import { ReactNode, useMemo, useState } from 'react';
import { useTheme } from '../contexts/ThemeContext';
import { PortfolioSnapshot } from '../types';
import { PlanWindow, UsageReport, UsageRun, UsageWindow } from '../types/usage';
import { useUsage } from '../hooks/useUsage';
import {
  Grain, Tally, bucketLabel, buckets, byModel, formatAgo, formatCount, formatPct, formatUsd, groupBy, kindLabel,
  modelLabel, nextBucket, tallyBuckets, topRuns, totalTokens,
} from '../utils/usage';
import { Card, Notice, PageHeader, SectionLabel } from './BoardUI';
import { Icon } from './Icons';

// Usage: where the Claude plan goes. Everything runs on a Max subscription, so dollars are
// API-equivalent estimates and the plan's limits are what matter. Charts follow the dataviz
// rules: one series per chart in the theme's chart hue, text in text tokens, thin marks with
// 4px rounded data-ends, a hover/focus tooltip on every mark, and the numbers written out.

const WINDOW_LABEL: Record<string, string> = { five_hour: '5-hour window', seven_day: 'Weekly window' };
type Metric = 'cost' | 'tokens';

function useNames(snapshot: PortfolioSnapshot | null) {
  return useMemo(() => {
    const m = new Map<string, string>();
    for (const e of snapshot?.registry?.entities ?? []) m.set(e.id, e.name);
    return m;
  }, [snapshot]);
}

// ------------------------------------------
// Plan limits: the plan's own reading, and our estimate against the soft budget
// ------------------------------------------

function Meter({ value, warn, label }: { value: number; warn: boolean; label: string }) {
  const { tokens } = useTheme();
  const c = tokens.colors;
  const pct = Math.max(0, Math.min(1, value));
  return (
    <div role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(value * 100)}
      style={{ height: '8px', borderRadius: '4px', background: c.chartTrack, overflow: 'hidden' }}>
      <div style={{ width: `${pct * 100}%`, minWidth: value > 0 ? '4px' : 0, height: '100%', background: warn ? c.warning : c.chart, borderRadius: '0 4px 4px 0' }} />
    </div>
  );
}

function WarnLabel() {
  const { tokens } = useTheme();
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', fontSize: tokens.type.micro, color: tokens.colors.text, fontWeight: 600 }}>
      <Icon name="alert" size={13} color={tokens.colors.warning} /> Near the limit
    </span>
  );
}

function resetText(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  const sameDay = d.toDateString() === new Date().toDateString();
  return `resets ${sameDay ? '' : d.toLocaleDateString([], { weekday: 'short' }) + ' '}${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
}

function LimitCard({ name, plan, planAge, ours, implied }: {
  name: 'five_hour' | 'seven_day'; plan: PlanWindow | undefined; planAge: number | null; ours: UsageWindow | undefined; implied: number | undefined;
}) {
  const { tokens } = useTheme();
  const c = tokens.colors;
  const planUsable = plan && !plan.reset_passed;
  return (
    <Card padding="20px 22px">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '12px', marginBottom: '14px' }}>
        <SectionLabel style={{ marginBottom: 0 }}>{WINDOW_LABEL[name]}</SectionLabel>
        {((planUsable && plan.warn) || ours?.warn) && <WarnLabel />}
      </div>

      {/* The plan's own number, from Claude Code */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '10px', marginBottom: '8px' }}>
        <span style={{ fontSize: '30px', fontWeight: 600, letterSpacing: '-0.02em', color: c.text, fontVariantNumeric: 'tabular-nums' }}>
          {planUsable ? formatPct(plan.utilization) : '—'}
        </span>
        <span style={{ fontSize: tokens.type.small, color: c.textMuted }}>of the plan's limit used</span>
      </div>
      {planUsable && <Meter value={plan.utilization} warn={plan.warn} label={`${WINDOW_LABEL[name]}: plan usage`} />}
      <div style={{ fontSize: tokens.type.micro, color: c.textDim, marginTop: '8px', lineHeight: 1.5 }}>
        {plan == null
          ? 'No reading yet. Claude Code reports it during each agent run.'
          : plan.reset_passed
            ? `Last reading was before this window reset${planAge != null ? ` (${formatAgo(planAge)})` : ''}. The next agent run updates it.`
            : `From Claude Code${planAge != null ? `, ${formatAgo(planAge)}` : ''}${resetText(plan.resets_at) ? `; ${resetText(plan.resets_at)}` : ''}.`}
      </div>

      {/* Our estimate, from our own logs */}
      <div style={{ borderTop: `1px solid ${c.border}`, marginTop: '16px', paddingTop: '14px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', fontSize: tokens.type.small, marginBottom: '8px' }}>
          <span style={{ color: c.textMuted }}>Our estimate</span>
          <span style={{ color: c.text, fontVariantNumeric: 'tabular-nums' }}>
            {ours ? formatUsd(ours.cost_usd) : '—'}
            {ours?.budget_usd ? <span style={{ color: c.textDim }}> of {formatUsd(ours.budget_usd)} · {formatPct(ours.used ?? 0)}</span> : null}
          </span>
        </div>
        {ours?.budget_usd ? <Meter value={ours.used ?? 0} warn={ours.warn} label={`${WINDOW_LABEL[name]}: our estimate against the soft budget`} /> : null}
        <div style={{ fontSize: tokens.type.micro, color: c.textDim, marginTop: '8px', lineHeight: 1.5 }}>
          {ours ? `${ours.runs} run${ours.runs === 1 ? '' : 's'}, ${formatCount(totalTokens(ours.tokens))} tokens in the last ${name === 'five_hour' ? '5 hours' : '7 days'}. ` : ''}
          {ours?.budget_usd ? 'Soft budget from portfolio.json "usage".' : 'Set a soft budget in portfolio.json "usage".'}
          {implied ? ` The plan's reading puts a full window near ${formatUsd(implied)}.` : ''}
        </div>
      </div>
    </Card>
  );
}

// ------------------------------------------
// Over time: one column per day, week or month
// ------------------------------------------

function tip(t: Tally): string {
  return `${formatUsd(t.cost)}${t.estimated ? ' (part estimated)' : ''} · ${formatCount(totalTokens(t.tokens))} tokens · ${t.runs} run${t.runs === 1 ? '' : 's'}`;
}

function Columns({ data, grain, metric, height = 160 }: { data: { start: number; tally: Tally }[]; grain: Grain; metric: Metric; height?: number }) {
  const { tokens } = useTheme();
  const c = tokens.colors;
  const [active, setActive] = useState<number | null>(null);
  const val = (t: Tally) => (metric === 'cost' ? t.cost : totalTokens(t.tokens));
  const fmt = (v: number) => (metric === 'cost' ? formatUsd(v) : formatCount(v));
  const max = Math.max(0, ...data.map((d) => val(d.tally)));
  const peak = data.find((d) => max > 0 && val(d.tally) === max)?.start;
  const latest = data[data.length - 1]?.start;
  const AXIS = 22;
  return (
    <div style={{ position: 'relative' }}>
      <div role="list" aria-label={`Usage by ${grain}`} style={{ display: 'flex', alignItems: 'stretch', height: height + AXIS, gap: '2px' }}>
        {data.map(({ start, tally }) => {
          const v = val(tally);
          const h = max > 0 ? Math.max(v > 0 ? 3 : 0, ((height - 16) * v) / max) : 0;
          const label = `${bucketLabel(start, grain, true)}: ${tip(tally)}`;
          return (
            <div key={start} role="listitem" tabIndex={0} aria-label={label}
              onMouseEnter={() => setActive(start)} onMouseLeave={() => setActive((a) => (a === start ? null : a))}
              onFocus={() => setActive(start)} onBlur={() => setActive((a) => (a === start ? null : a))}
              style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', position: 'relative', outline: 'none' }}>
              <div style={{ height, width: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', alignItems: 'center',
                borderBottom: `1px solid ${c.border}`, background: active === start ? c.bgCardHover : 'transparent', borderRadius: '6px 6px 0 0' }}>
                {(start === peak || start === latest) && v > 0 && (
                  <span style={{ fontSize: tokens.type.micro, color: c.textMuted, marginBottom: '4px', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{fmt(v)}</span>
                )}
                <div style={{ width: '62%', maxWidth: '28px', height: h, background: c.chart, borderRadius: '4px 4px 0 0' }} />
              </div>
              <span style={{ height: AXIS, lineHeight: `${AXIS}px`, fontSize: tokens.type.micro, color: start === latest ? c.text : c.textDim, whiteSpace: 'nowrap' }}>
                {bucketLabel(start, grain)}
              </span>
              {active === start && (
                <div role="tooltip" style={{ position: 'absolute', bottom: AXIS + 6, left: '50%', transform: 'translateX(-50%)', padding: '6px 10px',
                  borderRadius: tokens.radius.sm, background: c.bgElevated, border: `1px solid ${c.borderHover}`, color: c.text,
                  fontSize: tokens.type.micro, whiteSpace: 'nowrap', pointerEvents: 'none', zIndex: 2, boxShadow: '0 6px 20px rgba(0,0,0,0.25)' }}>
                  {label}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ------------------------------------------
// Breakdowns: ranked bars, one hue; the label carries identity, the length carries size
// ------------------------------------------

function Ranked({ rows, total, metric }: { rows: { key: string; label: ReactNode; tally: Tally }[]; total: number; metric: Metric }) {
  const { tokens } = useTheme();
  const c = tokens.colors;
  const val = (t: Tally) => (metric === 'cost' ? t.cost : totalTokens(t.tokens));
  const top = Math.max(0, ...rows.map((r) => val(r.tally)));
  if (rows.length === 0) return <div style={{ fontSize: tokens.type.small, color: c.textDim }}>Nothing in this range.</div>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      {rows.slice(0, 8).map((r) => {
        const v = val(r.tally);
        return (
          <div key={r.key} title={tip(r.tally)}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '10px' }}>
              <span style={{ flex: 1, minWidth: 0, fontSize: tokens.type.small, color: c.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.label}</span>
              <span style={{ fontSize: tokens.type.small, fontWeight: 600, color: c.text, fontVariantNumeric: 'tabular-nums' }}>
                {metric === 'cost' ? formatUsd(v) : formatCount(v)}
              </span>
              <span style={{ width: '38px', textAlign: 'right', fontSize: tokens.type.micro, color: c.textDim, fontVariantNumeric: 'tabular-nums' }}>
                {total > 0 ? formatPct(v / total) : ''}
              </span>
            </div>
            <div style={{ height: '6px', marginTop: '6px', borderRadius: '4px', background: c.chartTrack, overflow: 'hidden' }}>
              <div style={{ width: `${top > 0 ? (100 * v) / top : 0}%`, minWidth: v > 0 ? '4px' : 0, height: '100%', background: c.chart, borderRadius: '0 4px 4px 0' }} />
            </div>
          </div>
        );
      })}
      {rows.length > 8 && <div style={{ fontSize: tokens.type.micro, color: c.textDim }}>+ {rows.length - 8} more</div>}
    </div>
  );
}

function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { id: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  const { tokens } = useTheme();
  const c = tokens.colors;
  return (
    <div role="radiogroup" aria-label={label} style={{ display: 'inline-flex', border: `1px solid ${c.border}`, borderRadius: tokens.radius.sm, padding: '2px', gap: '2px' }}>
      {options.map((o) => (
        <button key={o.id} role="radio" aria-checked={value === o.id} onClick={() => onChange(o.id)}
          style={{ padding: '5px 12px', fontSize: tokens.type.small, border: 'none', borderRadius: '6px', cursor: 'pointer', fontFamily: 'inherit',
            background: value === o.id ? c.bgCardHover : 'transparent', color: value === o.id ? c.text : c.textMuted }}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

function when(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })}, ${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
}

const th = { textAlign: 'right' as const, fontWeight: 500, padding: '8px 0 8px 16px' };
const td = { textAlign: 'right' as const, padding: '9px 0 9px 16px', fontVariantNumeric: 'tabular-nums' as const };

// ------------------------------------------
// The page
// ------------------------------------------

function Body({ report, names, onOpenConversation }: { report: UsageReport; names: Map<string, string>; onOpenConversation: (f: { runId?: string }) => void }) {
  const { tokens } = useTheme();
  const c = tokens.colors;
  const [grain, setGrain] = useState<Grain>('day');
  const [metric, setMetric] = useState<Metric>('cost');
  const [table, setTable] = useState(false);
  const now = Date.parse(report.generated) || Date.now();
  const runs: UsageRun[] = report.runs;

  const series = useMemo(() => tallyBuckets(runs, grain, now), [runs, grain, now]);
  const from = buckets(grain, now)[0];
  const to = nextBucket(series[series.length - 1].start, grain);
  const rangeLabel = `${bucketLabel(from, grain, true)} to now`;
  const total = series.reduce((s, b) => s + (metric === 'cost' ? b.tally.cost : totalTokens(b.tally.tokens)), 0);
  const totalCost = series.reduce((s, b) => s + b.tally.cost, 0);

  const entityRows = groupBy(runs, (r) => r.entity ?? '', from, to).map((g) => ({
    key: g.key, tally: g.tally, label: g.key ? names.get(g.key) ?? g.key : <span style={{ color: c.textMuted }}>No business (your own sessions, other runs)</span>,
  }));
  const leadRows = groupBy(runs, (r) => r.agent ?? (r.kind === 'interactive' ? 'You (no agent)' : r.kind === 'headless' ? 'Other headless runs' : 'Unknown'), from, to)
    .map((g) => ({ key: g.key, tally: g.tally, label: g.key }));
  const kindRows = groupBy(runs, (r) => r.kind, from, to).map((g) => ({ key: g.key, tally: g.tally, label: kindLabel(g.key) }));
  const models = byModel(runs, from, to);
  const modelRows = models.map((g) => ({ key: g.key, tally: g.tally, label: modelLabel(g.key) }));
  const heavy = topRuns(runs, from, to, 10);
  const plan = report.plan;

  return (
    <>
      {/* Plan limits */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '16px', marginBottom: '28px' }}>
        {(['five_hour', 'seven_day'] as const).map((w) => (
          <LimitCard key={w} name={w} plan={plan?.windows?.[w]} planAge={plan?.age_secs ?? null} ours={report.windows?.[w]} implied={report.implied_budget_usd?.[w]} />
        ))}
      </div>

      {/* Filters: one row above the charts */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap', marginBottom: '16px' }}>
        <Segmented label="Group by" value={grain} onChange={setGrain} options={[{ id: 'day', label: 'Day' }, { id: 'week', label: 'Week' }, { id: 'month', label: 'Month' }]} />
        <Segmented label="Measure" value={metric} onChange={setMetric} options={[{ id: 'cost', label: 'Est. cost' }, { id: 'tokens', label: 'Tokens' }]} />
        <span style={{ fontSize: tokens.type.small, color: c.textMuted }}>{rangeLabel}: {formatUsd(totalCost)} API-equivalent</span>
      </div>

      <Card style={{ marginBottom: '16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '16px' }}>
          <SectionLabel style={{ marginBottom: 0 }}>{metric === 'cost' ? 'Estimated cost' : 'Tokens'} by {grain}</SectionLabel>
          <button onClick={() => setTable((t) => !t)} style={{ background: 'none', border: 'none', color: c.textMuted, fontSize: tokens.type.micro, cursor: 'pointer', fontFamily: 'inherit' }}>
            {table ? 'Show chart' : 'Show as table'}
          </button>
        </div>
        {table ? (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: tokens.type.small, color: c.text }}>
            <thead><tr style={{ color: c.textDim, fontSize: tokens.type.micro }}>
              <th style={{ ...th, textAlign: 'left', paddingLeft: 0 }}>{grain === 'day' ? 'Day' : grain === 'week' ? 'Week' : 'Month'}</th>
              <th style={th}>Est. cost</th><th style={th}>Tokens</th><th style={th}>Runs</th>
            </tr></thead>
            <tbody>
              {[...series].reverse().map(({ start, tally }) => (
                <tr key={start} style={{ borderTop: `1px solid ${c.border}` }}>
                  <td style={{ ...td, textAlign: 'left', paddingLeft: 0 }}>{bucketLabel(start, grain, true)}</td>
                  <td style={td}>{formatUsd(tally.cost)}</td><td style={td}>{formatCount(totalTokens(tally.tokens))}</td><td style={td}>{tally.runs}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <Columns data={series} grain={grain} metric={metric} />
        )}
      </Card>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))', gap: '16px', marginBottom: '16px' }}>
        <Card padding="20px 22px"><SectionLabel>By business</SectionLabel><Ranked rows={entityRows} total={total} metric={metric} /></Card>
        <Card padding="20px 22px"><SectionLabel>By lead</SectionLabel><Ranked rows={leadRows} total={total} metric={metric} /></Card>
        <Card padding="20px 22px"><SectionLabel>By kind of run</SectionLabel><Ranked rows={kindRows} total={total} metric={metric} /></Card>
        <Card padding="20px 22px"><SectionLabel>By model</SectionLabel><Ranked rows={modelRows} total={total} metric={metric} /></Card>
      </div>

      {/* Tokens by model, written out */}
      <Card style={{ marginBottom: '16px' }}>
        <SectionLabel>Tokens by model · {rangeLabel}</SectionLabel>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: tokens.type.small, color: c.text }}>
          <thead><tr style={{ color: c.textDim, fontSize: tokens.type.micro }}>
            <th style={{ ...th, textAlign: 'left', paddingLeft: 0 }}>Model</th>
            <th style={th}>Input</th><th style={th}>Output</th><th style={th}>Cache read</th><th style={th}>Cache write</th><th style={th}>Est. cost</th>
          </tr></thead>
          <tbody>
            {models.map((m) => (
              <tr key={m.key} style={{ borderTop: `1px solid ${c.border}` }}>
                <td style={{ ...td, textAlign: 'left', paddingLeft: 0 }}>{modelLabel(m.key)}</td>
                <td style={td}>{formatCount(m.tally.tokens.input)}</td><td style={td}>{formatCount(m.tally.tokens.output)}</td>
                <td style={td}>{formatCount(m.tally.tokens.cache_read)}</td><td style={td}>{formatCount(m.tally.tokens.cache_write)}</td>
                <td style={td}>{formatUsd(m.tally.cost)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {models.length === 0 && <div style={{ fontSize: tokens.type.small, color: c.textDim, marginTop: '8px' }}>Nothing in this range.</div>}
      </Card>

      {/* The heaviest runs */}
      <Card style={{ marginBottom: '16px' }}>
        <SectionLabel>Heaviest runs · {rangeLabel}</SectionLabel>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {heavy.map(({ run, cost, share }, i) => {
            const open = run.run_id ? () => onOpenConversation({ runId: run.run_id! }) : undefined;
            const who = run.agent ?? (run.kind === 'interactive' ? 'Your session' : 'Headless run');
            return (
              <div key={run.id} role={open ? 'button' : undefined} tabIndex={open ? 0 : undefined} onClick={open}
                onKeyDown={(e) => open && (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), open())}
                title={open ? 'Open the conversation' : 'No conversation on record for this one'}
                className={open ? 'activity-row-link' : undefined}
                style={{ display: 'flex', gap: '14px', alignItems: 'baseline', padding: '10px 8px', margin: '0 -8px', borderTop: i ? `1px solid ${c.border}` : 'none', cursor: open ? 'pointer' : 'default', borderRadius: tokens.radius.sm }}>
                <span style={{ width: '20px', fontSize: tokens.type.micro, color: c.textDim, fontVariantNumeric: 'tabular-nums' }}>{i + 1}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: tokens.type.small, color: c.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{run.doing || who}</div>
                  <div style={{ fontSize: tokens.type.micro, color: c.textDim, marginTop: '3px' }}>
                    {kindLabel(run.kind)}{run.agent ? ` · ${run.agent}` : ''}{run.entity ? ` · ${names.get(run.entity) ?? run.entity}` : ''} · {when(run.started)}
                    {run.models.length ? ` · ${run.models.map(modelLabel).join(', ')}` : ''}
                  </div>
                </div>
                <span style={{ fontSize: tokens.type.micro, color: c.textDim, fontVariantNumeric: 'tabular-nums' }}>{formatCount(totalTokens(run.tokens) * share)} tokens</span>
                <span style={{ width: '64px', textAlign: 'right', fontSize: tokens.type.small, fontWeight: 600, color: c.text, fontVariantNumeric: 'tabular-nums' }}>
                  {formatUsd(cost)}
                </span>
                {open ? <Icon name="external-link" size={13} color={c.textDim} /> : <span style={{ width: 13 }} />}
              </div>
            );
          })}
          {heavy.length === 0 && <div style={{ fontSize: tokens.type.small, color: c.textDim }}>Nothing in this range.</div>}
        </div>
      </Card>

      <div style={{ fontSize: tokens.type.micro, color: c.textDim, lineHeight: 1.6, maxWidth: '760px' }}>
        How this is computed: agent runs report their own API-equivalent cost and tokens when they finish. Your own Claude Code
        sessions are counted from the usage numbers Claude Code records for each reply (never the messages), priced at
        per-model rates calibrated against Claude Code's own figures; a session that belongs to an agent run is counted once.
        The plan percentages are Claude Code's own readings from the most recent agent run. Rebuilt nightly and when you open this page.
      </div>
    </>
  );
}

export function UsagePage({ snapshot, onOpenConversation }: { snapshot: PortfolioSnapshot | null; onOpenConversation: (f: { runId?: string; entity?: string }) => void }) {
  const { tokens } = useTheme();
  const { data, error, refreshing, refresh } = useUsage();
  const names = useNames(snapshot);
  const report = data?.report ?? null;
  return (
    <div style={{ maxWidth: '1180px' }}>
      <PageHeader
        title="Usage"
        subtitle="Where your Claude plan goes. Dollars are what the same tokens would cost on the API; your Max plan doesn't charge them."
        right={
          <button onClick={refresh} disabled={refreshing}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '7px 12px', fontSize: tokens.type.small, borderRadius: tokens.radius.sm,
              border: `1px solid ${tokens.colors.border}`, background: 'transparent', color: tokens.colors.text, cursor: refreshing ? 'default' : 'pointer', fontFamily: 'inherit' }}>
            <Icon name="refresh" size={14} color={tokens.colors.textMuted} /> {refreshing ? 'Refreshing…' : 'Refresh'}
          </button>
        }
      />
      {error && <Notice>Couldn't read usage: {error}</Notice>}
      {data?.refresh_error && <Notice tone="quiet">Showing the last report; rebuilding it failed: {data.refresh_error}</Notice>}
      {report ? (
        <Body report={report} names={names} onOpenConversation={onOpenConversation} />
      ) : (
        !error && <div style={{ fontSize: tokens.type.small, color: tokens.colors.textDim }}>{refreshing ? 'Adding up usage…' : 'No usage report yet.'}</div>
      )}
    </div>
  );
}
