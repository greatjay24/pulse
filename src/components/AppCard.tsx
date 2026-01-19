import { AppMetrics } from '../types';
import { MetricCard } from './MetricCard';

interface AppCardProps {
  name: string;
  metrics: AppMetrics | null;
  isLoading: boolean;
}

export function AppCard({ name, metrics, isLoading }: AppCardProps) {
  if (isLoading) {
    return (
      <div className="bg-[#0f0f0f] rounded-xl p-4 border border-[#1f1f1f]">
        <h3 className="text-lg font-medium mb-4">{name}</h3>
        <div className="grid grid-cols-2 gap-3">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="bg-[#141414] rounded-lg p-4 animate-pulse">
              <div className="h-4 bg-[#1f1f1f] rounded w-16 mb-2"></div>
              <div className="h-6 bg-[#1f1f1f] rounded w-20"></div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
    }).format(amount);
  };

  const formatNumber = (num: number) => {
    return new Intl.NumberFormat('en-US').format(num);
  };

  return (
    <div className="bg-[#0f0f0f] rounded-xl p-4 border border-[#1f1f1f]">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-medium">{name}</h3>
        {metrics?.vercel && (
          <span className={`text-xs px-2 py-1 rounded-full ${
            metrics.vercel.status === 'ready' ? 'bg-green-500/20 text-green-400' :
            metrics.vercel.status === 'building' ? 'bg-yellow-500/20 text-yellow-400' :
            metrics.vercel.status === 'error' ? 'bg-red-500/20 text-red-400' :
            'bg-gray-500/20 text-gray-400'
          }`}>
            {metrics.vercel.status}
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        {metrics?.stripe && (
          <>
            <MetricCard
              label="MRR"
              value={formatCurrency(metrics.stripe.mrr)}
              trend="up"
            />
            <MetricCard
              label="Subscribers"
              value={formatNumber(metrics.stripe.activeSubscriptions)}
            />
          </>
        )}

        {metrics?.posthog && (
          <>
            <MetricCard
              label="Users (24h)"
              value={formatNumber(metrics.posthog.uniqueUsers24h)}
            />
            <MetricCard
              label="Events (24h)"
              value={formatNumber(metrics.posthog.totalEvents24h)}
            />
          </>
        )}

        {metrics?.supabase && (
          <>
            <MetricCard
              label="Total Users"
              value={formatNumber(metrics.supabase.totalUsers)}
            />
            <MetricCard
              label="New Users (7d)"
              value={formatNumber(metrics.supabase.newUsers7d)}
            />
          </>
        )}

        {!metrics?.stripe && !metrics?.posthog && !metrics?.supabase && (
          <div className="col-span-2 text-center py-8 text-gray-500">
            No integrations configured
          </div>
        )}
      </div>

      {metrics && (
        <div className="mt-3 text-xs text-gray-500">
          Updated {new Date(metrics.lastUpdated).toLocaleTimeString()}
        </div>
      )}
    </div>
  );
}
