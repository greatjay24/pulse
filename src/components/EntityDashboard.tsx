import { ReactNode } from 'react';
import { useTheme } from '../contexts/ThemeContext';
import { orderedLanes, titleCase } from '../utils/portfolio';
import { AgeLabel, BoardEntity, HealthDot, SectionLabel, StageBadge } from './OrgBoard';

const TREND_ARROW: Record<string, string> = { up: '↑', down: '↓', flat: '→' };

function Panel({ children }: { children: ReactNode }) {
  const { tokens } = useTheme();
  return (
    <div
      style={{
        padding: '16px 18px',
        background: tokens.colors.bgCard,
        border: `1px solid ${tokens.colors.border}`,
        borderRadius: tokens.radius.md,
        minWidth: 0,
        overflowWrap: 'anywhere',
      }}
    >
      {children}
    </div>
  );
}

function Empty({ children }: { children: ReactNode }) {
  const { tokens } = useTheme();
  return <div style={{ fontSize: '13px', color: tokens.colors.textDim }}>{children}</div>;
}

interface EntityDashboardProps {
  item: BoardEntity;
  onBack: () => void;
}

export function EntityDashboard({ item, onBack }: EntityDashboardProps) {
  const { tokens } = useTheme();
  const { entity, status, error } = item;
  const now = Date.now();
  const severityColor = (s: string | undefined) =>
    s === 'high' ? tokens.colors.danger : s === 'medium' ? tokens.colors.warning : tokens.colors.textDim;

  const backButton = (
    <button className="btn btn-secondary" onClick={onBack} style={{ marginBottom: '24px' }}>
      ← Board
    </button>
  );

  if (!status) {
    return (
      <div>
        {backButton}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' }}>
          <HealthDot health={undefined} size={12} />
          <h1 style={{ fontSize: '28px', fontWeight: 600, letterSpacing: '-0.02em' }}>{entity.name}</h1>
        </div>
        <p style={{ fontSize: '15px', color: tokens.colors.textMuted }}>No report yet.</p>
        <p style={{ fontSize: '13px', color: tokens.colors.textDim, marginTop: '8px' }}>
          Pulse looks for ~/portfolio/{entity.path}/status.json
          {error && error !== 'missing' ? ` (${error})` : ''}.
          {entity.lead ? ` ${entity.lead} writes it at the end of each session.` : ''}
        </p>
      </div>
    );
  }

  const metrics = status.metrics ?? [];
  const lanes = orderedLanes(status.lanes);
  const decisions = status.decisions ?? [];
  const waiting = status.waiting_on ?? [];
  const risks = status.risks ?? [];
  const next = status.next ?? [];
  const done = status.done ?? [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
      <div>
        {backButton}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
          <HealthDot health={status.health} size={12} />
          <h1 style={{ fontSize: '28px', fontWeight: 600, letterSpacing: '-0.02em' }}>{entity.name}</h1>
          <StageBadge stage={status.stage} />
          <AgeLabel updated={status.updated} now={now} />
        </div>
        <p style={{ fontSize: '17px', lineHeight: 1.55, color: tokens.colors.textMuted, marginTop: '12px', maxWidth: '900px' }}>
          {status.headline || 'No headline.'}
        </p>
      </div>

      {metrics.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px' }}>
          {metrics.map((m) => (
            <Panel key={m.label}>
              <div style={{ fontFamily: tokens.fonts.mono, fontSize: '20px', fontWeight: 600, lineHeight: 1.3, wordBreak: 'break-word' }}>
                {m.value}
              </div>
              <div style={{ fontSize: '12px', color: tokens.colors.textMuted, marginTop: '6px' }}>
                {m.label}
                {m.trend && <span style={{ color: tokens.colors.textDim }}> {TREND_ARROW[m.trend] ?? ''}</span>}
              </div>
              {m.source && <div style={{ fontSize: '11px', color: tokens.colors.textDim, marginTop: '4px' }}>{m.source}</div>}
            </Panel>
          ))}
        </div>
      )}

      {lanes.length > 0 && (
        <div>
          <SectionLabel>Lanes</SectionLabel>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px' }}>
            {lanes.map(([name, lane]) => (
              <Panel key={name}>
                <div style={{ fontSize: '13px', fontWeight: 600, marginBottom: '8px' }}>{titleCase(name)}</div>
                {lane ? (
                  <>
                    <div style={{ fontSize: '13px', lineHeight: 1.5, color: tokens.colors.textMuted }}>{lane.status || '—'}</div>
                    {lane.next && (
                      <div style={{ fontSize: '12px', lineHeight: 1.5, color: tokens.colors.text, marginTop: '10px' }}>
                        <span style={{ color: tokens.colors.textDim }}>Next </span>
                        {lane.next}
                      </div>
                    )}
                  </>
                ) : (
                  <Empty>Not reported</Empty>
                )}
              </Panel>
            ))}
          </div>
        </div>
      )}

      <div>
        <SectionLabel>Decisions waiting on you ({decisions.length})</SectionLabel>
        {decisions.length === 0 ? (
          <Empty>Nothing waiting on you.</Empty>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {decisions.map((d, idx) => (
              <Panel key={idx}>
                <div style={{ display: 'flex', gap: '10px', alignItems: 'baseline', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '15px', fontWeight: 600, flex: 1, minWidth: '240px' }}>{d.ask}</span>
                  {d.due && <span style={{ fontSize: '12px', color: tokens.colors.warning }}>due {d.due}</span>}
                  {d.gate && (
                    <span
                      style={{
                        fontSize: '11px',
                        padding: '2px 8px',
                        borderRadius: '20px',
                        border: `1px solid ${tokens.colors.border}`,
                        color: tokens.colors.textMuted,
                      }}
                    >
                      {d.gate}
                    </span>
                  )}
                </div>
                {d.recommend && (
                  <div style={{ fontSize: '13px', lineHeight: 1.5, marginTop: '8px' }}>
                    <span style={{ color: tokens.colors.accent }}>Recommend </span>
                    {d.recommend}
                  </div>
                )}
                {d.why && <div style={{ fontSize: '12px', lineHeight: 1.5, color: tokens.colors.textMuted, marginTop: '4px' }}>{d.why}</div>}
              </Panel>
            ))}
          </div>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '24px', alignItems: 'start' }}>
        <div>
          <SectionLabel>Waiting on</SectionLabel>
          {waiting.length === 0 ? <Empty>Nobody.</Empty> : (
            <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {waiting.map((w, idx) => (
                <li key={idx} style={{ fontSize: '13px', lineHeight: 1.5 }}>
                  <span style={{ fontWeight: 600 }}>{w.who}</span>
                  <span style={{ color: tokens.colors.textMuted }}>: {w.what}</span>
                  {w.since && <div style={{ fontSize: '11px', color: tokens.colors.textDim }}>since {w.since}</div>}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <SectionLabel>Risks</SectionLabel>
          {risks.length === 0 ? <Empty>None reported.</Empty> : (
            <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {risks.map((r, idx) => (
                <li key={idx} style={{ display: 'flex', gap: '10px', fontSize: '13px', lineHeight: 1.5 }}>
                  <span
                    title={r.severity}
                    style={{ width: 8, height: 8, borderRadius: '50%', background: severityColor(r.severity), marginTop: '6px', flexShrink: 0 }}
                  />
                  <span>
                    <span style={{ color: tokens.colors.textMuted }}>{r.what}</span>
                    {r.date && <span style={{ fontSize: '11px', color: tokens.colors.textDim }}> · {r.date}</span>}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <SectionLabel>Next moves</SectionLabel>
          {next.length === 0 ? <Empty>None listed.</Empty> : (
            <ol style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {next.map((n, idx) => (
                <li key={idx} style={{ display: 'flex', gap: '10px', fontSize: '13px', lineHeight: 1.5 }}>
                  <span style={{ fontFamily: tokens.fonts.mono, color: tokens.colors.textDim, width: '14px', flexShrink: 0 }}>{idx + 1}</span>
                  <span>{n}</span>
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>

      <div>
        <SectionLabel>Done this week</SectionLabel>
        {done.length === 0 ? <Empty>Nothing recorded.</Empty> : (
          <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {done.map((d, idx) => (
              <li key={idx} style={{ fontSize: '13px', lineHeight: 1.5, color: tokens.colors.textMuted }}>
                <span style={{ color: tokens.colors.success, marginRight: '8px' }}>✓</span>
                {d.what}
                {d.date && <span style={{ fontSize: '11px', color: tokens.colors.textDim }}> · {d.date}</span>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
