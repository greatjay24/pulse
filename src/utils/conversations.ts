import { ActivitySnapshot, DecisionRow, LiveRun, LiveSnapshot, PortfolioSnapshot, RunTokens, TranscriptSummary } from '../types';
import { decisionId } from './decisions';
import { leadOwners, shifts, stampOf } from './activity';
import { ms } from './live';
import { frontDoorOf } from './command';

// Conversations: one thread per entity (plus the org's own, for the chief of staff and
// managers), each interleaving the owner's side (their answers in decisions.jsonl, their turns in a
// session) with the lead's (replies, done records, and every run's transcript).

export const ORG_THREAD = 'org';
export const PULSE_THREAD = 'front-door'; // the front door's own conversation, pinned first

export type ConvItem =
  | { type: 'owner'; key: string; at: number; row: DecisionRow; ask: string }
  | { type: 'lead'; key: string; at: number; row: DecisionRow; ask: string }
  | {
      type: 'run';
      key: string;
      at: number;
      runId: string | null; // null: a run from before transcripts, shown by its summary
      agent: string;
      kind: string;
      doing: string;
      ok?: boolean;
      cost?: number | null;
      tokens?: RunTokens;
      secs?: number | null;
      result?: string;
      agents?: number; // subagents deployed; 0 = worked solo
      live: LiveRun | null;
      parentRun?: string; // the front-door run that handed this one off
      trigger?: string; // report | brief | followup (front-door runs)
      source?: string; // telegram, schedule, ...
      children?: RunItem[]; // runs this one handed off (front door)
    };

export interface Thread {
  id: string; // entity id or ORG_THREAD
  name: string;
  lead: string | null;
  items: ConvItem[]; // oldest first, like a chat
  latest: number;
  working: boolean;
  preview: string;
}

type RunItem = Extract<ConvItem, { type: 'run' }>;

const VERB: Record<string, string> = { approve: 'Approved', reject: 'Rejected', discuss: 'Asked about', reply: 'Replied on', done: 'Done' };
export const verbOf = (action: string) => VERB[action] ?? action;

export function buildThreads(
  snapshot: PortfolioSnapshot | null,
  activity: ActivitySnapshot | null,
  index: TranscriptSummary[],
  live: LiveSnapshot | null,
): Thread[] {
  const entities = snapshot?.registry?.entities ?? [];
  const owners = leadOwners(entities);
  const threadOf = (entity: string | null | undefined) => (entity && entities.some((e) => e.id === entity) ? entity : ORG_THREAD);
  const door = frontDoorOf(snapshot?.registry);
  const runThread = (agent: string, entity: string | null | undefined) => (door && agent === door ? PULSE_THREAD : threadOf(entity));
  const items = new Map<string, ConvItem[]>();
  const add = (thread: string, it: ConvItem) => items.set(thread, [...(items.get(thread) ?? []), it]);

  // Runs, keyed by run id so a transcript, its live file and its log merge into one.
  const runs = new Map<string, { thread: string; item: RunItem }>();
  for (const s of index) {
    if (s.start?.t !== 'start') continue;
    const st = s.start;
    const item: RunItem = { type: 'run', key: `run-${s.run_id}`, at: ms(st.at), runId: s.run_id, agent: st.agent, kind: st.kind, doing: st.doing, live: null, parentRun: st.parent_run, trigger: st.trigger, source: st.source };
    if (s.last?.t === 'result') Object.assign(item, { ok: s.last.ok, cost: s.last.cost_usd, tokens: s.last.tokens, secs: s.last.secs, result: s.last.result, agents: s.last.agents });
    runs.set(s.run_id, { thread: runThread(st.agent, st.entity), item });
  }
  for (const r of live?.runs ?? []) {
    const known = runs.get(r.run_id);
    if (known) {
      known.item.live = r;
      const pending = r.state === 'running' || r.state === 'idle' || r.state === 'queued';
      if (!pending && known.item.ok === undefined) {
        Object.assign(known.item, { ok: r.ok ?? r.state === 'finished', cost: r.cost_usd, tokens: r.tokens, secs: r.secs, result: r.result });
      }
      if (r.kind !== 'interactive' && !pending) known.item.agents ??= r.team?.length ?? 0;
    } else {
      runs.set(r.run_id, {
        thread: runThread(r.agent, r.entity),
        item: { type: 'run', key: `run-${r.run_id}`, at: ms(r.started), runId: r.run_id, agent: r.agent, kind: r.kind, doing: r.doing, live: r, parentRun: r.parent_run, trigger: r.trigger, source: r.source },
      });
    }
  }

  // Run logs: fill in cost for transcripts, and keep older runs that have no transcript.
  const legacy = (thread: string, key: string, at: number, agent: string, kind: string, doing: string, r: { ok?: boolean; cost_usd?: number | null; tokens?: RunTokens; secs?: number; result?: string }) =>
    add(thread, { type: 'run', key, at, runId: null, agent, kind, doing, ok: r.ok, cost: r.cost_usd, tokens: r.tokens, secs: r.secs, result: r.result, live: null });
  for (const shift of shifts(activity)) {
    shift.runs.forEach((r, i) => {
      const known = r.run_id ? runs.get(r.run_id) : undefined;
      if (known) {
        known.item.cost ??= r.cost_usd;
        known.item.tokens ??= r.tokens;
        known.item.agents ??= r.agents;
        return;
      }
      const weekly = r.agent === 'chief-of-staff';
      legacy(threadOf(owners.get(r.agent)), `log-${shift.file}-${i}`, shift.at, r.agent, weekly ? 'weekly' : 'nightly', weekly ? 'Weekly review' : 'Night shift', r);
    });
  }
  const asks = new Map<string, string>();
  for (const report of snapshot?.entities ?? []) {
    for (const d of report.status?.decisions ?? []) asks.set(`${report.id}/${decisionId(d)}`, d.ask);
  }
  for (const { entity, rows } of activity?.decisions ?? []) {
    for (const r of rows) if (r.ask) asks.set(`${entity}/${r.id}`, r.ask);
  }
  for (const f of activity?.runs ?? []) {
    const r = f.data;
    if (Array.isArray(r) || r?.kind !== 'act' || r.running) continue;
    const known = r.run_id ? runs.get(r.run_id) : undefined;
    if (known) {
      known.item.cost ??= r.cost_usd;
      known.item.tokens ??= r.tokens;
      known.item.agents ??= r.agents;
      continue;
    }
    const ask = asks.get(`${r.entity}/${r.decision}`) ?? r.decision ?? '';
    const at = ms(r.started) || stampOf(f.file.replace(/^act-/, '')) || 0;
    legacy(threadOf(r.entity), `log-${f.file}`, at, r.agent, 'act', `${r.action ? verbOf(r.action) : 'Answer'}: ${ask}`, r);
  }
  // Hand-offs also nest under the front-door run that launched them, like a team deployment.
  for (const { item } of runs.values()) {
    const parent = item.parentRun ? runs.get(item.parentRun)?.item : undefined;
    if (parent) parent.children = [...(parent.children ?? []), item].sort((a, b) => a.at - b.at);
  }
  for (const { thread, item } of runs.values()) add(thread, item);

  // decisions.jsonl: the owner's answers and the lead's replies.
  for (const { entity, rows } of activity?.decisions ?? []) {
    rows.forEach((row, i) => {
      const at = ms(row.at);
      if (!at) return;
      const ask = asks.get(`${entity}/${row.id}`) ?? row.id;
      const mine = row.action === 'approve' || row.action === 'reject' || row.action === 'discuss';
      add(threadOf(entity), { type: mine ? 'owner' : 'lead', key: `dec-${entity}-${i}`, at, row, ask });
    });
  }

  const threads: Thread[] = [];
  for (const [id, list] of items) {
    const sorted = list.sort((a, b) => a.at - b.at);
    const e = entities.find((x) => x.id === id);
    const last = sorted[sorted.length - 1];
    const working = sorted.some((i) => i.type === 'run' && i.live?.state === 'running');
    threads.push({
      id,
      name: id === PULSE_THREAD ? 'Pulse' : e?.name ?? 'Organization',
      lead: id === PULSE_THREAD ? door : e?.lead ?? null,
      items: sorted,
      latest: last?.at ?? 0,
      working,
      preview: previewOf(last),
    });
  }
  // Every lead gets a thread, so the owner can start a conversation with one that has none yet.
  const chief = (snapshot?.registry as { chief_of_staff?: { lead?: string } } | null | undefined)?.chief_of_staff?.lead;
  for (const e of entities) {
    if (e.lead && !items.has(e.id)) threads.push({ id: e.id, name: e.name, lead: e.lead, items: [], latest: 0, working: false, preview: 'No conversation yet' });
  }
  if (chief && !items.has(ORG_THREAD)) threads.push({ id: ORG_THREAD, name: 'Organization', lead: null, items: [], latest: 0, working: false, preview: 'No conversation yet' });
  if (door && !items.has(PULSE_THREAD)) threads.push({ id: PULSE_THREAD, name: 'Pulse', lead: door, items: [], latest: 0, working: false, preview: 'Ask anything; Pulse hands it to the right lead' });
  // Pulse first, always: it's the one conversation the owner never has to look for.
  return threads.sort((a, b) => Number(b.id === PULSE_THREAD) - Number(a.id === PULSE_THREAD) || Number(b.working) - Number(a.working) || b.latest - a.latest);
}

function previewOf(it: ConvItem | undefined): string {
  if (!it) return '';
  if (it.type === 'run') {
    if (it.live?.state === 'running') return `${it.agent}: ${it.live.step}`;
    return `${it.agent}: ${(it.result || it.doing || '').replace(/\s+/g, ' ').slice(0, 120)}`;
  }
  const who = it.type === 'owner' ? 'You' : 'Lead';
  return `${who}: ${verbOf(it.row.action)} ${it.row.note || it.ask}`.slice(0, 120);
}

export function threadOfRun(threads: Thread[], runId: string): Thread | undefined {
  return threads.find((t) => t.items.some((i) => i.type === 'run' && i.runId === runId));
}
