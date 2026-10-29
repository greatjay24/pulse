import { useCallback, useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { CAN_READ_ORG, DEMO, orgRead } from '../utils/orgSource';
import { showToast } from '../utils/toast';
import { ConnectionsDoc, Goal, GoalsSnapshot, OutboxSnapshot } from '../types/ops';

const POLL_MS = 30_000;

// One read command, polled and re-read on focus. `missing` (no file yet) is not an error.
function usePolled<T>(cmd: string, poll = POLL_MS) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    if (!CAN_READ_ORG) return;
    try {
      setData(JSON.parse(await orgRead(cmd)) as T);
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }, [cmd]);
  useEffect(() => {
    refresh();
    const t = setInterval(refresh, poll);
    window.addEventListener('focus', refresh);
    return () => {
      clearInterval(t);
      window.removeEventListener('focus', refresh);
    };
  }, [refresh, poll]);
  return { data, error, refresh };
}

export const useOutbox = () => usePolled<OutboxSnapshot>('read_outbox');
export const useGoals = () => usePolled<GoalsSnapshot>('read_goals', 60_000);
export const useConnections = () => usePolled<ConnectionsDoc>('read_connections', 120_000);

// The demo org is read-only: say what would happen instead of doing it.
function demo(what: string) {
  showToast(`Demo only. In your org, this would ${what}.`);
}

// The owner's click. Rust re-checks the content, signs a one-time approval and runs
// bin/outbox_send.py; nothing else in the org can send.
export async function sendOutbox(id: string, content: string): Promise<{ ok: boolean; warning?: string }> {
  if (DEMO) {
    demo('send this message from the right mailbox, threaded, and mark it sent');
    return { ok: true };
  }
  return JSON.parse(await invoke<string>('outbox_send', { id, content }));
}

export async function editOutbox(id: string, fields: { to: string[]; cc: string[]; subject: string; body: string }) {
  if (DEMO) return demo('save your edit to the message');
  await invoke<string>('outbox_edit', { id, ...fields });
}

export async function skipOutbox(id: string) {
  if (DEMO) return demo('mark it skipped; the Gmail draft stays where it is');
  await invoke<string>('outbox_skip', { id });
}

export async function saveGoal(entityId: string, goal: Partial<Goal> & { id: string }): Promise<Goal | null> {
  if (DEMO) {
    demo("save the goal to that business's goals.json");
    return null;
  }
  return JSON.parse(await invoke<string>('save_goal', { entityId, goal })) as Goal;
}

export async function checkConnections() {
  if (DEMO) return demo('re-check every connection');
  await invoke<string>('check_connections');
}
