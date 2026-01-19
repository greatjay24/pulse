import { useState, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { MetricSnapshot, HistoricalData, AppMetrics } from '../types';

const IS_WEB_PREVIEW = typeof window !== 'undefined' && !(window as any).__TAURI__;

// Generate mock historical data for preview mode
function generateMockHistory(appId: string): HistoricalData {
  const snapshots: MetricSnapshot[] = [];
  const now = new Date();

  for (let i = 29; i >= 0; i--) {
    const date = new Date(now);
    date.setDate(date.getDate() - i);

    // Generate trending upward data with some variance
    const dayFactor = (30 - i) / 30;
    const variance = () => 0.9 + Math.random() * 0.2;

    snapshots.push({
      date: date.toISOString().split('T')[0],
      appId,
      stripe: {
        mrr: Math.round(3000 * dayFactor * variance() + 2000),
        activeSubscriptions: Math.round(30 * dayFactor * variance() + 20),
        churnRate: Math.round((5 - dayFactor * 2) * variance() * 10) / 10,
        arr: Math.round((3000 * dayFactor * variance() + 2000) * 12),
      },
    });
  }

  return {
    appId,
    snapshots,
    lastUpdated: new Date().toISOString(),
  };
}

export function useHistory(appId: string | null) {
  const [history, setHistory] = useState<HistoricalData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchHistory = useCallback(async () => {
    if (!appId) {
      setHistory(null);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      if (IS_WEB_PREVIEW) {
        // Use mock data in preview mode
        setHistory(generateMockHistory(appId));
      } else {
        const result = await invoke<string>('get_history', { appId });
        const data: HistoricalData = JSON.parse(result);
        setHistory(data);
      }
    } catch (err) {
      console.error('Failed to fetch history:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch history');
    } finally {
      setIsLoading(false);
    }
  }, [appId]);

  const saveSnapshot = useCallback(async (metrics: AppMetrics) => {
    if (!appId || IS_WEB_PREVIEW) return;

    try {
      await invoke('save_snapshot', {
        appId,
        metrics: JSON.stringify(metrics),
      });
      // Refresh history after saving
      fetchHistory();
    } catch (err) {
      console.error('Failed to save snapshot:', err);
    }
  }, [appId, fetchHistory]);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  return {
    history,
    snapshots: history?.snapshots || [],
    isLoading,
    error,
    saveSnapshot,
    refetch: fetchHistory,
  };
}

// Helper function to get trend data for sparklines
export function getSparklineData(
  snapshots: MetricSnapshot[],
  metric: 'mrr' | 'activeSubscriptions' | 'churnRate' | 'arr',
  days: number = 7
): number[] {
  const recentSnapshots = snapshots.slice(-days);
  return recentSnapshots.map((s) => {
    switch (metric) {
      case 'mrr':
        return s.stripe?.mrr || 0;
      case 'activeSubscriptions':
        return s.stripe?.activeSubscriptions || 0;
      case 'churnRate':
        return s.stripe?.churnRate || 0;
      case 'arr':
        return s.stripe?.arr || 0;
      default:
        return 0;
    }
  });
}
