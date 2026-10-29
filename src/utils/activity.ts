import { ActivitySnapshot, AgentRun, PortfolioEntity, PortfolioSnapshot } from '../types';
import { decisionId } from './decisions';

// One line on the Activity timeline. Built only from files the organization wrote:
// run logs, git commits, status.json `done`, decisions.jsonl and the sales ledgers.
export type ActivityKind = 'run' | 'act' | 'commit' | 'done' | 'answer' | 'report' | 'drafts';

export interface ActivityItem {
  key: string;
  at: number; // ms
  day: string; // YYYY-MM-DD, local
  entity: string | null; // null = the whole org (a nightly commit, chief of staff)
  kind: ActivityKind;
  title: string;
  detail?: string;
  cost?: number;
  secs?: number;
  ok?: boolean;
  running?: boolean;
  link?: string | null;
  runId?: string; // the run's transcript, for Conversations
}

export function localDay(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// "2026-10-28_0940.json" → local time. Nightly logs carry no timestamp inside.
export function stampOf(file: string): number | null {
  const m = file.match(/^(\d{4})-(\d{2})-(\d{2})_(\d{2})(\d{2})/);
  if (!m) return null;
  return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]).getTime();
}

// "2026-10-27" (a date with no time) reads as local noon, so it lands on the right day.
function dateMs(s: string | null | undefined): number | null {
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const [y, m, d] = s.split('-').map(Number);
    return new Date(y, m - 1, d, 12).getTime();
  }
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : t;
}

// Lead summaries are short markdown; the timeline wants plain text.
export function plainSummary(text: string | undefined, max = 320): string {
  const plain = (text ?? '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/`(.+?)`/g, '$1')
    .replace(/^\s*[-*]\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
  return plain.length > max ? `${plain.slice(0, max - 1)}…` : plain;
}

export function leadOwners(entities: PortfolioEntity[]): Map<string, string> {
  return new Map(entities.filter((e) => e.lead).map((e) => [e.lead as string, e.id]));
}

export interface NightRun {
  file: string;
  at: number;
  runs: AgentRun[];
}

// Scheduled shifts (nightly.py logs: an array per run), newest first.
export function shifts(activity: ActivitySnapshot | null): NightRun[] {
  const out: NightRun[] = [];
  for (const f of activity?.runs ?? []) {
    const at = stampOf(f.file);
    if (Array.isArray(f.data) && at !== null) out.push({ file: f.file, at, runs: f.data });
  }
  return out.sort((a, b) => b.at - a.at);
}

export function activityItems(activity: ActivitySnapshot | null, snapshot: PortfolioSnapshot | null): ActivityItem[] {
  const entities = snapshot?.registry?.entities ?? [];
  const owners = leadOwners(entities);
  const ids = new Set(entities.map((e) => e.id));
  const nameOf = (id: string) => entities.find((e) => e.id === id)?.name ?? id;
  const items: ActivityItem[] = [];
  const push = (it: Omit<ActivityItem, 'day'>) => items.push({ ...it, day: localDay(it.at) });
  // Decision ids read badly; show the ask (from status.json, or the copy act.py keeps in each row).
  const asks = new Map<string, string>();
  for (const report of snapshot?.entities ?? []) {
    for (const d of report.status?.decisions ?? []) asks.set(`${report.id}/${decisionId(d)}`, d.ask);
  }
  for (const { entity, rows } of activity?.decisions ?? []) {
    for (const r of rows) if (r.ask) asks.set(`${entity}/${r.id}`, r.ask);
  }
  const askOf = (entity: string | undefined, id: string | undefined) => asks.get(`${entity}/${id}`) ?? id ?? '';
  const VERB = { approve: 'approval', reject: 'rejection', discuss: 'question' } as const;

  for (const shift of shifts(activity)) {
    shift.runs.forEach((r, i) =>
      push({
        key: `run-${shift.file}-${i}`,
        at: shift.at,
        entity: owners.get(r.agent) ?? null,
        kind: 'run',
        title: `${r.agent} ran the ${r.agent === 'chief-of-staff' ? 'weekly review' : 'night shift'}`,
        detail: plainSummary(r.result),
        cost: r.cost_usd ?? undefined,
        secs: r.secs,
        ok: r.ok,
        runId: r.run_id,
      }),
    );
  }

  for (const f of activity?.runs ?? []) {
    const r = f.data;
    if (Array.isArray(r) || r?.kind !== 'act') continue;
    const at = dateMs(r.finished ?? r.started);
    if (at === null) continue;
    push({
      key: `act-${f.file}`,
      at,
      entity: r.entity ?? null,
      kind: 'act',
      title: `${r.agent} ${r.running ? 'is acting on' : 'acted on'} your ${r.action ? VERB[r.action] : 'answer'}: ${askOf(r.entity, r.decision)}`,
      detail: r.running ? undefined : plainSummary(r.result),
      cost: r.cost_usd ?? undefined,
      secs: r.running ? undefined : r.secs,
      ok: r.running ? undefined : r.ok,
      running: !!r.running,
      runId: r.run_id,
    });
  }

  for (const c of activity?.commits ?? []) {
    const at = dateMs(c.at);
    if (at === null) continue;
    const prefix = c.subject.match(/^([a-z0-9-]+):/)?.[1];
    push({
      key: `commit-${c.hash}`,
      at,
      entity: prefix && ids.has(prefix) ? prefix : null,
      kind: 'commit',
      title: c.subject,
      detail: c.hash.slice(0, 7),
    });
  }

  for (const report of snapshot?.entities ?? []) {
    (report.status?.done ?? []).forEach((d, i) => {
      const at = dateMs(d.date);
      if (at === null) return;
      push({ key: `done-${report.id}-${i}`, at, entity: report.id, kind: 'done', title: d.what, link: d.link ?? null });
    });
  }

  for (const { entity, rows } of activity?.decisions ?? []) {
    rows.forEach((r, i) => {
      const at = dateMs(r.at);
      if (at === null) return;
      const what = askOf(entity, r.id);
      const mine = r.action === 'approve' || r.action === 'reject' || r.action === 'discuss';
      const verb = { approve: 'You approved', reject: 'You rejected', discuss: 'You asked about', done: 'Done', reply: 'Lead replied on' }[r.action];
      push({
        key: `dec-${entity}-${i}`,
        at,
        entity,
        kind: mine ? 'answer' : 'report',
        title: r.action === 'done' ? `Done: ${what}` : `${verb}: ${what}`,
        detail: r.note || undefined,
        link: r.action === 'done' ? r.note?.match(/https?:\/\/[^\s)>\]]+/)?.[0] ?? null : null,
      });
    });
  }

  // Sales drafts: one line per entity per day, not one per email.
  const drafts = new Map<string, { at: number; entity: string; n: number; prospects: string[] }>();
  for (const d of activity?.drafts ?? []) {
    const at = dateMs(d.date);
    if (at === null) continue;
    const k = `${d.entity}-${localDay(at)}`;
    const g = drafts.get(k) ?? { at, entity: d.entity, n: 0, prospects: [] };
    g.n += 1;
    g.at = Math.max(g.at, at);
    if (d.prospect && g.prospects.length < 6) g.prospects.push(d.prospect);
    drafts.set(k, g);
  }
  for (const [k, g] of drafts) {
    push({
      key: `drafts-${k}`,
      at: g.at,
      entity: g.entity,
      kind: 'drafts',
      title: `${g.n} sales ${g.n === 1 ? 'draft' : 'drafts'} written for ${nameOf(g.entity)}`,
      detail: g.prospects.join(', ') + (g.n > g.prospects.length ? ', …' : ''),
    });
  }

  return items.sort((a, b) => b.at - a.at);
}

export function costBetween(items: ActivityItem[], from: number, to = Infinity): number {
  return items.reduce((sum, i) => sum + (i.at >= from && i.at < to && i.cost ? i.cost : 0), 0);
}

export function startOfDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function formatCost(usd: number): string {
  return usd < 10 ? `$${usd.toFixed(2)}` : `$${Math.round(usd)}`;
}

export function formatSecs(secs: number | undefined): string {
  if (secs === undefined) return '';
  return secs < 60 ? `${secs}s` : `${Math.floor(secs / 60)}m ${secs % 60}s`;
}
