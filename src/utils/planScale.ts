import { CAN_READ_ORG, orgRead } from './orgSource';
import { UsageSnapshot } from '../types/usage';
import { formatPlanShareAt } from './planShare';

// Jay runs everything on a Max plan: what a run costs is a share of the plan, not dollars.
// usage.py's implied_budget_usd.seven_day is what a full week comes to in API-equivalent
// dollars, judged from Claude Code's own weekly reading. Dividing an estimate by it gives
// "% of week". It's kept in localStorage so every page has it before Usage is opened.

const KEY = 'roo.planScale.weekUsd';
let weekUsd: number | null = read();

function read(): number | null {
  try {
    const v = Number(localStorage.getItem(KEY));
    return Number.isFinite(v) && v > 0 ? v : null;
  } catch {
    return null;
  }
}

export function setPlanScale(week: number | null | undefined): void {
  if (!week || !Number.isFinite(week) || week <= 0) return;
  weekUsd = week;
  try {
    localStorage.setItem(KEY, String(week));
  } catch {
    /* fine: kept in memory */
  }
}

export function planScale(): number | null {
  return weekUsd;
}

export function scaleFromSnapshot(s: UsageSnapshot | null | undefined): void {
  setPlanScale(s?.report?.implied_budget_usd?.seven_day);
}

// Once at start-up, from the last usage report on disk (no rebuild).
export async function loadPlanScale(): Promise<void> {
  if (!CAN_READ_ORG) return;
  try {
    scaleFromSnapshot(JSON.parse(await orgRead('read_usage', { refresh: false })) as UsageSnapshot);
  } catch {
    /* no report yet: callers fall back */
  }
}

// An API-equivalent estimate as a share of the weekly plan, at the current scale.
export function formatPlanShare(usd: number): string {
  return formatPlanShareAt(usd, weekUsd);
}
