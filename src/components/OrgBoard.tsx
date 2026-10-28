import { ReactNode } from 'react';
import { useTheme } from '../contexts/ThemeContext';
import { EntityStatus, PortfolioEntity, PortfolioSnapshot, TrackerSnapshot } from '../types';
import { decisionCount, firstWeekSection, plainMarkdownLine } from '../utils/portfolio';
import { EntityTracker, dueNow, entityTracker, formatUsd, isDueToday, isGate, openTaskList, projectOwners } from '../utils/tracker';
import { projectsOf, sumFinance } from '../utils/finance';
import { Icon } from './Icons';
import { AgeLabel, Card, EntityLogos, EntityMark, HealthBadge, Notice, PageHeader, SectionLabel, StageBadge } from './BoardUI';
import { MoneyBand } from './MoneyBand';

export interface BoardEntity {
  entity: PortfolioEntity;
  status: EntityStatus | null;
  error: string | null;
  logos: EntityLogos | null;
  logoError: string | null;
  tracker: EntityTracker | null; // null until ~/project-tracker has been read
  money30: number | null; // cash in over 30 days; null when no money source is connected
}

// Joins the registry with each entity's report and its slice of the tracker, keeping registry order.
export function boardEntities(snapshot: PortfolioSnapshot | null, tracker: TrackerSnapshot | null): BoardEntity[] {
  if (!snapshot?.registry) return [];
  const entities = snapshot.registry.entities;
  const owners = projectOwners(entities);
  const trackerOk = tracker && !tracker.error ? tracker : null;
  return entities.map((entity) => {
    const report = snapshot.entities.find((r) => r.id === entity.id);
    return {
      entity,
      status: report?.status ?? null,
      error: report ? report.error : 'missing',
      logos: report ? { logo: report.logo, logo_dark: report.logo_dark } : null,
      logoError: report?.logo_error ?? null,
      tracker: trackerOk ? entityTracker(entity.id, trackerOk, owners) : null,
      money30: trackerOk?.money.configured
        ? sumFinance(projectsOf(entity.id, trackerOk.money.finance, entities)).d30
        : null,
    };
  });
}

function Count({ n, children, tone }: { n: number; children: ReactNode; tone?: string }) {
  const { tokens } = useTheme();
  return (
    <span style={{ color: tone ?? tokens.colors.textMuted }}>
      <span style={{ fontWeight: 600, color: tone ?? tokens.colors.text }}>{n}</span> {children}
    </span>
  );
}

function EntityCard({ item, now, onOpen }: { item: BoardEntity; now: number; onOpen: () => void }) {
  const { tokens } = useTheme();
  const c = tokens.colors;
  const { entity, status, error, tracker, logos, money30 } = item;
  const decisions = decisionCount(status);
  const metrics = (status?.metrics ?? []).slice(0, 3);
  const nowTasks = tracker ? dueNow(tracker.tasks).length : 0;

  return (
    <button
      onClick={onOpen}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = c.bgCardHover;
        e.currentTarget.style.borderColor = c.borderHover;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = c.bgCard;
        e.currentTarget.style.borderColor = c.border;
      }}
      style={{
        transition: 'background 0.15s ease, border-color 0.15s ease',
        display: 'flex',
        flexDirection: 'column',
        gap: '16px',
        padding: '22px 24px',
        width: '100%',
        textAlign: 'left',
        cursor: 'pointer',
        fontFamily: 'inherit',
        color: c.text,
        background: c.bgCard,
        border: `1px solid ${c.border}`,
        borderRadius: tokens.radius.lg,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '14px', width: '100%' }}>
        <EntityMark entity={entity} logos={logos} size={40} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: tokens.fonts.display, fontSize: '21px', fontWeight: 500, lineHeight: 1.2, letterSpacing: '-0.01em' }}>
            {entity.name}
          </div>
          {(status?.stage && status.stage !== 'active') || decisions > 0 ? (
            <div style={{ display: 'flex', gap: '8px', marginTop: '6px', flexWrap: 'wrap', alignItems: 'center' }}>
              <StageBadge stage={status?.stage} />
              {decisions > 0 && (
                <span title="Open decisions waiting on the owner" style={{ fontSize: tokens.type.micro, color: c.textMuted }}>
                  <span style={{ fontWeight: 600, color: c.text }}>{decisions}</span> {decisions === 1 ? 'decision' : 'decisions'} for you
                </span>
              )}
            </div>
          ) : null}
        </div>
        <HealthBadge health={status?.health} />
      </div>

      {status ? (
        <div
          title={status.headline}
          style={{
            fontSize: tokens.type.body,
            lineHeight: 1.55,
            color: c.textMuted,
            display: '-webkit-box',
            WebkitLineClamp: 3,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}
        >
          {status.headline || 'No headline.'}
        </div>
      ) : (
        <div style={{ fontSize: tokens.type.body, color: c.textDim }}>
          No report yet
          {error && error !== 'missing' && <span style={{ color: c.warning }}> · status.json could not be read</span>}
        </div>
      )}

      {metrics.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${metrics.length}, minmax(0, 1fr))`, gap: '16px', width: '100%' }}>
          {metrics.map((m) => (
            <div key={m.label} style={{ minWidth: 0 }}>
              <div
                title={m.value}
                style={{
                  fontSize: '16px',
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
              <div style={{ fontSize: tokens.type.micro, color: c.textDim, marginTop: '4px', lineHeight: 1.35 }}>{m.label}</div>
            </div>
          ))}
        </div>
      )}

      <div
        style={{
          display: 'flex',
          gap: '16px',
          flexWrap: 'wrap',
          alignItems: 'baseline',
          width: '100%',
          paddingTop: '14px',
          borderTop: `1px solid ${c.border}`,
          fontSize: tokens.type.small,
        }}
      >
        {tracker && tracker.tasks.length > 0 && (
          <span>
            <Count n={tracker.tasks.length}>{tracker.tasks.length === 1 ? 'task' : 'tasks'}</Count>
            {nowTasks > 0 && <span style={{ color: c.danger }}> · {nowTasks} now</span>}
          </span>
        )}
        {tracker && tracker.replies.length > 0 && (
          <Count n={tracker.replies.length}>{tracker.replies.length === 1 ? 'reply' : 'replies'}</Count>
        )}
        {money30 !== null && money30 > 0 && (
          <span style={{ color: c.textMuted }}>
            <span style={{ fontWeight: 600, color: c.text }}>{formatUsd(money30)}</span> in 30d
          </span>
        )}
        <span style={{ marginLeft: 'auto' }}>{status && <AgeLabel updated={status.updated} now={now} />}</span>
      </div>
    </button>
  );
}

function BigNumber({ value, label }: { value: number; label: string }) {
  const { tokens } = useTheme();
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: '10px' }}>
      <span style={{ fontSize: '48px', fontWeight: 600, letterSpacing: '-0.03em', lineHeight: 1 }}>{value}</span>
      <span style={{ fontSize: tokens.type.body, color: tokens.colors.textMuted }}>{label}</span>
    </div>
  );
}

// Board summary of the tracker, same scope as the Today view: tasks due now and gate items
// marked now or soon, and who is waiting on a reply.
function TodayCard({ tracker, onOpen }: { tracker: TrackerSnapshot; onOpen: () => void }) {
  const { tokens } = useTheme();
  const today = openTaskList(tracker).filter(isDueToday);
  const gates = today.filter(isGate).length;
  const replies = tracker.email?.needs_reply ?? [];
  const urgentReplies = replies.filter((e) => e.urgency === 'now').length;
  // One shared detail line, so the two numbers stay side by side in a narrow card.
  const detail = [
    gates ? `${gates} gate ${gates === 1 ? 'item' : 'items'}` : null,
    urgentReplies ? `${urgentReplies} urgent ${urgentReplies === 1 ? 'reply' : 'replies'}` : null,
  ].filter(Boolean).join(' · ');
  return (
    <button
      onClick={onOpen}
      title="Open the Today view"
      onMouseEnter={(e) => (e.currentTarget.style.borderColor = tokens.colors.borderHover)}
      onMouseLeave={(e) => (e.currentTarget.style.borderColor = tokens.colors.border)}
      style={{
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'flex-start',
        padding: '24px 26px',
        background: tokens.colors.bgCard,
        border: `1px solid ${tokens.colors.border}`,
        borderRadius: tokens.radius.lg,
        textAlign: 'left',
        cursor: 'pointer',
        fontFamily: 'inherit',
        color: tokens.colors.text,
        transition: 'border-color 0.15s ease',
      }}
    >
      <SectionLabel>Today</SectionLabel>
      <div style={{ display: 'flex', gap: '32px', flexWrap: 'wrap' }}>
        <BigNumber value={today.length} label="due" />
        <BigNumber value={replies.length} label={replies.length === 1 ? 'reply' : 'replies'} />
      </div>
      {detail && <div style={{ fontSize: tokens.type.small, color: tokens.colors.textDim, marginTop: '10px' }}>{detail}</div>}
    </button>
  );
}

function TopStrip({ items, week, tracker, onOpenToday }: {
  items: BoardEntity[];
  week: string | null;
  tracker: TrackerSnapshot | null;
  onOpenToday: () => void;
}) {
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
        gap: '20px',
        marginBottom: '24px',
      }}
    >
      <Card>
        <SectionLabel>Waiting on you</SectionLabel>
        <BigNumber value={total} label={total === 1 ? 'decision' : 'decisions'} />
        {byGate.size > 0 && (
          <div style={{ fontSize: tokens.type.small, color: tokens.colors.textDim, marginTop: '10px', lineHeight: 1.5 }}>
            {[...byGate.entries()].map(([gate, n]) => `${n} ${gate}`).join(' · ')}
          </div>
        )}
      </Card>

      {tracker && !tracker.error && <TodayCard tracker={tracker} onOpen={onOpenToday} />}

      <Card style={{ gridColumn: 'span 2' }}>
        <SectionLabel>{moves?.title ?? "This week's three moves"}</SectionLabel>
        {moves && moves.lines.length > 0 ? (
          <ol style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '10px', maxWidth: '72ch' }}>
            {moves.lines.map((line, idx) => {
              const { text, numbered, bullet } = plainMarkdownLine(line);
              const isItem = numbered || bullet;
              return (
                <li
                  key={idx}
                  style={{
                    display: 'flex',
                    gap: '12px',
                    fontSize: isItem ? '16px' : tokens.type.small,
                    lineHeight: 1.5,
                    color: isItem ? tokens.colors.text : tokens.colors.textMuted,
                    paddingLeft: isItem ? 0 : '30px',
                  }}
                >
                  {isItem && (
                    <span style={{ fontFamily: tokens.fonts.display, color: tokens.colors.accent, width: '18px', flexShrink: 0 }}>
                      {numbered ? line.match(/^\d+/)?.[0] : '·'}
                    </span>
                  )}
                  <span>{text}</span>
                </li>
              );
            })}
          </ol>
        ) : (
          <div style={{ fontSize: tokens.type.body, color: tokens.colors.textDim, lineHeight: 1.55 }}>
            No WEEK.md yet. The chief of staff writes it on Mondays at 6:30am.
          </div>
        )}
      </Card>
    </div>
  );
}

interface OrgBoardProps {
  snapshot: PortfolioSnapshot | null;
  tracker: TrackerSnapshot | null;
  error: string | null;
  trackerError: string | null;
  onOpenToday: () => void;
  onOpenEntity: (id: string, tab?: 'finance') => void;
  onRefresh: () => void;
  tvMode: boolean;
  onToggleTv: () => void;
}

export function OrgBoard({ snapshot, tracker, error, trackerError, onOpenToday, onOpenEntity, onRefresh, tvMode, onToggleTv }: OrgBoardProps) {
  const { tokens } = useTheme();
  const now = Date.now();
  const items = boardEntities(snapshot, tracker);
  const trackerProblem = trackerError ?? tracker?.error ?? null;
  const groups = snapshot?.registry?.groups ?? [];
  const readAt = snapshot ? new Date(snapshot.read_at) : null;
  const logos = new Map(items.filter((i) => i.logos).map((i) => [i.entity.id, i.logos as EntityLogos]));

  return (
    <div style={{ maxWidth: '1680px', margin: '0 auto' }}>
      <PageHeader
        title="Board"
        subtitle={
          readAt
            ? `${new Date(now).toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })} · read ${readAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}, refreshes every minute`
            : 'Reading ~/portfolio…'
        }
        right={
          tvMode ? (
            <span style={{ fontSize: '28px', fontWeight: 500, color: tokens.colors.textMuted }}>
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
          )
        }
      />

      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: error || snapshot?.registry_error || trackerProblem ? '24px' : 0 }}>
        {error && <Notice>{error}</Notice>}
        {snapshot?.registry_error && <Notice>Could not read ~/portfolio/portfolio.json ({snapshot.registry_error}).</Notice>}
        {trackerProblem && <Notice>Tracker not shown: {trackerProblem}</Notice>}
      </div>

      {snapshot?.registry && (
        <>
          <TopStrip items={items} week={snapshot.week} tracker={tracker} onOpenToday={onOpenToday} />

          {tracker && !tracker.error && (
            <MoneyBand
              money={tracker.money}
              entities={snapshot.registry.entities}
              logos={logos}
              onOpenEntity={(id) => onOpenEntity(id, 'finance')}
            />
          )}

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))',
              gap: '28px',
              alignItems: 'start',
            }}
          >
            {groups.map((group) => {
              const top = items.filter((i) => i.entity.group === group.id && !i.entity.parent);
              return (
                <section key={group.id} style={{ display: 'flex', flexDirection: 'column', gap: '16px', minWidth: 0 }}>
                  <h2 style={{ fontFamily: tokens.fonts.display, fontSize: tokens.type.heading, fontWeight: 500, letterSpacing: '-0.01em' }}>
                    {group.name}
                  </h2>
                  {top.map((item) => {
                    const children = items.filter((i) => i.entity.parent === item.entity.id);
                    return (
                      <div key={item.entity.id} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                        <EntityCard item={item} now={now} onOpen={() => onOpenEntity(item.entity.id)} />
                        {children.length > 0 && (
                          <div
                            style={{
                              display: 'flex',
                              flexDirection: 'column',
                              gap: '16px',
                              paddingLeft: '18px',
                              borderLeft: `1px solid ${tokens.colors.border}`,
                              marginLeft: '20px',
                            }}
                          >
                            <SectionLabel style={{ marginBottom: 0, marginTop: '2px' }}>Ventures</SectionLabel>
                            {children.map((child) => (
                              <EntityCard key={child.entity.id} item={child} now={now} onOpen={() => onOpenEntity(child.entity.id)} />
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                  {top.length === 0 && (
                    <div style={{ fontSize: tokens.type.small, color: tokens.colors.textDim }}>Nothing here yet.</div>
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
