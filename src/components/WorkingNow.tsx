import { useEffect, useState } from 'react';
import { useTheme } from '../contexts/ThemeContext';
import { LiveRun, PortfolioSnapshot } from '../types';
import { useLive } from '../hooks/useLive';
import { elapsed, kindLabel, ms, stateLabel, stripRuns } from '../utils/live';
import { EntityMark, SectionLabel } from './BoardUI';

// Ticks once a second while something is on screen, for elapsed times.
function useNow(active: boolean) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  return now;
}

export function LiveDot({ color, pulsing }: { color: string; pulsing: boolean }) {
  return (
    <span
      aria-hidden
      style={{
        width: 8,
        height: 8,
        borderRadius: '50%',
        background: color,
        flexShrink: 0,
        display: 'inline-block',
        animation: pulsing ? 'pulse-live 1.6s ease-in-out infinite' : undefined,
      }}
    >
      <style>{'@keyframes pulse-live { 0%, 100% { opacity: 1 } 50% { opacity: 0.35 } }'}</style>
    </span>
  );
}

function RunCard({ run, snapshot, now, onOpen }: { run: LiveRun; snapshot: PortfolioSnapshot | null; now: number; onOpen: (runId: string) => void }) {
  const { tokens } = useTheme();
  const c = tokens.colors;
  const entity = snapshot?.registry?.entities.find((e) => e.id === run.entity) ?? null;
  const report = snapshot?.entities.find((e) => e.id === run.entity);
  const tone = run.state === 'running' ? c.accent : run.state === 'stopped' ? c.danger : c.textDim;
  const end = run.state === 'stopped' ? ms(run.updated) : now;
  const step = run.state === 'idle' ? run.last || 'Waiting for you' : run.step;
  return (
    <button
      onClick={() => onOpen(run.run_id)}
      title="Open this conversation"
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: '12px',
        padding: '14px 16px',
        minWidth: 0,
        textAlign: 'left',
        background: c.bgCard,
        border: `1px solid ${run.state === 'running' ? c.accent : c.border}`,
        borderRadius: tokens.radius.md,
        color: c.text,
        fontFamily: 'inherit',
        cursor: 'pointer',
      }}
    >
      {entity ? (
        <EntityMark entity={entity} logos={report ? { logo: report.logo, logo_dark: report.logo_dark } : null} size={28} />
      ) : (
        <span style={{ width: 28, height: 28, borderRadius: 7, background: c.bgElevated, flexShrink: 0 }} aria-hidden />
      )}
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: tokens.type.small, color: c.textDim }}>
          <LiveDot color={tone} pulsing={run.state === 'running'} />
          <span style={{ fontWeight: 600, color: c.text }}>{run.agent}</span>
          <span style={{ color: tone }}>{stateLabel(run)}</span>
          <span style={{ marginLeft: 'auto', fontVariantNumeric: 'tabular-nums' }}>{elapsed(ms(run.started), end)}</span>
        </span>
        <span style={{ display: 'block', fontSize: '15px', fontWeight: 500, lineHeight: 1.4, marginTop: '4px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {run.doing || kindLabel(run.kind)}
        </span>
        <span style={{ display: 'block', fontSize: tokens.type.small, color: c.textMuted, marginTop: '2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {kindLabel(run.kind)} · {step}
        </span>
      </span>
    </button>
  );
}

// Who is working right now, live (read_live every 2s). Hidden when nobody is.
export function WorkingNow({ snapshot, onOpenRun }: { snapshot: PortfolioSnapshot | null; onOpenRun: (runId: string) => void }) {
  const { live } = useLive();
  const now = useNow((live?.runs.length ?? 0) > 0);
  const runs = stripRuns(live, now);
  if (runs.length === 0) return null;
  const working = runs.filter((r) => r.state === 'running').length;
  return (
    <section style={{ marginBottom: '32px' }}>
      <SectionLabel style={{ marginBottom: '12px' }}>
        Working now{working > 0 ? ` · ${working}` : ''}
      </SectionLabel>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '12px' }}>
        {runs.map((r) => (
          <RunCard key={r.run_id} run={r} snapshot={snapshot} now={now} onOpen={onOpenRun} />
        ))}
      </div>
    </section>
  );
}
