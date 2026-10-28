import { EntityDecision, PortfolioSnapshot, TrackerEmail, TrackerSnapshot, TrackerTask } from '../types';
import type { BoardEntity } from '../components/OrgBoard';
import { healthRank } from './portfolio';
import { isDueToday, isGate, openTaskList } from './tracker';
import { sumFinance, trailingMonths } from './finance';

// The one line Pulse leads with, and the decision queue under it. Today, the board, the
// menu bar count and notifications all read these, so every surface counts the same way.

// A move is tracker work due today: tasks marked now, "Decide:" gate items marked now or
// soon, and replies marked now. Report decisions are counted separately, as the queue.
export const isUrgentReply = (e: TrackerEmail) => e.urgency === 'now';

export function todayMoves(tracker: TrackerSnapshot): { tasks: TrackerTask[]; replies: TrackerEmail[] } {
  return {
    tasks: openTaskList(tracker).filter(isDueToday),
    replies: (tracker.email?.needs_reply ?? []).filter(isUrgentReply),
  };
}

export interface QueuedDecision {
  item: BoardEntity;
  decision: EntityDecision;
  index: number; // position in the entity's report, the fallback key when a decision has no id
}

// The entity's health first (red, then yellow, then green), then the soonest due date,
// then registry order, so the riskiest business's asks lead.
export function decisionQueue(items: BoardEntity[]): QueuedDecision[] {
  const queue = items.flatMap((item, order) =>
    (item.status?.decisions ?? []).map((decision, index) => ({ item, decision, index, order })),
  );
  const dueKey = (d: EntityDecision) => (d.due ? d.due : '9999');
  return queue
    .sort(
      (a, b) =>
        healthRank(a.item.status?.health) - healthRank(b.item.status?.health) ||
        dueKey(a.decision).localeCompare(dueKey(b.decision)) ||
        a.order - b.order ||
        a.index - b.index,
    )
    .map(({ item, decision, index }) => ({ item, decision, index }));
}

export function decisionKey(q: QueuedDecision): string {
  return `${q.item.entity.id}:${q.decision.id ?? q.index}`;
}

// Cash in this calendar month to date, or null when no money source is connected.
export function cashThisMonth(tracker: TrackerSnapshot | null, now = new Date()): number | null {
  if (!tracker || tracker.error || !tracker.money.configured) return null;
  const [month] = trailingMonths(1, now);
  return sumFinance(tracker.money.finance.projects).months.get(month) ?? 0;
}

export interface Headline {
  moves: number | null; // null until the tracker has been read
  decisions: number;
  cash: number | null;
}

export function headline(items: BoardEntity[], snapshot: PortfolioSnapshot | null, tracker: TrackerSnapshot | null): Headline | null {
  if (!snapshot?.registry) return null;
  const ok = tracker && !tracker.error ? tracker : null;
  const moves = ok ? todayMoves(ok) : null;
  return {
    moves: moves ? moves.tasks.length + moves.replies.length : null,
    decisions: items.reduce((n, i) => n + (i.status?.decisions?.length ?? 0), 0),
    cash: cashThisMonth(ok),
  };
}

// What a native notification may announce: a "now" gate item, or an entity turning red.
export interface UrgentSignal {
  key: string;
  title: string;
  body: string;
}

// `cleared` lists red keys whose entity has a fresh, non-red report. Only those are
// forgotten (so a later turn to red is news again); an unreadable report never is.
export function urgentSignals(items: BoardEntity[], tracker: TrackerSnapshot | null): { signals: UrgentSignal[]; cleared: string[] } {
  const signals: UrgentSignal[] = [];
  const cleared: string[] = [];
  if (tracker && !tracker.error) {
    for (const t of openTaskList(tracker)) {
      if (isGate(t) && t.urgency === 'now') {
        signals.push({ key: `gate:${t.id}`, title: 'Decision needed now', body: t.title.replace(/^decide:\s*/i, '') });
      }
    }
  }
  for (const i of items) {
    const key = `red:${i.entity.id}`;
    if (i.status?.health === 'red') {
      signals.push({ key, title: `${i.entity.name} is at risk`, body: i.status.health_why || i.status.headline || 'Health turned red.' });
    } else if (i.status) {
      cleared.push(key);
    }
  }
  return { signals, cleared };
}
