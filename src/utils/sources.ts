import type { DataSource } from '../components/BoardUI';
import { PortfolioSnapshot, TrackerSnapshot } from '../types';
import { STALE_AFTER_HOURS } from './portfolio';
import { SOURCE_LABEL } from './finance';

const secs = (v: number | null | undefined) => (v ? v * 1000 : null);

// Reports are as old as the oldest one; the tooltip names each entity's time.
function reportsSource(snapshot: PortfolioSnapshot): DataSource {
  const times = snapshot.entities
    .map((e) => ({ name: e.status?.name ?? e.id, at: e.status?.updated ? Date.parse(e.status.updated) : NaN }))
    .filter((e) => !Number.isNaN(e.at));
  const oldest = times.length ? Math.min(...times.map((t) => t.at)) : null;
  return {
    label: 'Reports',
    at: oldest,
    staleAfterHours: STALE_AFTER_HOURS,
    detail: times.map((t) => `${t.name}: ${new Date(t.at).toLocaleString()}`).join('\n') || 'No status.json read yet',
  };
}

export function moneySources(tracker: TrackerSnapshot): DataSource[] {
  return tracker.money.finance.coverage
    .filter((c) => c.ok)
    .map((c) => ({ label: SOURCE_LABEL[c.source], at: secs(c.collected_at), staleAfterHours: 26 }));
}

// The tracker's collectors run through the day; anything older than a working day is flagged.
export function dataSources(snapshot: PortfolioSnapshot | null, tracker: TrackerSnapshot | null, include: { money?: boolean } = {}): DataSource[] {
  const out: DataSource[] = [];
  if (snapshot?.registry) out.push(reportsSource(snapshot));
  if (tracker && !tracker.error) {
    out.push({ label: 'Tasks', at: secs(tracker.tasks_updated_at), staleAfterHours: 12 });
    if (tracker.email) out.push({ label: 'Email', at: secs(tracker.email.collected_at), staleAfterHours: 12 });
    if (include.money) out.push(...moneySources(tracker));
  }
  return out;
}
