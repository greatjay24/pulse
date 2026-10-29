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
