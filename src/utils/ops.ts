import { Goal } from '../types/ops';

export type Pace = 'on-track' | 'at-risk' | 'done' | 'missed' | 'no-date' | 'unmeasured';

const AT_RISK_SLACK = 0.15;

function day(s: string): number {
  const [y, m, d] = s.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

// Same rule as ~/portfolio/bin/goals.py `pace`: progress from the baseline toward the target,
// against the share of the time between start and the date that has passed.
export function pace(g: Goal, now: Date = new Date()): Pace {
  const { target: t, current: c } = g;
  if (t == null || c == null) return 'unmeasured';
  const base = g.baseline ?? 0;
  const down = g.direction === 'down';
  if (down ? c <= t : c >= t) return 'done';
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  if (g.by && day(g.by) < today) return 'missed';
  if (g.at_risk) return 'at-risk';
  if (!g.by) return 'no-date';
  if (!g.start || t === base) return 'on-track';
  const span = Math.max((day(g.by) - day(g.start)) / 86_400_000, 1);
  const expected = Math.min(Math.max((today - day(g.start)) / 86_400_000 / span, 0), 1);
  const progress = (c - base) / (t - base);
  return progress < expected - AT_RISK_SLACK ? 'at-risk' : 'on-track';
}

// 0..1 toward the target, or null when it can't be measured.
export function progress(g: Goal): number | null {
  if (g.target == null || g.current == null) return null;
  const base = g.baseline ?? 0;
  if (g.target === base) return g.current === g.target ? 1 : 0;
  return Math.min(Math.max((g.current - base) / (g.target - base), 0), 1);
}

export const PACE_LABEL: Record<Pace, string> = {
  'on-track': 'On track',
  'at-risk': 'At risk',
  done: 'Done',
  missed: 'Missed',
  'no-date': 'No date',
  unmeasured: 'Not measured',
};

const PACE_ORDER: Record<Pace, number> = { 'at-risk': 0, missed: 1, 'on-track': 2, 'no-date': 3, unmeasured: 4, done: 5 };

// The goal a business card leads with: confirmed before proposed, then the one most at risk.
export function topGoal(goals: Goal[] | undefined, now: Date = new Date()): Goal | null {
  if (!goals?.length) return null;
  const ranked = goals
    .map((g, i) => ({ g, i }))
    .filter(({ g }) => pace(g, now) !== 'done')
    .sort((a, b) => Number(!!a.g.proposed) - Number(!!b.g.proposed) || PACE_ORDER[pace(a.g, now)] - PACE_ORDER[pace(b.g, now)] || a.i - b.i);
  return ranked[0]?.g ?? null;
}

export function formatAmount(n: number | null, unit: string): string {
  if (n == null) return '?';
  if (unit === 'USD') {
    return n.toLocaleString([], { style: 'currency', currency: 'USD', maximumFractionDigits: Math.abs(n) >= 100 ? 0 : 2 });
  }
  const v = n.toLocaleString([], { maximumFractionDigits: 2 });
  return unit === '%' ? `${v}%` : v;
}

export function formatDate(s: string | null | undefined): string {
  if (!s) return 'no date';
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}

// Edit form text fields -> the number Rust expects (empty means "unknown").
export function parseAmount(s: string): number | null | 'invalid' {
  const t = s.replace(/[$,%\s]/g, '');
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : 'invalid';
}

export function splitAddresses(s: string): string[] {
  return s.split(/[,;\n]/).map((a) => a.trim()).filter(Boolean);
}
