import { LiveRun, LiveSnapshot } from '../types';
import { UrgentSignal } from './today';

// What the Working now strip shows: runs at work, interactive sessions waiting on the owner, and
// runs that died without finishing (until they are this old).
const STOPPED_SHOWN_MS = 12 * 3_600_000;
// A finish is announced only if it happened this recently, so a restart never replays old ones.
const ANNOUNCE_WINDOW_MS = 30 * 60_000;

export function ms(iso: string | undefined): number {
  const t = Date.parse(iso ?? '');
  return Number.isNaN(t) ? 0 : t;
}

export function stripRuns(live: LiveSnapshot | null, now = Date.now()): LiveRun[] {
  const order = { running: 0, idle: 1, stopped: 2, finished: 3, failed: 3 } as const;
  return (live?.runs ?? [])
    .filter((r) => r.state === 'running' || r.state === 'idle' || (r.state === 'stopped' && now - ms(r.updated) < STOPPED_SHOWN_MS))
    .sort((a, b) => order[a.state] - order[b.state] || ms(b.started) - ms(a.started));
}

export function workingRuns(live: LiveSnapshot | null): LiveRun[] {
  return (live?.runs ?? []).filter((r) => r.state === 'running');
}

const KIND_LABEL: Record<string, string> = {
  nightly: 'Night shift',
  weekly: 'Weekly review',
  act: 'Your answer',
  check: 'Check',
  interactive: 'With you',
};

export function kindLabel(kind: string): string {
  return KIND_LABEL[kind] ?? kind;
}

export function stateLabel(r: LiveRun): string {
  switch (r.state) {
    case 'running':
      return 'working';
    case 'idle':
      return 'waiting for you';
    case 'stopped':
      return 'stopped unexpectedly';
    case 'failed':
      return 'failed';
    default:
      return 'finished';
  }
}

// "4s", "3m 05s", "1h 12m"
export function elapsed(fromMs: number, toMs: number): string {
  const s = Math.max(0, Math.floor((toMs - fromMs) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, '0')}s`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
}

// The menu bar's list: one line per working agent.
export function trayRuns(live: LiveSnapshot | null): { run_id: string; label: string }[] {
  return workingRuns(live).map((r) => ({ run_id: r.run_id, label: `${r.agent}: ${r.step || r.doing}` }));
}

// One notification when a headless run starts and one when it ends. Interactive sessions
// are left out: the owner is the one typing. Keys are per run, so the seen-list dedupes them.
export function liveSignals(live: LiveSnapshot | null, now = Date.now()): UrgentSignal[] {
  const out: UrgentSignal[] = [];
  for (const r of live?.runs ?? []) {
    if (r.kind === 'interactive') continue;
    if (r.state === 'running') {
      out.push({ key: `live-start:${r.run_id}`, title: `${r.agent} started`, body: r.doing });
      continue;
    }
    // A dead run's last write can be long before anyone noticed, so it is announced while shown.
    const span = r.state === 'stopped' ? STOPPED_SHOWN_MS : ANNOUNCE_WINDOW_MS;
    if (now - ms(r.finished ?? r.updated) > span) continue;
    const title = r.state === 'failed' ? `${r.agent} failed` : r.state === 'stopped' ? `${r.agent} stopped unexpectedly` : `${r.agent} finished`;
    const result = (r.result ?? '').replace(/\s+/g, ' ').trim();
    out.push({ key: `live-end:${r.run_id}`, title, body: result ? result.slice(0, 160) : r.doing });
  }
  return out;
}
