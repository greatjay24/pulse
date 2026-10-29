import { useSyncExternalStore } from 'react';
import { CAN_READ_ORG, orgRead } from '../utils/orgSource';
import { LiveSnapshot } from '../types';
import { refresh as refreshActivity } from './useOrgActivity';

const POLL_MS = 2_000; // a start shows within two seconds

// One poll of `read_live` for every view (Working now, Conversations) and for the menu bar
// and notifications, which App keeps subscribed the whole time Pulse runs.
let snapshot: LiveSnapshot | null = null;
let error: string | null = null;
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setTimeout> | null = null;
let inflight = false;

// Runs that were working on the last read: when one stops, the activity (act logs,
// decisions.jsonl, status.json) has news, so it is re-read at once rather than in a minute.
let working = new Set<string>();

function emit() {
  listeners.forEach((l) => l());
}

async function poll() {
  if (inflight || !CAN_READ_ORG) return;
  inflight = true;
  try {
    const next: LiveSnapshot = JSON.parse(await orgRead('read_live'));
    const now = new Set(next.runs.filter((r) => r.state === 'running').map((r) => r.run_id));
    const ended = [...working].some((id) => !now.has(id));
    working = now;
    // Same content, same object: nothing re-renders on a quiet poll.
    if (!snapshot || JSON.stringify(next.runs) !== JSON.stringify(snapshot.runs) || error) {
      snapshot = next;
      error = null;
      emit();
    }
    if (ended) refreshActivity();
  } catch (e) {
    if (String(e) !== error) {
      error = String(e);
      emit();
    }
  } finally {
    inflight = false;
    if (listeners.size > 0) timer = setTimeout(poll, POLL_MS);
  }
}

function subscribe(l: () => void) {
  listeners.add(l);
  if (listeners.size === 1) {
    if (!CAN_READ_ORG) {
      error = 'Live runs are read from ~/portfolio and only show in the Pulse desktop app.';
    } else {
      poll();
    }
  }
  return () => {
    listeners.delete(l);
    if (listeners.size === 0 && timer) {
      clearTimeout(timer);
      timer = null;
    }
  };
}

export function useLive() {
  const live = useSyncExternalStore(subscribe, () => snapshot);
  const liveError = useSyncExternalStore(subscribe, () => error);
  return { live, liveError };
}
