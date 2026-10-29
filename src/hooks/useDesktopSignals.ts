import { useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { isPermissionGranted, requestPermission, sendNotification } from '@tauri-apps/plugin-notification';
import { UrgentSignal } from '../utils/today';

const IS_TAURI = typeof window !== 'undefined' && !!(window as any).__TAURI_INTERNALS__;
const SEEN_KEY = 'pulse-notified';
const SEEN_LIMIT = 500;
const BATCH_MS = 4000; // signals that arrive within one read go out as one notification

function loadSeen(): string[] | null {
  try {
    const raw = localStorage.getItem(SEEN_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return Array.isArray(parsed) ? parsed.filter((k) => typeof k === 'string') : null;
  } catch {
    return null;
  }
}

function saveSeen(keys: string[]) {
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify(keys.slice(-SEEN_LIMIT)));
  } catch {
    // not persisted; worst case a signal is announced again after a restart
  }
}

async function notify(batch: UrgentSignal[]) {
  let granted = await isPermissionGranted();
  if (!granted) granted = (await requestPermission()) === 'granted';
  if (!granted) return;
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
}

// Keeps the menu bar count current and announces each new urgent item once. The first
// complete read only records what is already there, so launching Pulse never floods.
export function useDesktopSignals({ ready, decisions, signals, cleared, notificationsOn }: DesktopSignals) {
  const pending = useRef<UrgentSignal[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!IS_TAURI || decisions === null) return;
    invoke('set_tray_count', { count: decisions }).catch((e) => console.error('Failed to update the menu bar:', e));
  }, [decisions]);

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
