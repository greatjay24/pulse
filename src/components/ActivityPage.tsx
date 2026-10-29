import { useMemo, useState } from 'react';
import { useTheme } from '../contexts/ThemeContext';
import { PortfolioSnapshot } from '../types';
import { useOrgActivity } from '../hooks/useOrgActivity';
import { ActivityItem, ActivityKind, activityItems, costBetween, formatCost, formatSecs, localDay, startOfDay } from '../utils/activity';
import { openExternal } from '../utils/tracker';
import { Card, Notice, PageHeader, SectionLabel } from './BoardUI';
import { WorkingNow } from './WorkingNow';
import { Icon } from './Icons';

const KIND_LABEL: Record<ActivityKind, string> = {
  run: 'Run',
  act: 'Acted',
  commit: 'Commit',
  done: 'Done',
  answer: 'You',
  report: 'Lead',
  drafts: 'Drafts',
};

function dayLabel(day: string, now: number): string {
  if (day === localDay(now)) return 'Today';
  if (day === localDay(now - 86_400_000)) return 'Yesterday';
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  const { tokens } = useTheme();
  const c = tokens.colors;
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      style={{
        padding: '6px 12px',
        borderRadius: '999px',
        border: `1px solid ${active ? c.accent : c.border}`,
        background: active ? c.accentGlow : 'transparent',
        color: active ? c.text : c.textMuted,
        fontFamily: 'inherit',
        fontSize: tokens.type.small,
        fontWeight: active ? 600 : 500,
        cursor: 'pointer',
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </button>
  );
}

// Runs open their conversation; answers and replies open their entity's thread.
const CONVERSATION_KINDS: ActivityKind[] = ['run', 'act', 'answer', 'report'];

function Row({ item, entityName, onOpen }: { item: ActivityItem; entityName: string | null; onOpen?: () => void }) {
  const { tokens } = useTheme();
  const c = tokens.colors;
  const tone = item.ok === false ? c.danger : item.running ? c.accent : item.kind === 'answer' ? c.accent : c.textDim;
  const meta = [
    new Date(item.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }),
    entityName,
    item.secs !== undefined ? formatSecs(item.secs) : null,
    item.cost ? formatCost(item.cost) : null,
    item.running ? 'running' : null,
    item.ok === false ? 'failed' : null,
  ].filter(Boolean);
  return (
    <div
      onClick={onOpen}
      onKeyDown={(e) => onOpen && (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onOpen())}
      role={onOpen ? 'button' : undefined}
      tabIndex={onOpen ? 0 : undefined}
      title={onOpen ? 'Open the conversation' : undefined}
      className={onOpen ? 'activity-row-link' : undefined}
      style={{ display: 'flex', gap: '14px', padding: '12px 16px', alignItems: 'flex-start', cursor: onOpen ? 'pointer' : undefined, borderRadius: tokens.radius.sm }}
    >
      <span
        style={{
          width: '64px',
          flexShrink: 0,
          fontSize: '11px',
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          color: tone,
          marginTop: '3px',
        }}
      >
        {KIND_LABEL[item.kind]}
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: '15px', fontWeight: 500, lineHeight: 1.45 }}>{item.title}</span>
        {item.detail && (
          <span style={{ display: 'block', fontSize: '13px', lineHeight: 1.55, color: c.textMuted, marginTop: '3px', maxWidth: '100ch' }}>{item.detail}</span>
        )}
        <span style={{ display: 'block', fontSize: tokens.type.micro, color: c.textDim, marginTop: '4px' }}>{meta.join(' · ')}</span>
      </span>
      {item.link && /^https?:\/\//.test(item.link) && (
        <button onClick={(e) => (e.stopPropagation(), openExternal(item.link!))} title={item.link} style={{ background: 'none', border: 'none', cursor: 'pointer', marginTop: '3px' }}>
          <Icon name="external-link" size={13} color={c.textDim} />
        </button>
      )}
    </div>
  );
}

// A read-only timeline of what the organization did: lead runs (nightly and on the owner's answers)
// with their cost, commits in ~/portfolio, `done` from each status.json, decisions.jsonl and
// sales drafts. Filter by entity and by day.
export function ActivityPage({ snapshot, onOpenConversation }: {
  snapshot: PortfolioSnapshot | null;
  onOpenConversation: (focus: { runId?: string; entity?: string }) => void;
}) {
  const { tokens } = useTheme();
  const c = tokens.colors;
  const { activity, error, refresh } = useOrgActivity();
  const [entity, setEntity] = useState<string | 'all'>('all');
  const [day, setDay] = useState<string | 'all'>('all');
  const now = Date.now();
  const entities = snapshot?.registry?.entities ?? [];
  const nameOf = (id: string | null) => (id ? entities.find((e) => e.id === id)?.name ?? id : 'Org');

  const all = useMemo(() => activityItems(activity, snapshot), [activity, snapshot]);
  const byEntity = entity === 'all' ? all : all.filter((i) => i.entity === entity);
  const days = [...new Set(byEntity.map((i) => i.day))].slice(0, 14);
  const shown = day === 'all' ? byEntity.filter((i) => now - i.at < 14 * 86_400_000) : byEntity.filter((i) => i.day === day);

  const today = startOfDay(now);
  const weekAgo = today - 6 * 86_400_000;
  const costToday = costBetween(byEntity, today);
  const costWeek = costBetween(byEntity, weekAgo);
  const runsWeek = byEntity.filter((i) => (i.kind === 'run' || i.kind === 'act') && i.at >= weekAgo).length;
  const failedWeek = byEntity.filter((i) => i.ok === false && i.at >= weekAgo).length;

  const groups: { day: string; items: ActivityItem[] }[] = [];
  for (const i of shown) {
    const last = groups[groups.length - 1];
    if (last?.day === i.day) last.items.push(i);
    else groups.push({ day: i.day, items: [i] });
  }

  return (
    <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
      <PageHeader
        title="Activity"
        subtitle="What the organization did: lead runs, answers, commits, drafts. Read-only."
        right={
          <button className="btn btn-secondary" onClick={refresh} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Icon name="refresh" size={14} color="currentColor" /> Refresh
          </button>
        }
      />

      <WorkingNow snapshot={snapshot} onOpenRun={(runId) => onOpenConversation({ runId })} />

      {error && <Notice>{error}</Notice>}
      {(activity?.errors.length ?? 0) > 0 && <Notice tone="quiet">Some files could not be read: {activity!.errors.join('; ')}</Notice>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: '16px', margin: '20px 0 28px' }}>
        {[
          { label: 'Agent cost · today', value: formatCost(costToday) },
          { label: 'Agent cost · 7 days', value: formatCost(costWeek) },
          { label: 'Lead runs · 7 days', value: String(runsWeek), sub: failedWeek ? `${failedWeek} failed` : 'none failed' },
        ].map((s) => (
          <Card key={s.label} padding="20px 22px">
            <SectionLabel style={{ marginBottom: '8px' }}>{s.label}</SectionLabel>
            <div style={{ fontSize: '32px', fontWeight: 600, letterSpacing: '-0.02em' }}>{s.value}</div>
            {s.sub && <div style={{ fontSize: tokens.type.small, color: failedWeek ? c.danger : c.textDim, marginTop: '6px' }}>{s.sub}</div>}
          </Card>
        ))}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '28px' }}>
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
          <Chip active={entity === 'all'} onClick={() => setEntity('all')}>Everyone</Chip>
          {entities.map((e) => (
            <Chip key={e.id} active={entity === e.id} onClick={() => setEntity(e.id)}>{e.name}</Chip>
          ))}
        </div>
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
          <Chip active={day === 'all'} onClick={() => setDay('all')}>Last 14 days</Chip>
          {days.map((d) => (
            <Chip key={d} active={day === d} onClick={() => setDay(d)}>{dayLabel(d, now)}</Chip>
          ))}
        </div>
      </div>

      {!activity && !error && <div style={{ color: c.textMuted }}>Reading ~/portfolio…</div>}
      {activity && groups.length === 0 && <div style={{ color: c.textMuted }}>Nothing recorded for this filter.</div>}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '28px' }}>
        {groups.map((g) => {
          const cost = costBetween(g.items, 0);
          return (
            <section key={g.day}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: '12px', marginBottom: '10px' }}>
                <h2 style={{ fontFamily: tokens.fonts.display, fontSize: tokens.type.heading, fontWeight: 500 }}>{dayLabel(g.day, now)}</h2>
                <span style={{ fontSize: tokens.type.small, color: c.textDim }}>
                  {g.items.length} {g.items.length === 1 ? 'entry' : 'entries'}
                  {cost > 0 && ` · ${formatCost(cost)} agent cost`}
                </span>
              </div>
              <div style={{ background: c.bgCard, border: `1px solid ${c.border}`, borderRadius: tokens.radius.md, padding: '4px' }}>
                {g.items.map((i) => (
                  <Row
                    key={i.key}
                    item={i}
                    entityName={entity === 'all' ? nameOf(i.entity) : null}
                    onOpen={
                      CONVERSATION_KINDS.includes(i.kind)
                        ? () => onOpenConversation(i.runId ? { runId: i.runId } : { entity: i.entity ?? undefined })
                        : undefined
                    }
                  />
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
