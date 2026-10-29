import { useCallback, useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { CAN_READ_ORG, DEMO, orgRead } from '../utils/orgSource';
import { showToast } from '../utils/toast';
import { ConnectionsDoc, Goal, GoalsSnapshot, OutboxEdit, OutboxSnapshot } from '../types/ops';

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

export interface OutboxResult {
  ok: boolean;
  warning?: string;
  status?: string;
  link?: string | null;
  next_step?: string | null;
}

// The owner's click (Send / Publish / Approve). Rust re-checks the content, signs a one-time
// approval and runs bin/outbox_send.py, which does what the item's kind says; nothing else
// in the org can.
export async function sendOutbox(id: string, content: string, what = 'send this message from the right mailbox, threaded, and mark it sent'): Promise<OutboxResult> {
  if (DEMO) {
    demo(what);
    return { ok: true };
  }
  return JSON.parse(await invoke<string>('outbox_send', { id, content }));
}

export async function editOutbox(id: string, fields: OutboxEdit) {
  if (DEMO) return demo('save your edit');
  await invoke<string>('outbox_edit', { id, fields });
}

export async function markPublished(id: string) {
  if (DEMO) return demo('mark it published');
  await invoke<string>('outbox_mark_published', { id });
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
