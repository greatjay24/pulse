// Pure formatting for plan shares (no app imports, so node tests can load it).

// A percentage, readable at any size: 12%, 3.4%, 0.27%, <0.01%.
export function formatShare(pct: number): string {
  if (pct <= 0) return '0%';
  if (pct < 0.01) return '<0.01%';
  if (pct < 1) return `${pct.toFixed(2)}%`;
  if (pct < 10) return `${pct.toFixed(1)}%`;
  return `${Math.round(pct)}%`;
}

// An API-equivalent estimate as a share of the weekly plan. Before the first plan reading
// there's no scale; then it says "not measured yet" rather than showing dollars.
export function formatPlanShareAt(usd: number, week: number | null): string {
  if (!week) return 'not measured yet';
  return `${formatShare((usd / week) * 100)} of week`;
}
