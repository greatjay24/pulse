import { MrrBridge as MrrBridgeType } from '../../types';

interface MrrBridgeProps {
  bridge: MrrBridgeType;
}

export function MrrBridge({ bridge }: MrrBridgeProps) {
  const categories = [
    { label: 'New MRR', value: bridge.newMrr, type: 'positive' as const },
    { label: 'Expansion', value: bridge.expansionMrr, type: 'positive' as const },
    { label: 'Reactivation', value: bridge.reactivationMrr, type: 'positive' as const },
    { label: 'Contraction', value: bridge.contractionMrr, type: 'negative' as const },
    { label: 'Churned', value: bridge.churnedMrr, type: 'negative' as const },
  ];

  const positiveTotal = bridge.newMrr + bridge.expansionMrr + bridge.reactivationMrr;
  const negativeTotal = bridge.contractionMrr + bridge.churnedMrr;
  const maxValue = Math.max(positiveTotal, negativeTotal, Math.abs(bridge.netNewMrr)) || 1;

  return (
    <div className="bg-white/[0.03] rounded-xl border border-white/[0.06] p-4">
      <div className="flex items-center justify-between mb-4">
        <h4 className="text-sm font-medium">MRR Bridge</h4>
        <span className={`text-sm font-semibold ${bridge.netNewMrr >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
          {bridge.netNewMrr >= 0 ? '+' : ''}${bridge.netNewMrr.toLocaleString()} net
        </span>
      </div>

      <div className="space-y-3">
        {categories.map((cat) => (
          <div key={cat.label} className="flex items-center gap-3">
            <span className="text-xs text-[var(--text-secondary)] w-24">{cat.label}</span>
            <div className="flex-1 h-6 bg-white/[0.04] rounded overflow-hidden">
              <div
                className={`h-full rounded transition-all ${
                  cat.type === 'positive' ? 'bg-emerald-500/60' : 'bg-red-500/60'
                }`}
                style={{ width: `${(cat.value / maxValue) * 100}%` }}
              />
            </div>
            <span className={`text-sm font-medium w-20 text-right ${
              cat.type === 'positive' ? 'text-emerald-400' : 'text-red-400'
            }`}>
              {cat.type === 'positive' ? '+' : '-'}${Math.abs(cat.value).toLocaleString()}
            </span>
          </div>
        ))}

        {/* Net line */}
        <div className="border-t border-white/[0.08] pt-3 flex items-center gap-3">
          <span className="text-xs font-medium w-24">Net New MRR</span>
          <div className="flex-1 h-6 bg-white/[0.04] rounded overflow-hidden relative">
            {/* Center line for reference */}
            <div className="absolute left-1/2 top-0 bottom-0 w-px bg-white/[0.1]" />
            <div
              className={`h-full rounded transition-all ${
                bridge.netNewMrr >= 0 ? 'bg-emerald-500' : 'bg-red-500'
              }`}
              style={{
                width: `${(Math.abs(bridge.netNewMrr) / maxValue) * 50}%`,
                marginLeft: bridge.netNewMrr >= 0 ? '50%' : `${50 - (Math.abs(bridge.netNewMrr) / maxValue) * 50}%`,
              }}
            />
          </div>
          <span className={`text-sm font-semibold w-20 text-right ${
            bridge.netNewMrr >= 0 ? 'text-emerald-400' : 'text-red-400'
          }`}>
            {bridge.netNewMrr >= 0 ? '+' : ''}${bridge.netNewMrr.toLocaleString()}
          </span>
        </div>
      </div>

      {/* Summary */}
      <div className="mt-4 pt-4 border-t border-white/[0.08] grid grid-cols-3 gap-4 text-center">
        <div>
          <p className="text-xs text-[var(--text-secondary)]">Gains</p>
          <p className="text-sm font-semibold text-emerald-400">+${positiveTotal.toLocaleString()}</p>
        </div>
        <div>
          <p className="text-xs text-[var(--text-secondary)]">Losses</p>
          <p className="text-sm font-semibold text-red-400">-${negativeTotal.toLocaleString()}</p>
        </div>
        <div>
          <p className="text-xs text-[var(--text-secondary)]">Net</p>
          <p className={`text-sm font-semibold ${bridge.netNewMrr >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
            {bridge.netNewMrr >= 0 ? '+' : ''}${bridge.netNewMrr.toLocaleString()}
          </p>
        </div>
      </div>
    </div>
  );
}
