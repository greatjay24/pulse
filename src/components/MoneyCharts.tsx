import { ReactNode, useEffect, useRef, useState } from 'react';
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

// ---------------------------------------------------------------------------
// Per-business weekly charts. Each plots one business, in that business's brand color
// stepped for the surface (utils/seriesColor.ts), so color says whose money it is.
// ---------------------------------------------------------------------------

export interface WeekBar {
  key: string; // Monday, YYYY-MM-DD
  value: number;
  known: boolean; // inside a connected source's window
  detail?: string; // a quiet second tooltip line (e.g. by channel)
}

function weekLabel(key: string, long = false): string {
  const [y, m, d] = key.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return long ? `Week of ${date.toLocaleDateString([], { month: 'long', day: 'numeric' })}` : date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function Tooltip({ children, style }: { children: ReactNode; style: React.CSSProperties }) {
  const { tokens } = useTheme();
  const c = tokens.colors;
  return (
    <div
      role="tooltip"
      style={{
        position: 'absolute',
        padding: '6px 10px',
        borderRadius: tokens.radius.sm,
        background: c.bgElevated,
        border: `1px solid ${c.borderHover}`,
        color: c.text,
        fontSize: tokens.type.micro,
        lineHeight: 1.5,
        whiteSpace: 'nowrap',
        pointerEvents: 'none',
        zIndex: 2,
        boxShadow: '0 6px 20px rgba(0,0,0,0.25)',
        ...style,
      }}
    >
      {children}
    </div>
  );
}

// Columns by week: 4px rounded data-ends on a hairline baseline; the peak and the latest
// week carry direct labels; hover or focus shows the exact value.
export function WeekColumns({ weeks, color, label, height = 110 }: { weeks: WeekBar[]; color: string; label: string; height?: number }) {
  const { tokens } = useTheme();
  const c = tokens.colors;
  const [active, setActive] = useState<string | null>(null);
  const known = weeks.filter((w) => w.known);
  const max = Math.max(0, ...known.map((w) => w.value));
  const peak = known.find((w) => max > 0 && w.value === max)?.key ?? null;
  const latest = weeks[weeks.length - 1]?.key;
  const AXIS = 20;
  // Every fourth week is named on the axis (counting back from the latest), so labels never collide.
  const named = new Set(weeks.filter((_, i) => (weeks.length - 1 - i) % 4 === 0).map((w) => w.key));
  const barH = (w: WeekBar) => (w.known && max > 0 ? Math.max(w.value > 0 ? 3 : 0, ((height - 16) * w.value) / max) : 0);

  return (
    <div role="list" aria-label={label} style={{ display: 'flex', alignItems: 'stretch', height: height + AXIS, gap: '2px' }}>
      {weeks.map((w, i) => {
        const h = barH(w);
        // A direct label sits on its column's cap; skip it when a neighbor rises into the label's line.
        const clear = [i - 1, i + 1].every((j) => !weeks[j] || barH(weeks[j]) < h + 14);
        const showLabel = w.known && w.value > 0 && (w.key === peak || w.key === latest) && clear;
        const tip = w.known ? `${weekLabel(w.key, true)}: ${formatUsd(w.value)}` : `${weekLabel(w.key, true)}: not on file`;
        return (
          <div
            key={w.key}
            role="listitem"
            tabIndex={0}
            aria-label={tip}
            onMouseEnter={() => setActive(w.key)}
            onMouseLeave={() => setActive((a) => (a === w.key ? null : a))}
            onFocus={() => setActive(w.key)}
            onBlur={() => setActive((a) => (a === w.key ? null : a))}
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
                background: active === w.key ? c.bgCardHover : 'transparent',
                borderRadius: '6px 6px 0 0',
              }}
            >
              {showLabel && (
                <span style={{ fontSize: tokens.type.micro, color: c.textMuted, marginBottom: '4px', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                  {formatUsdCompact(w.value)}
                </span>
              )}
              {w.known ? (
                <div style={{ width: '64%', maxWidth: '24px', height: h, background: color, borderRadius: '4px 4px 0 0' }} />
              ) : (
                <span aria-hidden style={{ fontSize: tokens.type.micro, color: c.textDim, marginBottom: '6px' }}>·</span>
              )}
            </div>
            <span style={{ height: AXIS, lineHeight: `${AXIS}px`, fontSize: tokens.type.micro, color: w.key === latest ? c.text : c.textDim, whiteSpace: 'nowrap' }}>
              {named.has(w.key) ? weekLabel(w.key) : ''}
            </span>
            {active === w.key && (
              <Tooltip style={{ bottom: AXIS + 6, left: '50%', transform: 'translateX(-50%)' }}>
                {tip}
                {w.known && w.detail && <div style={{ color: c.textMuted }}>{w.detail}</div>}
              </Tooltip>
            )}
          </div>
        );
      })}
    </div>
  );
}

// A balance over time: a 2px line over a 10% wash of the same hue, an end-dot ringed in the
// surface color with the latest value beside it, two recessive hairlines at the low and high,
// and a crosshair that follows the pointer (or the arrow keys) with the exact day's balance.
export function BalanceLine({ points, color, label, height = 130 }: { points: [string, number][]; color: string; label: string; height?: number }) {
  const { tokens } = useTheme();
  const c = tokens.colors;
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [active, setActive] = useState<number | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.floor(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const n = points.length;
  const values = points.map((p) => p[1]);
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const span = hi - lo || Math.max(Math.abs(hi), 1);
  const LEFT = 44; // y labels
  const RIGHT = 64; // end label
  const TOP = 10;
  const BOTTOM = 20;
  const plotW = Math.max(0, width - LEFT - RIGHT);
  const plotH = height - TOP - BOTTOM;
  const x = (i: number) => LEFT + (n > 1 ? (plotW * i) / (n - 1) : plotW);
  const y = (v: number) => TOP + plotH - (plotH * (v - lo)) / span;
  const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p[1]).toFixed(1)}`).join('');
  const area = `${line}L${x(n - 1).toFixed(1)},${TOP + plotH}L${x(0).toFixed(1)},${TOP + plotH}Z`;
  const dayLabel = (d: string, long = false) => {
    const [yy, mm, dd] = d.split('-').map(Number);
    return new Date(yy, mm - 1, dd).toLocaleDateString([], long ? { weekday: 'short', month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric' });
  };

  const pick = (clientX: number) => {
    const r = ref.current?.getBoundingClientRect();
    if (!r || n === 0 || plotW <= 0) return;
    const i = Math.round(((clientX - r.left - LEFT) / plotW) * (n - 1));
    setActive(Math.min(n - 1, Math.max(0, i)));
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      setActive((a) => Math.min(n - 1, Math.max(0, (a ?? n - 1) + (e.key === 'ArrowLeft' ? -1 : 1))));
    }
  };

  const a = active !== null ? points[active] : null;
  return (
    <div
      ref={ref}
      tabIndex={0}
      role="img"
      aria-label={`${label}: ${formatUsd(values[n - 1] ?? 0)} on ${points[n - 1] ? dayLabel(points[n - 1][0]) : ''}, low ${formatUsd(lo)}, high ${formatUsd(hi)}. Arrow keys step through days.`}
      onMouseMove={(e) => pick(e.clientX)}
      onMouseLeave={() => setActive(null)}
      onFocus={() => setActive(n - 1)}
      onBlur={() => setActive(null)}
      onKeyDown={onKey}
      style={{ position: 'relative', height, outline: 'none' }}
    >
      {width > 0 && n > 1 && (
        <svg width={width} height={height} style={{ display: 'block', overflow: 'visible' }} aria-hidden>
          {[hi, lo].map((v) => (
            <g key={v}>
              <line x1={LEFT} x2={LEFT + plotW} y1={y(v)} y2={y(v)} stroke={c.border} strokeWidth={1} />
              <text x={LEFT - 6} y={y(v)} dy="0.35em" textAnchor="end" fill={c.textDim} style={{ fontSize: tokens.type.micro, fontVariantNumeric: 'tabular-nums' }}>
                {formatUsdCompact(v)}
              </text>
            </g>
          ))}
          <path d={area} fill={color} fillOpacity={0.1} />
          <path d={line} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          <text x={LEFT} y={height - 4} fill={c.textDim} style={{ fontSize: tokens.type.micro }}>{dayLabel(points[0][0])}</text>
          <text x={LEFT + plotW} y={height - 4} textAnchor="end" fill={c.text} style={{ fontSize: tokens.type.micro }}>{dayLabel(points[n - 1][0])}</text>
          {a && active !== null && <line x1={x(active)} x2={x(active)} y1={TOP} y2={TOP + plotH} stroke={c.borderHover} strokeWidth={1} />}
          {(a && active !== null ? [active] : []).concat([n - 1]).map((i) => (
            <circle key={i} cx={x(i)} cy={y(points[i][1])} r={4} fill={color} stroke={c.bgCard} strokeWidth={2} />
          ))}
          <text x={x(n - 1) + 10} y={y(values[n - 1])} dy="0.35em" fill={c.text} style={{ fontSize: tokens.type.small, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
            {formatUsdCompact(values[n - 1])}
          </text>
        </svg>
      )}
      {a && active !== null && (
        <Tooltip style={{ top: 0, left: Math.min(Math.max(x(active) - 70, 0), Math.max(width - 160, 0)) }}>
          {dayLabel(a[0], true)}: {formatUsd(a[1])}
        </Tooltip>
      )}
    </div>
  );
}

// The same numbers as a table, for screen readers and anyone who'd rather read than look.
export function ValuesTable({ rows, caption }: { rows: [string, string][]; caption: string }) {
  const { tokens } = useTheme();
  const c = tokens.colors;
  return (
    <details style={{ marginTop: '8px', fontSize: tokens.type.micro, color: c.textDim }}>
      <summary style={{ cursor: 'pointer' }}>Show as table</summary>
      <table style={{ marginTop: '6px', borderCollapse: 'collapse', width: '100%' }}>
        <caption style={{ textAlign: 'left', paddingBottom: '4px' }}>{caption}</caption>
        <tbody>
          {rows.map(([k, v]) => (
            <tr key={k} style={{ borderTop: `1px solid ${c.border}` }}>
              <td style={{ padding: '3px 0', color: c.textMuted }}>{k}</td>
              <td style={{ padding: '3px 0', textAlign: 'right', color: c.text, fontVariantNumeric: 'tabular-nums' }}>{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}
