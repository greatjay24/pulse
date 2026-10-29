import { useCallback, useEffect, useMemo, useState } from 'react';
import { CAN_READ_ORG, orgRead } from '../utils/orgSource';
import { PortfolioSnapshot, TrackerSnapshot } from '../types';
import { withoutDecisionDuplicates } from '../utils/decisions';

const POLL_MS = 60_000;

// Reads ~/portfolio and the tracker's data (Rust `read_portfolio` and `read_tracker`) and
// re-reads every 60s, plus whenever the window regains focus. Local files only; no network.
export function usePortfolio() {
  const [snapshot, setSnapshot] = useState<PortfolioSnapshot | null>(null);
  const [tracker, setTracker] = useState<TrackerSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [trackerError, setTrackerError] = useState<string | null>(null);
  // No ~/project-tracker: the tracker is optional, so this is not an error and every view
  // that reads it (tasks, inbox, money) hides instead.
  const [trackerAbsent, setTrackerAbsent] = useState(false);

  const refresh = useCallback(async () => {
    if (!CAN_READ_ORG) {
      setError('The org board reads ~/portfolio and only runs in the Pulse desktop app.');
      return;
    }
    // Independent reads: a tracker problem never blanks the board, and vice versa.
    const [portfolio, trackerResult] = await Promise.allSettled([
      orgRead('read_portfolio'),
      orgRead('read_tracker'),
    ]);
    if (portfolio.status === 'fulfilled') {
      setSnapshot(JSON.parse(portfolio.value));
      setError(null);
    } else {
      setError(String(portfolio.reason));
    }
    if (trackerResult.status === 'fulfilled') {
      const next: TrackerSnapshot = JSON.parse(trackerResult.value);
      const absent = next.installed === false;
      setTrackerAbsent(absent);
      setTracker(absent ? null : next);
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

  // A "Decide: …" task that mirrors a status.json decision is hidden everywhere; the decision
  // card (with its buttons) stands for both.
  const deduped = useMemo(() => (tracker ? withoutDecisionDuplicates(tracker, snapshot) : null), [tracker, snapshot]);

  return { snapshot, tracker: deduped, error, trackerError, trackerAbsent, refresh };
}
