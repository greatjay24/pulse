import { useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { isPermissionGranted, requestPermission, sendNotification } from '@tauri-apps/plugin-notification';
import { UrgentSignal } from '../utils/today';

const IS_TAURI = typeof window !== 'undefined' && !!(window as any).__TAURI_INTERNALS__;
const SEEN_KEY = 'pulse-notified';
const LIVE_SEEN_KEY = 'pulse-notified-live'; // its own list, so run keys never push urgent ones out
const SEEN_LIMIT = 500;
const BATCH_MS = 4000; // signals that arrive within one read go out as one notification

function loadSeen(key = SEEN_KEY): string[] | null {
  try {
    const raw = localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : null;
    return Array.isArray(parsed) ? parsed.filter((k) => typeof k === 'string') : null;
  } catch {
    return null;
  }
}

function saveSeen(keys: string[], key = SEEN_KEY) {
  try {
    localStorage.setItem(key, JSON.stringify(keys.slice(-SEEN_LIMIT)));
  } catch {
    // not persisted; worst case a signal is announced again after a restart
  }
}

async function permitted(): Promise<boolean> {
  if (await isPermissionGranted()) return true;
  return (await requestPermission()) === 'granted';
}

async function notify(batch: UrgentSignal[]) {
  if (!(await permitted())) return;
  if (batch.length === 1) {
    sendNotification({ title: batch[0].title, body: batch[0].body });
  } else {
    const more = batch.length > 3 ? ` and ${batch.length - 3} more` : '';
    sendNotification({ title: `${batch.length} urgent items in Pulse`, body: batch.slice(0, 3).map((s) => s.body).join(' · ') + more });
  }
}

interface DesktopSignals {
  ready: boolean; // both ~/portfolio and the tracker have been read, so the picture is complete
  decisions: number | null; // the menu bar count
  signals: UrgentSignal[];
  cleared: string[];
  notificationsOn: boolean;
  working: { run_id: string; label: string }[] | null; // null until logs/live has been read
  liveSignals: UrgentSignal[]; // a run started or ended: each is its own notification
}

// Keeps the menu bar count current and announces each new urgent item once. The first
// complete read only records what is already there, so launching Pulse never floods.
export function useDesktopSignals({ ready, decisions, signals, cleared, notificationsOn, working, liveSignals }: DesktopSignals) {
  const pending = useRef<UrgentSignal[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const workingKey = JSON.stringify(working ?? []);
  useEffect(() => {
    if (!IS_TAURI || (decisions === null && working === null)) return;
    invoke('set_tray_status', { count: decisions ?? 0, working: working ?? [] }).catch((e) => console.error('Failed to update the menu bar:', e));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [decisions, workingKey]);

  // Starts and finishes go out one by one (not batched as "urgent items"). A run that
  // started and ended between two reads only announces its end.
  const liveKeys = liveSignals.map((s) => s.key).join('|');
  useEffect(() => {
    if (working === null) return;
    const seen = loadSeen(LIVE_SEEN_KEY);
    if (seen === null) {
      saveSeen(liveSignals.map((s) => s.key), LIVE_SEEN_KEY);
      return;
    }
    const known = new Set(seen);
    const fresh = liveSignals.filter((s) => !known.has(s.key));
    if (fresh.length === 0) return;
    saveSeen([...seen, ...fresh.map((s) => s.key)], LIVE_SEEN_KEY);
    if (!IS_TAURI || !notificationsOn) return;
    const ending = new Set(fresh.filter((s) => s.key.startsWith('live-end:')).map((s) => s.key.slice('live-end:'.length)));
    const out = fresh.filter((s) => !(s.key.startsWith('live-start:') && ending.has(s.key.slice('live-start:'.length))));
    permitted()
      .then((ok) => ok && out.forEach((s) => sendNotification({ title: s.title, body: s.body })))
      .catch((e) => console.error('Failed to notify:', e));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [working === null, liveKeys, notificationsOn]);

  const signalKeys = signals.map((s) => s.key).join('|');
  const clearedKeys = cleared.join('|');
  useEffect(() => {
    if (!ready) return;
    const seen = loadSeen();
    if (seen === null) {
      saveSeen(signals.map((s) => s.key));
      return;
    }
    const known = new Set(seen.filter((k) => !cleared.includes(k)));
    const fresh = signals.filter((s) => !known.has(s.key));
    saveSeen([...known, ...fresh.map((s) => s.key)]);
    if (!IS_TAURI || !notificationsOn || fresh.length === 0) return;
    pending.current.push(...fresh);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const batch = pending.current;
      pending.current = [];
      notify(batch).catch((e) => console.error('Failed to notify:', e));
    }, BATCH_MS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, signalKeys, clearedKeys, notificationsOn]);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
}
