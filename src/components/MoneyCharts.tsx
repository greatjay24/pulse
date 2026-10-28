import { ReactNode, useState } from 'react';
import { useTheme } from '../contexts/ThemeContext';
import { formatUsd } from '../utils/tracker';
import { formatUsdCompact, monthLabel, monthOnFile } from '../utils/finance';

// Money charts: one series each, so one hue (the theme's chart color); text stays in text
// tokens; thin marks with 4px rounded data-ends; hairline baseline; hover and keyboard
// focus show the exact value, and every value is also written out next to the chart.

interface MonthColumnsProps {
  months: string[]; // YYYY-MM, oldest first
  values: Map<string, number>;
  since: number | null; // unix seconds; months entirely before it are not on file
  height?: number;
}

export function MonthColumns({ months, values, since, height = 150 }: MonthColumnsProps) {
  const { tokens } = useTheme();
  const c = tokens.colors;
  const [active, setActive] = useState<string | null>(null);
  const onFile = months.filter((m) => monthOnFile(m, since));
  const max = Math.max(0, ...onFile.map((m) => values.get(m) ?? 0));
  const peak = onFile.find((m) => max > 0 && (values.get(m) ?? 0) === max) ?? null;
  const latest = months[months.length - 1];
  const AXIS = 22;

  return (
    <div style={{ position: 'relative', paddingLeft: '36px' }}>
      {/* y-axis: the baseline only; the peak and the latest month carry direct labels */}
      <div style={{ position: 'absolute', left: 0, top: 0, height, width: '32px', fontSize: tokens.type.micro, color: c.textDim, fontVariantNumeric: 'tabular-nums' }}>
        <span style={{ position: 'absolute', bottom: 0, right: 6, transform: 'translateY(50%)' }}>$0</span>
      </div>
      <div
        role="list"
        aria-label="Cash in by month"
        style={{ display: 'flex', alignItems: 'stretch', height: height + AXIS, gap: '2px' }}
      >
        {months.map((m) => {
          const known = monthOnFile(m, since);
          const v = values.get(m) ?? 0;
          const h = known && max > 0 ? Math.max(v > 0 ? 3 : 0, ((height - 14) * v) / max) : 0;
          const showLabel = known && v > 0 && (m === peak || m === latest);
          const tip = known ? `${monthLabel(m, 'long')}: ${formatUsd(v)}` : `${monthLabel(m, 'long')}: not on file`;
          return (
            <div
              key={m}
              role="listitem"
              tabIndex={0}
              aria-label={tip}
              onMouseEnter={() => setActive(m)}
              onMouseLeave={() => setActive((a) => (a === m ? null : a))}
              onFocus={() => setActive(m)}
              onBlur={() => setActive((a) => (a === m ? null : a))}
              style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', position: 'relative', outline: 'none' }}
            >
              <div
                style={{
                  height,
                  width: '100%',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'flex-end',
                  alignItems: 'center',
                  borderBottom: `1px solid ${c.border}`,
                  background: active === m ? c.bgCardHover : 'transparent',
                  borderRadius: '6px 6px 0 0',
                }}
              >
                {showLabel && (
                  <span style={{ fontSize: tokens.type.micro, color: c.textMuted, marginBottom: '4px', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                    {formatUsdCompact(v)}
                  </span>
                )}
                {known ? (
                  <div style={{ width: '62%', maxWidth: '24px', height: h, background: c.chart, borderRadius: '4px 4px 0 0' }} />
                ) : (
                  <span aria-hidden style={{ fontSize: tokens.type.micro, color: c.textDim, marginBottom: '6px' }}>·</span>
                )}
              </div>
              <span
                style={{
                  height: AXIS,
                  lineHeight: `${AXIS}px`,
                  fontSize: tokens.type.micro,
                  color: m === latest ? c.text : c.textDim,
                  whiteSpace: 'nowrap',
                }}
              >
                {monthLabel(m)}
              </span>
              {active === m && (
                <div
                  role="tooltip"
                  style={{
                    position: 'absolute',
                    bottom: AXIS + 6,
                    left: '50%',
                    transform: 'translateX(-50%)',
                    padding: '6px 10px',
                    borderRadius: tokens.radius.sm,
                    background: c.bgElevated,
                    border: `1px solid ${c.borderHover}`,
                    color: c.text,
                    fontSize: tokens.type.micro,
                    whiteSpace: 'nowrap',
                    pointerEvents: 'none',
                    zIndex: 2,
                    boxShadow: '0 6px 20px rgba(0,0,0,0.25)',
                  }}
                >
                  {tip}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export interface BarRow {
  key: string;
  label: ReactNode;
  value: number;
  sub?: ReactNode; // a quiet second line under the label
  onClick?: () => void;
}

// Horizontal bars for a ranked list (by entity, by source, by payer). Same hue for every
// row: the rows are named, so the label carries identity and the length carries size.
export function BarList({ rows, max, emptyText }: { rows: BarRow[]; max?: number; emptyText?: string }) {
  const { tokens } = useTheme();
  const c = tokens.colors;
  const top = max ?? Math.max(0, ...rows.map((r) => r.value));
  if (rows.length === 0) {
    return <div style={{ fontSize: tokens.type.small, color: c.textDim }}>{emptyText ?? 'Nothing yet.'}</div>;
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
      {rows.map((r) => {
        const pct = top > 0 ? (100 * r.value) / top : 0;
        const body = (
          <>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '12px' }}>
              <span style={{ flex: 1, minWidth: 0, fontSize: tokens.type.body, color: c.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {r.label}
              </span>
              <span style={{ fontSize: tokens.type.body, fontWeight: 600, color: c.text, fontVariantNumeric: 'tabular-nums' }}>{formatUsd(r.value)}</span>
            </div>
            <div style={{ height: '8px', marginTop: '7px', borderRadius: '4px', background: c.chartTrack, overflow: 'hidden' }}>
              <div style={{ width: `${pct}%`, minWidth: r.value > 0 ? '4px' : 0, height: '100%', background: c.chart, borderRadius: '0 4px 4px 0' }} />
            </div>
            {r.sub && <div style={{ fontSize: tokens.type.micro, color: c.textDim, marginTop: '6px' }}>{r.sub}</div>}
          </>
        );
        return r.onClick ? (
          <button
            key={r.key}
            onClick={r.onClick}
            onMouseEnter={(e) => (e.currentTarget.style.background = c.bgCardHover)}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            style={{ display: 'block', width: '100%', textAlign: 'left', padding: '6px 8px', margin: '-6px -8px', boxSizing: 'content-box', background: 'transparent', border: 'none', borderRadius: tokens.radius.sm, cursor: 'pointer', fontFamily: 'inherit', color: 'inherit' }}
          >
            {body}
          </button>
        ) : (
          <div key={r.key}>{body}</div>
        );
      })}
    </div>
  );
}

// A big figure with its label: the hero is the one number a view leads with.
export function Figure({ label, value, sub, hero = false }: { label: string; value: ReactNode; sub?: ReactNode; hero?: boolean }) {
  const { tokens } = useTheme();
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: tokens.type.small, color: tokens.colors.textMuted, marginBottom: '6px' }}>{label}</div>
      <div
        style={{
          fontSize: hero ? tokens.type.hero : '34px',
          fontWeight: 600,
          letterSpacing: '-0.025em',
          lineHeight: 1.05,
          color: tokens.colors.text,
        }}
      >
        {value}
      </div>
      {sub && <div style={{ fontSize: tokens.type.small, color: tokens.colors.textDim, marginTop: '8px', lineHeight: 1.45 }}>{sub}</div>}
    </div>
  );
}
