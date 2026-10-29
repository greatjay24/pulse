import { useEffect, useState } from 'react';
import { useTheme } from '../contexts/ThemeContext';
import { LiveRun, PortfolioSnapshot, TeamMember } from '../types';
import { useLive } from '../hooks/useLive';
import { elapsed, kindLabel, ms, stateLabel, stripRuns, teamLine } from '../utils/live';
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

const TEAM_SHOWN = 4;

export function memberTone(status: string, c: ReturnType<typeof useTheme>['tokens']['colors']): string {
  return status === 'running' ? c.accent : status === 'completed' ? c.success : status === 'failed' ? c.danger : c.textDim;
}

// The agents a lead deployed, nested under it: working ones first.
function TeamList({ team, now }: { team: TeamMember[]; now: number }) {
  const { tokens } = useTheme();
  const c = tokens.colors;
  const working = team.filter((m) => m.status === 'running').length;
  const shown = [...team].sort((a, b) => Number(b.status === 'running') - Number(a.status === 'running') || ms(b.started) - ms(a.started)).slice(0, TEAM_SHOWN);
  return (
    <span style={{ display: 'block', marginTop: '8px', paddingLeft: '10px', borderLeft: `2px solid ${c.border}` }}>
      <span style={{ display: 'block', fontSize: tokens.type.micro, color: c.textMuted }}>
        → {teamLine(team)}
        {working > 0 && working < team.length && ` · ${working} still working`}
      </span>
      {shown.map((m) => (
        <span key={m.id} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: tokens.type.micro, color: c.textDim, marginTop: '3px', minWidth: 0 }}>
          <LiveDot color={memberTone(m.status, c)} pulsing={m.status === 'running'} />
          <span style={{ color: c.text, fontWeight: 500, whiteSpace: 'nowrap' }}>{m.type}</span>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{m.description || m.prompt}</span>
          <span style={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
            {m.status === 'running' ? elapsed(ms(m.started), now) : m.status}
          </span>
        </span>
      ))}
      {team.length > TEAM_SHOWN && <span style={{ display: 'block', fontSize: tokens.type.micro, color: c.textDim, marginTop: '3px' }}>+{team.length - TEAM_SHOWN} more</span>}
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
        {(run.team?.length ?? 0) > 0 && <TeamList team={run.team!} now={now} />}
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
