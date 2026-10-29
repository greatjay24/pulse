import { useCallback, useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { PortfolioSnapshot, TrackerSnapshot } from '../types';

const IS_TAURI = typeof window !== 'undefined' && !!(window as any).__TAURI_INTERNALS__;
const POLL_MS = 60_000;

// Reads ~/portfolio and the tracker's data (Rust `read_portfolio` and `read_tracker`) and
// re-reads every 60s, plus whenever the window regains focus. Local files only; no network.
export function usePortfolio() {
  const [snapshot, setSnapshot] = useState<PortfolioSnapshot | null>(null);
  const [tracker, setTracker] = useState<TrackerSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [trackerError, setTrackerError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!IS_TAURI) {
      setError('The org board reads ~/portfolio and only runs in the Pulse desktop app.');
      return;
    }
    // Independent reads: a tracker problem never blanks the board, and vice versa.
    const [portfolio, trackerResult] = await Promise.allSettled([
      invoke<string>('read_portfolio'),
      invoke<string>('read_tracker'),
    ]);
    if (portfolio.status === 'fulfilled') {
      setSnapshot(JSON.parse(portfolio.value));
      setError(null);
    } else {
      setError(String(portfolio.reason));
    }
    if (trackerResult.status === 'fulfilled') {
      setTracker(JSON.parse(trackerResult.value));
      setTrackerError(null);
    } else {
      setTrackerError(String(trackerResult.reason));
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

  return { snapshot, tracker, error, trackerError, refresh };
}
