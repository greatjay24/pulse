import { PlanRevenue } from '../../types';

interface RevenueBreakdownProps {
  plans: PlanRevenue[];
  totalMrr: number;
}

export function RevenueBreakdown({ plans, totalMrr }: RevenueBreakdownProps) {
  // Sort plans by MRR descending
  const sortedPlans = [...plans].sort((a, b) => b.mrr - a.mrr);

  if (plans.length === 0) {
    return (
      <div className="text-center py-8 text-[var(--text-secondary)]">
        <p>No revenue breakdown available</p>
        <p className="text-xs mt-2">Connect your Stripe account to see revenue by plan</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Summary */}
      <div className="grid grid-cols-2 gap-4">
        <div className="p-4 bg-white/[0.03] rounded-xl border border-white/[0.06]">
          <p className="text-xs text-[var(--text-secondary)] mb-1">Total MRR</p>
          <p className="text-xl font-semibold">${totalMrr.toLocaleString()}</p>
        </div>
        <div className="p-4 bg-white/[0.03] rounded-xl border border-white/[0.06]">
          <p className="text-xs text-[var(--text-secondary)] mb-1">Active Plans</p>
          <p className="text-xl font-semibold">{plans.length}</p>
        </div>
      </div>

      {/* Visual breakdown */}
      <div className="bg-white/[0.03] rounded-xl border border-white/[0.06] p-4">
        <h4 className="text-sm font-medium mb-4">Revenue Distribution</h4>
        <div className="h-4 rounded-full overflow-hidden flex bg-white/[0.06]">
          {sortedPlans.map((plan, index) => (
            <div
              key={plan.planId}
              className="h-full transition-all"
              style={{
                width: `${plan.percentOfTotal}%`,
                backgroundColor: planColors[index % planColors.length],
              }}
              title={`${plan.planName}: $${plan.mrr.toLocaleString()} (${plan.percentOfTotal.toFixed(1)}%)`}
            />
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="bg-white/[0.03] rounded-xl border border-white/[0.06] overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-white/[0.06]">
              <th className="text-left text-xs font-medium text-[var(--text-secondary)] px-4 py-3">Plan</th>
              <th className="text-right text-xs font-medium text-[var(--text-secondary)] px-4 py-3">MRR</th>
              <th className="text-right text-xs font-medium text-[var(--text-secondary)] px-4 py-3">Subscribers</th>
              <th className="text-right text-xs font-medium text-[var(--text-secondary)] px-4 py-3">% of Total</th>
            </tr>
          </thead>
          <tbody>
            {sortedPlans.map((plan, index) => (
              <tr key={plan.planId} className="border-b border-white/[0.04] last:border-0">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <div
                      className="w-2 h-2 rounded-full"
                      style={{ backgroundColor: planColors[index % planColors.length] }}
                    />
                    <span className="text-sm">{plan.planName}</span>
                  </div>
                </td>
                <td className="text-right text-sm px-4 py-3 font-medium">
                  ${plan.mrr.toLocaleString()}
                </td>
                <td className="text-right text-sm px-4 py-3 text-[var(--text-secondary)]">
                  {plan.subscriberCount.toLocaleString()}
                </td>
                <td className="text-right text-sm px-4 py-3 text-[var(--text-secondary)]">
                  {plan.percentOfTotal.toFixed(1)}%
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Average metrics */}
      <div className="grid grid-cols-2 gap-4">
        {sortedPlans.slice(0, 2).map((plan) => (
          <div key={plan.planId} className="p-4 bg-white/[0.03] rounded-xl border border-white/[0.06]">
            <p className="text-xs text-[var(--text-secondary)] mb-1">Avg. {plan.planName} Customer</p>
            <p className="text-lg font-semibold">
              ${plan.subscriberCount > 0 ? (plan.mrr / plan.subscriberCount).toFixed(2) : '0'}/mo
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

const planColors = [
  '#818cf8', // indigo
  '#34d399', // emerald
  '#fbbf24', // amber
  '#f87171', // red
  '#22d3ee', // cyan
  '#a78bfa', // purple
  '#fb923c', // orange
  '#4ade80', // green
];
