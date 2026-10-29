import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { CAN_READ_ORG, DEMO, orgRead } from '../utils/orgSource';
import { showToast } from '../utils/toast';
import { PreferencesDoc, UsageSnapshot } from '../types/usage';

const POLL_MS = 60_000;

// The usage report. Opening the page rebuilds it once (bin/usage.py reads the run logs and
// Claude Code's usage numbers, a few seconds); after that it re-reads the file every minute,
// and Refresh rebuilds again.
export function useUsage() {
  const [data, setData] = useState<UsageSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const busy = useRef(false);

  const load = useCallback(async (refresh: boolean) => {
    if (!CAN_READ_ORG || busy.current) return;
    busy.current = true;
    if (refresh) setRefreshing(true);
    try {
      setData(JSON.parse(await orgRead('read_usage', { refresh })) as UsageSnapshot);
      setError(null);
    } catch (e) {
      setError(String(e));
    } finally {
      busy.current = false;
      if (refresh) setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load(true);
    const t = setInterval(() => load(false), POLL_MS);
    return () => clearInterval(t);
  }, [load]);

  return { data, error, refreshing, refresh: () => load(true) };
}

export function usePreferences() {
  const [doc, setDoc] = useState<PreferencesDoc | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    if (!CAN_READ_ORG) return;
    try {
      setDoc(JSON.parse(await orgRead('read_preferences')) as PreferencesDoc);
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }, []);
  useEffect(() => {
    load();
    window.addEventListener('focus', load);
    return () => window.removeEventListener('focus', load);
  }, [load]);
  return { doc, error, reload: load, setDoc };
}

// Off keeps the line in preferences.json and drops it from preferences.md; it is never deleted.
export async function setPreferenceDisabled(id: string, disabled: boolean) {
  if (DEMO) {
    showToast(`Demo only. In your org, this would turn the preference ${disabled ? 'off' : 'on'} for every agent.`);
    return;
  }
  await invoke<string>('set_preference_disabled', { id, disabled });
}
