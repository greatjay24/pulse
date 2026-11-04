import { useCallback, useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { CAN_READ_ORG, DEMO, orgRead } from '../utils/orgSource';
import { showToast } from '../utils/toast';
import { TodoChange, TodosSnapshot } from '../types';

const POLL_MS = 30_000;

// ~/project-tracker/todos.json, re-read every 30s and on focus (agents add to it too).
export function useTodos() {
  const [data, setData] = useState<TodosSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    if (!CAN_READ_ORG) return;
    try {
      setData(JSON.parse(await orgRead('read_todos')) as TodosSnapshot);
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }, []);
  useEffect(() => {
    refresh();
    const t = setInterval(refresh, POLL_MS);
    window.addEventListener('focus', refresh);
    return () => {
      clearInterval(t);
      window.removeEventListener('focus', refresh);
    };
  }, [refresh]);
  return { data, error, refresh };
}

// Every change goes through add_todo.py, the tracker's one write path. Returns its status line.
export async function writeTodo(change: TodoChange): Promise<string | null> {
  if (DEMO) {
    showToast('Demo only. In your org, this would update ~/project-tracker/todos.json.');
    return null;
  }
  return invoke<string>('write_todo', { change });
}
