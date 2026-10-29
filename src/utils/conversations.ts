import { ActivitySnapshot, DecisionRow, LiveRun, LiveSnapshot, PortfolioSnapshot, TranscriptSummary } from '../types';
import { decisionId } from './decisions';
import { leadOwners, shifts, stampOf } from './activity';
import { ms } from './live';

// Conversations: one thread per entity (plus the org's own, for the chief of staff and
// managers), each interleaving the owner's side (their answers in decisions.jsonl, their turns in a
// session) with the lead's (replies, done records, and every run's transcript).

export const ORG_THREAD = 'org';

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
      secs?: number | null;
      result?: string;
      agents?: number; // subagents deployed; 0 = worked solo
      live: LiveRun | null;
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
  const items = new Map<string, ConvItem[]>();
  const add = (thread: string, it: ConvItem) => items.set(thread, [...(items.get(thread) ?? []), it]);

  // Runs, keyed by run id so a transcript, its live file and its log merge into one.
  const runs = new Map<string, { thread: string; item: RunItem }>();
  for (const s of index) {
    if (s.start?.t !== 'start') continue;
    const st = s.start;
    const item: RunItem = { type: 'run', key: `run-${s.run_id}`, at: ms(st.at), runId: s.run_id, agent: st.agent, kind: st.kind, doing: st.doing, live: null };
    if (s.last?.t === 'result') Object.assign(item, { ok: s.last.ok, cost: s.last.cost_usd, secs: s.last.secs, result: s.last.result, agents: s.last.agents });
    runs.set(s.run_id, { thread: threadOf(st.entity), item });
  }
  for (const r of live?.runs ?? []) {
    const known = runs.get(r.run_id);
    if (known) {
      known.item.live = r;
      if (r.state !== 'running' && r.state !== 'idle' && known.item.ok === undefined) {
        Object.assign(known.item, { ok: r.ok ?? r.state === 'finished', cost: r.cost_usd, secs: r.secs, result: r.result });
      }
      if (r.kind !== 'interactive' && r.state !== 'running') known.item.agents ??= r.team?.length ?? 0;
    } else {
      runs.set(r.run_id, {
        thread: threadOf(r.entity),
        item: { type: 'run', key: `run-${r.run_id}`, at: ms(r.started), runId: r.run_id, agent: r.agent, kind: r.kind, doing: r.doing, live: r },
      });
    }
  }

  // Run logs: fill in cost for transcripts, and keep older runs that have no transcript.
  const legacy = (thread: string, key: string, at: number, agent: string, kind: string, doing: string, r: { ok?: boolean; cost_usd?: number | null; secs?: number; result?: string }) =>
    add(thread, { type: 'run', key, at, runId: null, agent, kind, doing, ok: r.ok, cost: r.cost_usd, secs: r.secs, result: r.result, live: null });
  for (const shift of shifts(activity)) {
    shift.runs.forEach((r, i) => {
      const known = r.run_id ? runs.get(r.run_id) : undefined;
      if (known) {
        known.item.cost ??= r.cost_usd;
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
      known.item.agents ??= r.agents;
      continue;
    }
    const ask = asks.get(`${r.entity}/${r.decision}`) ?? r.decision ?? '';
    const at = ms(r.started) || stampOf(f.file.replace(/^act-/, '')) || 0;
    legacy(threadOf(r.entity), `log-${f.file}`, at, r.agent, 'act', `${r.action ? verbOf(r.action) : 'Answer'}: ${ask}`, r);
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
      name: e?.name ?? 'Organization',
      lead: e?.lead ?? null,
      items: sorted,
      latest: last?.at ?? 0,
      working,
      preview: previewOf(last),
    });
  }
  return threads.sort((a, b) => Number(b.working) - Number(a.working) || b.latest - a.latest);
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
