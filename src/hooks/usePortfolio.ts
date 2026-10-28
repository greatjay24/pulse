import { useCallback, useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { PortfolioSnapshot } from '../types';

const IS_TAURI = typeof window !== 'undefined' && !!(window as any).__TAURI_INTERNALS__;
const POLL_MS = 60_000;

// Reads ~/portfolio through the Rust `read_portfolio` command and re-reads every 60s,
// plus whenever the window regains focus. Local files only; no network.
export function usePortfolio() {
  const [snapshot, setSnapshot] = useState<PortfolioSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!IS_TAURI) {
      setError('The org board reads ~/portfolio and only runs in the Pulse desktop app.');
      return;
    }
    try {
      const json = await invoke<string>('read_portfolio');
      setSnapshot(JSON.parse(json));
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }, []);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, POLL_MS);
    window.addEventListener('focus', refresh);
    return () => {
      clearInterval(interval);
      window.removeEventListener('focus', refresh);
    };
  }, [refresh]);

  return { snapshot, error, refresh };
}
