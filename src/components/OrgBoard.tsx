import { CSSProperties, ReactNode } from 'react';
import { useTheme } from '../contexts/ThemeContext';
import { EntityStatus, Health, PortfolioEntity, PortfolioSnapshot } from '../types';
import {
  decisionCount,
  firstWeekSection,
  formatAge,
  healthColor,
  hoursSince,
  isStale,
  plainMarkdownLine,
} from '../utils/portfolio';
import { Icon } from './Icons';

export interface BoardEntity {
  entity: PortfolioEntity;
  status: EntityStatus | null;
  error: string | null;
}

// Joins the registry with each entity's report, keeping registry order.
export function boardEntities(snapshot: PortfolioSnapshot | null): BoardEntity[] {
  if (!snapshot?.registry) return [];
  return snapshot.registry.entities.map((entity) => {
    const report = snapshot.entities.find((r) => r.id === entity.id);
    return {
      entity,
      status: report?.status ?? null,
      error: report ? report.error : 'missing',
    };
  });
}

export function HealthDot({ health, size = 10 }: { health: Health | undefined; size?: number }) {
  const { tokens } = useTheme();
  const color = healthColor(health, tokens.colors);
  return (
    <span
      title={health ? `Health: ${health}` : 'No report'}
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        background: color,
        boxShadow: health ? `0 0 0 3px ${color}22` : 'none',
        flexShrink: 0,
        display: 'inline-block',
      }}
    />
  );
}

export function SectionLabel({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  const { tokens } = useTheme();
  return (
    <div
      style={{
        fontSize: '11px',
        fontWeight: 600,
        color: tokens.colors.textDim,
        textTransform: 'uppercase',
        letterSpacing: '0.08em',
        marginBottom: '12px',
        ...style,
      }}
    >
      {children}
    </div>
  );
}

export function StageBadge({ stage }: { stage: string | undefined }) {
  const { tokens } = useTheme();
  if (!stage || stage === 'active') return null;
  return (
    <span
      style={{
        fontSize: '11px',
        padding: '2px 8px',
        borderRadius: '20px',
        border: `1px solid ${tokens.colors.border}`,
        color: tokens.colors.textMuted,
      }}
    >
      {stage}
    </span>
  );
}

export function AgeLabel({ updated, now }: { updated: string | undefined; now: number }) {
  const { tokens } = useTheme();
  const hours = hoursSince(updated, now);
  const stale = isStale(hours);
  return (
    <span
      title={updated ?? undefined}
      style={{ fontSize: '12px', color: stale ? tokens.colors.warning : tokens.colors.textDim }}
    >
      {stale ? `stale · ${formatAge(hours)}` : formatAge(hours)}
    </span>
  );
}

function EntityCard({ item, now, onOpen }: { item: BoardEntity; now: number; onOpen: () => void }) {
  const { tokens } = useTheme();
  const { entity, status, error } = item;
  const decisions = decisionCount(status);
  const metrics = (status?.metrics ?? []).slice(0, 3);

  return (
    <button
      onClick={onOpen}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = tokens.colors.bgCardHover;
        e.currentTarget.style.borderColor = tokens.colors.borderHover;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = tokens.colors.bgCard;
        e.currentTarget.style.borderColor = tokens.colors.border;
      }}
      style={{
        transition: 'all 0.15s ease',
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
        padding: '18px 20px',
        width: '100%',
        textAlign: 'left',
        cursor: 'pointer',
        fontFamily: 'inherit',
        color: tokens.colors.text,
        background: tokens.colors.bgCard,
        border: `1px solid ${tokens.colors.border}`,
        borderRadius: tokens.radius.lg,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', width: '100%' }}>
        <HealthDot health={status?.health} />
        <span style={{ fontSize: '16px', fontWeight: 600, flex: 1 }}>{entity.name}</span>
        <StageBadge stage={status?.stage} />
        {decisions > 0 && (
          <span
            title="Open decisions waiting on the owner"
            style={{
              fontSize: '12px',
              fontWeight: 600,
              padding: '3px 10px',
              borderRadius: '20px',
              background: tokens.colors.accentGlow,
              color: tokens.colors.accent,
              whiteSpace: 'nowrap',
            }}
          >
            {decisions} {decisions === 1 ? 'decision' : 'decisions'}
          </span>
        )}
      </div>

      {status ? (
        <>
          <div style={{ fontSize: '13px', lineHeight: 1.5, color: tokens.colors.textMuted }}>
            {status.headline || 'No headline.'}
          </div>

          {metrics.length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: `repeat(${metrics.length}, minmax(0, 1fr))`, gap: '12px' }}>
              {metrics.map((m) => (
                <div key={m.label} style={{ minWidth: 0 }}>
                  <div
                    title={m.value}
                    style={{
                      fontFamily: tokens.fonts.mono,
                      fontSize: '14px',
                      fontWeight: 600,
                      lineHeight: 1.35,
                      overflow: 'hidden',
                      display: '-webkit-box',
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: 'vertical',
                      wordBreak: 'break-word',
                    }}
                  >
                    {m.value}
                  </div>
                  <div style={{ fontSize: '11px', color: tokens.colors.textDim, marginTop: '2px', lineHeight: 1.3 }}>
                    {m.label}
                  </div>
                </div>
              ))}
            </div>
          )}

          <AgeLabel updated={status.updated} now={now} />
        </>
      ) : (
        <div style={{ fontSize: '13px', color: tokens.colors.textDim }}>
          No report yet
          {error && error !== 'missing' && (
            <span style={{ color: tokens.colors.warning }}> · status.json could not be read</span>
          )}
        </div>
      )}
    </button>
  );
}

function TopStrip({ items, week }: { items: BoardEntity[]; week: string | null }) {
  const { tokens } = useTheme();
  const total = items.reduce((sum, i) => sum + decisionCount(i.status), 0);
  const byGate = new Map<string, number>();
  for (const i of items) {
    for (const d of i.status?.decisions ?? []) {
      const gate = d.gate ?? 'decision';
      byGate.set(gate, (byGate.get(gate) ?? 0) + 1);
    }
  }
  const moves = firstWeekSection(week);

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
        gap: '16px',
        marginBottom: '32px',
      }}
    >
      <div
        style={{
          padding: '20px 24px',
          background: tokens.colors.bgCard,
          border: `1px solid ${tokens.colors.border}`,
          borderRadius: tokens.radius.lg,
        }}
      >
        <SectionLabel>Waiting on you</SectionLabel>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '10px' }}>
          <span style={{ fontFamily: tokens.fonts.mono, fontSize: '40px', fontWeight: 600, letterSpacing: '-0.02em' }}>
            {total}
          </span>
          <span style={{ fontSize: '14px', color: tokens.colors.textMuted }}>
            {total === 1 ? 'decision' : 'decisions'}
          </span>
        </div>
        {byGate.size > 0 && (
          <div style={{ fontSize: '12px', color: tokens.colors.textDim, marginTop: '8px' }}>
            {[...byGate.entries()].map(([gate, n]) => `${n} ${gate}`).join(' · ')}
          </div>
        )}
      </div>

      <div
        style={{
          gridColumn: 'span 2',
          padding: '20px 24px',
          background: tokens.colors.bgCard,
          border: `1px solid ${tokens.colors.border}`,
          borderRadius: tokens.radius.lg,
          minWidth: 0,
        }}
      >
        <SectionLabel>{moves?.title ?? "This week's three moves"}</SectionLabel>
        {moves && moves.lines.length > 0 ? (
          <ol style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {moves.lines.map((line, idx) => {
              const { text, numbered, bullet } = plainMarkdownLine(line);
              const isItem = numbered || bullet;
              return (
                <li
                  key={idx}
                  style={{
                    display: 'flex',
                    gap: '10px',
                    fontSize: isItem ? '15px' : '13px',
                    lineHeight: 1.5,
                    color: isItem ? tokens.colors.text : tokens.colors.textMuted,
                    paddingLeft: isItem ? 0 : '26px',
                  }}
                >
                  {isItem && (
                    <span style={{ fontFamily: tokens.fonts.mono, color: tokens.colors.textDim, width: '16px', flexShrink: 0 }}>
                      {numbered ? line.match(/^\d+/)?.[0] : '·'}
                    </span>
                  )}
                  <span>{text}</span>
                </li>
              );
            })}
          </ol>
        ) : (
          <div style={{ fontSize: '13px', color: tokens.colors.textDim, lineHeight: 1.5 }}>
            No WEEK.md yet. The chief of staff writes it on Mondays at 6:30am.
          </div>
        )}
      </div>
    </div>
  );
}

interface OrgBoardProps {
  snapshot: PortfolioSnapshot | null;
  error: string | null;
  onOpenEntity: (id: string) => void;
  onRefresh: () => void;
  tvMode: boolean;
  onToggleTv: () => void;
}

export function OrgBoard({ snapshot, error, onOpenEntity, onRefresh, tvMode, onToggleTv }: OrgBoardProps) {
  const { tokens } = useTheme();
  const now = Date.now();
  const items = boardEntities(snapshot);
  const groups = snapshot?.registry?.groups ?? [];
  const readAt = snapshot ? new Date(snapshot.read_at) : null;

  return (
    <div>
      <header
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '28px',
        }}
      >
        <div>
          <h1 style={{ fontSize: '24px', fontWeight: 600, letterSpacing: '-0.02em' }}>Board</h1>
          <p style={{ fontSize: '13px', color: tokens.colors.textMuted, marginTop: '4px' }}>
            {readAt
              ? `Read ${readAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} · refreshes every minute`
              : 'Reading ~/portfolio…'}
          </p>
        </div>
        {tvMode ? (
          <span style={{ fontFamily: tokens.fonts.mono, fontSize: '22px', color: tokens.colors.textMuted }}>
            {new Date(now).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
          </span>
        ) : (
          <div style={{ display: 'flex', gap: '8px' }}>
            <button className="btn btn-secondary" onClick={onRefresh} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Icon name="refresh" size={14} color="currentColor" /> Refresh
            </button>
            <button className="btn btn-secondary" onClick={onToggleTv} title="TV mode (press T, Esc to exit)">
              TV mode <span style={{ color: tokens.colors.textDim, marginLeft: '4px' }}>T</span>
            </button>
          </div>
        )}
      </header>

      {error && (
        <div style={{ padding: '16px 20px', borderRadius: tokens.radius.md, background: tokens.colors.warningMuted, color: tokens.colors.warning, fontSize: '13px', marginBottom: '24px' }}>
          {error}
        </div>
      )}
      {snapshot?.registry_error && (
        <div style={{ padding: '16px 20px', borderRadius: tokens.radius.md, background: tokens.colors.warningMuted, color: tokens.colors.warning, fontSize: '13px', marginBottom: '24px' }}>
          Could not read ~/portfolio/portfolio.json ({snapshot.registry_error}).
        </div>
      )}

      {snapshot?.registry && (
        <>
          <TopStrip items={items} week={snapshot.week} />

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
              gap: '24px',
              alignItems: 'start',
            }}
          >
            {groups.map((group) => {
              const top = items.filter((i) => i.entity.group === group.id && !i.entity.parent);
              return (
                <section key={group.id} style={{ display: 'flex', flexDirection: 'column', gap: '12px', minWidth: 0 }}>
                  <SectionLabel style={{ marginBottom: 0 }}>{group.name}</SectionLabel>
                  {top.map((item) => {
                    const children = items.filter((i) => i.entity.parent === item.entity.id);
                    return (
                      <div key={item.entity.id} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                        <EntityCard item={item} now={now} onOpen={() => onOpenEntity(item.entity.id)} />
                        {children.length > 0 && (
                          <div
                            style={{
                              display: 'flex',
                              flexDirection: 'column',
                              gap: '12px',
                              paddingLeft: '16px',
                              borderLeft: `1px solid ${tokens.colors.border}`,
                              marginLeft: '8px',
                            }}
                          >
                            <SectionLabel style={{ marginBottom: 0, marginTop: '4px' }}>Ventures</SectionLabel>
                            {children.map((child) => (
                              <EntityCard key={child.entity.id} item={child} now={now} onOpen={() => onOpenEntity(child.entity.id)} />
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                  {top.length === 0 && (
                    <div style={{ fontSize: '13px', color: tokens.colors.textDim }}>Nothing here yet.</div>
                  )}
                </section>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
