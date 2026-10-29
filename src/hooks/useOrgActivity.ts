import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { ActivitySnapshot, DecisionRow } from '../types';

const IS_TAURI = typeof window !== 'undefined' && !!(window as any).__TAURI_INTERNALS__;
const POLL_MS = 60_000;
const FAST_POLL_MS = 4_000; // while a lead is working on one of the owner's answers
const RUNNING_WINDOW_MS = 30 * 60_000; // a run never lasts longer (act.py's timeout is 25 min)

// One store for every view that shows decisions or activity, so the board, an entity page,
// Today and Activity share a single poll of `read_activity` instead of one each.
interface State {
  activity: ActivitySnapshot | null;
  error: string | null;
  // Answers sent but not yet read back from decisions.jsonl: shown at once, dropped on refresh.
  optimistic: { entity: string; row: DecisionRow }[];
}

let state: State = { activity: null, error: null, optimistic: [] };
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setTimeout> | null = null;
let inflight: Promise<void> | null = null;

function set(next: Partial<State>) {
  state = { ...state, ...next };
  listeners.forEach((l) => l());
}

// A lead is working when an act log says running, or an approve/discuss has no answer yet.
function busy(s: State): boolean {
  if (s.optimistic.length) return true;
  const recent = (iso: string) => Date.now() - (Date.parse(iso) || 0) < RUNNING_WINDOW_MS;
  for (const f of s.activity?.runs ?? []) {
    if (!Array.isArray(f.data) && f.data.kind === 'act' && f.data.running && recent(f.data.started ?? '')) return true;
  }
  for (const { rows } of s.activity?.decisions ?? []) {
    for (const r of rows) {
      if ((r.action === 'approve' || r.action === 'discuss') && recent(r.at)) {
        const answered = rows.some(
          (x) => x.id === r.id && (x.action === 'done' || x.action === 'reply') && Date.parse(x.at) >= Date.parse(r.at),
        );
        if (!answered) return true;
      }
    }
  }
  return false;
}

function schedule() {
  if (timer) clearTimeout(timer);
  if (listeners.size === 0) return;
  timer = setTimeout(refresh, busy(state) ? FAST_POLL_MS : POLL_MS);
}

export function refresh(): Promise<void> {
  if (!IS_TAURI) {
    set({ error: 'Activity reads ~/portfolio and only runs in the Pulse desktop app.' });
    return Promise.resolve();
  }
  if (inflight) return inflight;
  inflight = invoke<string>('read_activity')
    .then((json) => set({ activity: JSON.parse(json), error: null, optimistic: [] }))
    .catch((e) => set({ error: String(e) }))
    .finally(() => {
      inflight = null;
      schedule();
    });
  return inflight;
}

function subscribe(l: () => void) {
  listeners.add(l);
  if (listeners.size === 1) refresh();
  return () => {
    listeners.delete(l);
    if (listeners.size === 0 && timer) clearTimeout(timer);
  };
}

// Sends the owner's answer through act.py (the Rust command validates it first). Throws act.py's
// refusal so the caller can show it; on success the answer shows immediately.
export async function answerDecision(entity: string, id: string, action: 'approve' | 'reject' | 'discuss', note?: string) {
  const res = await invoke<string>('act_on_decision', { entityId: entity, decisionId: id, action, note: note ?? null });
  const row: DecisionRow = { id, action, note: note ?? '', at: new Date().toISOString() };
  set({ optimistic: [...state.optimistic, { entity, row }] });
  refresh();
  return JSON.parse(res) as { ok: boolean; changed?: boolean; launched?: boolean; reason?: string };
}

// The activity snapshot with any answers not yet read back merged into decisions.
function merged(s: State): ActivitySnapshot | null {
  if (!s.activity || s.optimistic.length === 0) return s.activity;
  const decisions = s.activity.decisions.map((d) => ({ ...d, rows: [...d.rows] }));
  for (const { entity, row } of s.optimistic) {
    let target = decisions.find((d) => d.entity === entity);
    if (!target) decisions.push((target = { entity, rows: [] }));
    target.rows.push(row);
  }
  return { ...s.activity, decisions };
}

let lastState: State | null = null;
let lastMerged: ActivitySnapshot | null = null;
function snapshot(): ActivitySnapshot | null {
  if (state !== lastState) {
    lastState = state;
    lastMerged = merged(state);
  }
  return lastMerged;
}

export function useOrgActivity() {
  const activity = useSyncExternalStore(subscribe, snapshot);
  const error = useSyncExternalStore(subscribe, () => state.error);
  // Re-read when the window regains focus, like the board does.
  useEffect(() => {
    const onFocus = () => refresh();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, []);
  return { activity, error, refresh: useCallback(() => refresh(), []) };
}
