import { ReactNode } from 'react';
import { useTheme } from '../contexts/ThemeContext';
import { PortfolioSnapshot, TrackerEmail, TrackerSnapshot, TrackerTask } from '../types';
import { UNASSIGNED, dueNow, formatUsd, isDueToday, isGate, openTaskList, ownerOf, projectOwners, sortReplies, sortTasks } from '../utils/tracker';
import { Icon } from './Icons';
import { BoardEntity, HealthDot, SectionLabel, boardEntities } from './OrgBoard';
import { ReplyRow, RowList, TaskRow } from './TrackerRows';

// What is due now for one entity: "now" tasks, gate items marked now or soon, and replies.
// Report decisions stay on the board and entity dashboards so Today stays short.
interface TodayGroup {
  id: string;
  name: string;
  item: BoardEntity | null; // null for the unassigned group
  tasks: TrackerTask[];
  replies: TrackerEmail[];
}

function todayGroups(items: BoardEntity[], tracker: TrackerSnapshot, snapshot: PortfolioSnapshot): TodayGroup[] {
  const groups: TodayGroup[] = items.map((item) => ({
    id: item.entity.id,
    name: item.entity.name,
    item,
    tasks: (item.tracker?.tasks ?? []).filter(isDueToday),
    replies: item.tracker?.replies ?? [],
  }));
  // Anything whose tracker project maps to no entity still has to show up somewhere.
  const owners = projectOwners(snapshot.registry?.entities ?? []);
  const loose = (p: string | null) => ownerOf(p, owners) === UNASSIGNED;
  groups.push({
    id: UNASSIGNED,
    name: 'Unassigned',
    item: null,
    tasks: sortTasks(openTaskList(tracker).filter((t) => isDueToday(t) && loose(t.project))),
    replies: sortReplies((tracker.email?.needs_reply ?? []).filter((e) => loose(e.project))),
  });
  return groups;
}

function Stat({ value, label, sub }: { value: ReactNode; label: string; sub?: string }) {
  const { tokens } = useTheme();
  return (
    <div
      style={{
        padding: '18px 22px',
        background: tokens.colors.bgCard,
        border: `1px solid ${tokens.colors.border}`,
        borderRadius: tokens.radius.lg,
      }}
    >
      <SectionLabel style={{ marginBottom: '8px' }}>{label}</SectionLabel>
      <div style={{ fontFamily: tokens.fonts.mono, fontSize: '32px', fontWeight: 600, letterSpacing: '-0.02em' }}>{value}</div>
      {sub && <div style={{ fontSize: '12px', color: tokens.colors.textDim, marginTop: '4px' }}>{sub}</div>}
    </div>
  );
}

interface TodayViewProps {
  snapshot: PortfolioSnapshot | null;
  tracker: TrackerSnapshot | null;
  error: string | null;
  trackerError: string | null;
  onOpenEntity: (id: string) => void;
  onRefresh: () => void;
}

export function TodayView({ snapshot, tracker, error, trackerError, onOpenEntity, onRefresh }: TodayViewProps) {
  const { tokens } = useTheme();
  const now = Date.now();
  const problem = error ?? trackerError ?? tracker?.error ?? null;

  const header = (
    <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '28px' }}>
      <div>
        <h1 style={{ fontSize: '24px', fontWeight: 600, letterSpacing: '-0.02em' }}>Today</h1>
        <p style={{ fontSize: '13px', color: tokens.colors.textMuted, marginTop: '4px' }}>
          {new Date(now).toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}
          {tracker && ` · read ${new Date(tracker.read_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`}
          {' · refreshes every minute'}
        </p>
      </div>
      <button className="btn btn-secondary" onClick={onRefresh} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
        <Icon name="refresh" size={14} color="currentColor" /> Refresh
      </button>
    </header>
  );

  if (problem || !snapshot || !tracker) {
    return (
      <div>
        {header}
        <div style={{ padding: '16px 20px', borderRadius: tokens.radius.md, background: tokens.colors.warningMuted, color: tokens.colors.warning, fontSize: '13px' }}>
          {problem ?? 'Reading ~/portfolio and ~/project-tracker…'}
        </div>
      </div>
    );
  }

  const items = boardEntities(snapshot, tracker);
  const groups = todayGroups(items, tracker, snapshot);
  const busy = groups.filter((g) => g.tasks.length + g.replies.length > 0);
  const quiet = groups.filter((g) => g.item && !busy.includes(g));
  const email = tracker.email;
  const replies = email?.needs_reply ?? [];
  const gates = openTaskList(tracker).filter((t) => isGate(t) && isDueToday(t)).length;
  const money = tracker.money;

  return (
    <div>
      {header}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px', marginBottom: '16px' }}>
        <Stat value={dueNow(openTaskList(tracker)).length} label="Tasks due now" />
        <Stat value={gates} label="Gate items" sub="Decide: items marked now or soon" />
        <Stat value={replies.length} label="Need a reply" sub={`${replies.filter((e) => e.urgency === 'now').length} urgent`} />
        <Stat
          value={money.configured ? formatUsd(money.totals.d7) : '—'}
          label="Money in · 7 days"
          sub={money.configured ? `${formatUsd(money.totals.d30)} over 30 days` : 'not connected in the tracker'}
        />
      </div>

      {(email?.stale || (email?.accounts_not_fetching.length ?? 0) > 0) && (
        <div style={{ fontSize: '12px', color: tokens.colors.warning, marginBottom: '16px' }}>
          {email?.stale && `Email last fetched ${email.age_hours ?? '?'}h ago. `}
          {(email?.accounts_not_fetching.length ?? 0) > 0 && `Not fetching: ${email?.accounts_not_fetching.join(', ')}.`}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '28px', marginTop: '28px' }}>
        {busy.map((g) => (
          <section key={g.id}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
              {g.item && <HealthDot health={g.item.status?.health} />}
              <h2 style={{ fontSize: '17px', fontWeight: 600, flex: 1 }}>{g.name}</h2>
              {g.item && (
                <button className="btn btn-secondary" onClick={() => onOpenEntity(g.id)}>
                  Open dashboard →
                </button>
              )}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {g.tasks.length > 0 && (
                <RowList>
                  {g.tasks.map((t) => <TaskRow key={t.id} task={t} now={now} />)}
                </RowList>
              )}
              {g.replies.length > 0 && (
                <RowList>
                  {g.replies.map((e, idx) => <ReplyRow key={idx} email={e} />)}
                </RowList>
              )}
            </div>
          </section>
        ))}
        {busy.length === 0 && <div style={{ fontSize: '14px', color: tokens.colors.textMuted }}>Nothing due now.</div>}
        {quiet.length > 0 && (
          <div style={{ fontSize: '13px', color: tokens.colors.textDim }}>
            Nothing due: {quiet.map((g) => g.name).join(', ')}
          </div>
        )}
      </div>
    </div>
  );
}
