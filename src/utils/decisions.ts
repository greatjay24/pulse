import { ActivitySnapshot, AgentRun, DecisionRow, EntityDecision, PortfolioSnapshot, TrackerSnapshot } from '../types';

// Same rule as act.py's slug(): decisions written before ids existed are keyed by their ask.
export function slugify(text: string | undefined): string {
  return (text ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '');
}

export function decisionId(d: EntityDecision): string {
  return d.id || slugify(d.ask);
}

// pending: nobody has answered. running: approved, the lead is on it. failed: the lead's run
// ended in an error before it reported done. stalled: the run ended without a done line.
export type DecisionState = 'pending' | 'running' | 'failed' | 'stalled' | 'done' | 'rejected';

export interface DecisionView {
  state: DecisionState;
  answer: DecisionRow | null; // the owner's approve or reject
  done: DecisionRow | null;
  thread: DecisionRow[]; // discuss and reply, oldest first
  awaitingReply: boolean; // the last discuss has no reply yet
  run: AgentRun | null; // the latest act run for this decision
}

export function rowsFor(activity: ActivitySnapshot | null, entityId: string): DecisionRow[] {
  return activity?.decisions.find((d) => d.entity === entityId)?.rows ?? [];
}

export function actRuns(activity: ActivitySnapshot | null): AgentRun[] {
  const out: AgentRun[] = [];
  for (const f of activity?.runs ?? []) {
    if (!Array.isArray(f.data) && f.data?.kind === 'act') out.push(f.data);
  }
  return out;
}

const ms = (iso: string | undefined) => (iso ? Date.parse(iso) || 0 : 0);

export function viewOf(id: string, rows: DecisionRow[], runs: AgentRun[], entityId: string): DecisionView {
  let answer: DecisionRow | null = null;
  let done: DecisionRow | null = null;
  const thread: DecisionRow[] = [];
  for (const r of rows) {
    if (r.id !== id) continue;
    if (r.action === 'done') done = done ?? r;
    else if ((r.action === 'approve' || r.action === 'reject') && !done) answer = r;
    else if (r.action === 'discuss' || r.action === 'reply') thread.push(r);
  }
  const last = thread[thread.length - 1];
  const awaitingReply = last?.action === 'discuss';
  const mine = runs
    .filter((r) => r.entity === entityId && r.decision === id)
    .sort((a, b) => ms(b.started) - ms(a.started));
  const run = mine[0] ?? null;

  let state: DecisionState = 'pending';
  if (done) state = 'done';
  else if (answer?.action === 'reject') state = 'rejected';
  else if (answer?.action === 'approve') {
    // Only a run that started after the approval speaks for it.
    const approveRun = mine.find((r) => r.action === 'approve' && ms(r.started) >= ms(answer!.at) - 5_000);
    if (approveRun && approveRun.running === false) state = approveRun.ok === false ? 'failed' : 'stalled';
    else state = 'running';
  }
  return { state, answer, done, thread, awaitingReply, run };
}

// Answered decisions that have left status.json (the lead removes them once done or rejected),
// so the entity page can still show what happened to them. Newest first, last 7 days.
export function recentlyAnswered(
  entityId: string,
  open: EntityDecision[],
  activity: ActivitySnapshot | null,
  now: number,
): { id: string; ask: string; recommend?: string; view: DecisionView }[] {
  const openIds = new Set(open.map(decisionId));
  const rows = rowsFor(activity, entityId);
  const runs = actRuns(activity);
  const seen = new Map<string, DecisionRow>();
  for (const r of rows) {
    if (r.action === 'approve' || r.action === 'reject' || r.action === 'discuss') {
      if (!openIds.has(r.id) && now - ms(r.at) < 7 * 86_400_000) seen.set(r.id, r);
    }
  }
  return [...seen.entries()]
    .map(([id]) => {
      const first = rows.find((x) => x.id === id && x.ask);
      return { id, ask: first?.ask ?? id, recommend: first?.recommend, view: viewOf(id, rows, runs, entityId) };
    })
    .filter((x) => x.view.answer || x.view.done)
    .sort((a, b) => ms(b.view.done?.at ?? b.view.answer?.at) - ms(a.view.done?.at ?? a.view.answer?.at));
}

export function firstUrl(text: string | undefined): string | null {
  return text?.match(/https?:\/\/[^\s)>\]]+/)?.[0] ?? null;
}

// Gates where approving touches someone else or money: confirm first.
export function needsConfirm(d: EntityDecision): boolean {
  return d.gate === 'money' || d.gate === 'relationship';
}

// A status.json decision and its "Decide: …" tracker task are the same item. The decision
// (with its buttons) wins; the task is hidden when it belongs to the same entity and its
// title, minus "Decide:", matches the ask exactly or by word overlap. Same rule as act.py's
// tracker_match, so the task Pulse hides is the one an approval closes.
const DECIDE_STOP = new Set(['decide', 'the', 'a', 'an', 'and', 'or', 'to', 'of', 'for', 'on', 'in', 'your', 'with', 'then', 'what', 'goes', 'under']);
const words = (s: string) => new Set((s.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((w) => w.length > 1 && !DECIDE_STOP.has(w)));
const normalize = (s: string) => s.toLowerCase().replace(/^\s*decide\b\s*:?\s*/, '').replace(/[^a-z0-9]+/g, ' ').trim();

export function matchesDecision(taskTitle: string, ask: string): boolean {
  if (!/^\s*decide\b/i.test(taskTitle)) return false;
  if (normalize(taskTitle) === normalize(ask)) return true;
  const a = words(ask);
  const t = words(taskTitle);
  if (!a.size || !t.size) return false;
  let shared = 0;
  for (const w of a) if (t.has(w)) shared++;
  return shared / Math.min(a.size, t.size) >= 0.6;
}

export function withoutDecisionDuplicates(tracker: TrackerSnapshot, snapshot: PortfolioSnapshot | null): TrackerSnapshot {
  const entities = snapshot?.registry?.entities ?? [];
  const asks = new Map<string, string[]>(); // tracker project → open asks of the entity that owns it
  for (const e of entities) {
    const open = (snapshot?.entities.find((r) => r.id === e.id)?.status?.decisions ?? []).map((d) => d.ask);
    for (const p of e.tracker_projects ?? []) asks.set(p, open);
  }
  const tasks = tracker.tasks.filter((t) => !(asks.get(t.project ?? '') ?? []).some((ask) => matchesDecision(t.title, ask)));
  return tasks.length === tracker.tasks.length ? tracker : { ...tracker, tasks };
}
