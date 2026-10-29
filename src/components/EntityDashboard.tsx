import { ReactNode, useState } from 'react';
import { useTheme } from '../contexts/ThemeContext';
import { PortfolioEntity, TrackerMoney } from '../types';
import { orderedLanes, titleCase } from '../utils/portfolio';
import { EntityTracker } from '../utils/tracker';
import { BoardEntity } from './OrgBoard';
import { AgeLabel, Card, EntityMark, HealthBadge, HealthWhy, Notice, SectionHeading, StageBadge } from './BoardUI';
import { Icon } from './Icons';
import { EntityDecisions } from './DecisionCard';
import { EntityFinance } from './EntityFinance';
import { RepoRow, ReplyRow, RowList, TaskRow } from './TrackerRows';

const TREND_ICON: Record<string, string> = { up: 'arrow-up', down: 'arrow-down', flat: 'trend-flat' };

export type EntityTab = 'overview' | 'finance' | 'work';

function Empty({ children }: { children: ReactNode }) {
  const { tokens } = useTheme();
  return <div style={{ fontSize: tokens.type.small, color: tokens.colors.textDim, lineHeight: 1.55 }}>{children}</div>;
}

const TASKS_SHOWN = 12;

// The tracker's view of this entity: tasks, replies and repos. Read-only.
function WorkTab({ tracker }: { tracker: EntityTracker }) {
  const { tokens } = useTheme();
  const [showAll, setShowAll] = useState(false);
  const now = Date.now();
  const { tasks, scheduled, replies, repos } = tracker;
  const shown = showAll ? tasks : tasks.slice(0, TASKS_SHOWN);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '40px' }}>
      <section>
        <SectionHeading note={`${tasks.length} open`}>Your tasks</SectionHeading>
        {tasks.length === 0 ? (
          <Empty>No open tasks in the tracker.</Empty>
        ) : (
          <RowList>
            {shown.map((t) => <TaskRow key={t.id} task={t} now={now} />)}
            {tasks.length > TASKS_SHOWN && (
              <button
                className="btn btn-secondary"
                onClick={() => setShowAll(!showAll)}
                style={{ alignSelf: 'flex-start', margin: '8px 12px 10px' }}
              >
                {showAll ? 'Show fewer' : `Show all ${tasks.length}`}
              </button>
            )}
          </RowList>
        )}
        {scheduled.length > 0 && (
          <div style={{ marginTop: '16px' }}>
            <div style={{ fontSize: tokens.type.small, color: tokens.colors.textMuted, margin: '0 0 8px 2px' }}>Scheduled ({scheduled.length})</div>
            <RowList>
              {scheduled.map((t) => <TaskRow key={t.id} task={t} now={now} />)}
            </RowList>
          </div>
        )}
      </section>

      <section>
        <SectionHeading note={`${replies.length} waiting`}>Needs a reply</SectionHeading>
        {replies.length === 0 ? (
          <Empty>Nobody waiting on a reply.</Empty>
        ) : (
          <RowList>
            {replies.map((e, idx) => <ReplyRow key={idx} email={e} />)}
          </RowList>
        )}
      </section>

      <section>
        <SectionHeading note={`${repos.length} tracked`}>Repos</SectionHeading>
        {repos.length === 0 ? (
          <Empty>No repos tracked for this entity.</Empty>
        ) : (
          <RowList>
            {repos.map(({ repo, note }) => <RepoRow key={repo.id} repo={repo} note={note} />)}
          </RowList>
        )}
      </section>
    </div>
  );
}

function OverviewTab({ item }: { item: BoardEntity }) {
  const { tokens } = useTheme();
  const c = tokens.colors;
  const { entity, status, error } = item;

  if (!status) {
    return (
      <Card>
        <p style={{ fontSize: tokens.type.body, color: c.textMuted }}>No report yet.</p>
        <p style={{ fontSize: tokens.type.small, color: c.textDim, marginTop: '8px', lineHeight: 1.55 }}>
          Pulse looks for ~/portfolio/{entity.path}/status.json
          {error && error !== 'missing' ? ` (${error})` : ''}.
          {entity.lead ? ` ${entity.lead} writes it at the end of each session.` : ''}
        </p>
      </Card>
    );
  }

  const severity = (s: string | undefined) =>
    s === 'high' ? { color: c.danger, label: 'High' } : s === 'medium' ? { color: c.warning, label: 'Medium' } : { color: c.textMuted, label: 'Low' };
  const metrics = status.metrics ?? [];
  const lanes = orderedLanes(status.lanes);
  const decisions = status.decisions ?? [];
  const waiting = status.waiting_on ?? [];
  const risks = status.risks ?? [];
  const next = status.next ?? [];
  const done = status.done ?? [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '40px' }}>
      {metrics.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: '16px' }}>
          {metrics.map((m) => (
            <Card key={m.label} padding="20px 22px">
              <div style={{ fontSize: '22px', fontWeight: 600, lineHeight: 1.3, wordBreak: 'break-word', letterSpacing: '-0.01em' }}>
                {m.value}
              </div>
              <div style={{ fontSize: tokens.type.small, color: c.textMuted, marginTop: '8px' }}>
                {m.label}
                {m.trend && TREND_ICON[m.trend] && (
                  <span title={`Trend: ${m.trend}`} style={{ marginLeft: '6px', verticalAlign: '-1px', display: 'inline-flex' }}>
                    <Icon name={TREND_ICON[m.trend]} size={12} color={c.textDim} />
                  </span>
                )}
              </div>
              {m.source && <div style={{ fontSize: tokens.type.micro, color: c.textDim, marginTop: '4px' }}>{m.source}</div>}
            </Card>
          ))}
        </div>
      )}

      <EntityDecisions entity={entity} decisions={decisions} />

      {lanes.length > 0 && (
        <section>
          <SectionHeading>Lanes</SectionHeading>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px' }}>
            {lanes.map(([name, lane]) => (
              <Card key={name} padding="20px 22px">
                <div style={{ fontSize: tokens.type.body, fontWeight: 600, marginBottom: '10px' }}>{titleCase(name)}</div>
                {lane ? (
                  <>
                    <div style={{ fontSize: tokens.type.small, lineHeight: 1.55, color: c.textMuted }}>{lane.status || '—'}</div>
                    {lane.next && (
                      <div style={{ fontSize: tokens.type.small, lineHeight: 1.55, color: c.text, marginTop: '12px' }}>
                        <span style={{ color: c.textDim }}>Next </span>
                        {lane.next}
                      </div>
                    )}
                  </>
                ) : (
                  <Empty>Not reported</Empty>
                )}
              </Card>
            ))}
          </div>
        </section>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '32px', alignItems: 'start' }}>
        <section>
          <SectionHeading>Next moves</SectionHeading>
          {next.length === 0 ? <Empty>None listed.</Empty> : (
            <ol style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {next.map((n, idx) => (
                <li key={idx} style={{ display: 'flex', gap: '12px', fontSize: tokens.type.body, lineHeight: 1.55 }}>
                  <span style={{ fontFamily: tokens.fonts.display, color: c.accent, width: '16px', flexShrink: 0 }}>{idx + 1}</span>
                  <span>{n}</span>
                </li>
              ))}
            </ol>
          )}
        </section>

        <section>
          <SectionHeading>Waiting on</SectionHeading>
          {waiting.length === 0 ? <Empty>Nobody.</Empty> : (
            <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {waiting.map((w, idx) => (
                <li key={idx} style={{ fontSize: tokens.type.body, lineHeight: 1.55 }}>
                  <span style={{ fontWeight: 600 }}>{w.who}</span>
                  <span style={{ color: c.textMuted }}>: {w.what}</span>
                  {w.since && <div style={{ fontSize: tokens.type.micro, color: c.textDim }}>since {w.since}</div>}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <SectionHeading>Risks</SectionHeading>
          {risks.length === 0 ? <Empty>None reported.</Empty> : (
            <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {risks.map((r, idx) => {
                const s = severity(r.severity);
                return (
                  <li key={idx} style={{ fontSize: tokens.type.body, lineHeight: 1.55 }}>
                    <span style={{ fontSize: tokens.type.micro, fontWeight: 600, color: s.color, marginRight: '8px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                      {s.label}
                    </span>
                    <span style={{ color: c.textMuted }}>{r.what}</span>
                    {r.date && <span style={{ fontSize: tokens.type.micro, color: c.textDim }}> · {r.date}</span>}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>

      <section>
        <SectionHeading>Done this week</SectionHeading>
        {done.length === 0 ? <Empty>Nothing recorded.</Empty> : (
          <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {done.map((d, idx) => (
              <li key={idx} style={{ fontSize: tokens.type.body, lineHeight: 1.55, color: c.textMuted }}>
                <span style={{ marginRight: '10px', verticalAlign: '-2px', display: 'inline-flex' }}>
                  <Icon name="check" size={14} color={c.success} />
                </span>
                {d.what}
                {d.date && <span style={{ fontSize: tokens.type.micro, color: c.textDim }}> · {d.date}</span>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

interface EntityDashboardProps {
  item: BoardEntity;
  entities: PortfolioEntity[];
  money: TrackerMoney | null; // null until the tracker has been read
  initialTab: EntityTab;
  onBack: () => void;
  backLabel: string; // the page it was opened from
}

export function EntityDashboard({ item, entities, money, initialTab, onBack, backLabel }: EntityDashboardProps) {
  const { tokens } = useTheme();
  const c = tokens.colors;
  const { entity, status, tracker, logos, logoError } = item;
  const [tab, setTab] = useState<EntityTab>(initialTab);
  const now = Date.now();

  const tabs: { id: EntityTab; label: string; count?: number }[] = [
    { id: 'overview', label: 'Overview', count: status?.decisions?.length || undefined },
    { id: 'finance', label: 'Finance' },
    { id: 'work', label: 'Tasks and inbox', count: tracker ? tracker.tasks.length + tracker.replies.length : undefined },
  ];

  return (
    <div style={{ maxWidth: '1400px', margin: '0 auto' }}>
      <button className="btn btn-secondary" onClick={onBack} style={{ marginBottom: '28px', display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
        <Icon name="arrow-left" size={14} color="currentColor" /> {backLabel}
      </button>

      <header style={{ display: 'flex', gap: '22px', alignItems: 'center', marginBottom: '20px' }}>
        <EntityMark entity={entity} logos={logos} size={68} header />
        <div style={{ minWidth: 0 }}>
          <h1 style={{ fontFamily: tokens.fonts.display, fontSize: '42px', fontWeight: 500, letterSpacing: '-0.02em', lineHeight: 1.05 }}>
            {entity.name}
          </h1>
          <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap', marginTop: '10px' }}>
            <HealthBadge health={status?.health} why={status?.health_why} large />
            <StageBadge stage={status?.stage} />
            {status && <AgeLabel updated={status.updated} now={now} />}
          </div>
          <HealthWhy why={status?.health_why} clamp={3} style={{ marginTop: '10px', fontSize: tokens.type.body, maxWidth: '72ch' }} />
        </div>
      </header>
      {status?.headline && (
        <p style={{ fontSize: tokens.type.lead, lineHeight: 1.6, color: c.textMuted, maxWidth: '72ch', marginBottom: '8px' }}>
          {status.headline}
        </p>
      )}
      {logoError && (
        <div style={{ marginTop: '12px' }}>
          <Notice>Logo not shown: {logoError}</Notice>
        </div>
      )}

      <nav role="tablist" style={{ display: 'flex', gap: '4px', margin: '32px 0 32px', borderBottom: `1px solid ${c.border}` }}>
        {tabs.map((t) => {
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              role="tab"
              aria-selected={active}
              onClick={() => setTab(t.id)}
              style={{
                padding: '12px 16px',
                marginBottom: '-1px',
                background: 'transparent',
                border: 'none',
                borderBottom: `2px solid ${active ? c.accent : 'transparent'}`,
                color: active ? c.text : c.textMuted,
                fontFamily: 'inherit',
                fontSize: tokens.type.body,
                fontWeight: active ? 600 : 500,
                cursor: 'pointer',
              }}
            >
              {t.label}
              {t.count !== undefined && <span style={{ color: c.textDim, fontWeight: 500, marginLeft: '8px' }}>{t.count}</span>}
            </button>
          );
        })}
      </nav>

      {tab === 'overview' && <OverviewTab item={item} />}
      {tab === 'finance' &&
        (money ? (
          <EntityFinance entity={entity} entities={entities} money={money} />
        ) : (
          <Empty>No money data: ~/project-tracker has not been read.</Empty>
        ))}
      {tab === 'work' && (tracker ? <WorkTab tracker={tracker} /> : <Empty>The tracker could not be read, so there are no tasks to show.</Empty>)}
    </div>
  );
}
