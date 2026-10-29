import { UsageRun, UsageTokens } from '../types/usage';

// Usage arithmetic for the Usage page. A run's cost is spread over the hours it used
// (`hours`), so a long session counts in the day, week or month each part of it fell in.
// Tokens follow the same share as the cost.

export type Grain = 'day' | 'week' | 'month';
export const GRAIN_SPAN: Record<Grain, number> = { day: 14, week: 12, month: 6 };

export const KIND_LABEL: Record<string, string> = {
  nightly: 'Night shift',
  weekly: 'Weekly review',
  act: 'Decisions',
  chat: 'Chat',
  watch: 'Watchers',
  check: 'Checks',
  learn: 'Learning',
  interactive: 'Your sessions',
  headless: 'Other headless',
};

export const kindLabel = (k: string) => KIND_LABEL[k] ?? k.charAt(0).toUpperCase() + k.slice(1);

export function zeroTokens(): UsageTokens {
  return { input: 0, output: 0, cache_read: 0, cache_write: 0 };
}

export function totalTokens(t: UsageTokens | null | undefined): number {
  return t ? t.input + t.output + t.cache_read + t.cache_write : 0;
}

export function addTokens(a: UsageTokens, b: UsageTokens | null | undefined, share = 1): UsageTokens {
  if (!b) return a;
  a.input += b.input * share;
  a.output += b.output * share;
  a.cache_read += b.cache_read * share;
  a.cache_write += b.cache_write * share;
  return a;
}

export function bucketStart(ms: number, grain: Grain): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  if (grain === 'week') d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // weeks start Monday
  if (grain === 'month') d.setDate(1);
  return d.getTime();
}

export function nextBucket(ms: number, grain: Grain): number {
  const d = new Date(ms);
  if (grain === 'day') d.setDate(d.getDate() + 1);
  else if (grain === 'week') d.setDate(d.getDate() + 7);
  else d.setMonth(d.getMonth() + 1);
  return d.getTime();
}

export function bucketLabel(ms: number, grain: Grain, long = false): string {
  const d = new Date(ms);
  if (grain === 'month') return d.toLocaleDateString([], { month: long ? 'long' : 'short', year: long ? 'numeric' : undefined });
  if (grain === 'week') return `${long ? 'Week of ' : ''}${d.toLocaleDateString([], { month: 'short', day: 'numeric' })}`;
  return long ? d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }) : String(d.getDate());
}

// The buckets on screen, oldest first: the last N days, weeks or months, ending with the current one.
export function buckets(grain: Grain, now: number): number[] {
  const out: number[] = [];
  let b = bucketStart(now, grain);
  for (let i = 0; i < GRAIN_SPAN[grain]; i++) {
    out.unshift(b);
    b = bucketStart(b - 1, grain);
  }
  return out;
}

// The part of a run that fell in [from, to): its cost there and its share of the whole.
export function runIn(run: UsageRun, from: number, to: number): { cost: number; share: number } {
  const hours = Object.entries(run.hours ?? {});
  const whole = hours.reduce((s, [, c]) => s + c, 0);
  let cost = 0;
  let any = false;
  for (const [h, c] of hours) {
    const t = Date.parse(h);
    if (t >= from && t < to) {
      cost += c;
      any = true;
    }
  }
  if (whole > 0) return { cost, share: cost / whole };
  // No cost on record (a run that reported none): place it by its start.
  const at = Date.parse(run.started ?? '');
  const inside = any || (at >= from && at < to);
  return { cost: 0, share: inside ? 1 : 0 };
}

export interface Tally {
  cost: number;
  tokens: UsageTokens;
  runs: number;
  estimated: boolean; // some of the cost is our estimate rather than Claude Code's report
}

export function emptyTally(): Tally {
  return { cost: 0, tokens: zeroTokens(), runs: 0, estimated: false };
}

function addRun(t: Tally, run: UsageRun, part: { cost: number; share: number }) {
  t.cost += part.cost;
  addTokens(t.tokens, run.tokens, part.share);
  t.runs += 1;
  if (run.cost_basis === 'estimated') t.estimated = true;
}

export function tallyBuckets(runs: UsageRun[], grain: Grain, now: number): { start: number; tally: Tally }[] {
  return buckets(grain, now).map((start) => {
    const end = nextBucket(start, grain);
    const tally = emptyTally();
    for (const r of runs) {
      const part = runIn(r, start, end);
      if (part.share > 0) addRun(tally, r, part);
    }
    return { start, tally };
  });
}

// Totals per group (business, lead, kind) over [from, to), largest first.
export function groupBy(runs: UsageRun[], key: (r: UsageRun) => string, from: number, to: number): { key: string; tally: Tally }[] {
  const m = new Map<string, Tally>();
  for (const r of runs) {
    const part = runIn(r, from, to);
    if (part.share <= 0) continue;
    const k = key(r);
    if (!m.has(k)) m.set(k, emptyTally());
    addRun(m.get(k)!, r, part);
  }
  return [...m.entries()].map(([key, tally]) => ({ key, tally })).sort((a, b) => b.tally.cost - a.tally.cost);
}

// Per model, from each run's by_model split.
export function byModel(runs: UsageRun[], from: number, to: number): { key: string; tally: Tally }[] {
  const m = new Map<string, Tally>();
  for (const r of runs) {
    const part = runIn(r, from, to);
    if (part.share <= 0) continue;
    const models = r.by_model && Object.keys(r.by_model).length ? Object.entries(r.by_model) : null;
    if (!models) {
      const k = r.models[0] ?? 'Not reported';
      if (!m.has(k)) m.set(k, emptyTally());
      addRun(m.get(k)!, r, part);
      continue;
    }
    const whole = models.reduce((s, [, u]) => s + (u.cost_usd ?? 0), 0);
    for (const [model, u] of models) {
      if (!m.has(model)) m.set(model, emptyTally());
      const t = m.get(model)!;
      // The run's cost in range, split by each model's share of the run's cost.
      t.cost += whole > 0 ? part.cost * ((u.cost_usd ?? 0) / whole) : 0;
      addTokens(t.tokens, u, part.share);
      t.runs += 1;
      if (r.cost_basis === 'estimated') t.estimated = true;
    }
  }
  return [...m.entries()].map(([key, tally]) => ({ key, tally })).sort((a, b) => b.tally.cost - a.tally.cost);
}

export function topRuns(runs: UsageRun[], from: number, to: number, n = 10): { run: UsageRun; cost: number; share: number }[] {
  return runs
    .map((run) => ({ run, ...runIn(run, from, to) }))
    .filter((x) => x.share > 0)
    .sort((a, b) => b.cost - a.cost)
    .slice(0, n);
}

export function modelLabel(model: string): string {
  // claude-opus-5-5 -> Opus 5.5; anything else stays as written.
  const m = /^claude-(opus|sonnet|haiku|fable)-(\d+)-(\d+)/.exec(model);
  return m ? `${m[1].charAt(0).toUpperCase()}${m[1].slice(1)} ${m[2]}.${m[3]}` : model;
}

export function formatUsd(usd: number): string {
  if (usd >= 1000) return `$${(usd / 1000).toFixed(usd >= 10000 ? 0 : 1)}k`;
  if (usd >= 100) return `$${Math.round(usd)}`;
  return `$${usd.toFixed(2)}`;
}

export function formatCount(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${Math.round(n / 1e3)}k`;
  return String(Math.round(n));
}

export function formatPct(x: number): string {
  return `${Math.round(x * 100)}%`;
}

export function formatAgo(secs: number): string {
  if (secs < 90) return 'just now';
  if (secs < 5400) return `${Math.round(secs / 60)} min ago`;
  if (secs < 36 * 3600) return `${Math.round(secs / 3600)} h ago`;
  return `${Math.round(secs / 86400)} days ago`;
}
