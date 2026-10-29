import { useState } from 'react';
import { useTheme } from '../contexts/ThemeContext';
import { PortfolioSnapshot, TrackerEmail, TrackerSnapshot, TrackerTask } from '../types';
import { UNASSIGNED, isDueToday, openTaskList, ownerOf, projectOwners, sortReplies, sortTasks } from '../utils/tracker';
import { healthRank } from '../utils/portfolio';
import { decisionQueue, headline, isUrgentReply } from '../utils/today';
import { dataSources } from '../utils/sources';
import { Icon } from './Icons';
import { BoardEntity, boardEntities } from './OrgBoard';
import type { EntityTab } from './EntityDashboard';
import { DataStamps, EntityMark, HealthBadge, HealthWhy, Notice, PageHeader, SectionHeading, SectionLabel } from './BoardUI';
import { DecisionQueue } from './DecisionQueue';
import { HeadlineLine } from './Headline';
import { ReplyRow, RowList, TaskRow } from './TrackerRows';
import { LastNightCard } from './LastNightCard';
import { WorkingNow } from './WorkingNow';

// One business on Today: its health and why, then what is due (tasks due now, gate items
// marked now or soon, replies marked now). Other replies wait on the entity's dashboard.
interface TodayBusiness {
  id: string;
  name: string;
  item: BoardEntity | null; // null for the unassigned bucket
  tasks: TrackerTask[];
  replies: TrackerEmail[];
  laterReplies: number;
}

function businessFor(item: BoardEntity): TodayBusiness {
  const replies = item.tracker?.replies ?? [];
  return {
    id: item.entity.id,
    name: item.entity.name,
    item,
    tasks: (item.tracker?.tasks ?? []).filter(isDueToday),
    replies: replies.filter(isUrgentReply),
    laterReplies: replies.filter((e) => !isUrgentReply(e)).length,
  };
}

// Anything whose tracker project maps to no entity still has to show up somewhere.
function unassigned(tracker: TrackerSnapshot, snapshot: PortfolioSnapshot): TodayBusiness {
  const owners = projectOwners(snapshot.registry?.entities ?? []);
  const loose = (p: string | null) => ownerOf(p, owners) === UNASSIGNED;
  const replies = (tracker.email?.needs_reply ?? []).filter((e) => loose(e.project));
  return {
    id: UNASSIGNED,
    name: 'Unassigned',
    item: null,
    tasks: sortTasks(openTaskList(tracker).filter((t) => isDueToday(t) && loose(t.project))),
    replies: sortReplies(replies.filter(isUrgentReply)),
    laterReplies: replies.filter((e) => !isUrgentReply(e)).length,
  };
}

const MOVES_SHOWN = 6;

function BusinessBlock({ b, onOpenEntity }: { b: TodayBusiness; onOpenEntity: (id: string, tab?: EntityTab) => void }) {
  const { tokens } = useTheme();
  const c = tokens.colors;
  const [showAll, setShowAll] = useState(false);
  const status = b.item?.status;
  const moves = b.tasks.length + b.replies.length;
  // Tasks lead (gate items first), replies follow; a long list folds after a handful.
  const rows = [
    ...b.tasks.map((t) => <TaskRow key={t.id} task={t} now={Date.now()} />),
    ...b.replies.map((e, idx) => <ReplyRow key={`r${idx}`} email={e} />),
  ];
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '14px', minWidth: 0 }}>
        {b.item && <EntityMark entity={b.item.entity} logos={b.item.logos} size={32} />}
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
            <h3 style={{ fontFamily: tokens.fonts.display, fontSize: tokens.type.heading, fontWeight: 500, letterSpacing: '-0.01em', lineHeight: 1.2 }}>
              {b.name}
            </h3>
            {b.item && <HealthBadge health={status?.health} why={status?.health_why} />}
            <span style={{ fontSize: tokens.type.small, color: moves ? c.textMuted : c.textDim }}>
              {moves ? `${moves} due today` : 'Nothing due today'}
            </span>
          </div>
          <HealthWhy why={status?.health_why} clamp={1} style={{ marginTop: '4px' }} />
        </div>
        {b.item && (
          <button
            className="btn btn-secondary"
            onClick={() => onOpenEntity(b.id)}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}
          >
            Open <Icon name="arrow-right" size={13} color="currentColor" />
          </button>
        )}
      </div>
      {moves > 0 && (
        <RowList>
          {showAll ? rows : rows.slice(0, MOVES_SHOWN)}
          {rows.length > MOVES_SHOWN && (
            <button className="btn btn-secondary" onClick={() => setShowAll(!showAll)} style={{ alignSelf: 'flex-start', margin: '8px 16px 10px' }}>
              {showAll ? 'Show fewer' : `Show all ${rows.length}`}
            </button>
          )}
        </RowList>
      )}
      {b.laterReplies > 0 && b.item && (
        <button
          onClick={() => onOpenEntity(b.id, 'work')}
          style={{
            alignSelf: 'flex-start',
            background: 'none',
            border: 'none',
            padding: 0,
            fontFamily: 'inherit',
            fontSize: tokens.type.small,
            color: c.textMuted,
            cursor: 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
          }}
        >
          <Icon name="inbox" size={13} color={c.textDim} />
          {b.laterReplies} more {b.laterReplies === 1 ? 'reply' : 'replies'} waiting, not urgent
        </button>
      )}
      {b.laterReplies > 0 && !b.item && (
        <div style={{ fontSize: tokens.type.small, color: c.textDim }}>
          {b.laterReplies} more {b.laterReplies === 1 ? 'reply' : 'replies'} waiting, not urgent
        </div>
      )}
    </section>
  );
}

interface TodayViewProps {
  snapshot: PortfolioSnapshot | null;
  tracker: TrackerSnapshot | null;
  error: string | null;
  trackerError: string | null;
  onOpenEntity: (id: string, tab?: EntityTab) => void;
  onOpenActivity?: () => void;
  onOpenRun: (runId: string) => void;
  onRefresh: () => void;
}

// The home view, in order of importance: one headline line, the decisions waiting on the owner,
// then each business with its health and what is due today.
export function TodayView({ snapshot, tracker, error, trackerError, onOpenEntity, onOpenActivity, onOpenRun, onRefresh }: TodayViewProps) {
  const now = Date.now();
  const trackerProblem = trackerError ?? tracker?.error ?? null;
  const trackerOk = tracker && !tracker.error ? tracker : null;
  const items = boardEntities(snapshot, tracker);
  const line = headline(items, snapshot, tracker);
  const queue = decisionQueue(items);
  const groups = snapshot?.registry?.groups ?? [];
  const email = trackerOk?.email;

  const businesses = (groupId: string) =>
    items
      .filter((i) => i.entity.group === groupId)
      .map((item, order) => ({ b: businessFor(item), order }))
      .sort((a, b) => healthRank(a.b.item?.status?.health) - healthRank(b.b.item?.status?.health) || a.order - b.order)
      .map(({ b }) => b);
  const loose = trackerOk && snapshot ? unassigned(trackerOk, snapshot) : null;

  return (
    <div style={{ maxWidth: '1120px', margin: '0 auto' }}>
      <PageHeader
        title={new Date(now).toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}
        subtitle={<DataStamps sources={dataSources(snapshot, tracker)} now={now} />}
        right={
          <button className="btn btn-secondary" onClick={onRefresh} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Icon name="refresh" size={14} color="currentColor" /> Refresh
          </button>
        }
      />

      <WorkingNow snapshot={snapshot} onOpenRun={onOpenRun} />

      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '8px' }}>
        {error && <Notice>{error}</Notice>}
        {snapshot?.registry_error && <Notice>Could not read ~/portfolio/portfolio.json ({snapshot.registry_error}).</Notice>}
        {trackerProblem && <Notice>Tracker not shown: {trackerProblem}</Notice>}
        {(email?.stale || (email?.accounts_not_fetching.length ?? 0) > 0) && (
          <Notice>
            {email?.stale && `Email last fetched ${email.age_hours ?? '?'}h ago. `}
            {(email?.accounts_not_fetching.length ?? 0) > 0 && `Not fetching: ${email?.accounts_not_fetching.join(', ')}.`}
          </Notice>
        )}
        {!snapshot && !error && <Notice tone="quiet">Reading ~/portfolio and ~/project-tracker…</Notice>}
      </div>

      {line && (
        <>
          <div style={{ margin: '8px 0 48px' }}>
            <HeadlineLine data={line} />
          </div>

          <section style={{ marginBottom: '56px' }}>
            <LastNightCard snapshot={snapshot} onOpen={onOpenActivity} />
          </section>

          <section style={{ marginBottom: '56px' }}>
            <SectionHeading note={queue.length ? 'riskiest business first' : undefined}>Decisions</SectionHeading>
            <DecisionQueue queue={queue} onOpenEntity={(id) => onOpenEntity(id)} />
          </section>

          <section>
            <SectionHeading note="red, then yellow, then green">Businesses</SectionHeading>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '40px' }}>
              {groups.map((g) => {
                const list = businesses(g.id);
                if (list.length === 0) return null;
                return (
                  <div key={g.id}>
                    <SectionLabel style={{ marginBottom: '18px' }}>{g.name}</SectionLabel>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '28px' }}>
                      {list.map((b) => <BusinessBlock key={b.id} b={b} onOpenEntity={onOpenEntity} />)}
                    </div>
                  </div>
                );
              })}
              {loose && loose.tasks.length + loose.replies.length + loose.laterReplies > 0 && (
                <div>
                  <SectionLabel style={{ marginBottom: '18px' }}>Not tied to a business</SectionLabel>
                  <BusinessBlock b={loose} onOpenEntity={onOpenEntity} />
                </div>
              )}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
