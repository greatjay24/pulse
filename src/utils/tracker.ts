import { openUrl } from '@tauri-apps/plugin-opener';
import {
  PortfolioEntity,
  TrackerEmail,
  TrackerNote,
  TrackerRepo,
  TrackerSnapshot,
  TrackerTask,
  Urgency,
} from '../types';

const IS_TAURI = typeof window !== 'undefined' && !!(window as any).__TAURI_INTERNALS__;

// Lead agents file decisions for the owner as tasks titled "Decide: …". They outrank everything else.
export function isGate(task: TrackerTask): boolean {
  return /^decide:/i.test(task.title.trim());
}

const URGENCY_RANK: Record<Urgency, number> = { now: 0, soon: 1, whenever: 2 };
const urgencyRank = (u: Urgency | null) => (u ? URGENCY_RANK[u] ?? 3 : 3);

// Gate items first, then by urgency, then oldest first (the brief's order).
export function sortTasks(tasks: TrackerTask[]): TrackerTask[] {
  return [...tasks].sort(
    (a, b) =>
      Number(isGate(b)) - Number(isGate(a)) ||
      urgencyRank(a.urgency) - urgencyRank(b.urgency) ||
      (a.first_seen ?? 0) - (b.first_seen ?? 0),
  );
}

export function sortReplies(replies: TrackerEmail[]): TrackerEmail[] {
  return [...replies].sort(
    (a, b) => urgencyRank(a.urgency) - urgencyRank(b.urgency) || (b.age_days ?? 0) - (a.age_days ?? 0),
  );
}

// Maps each tracker project id to the entity that owns it. An entity's tracker_projects
// list wins; an entity id that is also a tracker project (e.g. "personal") maps to itself
// unless another entity claims it.
export function projectOwners(entities: PortfolioEntity[]): Map<string, string> {
  const owners = new Map<string, string>();
  for (const e of entities) {
    for (const p of e.tracker_projects ?? []) owners.set(p, e.id);
  }
  for (const e of entities) {
    if (!owners.has(e.id)) owners.set(e.id, e.id);
  }
  return owners;
}

export const UNASSIGNED = '__unassigned';

export function ownerOf(project: string | null, owners: Map<string, string>): string {
  return (project && owners.get(project)) || UNASSIGNED;
}

export interface EntityTracker {
  tasks: TrackerTask[]; // open, sorted; email replies live in `replies` instead
  scheduled: TrackerTask[];
  replies: TrackerEmail[];
  repos: { repo: TrackerRepo; note: TrackerNote | null }[];
  money: { d7: number; d30: number } | null; // null when the tracker attributes no money here
}

// Email replies also appear in tasks.json (source "email"); email.json is the fresher
// copy, so Pulse lists them once, under "Needs a reply".
const isTaskListItem = (t: TrackerTask) => t.source !== 'email';

export function entityTracker(entityId: string, tracker: TrackerSnapshot, owners: Map<string, string>): EntityTracker {
  const mine = (project: string | null) => ownerOf(project, owners) === entityId;
  const tasks = tracker.tasks.filter((t) => isTaskListItem(t) && mine(t.project));
  const moneyFor = (rows: [string, number][]) =>
    rows.filter(([p]) => p !== 'unsorted' && mine(p)).reduce((sum, [, v]) => sum + v, 0);
  const hasMoney = tracker.money.by_project_d30.some(([p]) => p !== 'unsorted' && mine(p));
  return {
    tasks: sortTasks(tasks.filter((t) => t.status === 'open')),
    scheduled: tasks
      .filter((t) => t.status === 'scheduled')
      .sort((a, b) => (a.show_from ?? '').localeCompare(b.show_from ?? '')),
    replies: sortReplies((tracker.email?.needs_reply ?? []).filter((e) => mine(e.project))),
    repos: tracker.repos
      .filter((r) => mine(r.id))
      .sort((a, b) => (a.days_idle ?? Infinity) - (b.days_idle ?? Infinity))
      .map((repo) => ({ repo, note: tracker.notes[repo.id] ?? null })),
    money: hasMoney
      ? { d7: moneyFor(tracker.money.by_project_d7), d30: moneyFor(tracker.money.by_project_d30) }
      : null,
  };
}

export function dueNow(tasks: TrackerTask[]): TrackerTask[] {
  return tasks.filter((t) => t.status === 'open' && t.urgency === 'now');
}

export function openTaskList(tracker: TrackerSnapshot): TrackerTask[] {
  return tracker.tasks.filter((t) => t.status === 'open' && isTaskListItem(t));
}

export function formatUsd(v: number): string {
  return v.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}

export function formatIdle(days: number | null): string {
  if (days === null) return 'no activity';
  if (days < 1 / 24) return 'active now';
  if (days < 1) return `${Math.round(days * 24)}h idle`;
  return `${Math.round(days)}d idle`;
}

export function formatWaiting(unixSeconds: number | null, now: number): string | null {
  if (!unixSeconds) return null;
  const days = (now / 1000 - unixSeconds) / 86400;
  if (days < 1) return 'today';
  return `${Math.floor(days)}d`;
}

// Links open in the default browser through the Tauri opener; only http(s) is followed.
export function openExternal(url: string | null) {
  if (!url || !/^https?:\/\//i.test(url)) return;
  if (IS_TAURI) {
    openUrl(url).catch((e) => console.error('Failed to open link:', e));
  } else {
    window.open(url, '_blank', 'noopener');
  }
}
