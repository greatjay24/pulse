import { MoneyFinance, MoneySourceId, PortfolioEntity, ProjectFinance, TrackerMoney } from '../types';
import { UNASSIGNED, ownerOf, projectOwners } from './tracker';

const DAY = 86400;

export const SOURCE_LABEL: Record<MoneySourceId, string> = {
  stripe: 'Stripe',
  bank: 'Bank',
  email: 'Payment emails',
};

// One entity's money (or the whole portfolio's), summed over its tracker projects.
export interface FinanceSlice {
  d30: number;
  d90: number;
  months: Map<string, number>; // YYYY-MM -> total
  byChannel: [MoneySourceId, number][];
  byRail: [MoneySourceId, string, number][]; // [channel, rail, total]
  payers: { name: string; total: number; payments: number }[];
  repeat: number; // 90 days, from payers who paid more than once
  oneOff: number; // 90 days, from payers who paid once
  noPayer: number; // 90 days, counted with no payer name (payouts, bank deposits)
}

const cents = (v: number) => Math.round(v * 100) / 100;

function sortedEntries<K extends string>(m: Map<K, number>): [K, number][] {
  return [...m.entries()].map(([k, v]): [K, number] => [k, cents(v)]).sort((a, b) => b[1] - a[1]);
}

export function sumFinance(projects: ProjectFinance[]): FinanceSlice {
  const months = new Map<string, number>();
  const channel = new Map<MoneySourceId, number>();
  const rail = new Map<string, number>(); // "channel|rail" -> total
  // Same rule as Rust: payers match case-insensitively, first spelling wins.
  const payers = new Map<string, { name: string; total: number; payments: number }>();
  let d30 = 0;
  let d90 = 0;
  let noPayer = 0;
  for (const p of projects) {
    d30 += p.d30;
    d90 += p.d90;
    noPayer += p.no_payer_90d;
    for (const [m, v] of p.months) months.set(m, (months.get(m) ?? 0) + v);
    for (const [c, v] of p.by_channel) channel.set(c, (channel.get(c) ?? 0) + v);
    for (const [ch, r, v] of p.by_rail) rail.set(`${ch}|${r}`, (rail.get(`${ch}|${r}`) ?? 0) + v);
    for (const payer of p.payers) {
      const key = payer.name.toLowerCase();
      const seen = payers.get(key);
      if (seen) {
        seen.total += payer.total;
        seen.payments += payer.payments;
      } else {
        payers.set(key, { ...payer });
      }
    }
  }
  const payerList = [...payers.values()]
    .map((p) => ({ ...p, total: cents(p.total) }))
    .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
  const repeat = payerList.filter((p) => p.payments > 1).reduce((s, p) => s + p.total, 0);
  const oneOff = payerList.filter((p) => p.payments === 1).reduce((s, p) => s + p.total, 0);
  return {
    d30: cents(d30),
    d90: cents(d90),
    months,
    byChannel: sortedEntries(channel),
    byRail: sortedEntries(rail).map(([k, v]): [MoneySourceId, string, number] => {
      const [ch, r] = k.split('|');
      return [ch as MoneySourceId, r, v];
    }),
    payers: payerList,
    repeat: cents(repeat),
    oneOff: cents(oneOff),
    noPayer: cents(noPayer),
  };
}

// Projects a given entity owns (via portfolio.json tracker_projects). "unsorted" money and
// projects no entity lists belong to the Unassigned row.
export function projectsOf(entityId: string, finance: MoneyFinance, entities: PortfolioEntity[]): ProjectFinance[] {
  const owners = projectOwners(entities);
  return finance.projects.filter((p) => {
    const owner = p.project === 'unsorted' ? UNASSIGNED : ownerOf(p.project, owners);
    return owner === entityId;
  });
}

// The last `n` calendar months, oldest first, as YYYY-MM in local time.
export function trailingMonths(n: number, now: Date): string[] {
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  return out;
}

export function monthLabel(key: string, style: 'short' | 'long' = 'short'): string {
  const [y, m] = key.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString([], style === 'short' ? { month: 'short' } : { month: 'long', year: 'numeric' });
}

// How far back the money on file reaches: the earliest window start among connected
// sources. Collectors keep a fixed window (30 days today), so older months are unknown,
// not zero, and the views say so.
export function onFileSince(finance: MoneyFinance): number | null {
  const starts = finance.coverage
    .filter((c) => c.ok && c.collected_at && c.window_days)
    .map((c) => (c.collected_at as number) - (c.window_days as number) * DAY);
  return starts.length ? Math.min(...starts) : null;
}

export function windowDays(finance: MoneyFinance): number | null {
  const days = finance.coverage.filter((c) => c.ok && c.window_days).map((c) => c.window_days as number);
  return days.length ? Math.max(...days) : null;
}

// A month is on file when any of it falls inside a connected source's window.
export function monthOnFile(key: string, since: number | null): boolean {
  if (since === null) return false;
  const [y, m] = key.split('-').map(Number);
  return new Date(y, m, 1).getTime() / 1000 > since;
}

export function sourceOk(money: TrackerMoney, source: MoneySourceId): boolean {
  return money.finance.coverage.some((c) => c.source === source && c.ok);
}

export function formatUsdCompact(v: number): string {
  if (Math.abs(v) >= 1000) {
    return v.toLocaleString(undefined, { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 1 });
  }
  return v.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}

export function formatDay(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export const CONNECT_CMD = 'python3 ~/project-tracker/connect_money.py';

// ---------- weeks (the Money page's per-business charts) ----------

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// The last `n` weeks as their Mondays (YYYY-MM-DD, local), oldest first. Matches Rust local_week.
export function trailingWeeks(n: number, now: Date): string[] {
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7));
  return Array.from({ length: n }, (_, i) => ymd(new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() - 7 * (n - 1 - i))));
}

// A week is on file when any of it falls inside a connected source's window.
export function weekOnFile(key: string, since: number | null): boolean {
  if (since === null) return false;
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d + 7).getTime() / 1000 > since;
}

// Counted cash in by week (each dollar once, whichever channel saw it), with the channel split.
export function weeksOf(projects: ProjectFinance[]): Map<string, { total: number; byChannel: Map<MoneySourceId, number> }> {
  const out = new Map<string, { total: number; byChannel: Map<MoneySourceId, number> }>();
  for (const p of projects) {
    for (const [w, ch, v] of p.weeks ?? []) {
      const slot = out.get(w) ?? { total: 0, byChannel: new Map() };
      slot.total = cents(slot.total + v);
      slot.byChannel.set(ch, cents((slot.byChannel.get(ch) ?? 0) + v));
      out.set(w, slot);
    }
  }
  return out;
}

export function payoutWeeksOf(entityId: string, finance: MoneyFinance, entities: PortfolioEntity[]): Map<string, number> {
  const owners = projectOwners(entities);
  const out = new Map<string, number>();
  for (const [project, w, v] of finance.payout_weeks ?? []) {
    const owner = project === 'unsorted' ? UNASSIGNED : ownerOf(project, owners);
    if (owner === entityId) out.set(w, cents((out.get(w) ?? 0) + v));
  }
  return out;
}

// The entity's bank accounts, and their balances summed by day over the days every account reports.
export function balanceOf(entityId: string, finance: MoneyFinance, entities: PortfolioEntity[]) {
  const owners = projectOwners(entities);
  const accounts = finance.bank_accounts.filter((a) => (a.project ? ownerOf(a.project, owners) : UNASSIGNED) === entityId);
  const withSeries = accounts.filter((a) => a.balance_series?.length);
  const days = new Map<string, { sum: number; n: number }>();
  for (const a of withSeries) {
    for (const [d, v] of a.balance_series) {
      const s = days.get(d) ?? { sum: 0, n: 0 };
      days.set(d, { sum: s.sum + v, n: s.n + 1 });
    }
  }
  const series: [string, number][] = [...days.entries()]
    .filter(([, s]) => s.n === withSeries.length)
    .map(([d, s]): [string, number] => [d, cents(s.sum)])
    .sort((a, b) => a[0].localeCompare(b[0]));
  return { accounts, series };
}

export const MERCURY_CMD = 'python3 ~/project-tracker/connect_money.py mercury <business>';
