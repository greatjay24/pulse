import { useMemo, useState } from 'react';
import { useTheme } from '../contexts/ThemeContext';
import { Todo, TodoChange, TrackerSnapshot, Urgency } from '../types';
import { useTodos, writeTodo } from '../hooks/useTodos';
import { openExternal } from '../utils/tracker';
import { showToast } from '../utils/toast';
import { Card, Notice, PageHeader, SectionLabel } from './BoardUI';
import { Icon } from './Icons';

const URGENCIES: Urgency[] = ['now', 'soon', 'whenever'];
const URGENCY_LABEL: Record<Urgency, string> = { now: 'Now', soon: 'Soon', whenever: 'Whenever' };
const DONE_SHOWN = 40;

const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const daysFromToday = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return ymd(d);
};
const nextMonday = () => {
  const d = new Date();
  d.setDate(d.getDate() + (((8 - d.getDay()) % 7) || 7));
  return ymd(d);
};

function shortDate(s: string | null): string {
  if (!s) return '';
  const d = new Date(s.length === 10 ? `${s}T12:00` : s);
  return Number.isNaN(d.getTime()) ? s : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// "closes itself when PR x merges or Nov 9 passes"
export function doneWhenText(rule: Todo['done_when']): string | null {
  if (!rule) return null;
  const parts: string[] = [];
  if (rule.pr_merged) parts.push(`PR ${rule.pr_merged} merges`);
  if (rule.email_sent_to) parts.push(`you email ${rule.email_sent_to}`);
  if (rule.kit_broadcast_scheduled) parts.push(`Kit broadcast ${rule.kit_broadcast_scheduled} is scheduled`);
  if (rule.date_passed) parts.push(`${shortDate(String(rule.date_passed))} passes`);
  return parts.length ? `Closes itself when ${parts.join(' or ')}` : null;
}

type Tab = 'open' | 'later' | 'done';

export function TasksPage({ tracker, onChanged }: { tracker: TrackerSnapshot | null; onChanged: () => void }) {
  const { tokens } = useTheme();
  const c = tokens.colors;
  const { data, error, refresh } = useTodos();
  const [tab, setTab] = useState<Tab>('open');
  const [project, setProject] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const today = ymd(new Date());

  const projectNames = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of tracker?.projects ?? []) m.set(p.id, p.name || p.id);
    return m;
  }, [tracker]);

  const todos = data?.todos ?? [];
  const inProject = (t: Todo) => !project || t.project === project;
  const open = todos.filter((t) => !t.done && !(t.show_from && t.show_from > today) && inProject(t));
  const later = todos
    .filter((t) => !t.done && t.show_from && t.show_from > today && inProject(t))
    .sort((a, b) => (a.show_from ?? '').localeCompare(b.show_from ?? ''));
  const done = todos
    .filter((t) => t.done && inProject(t))
    .sort((a, b) => (b.done_at ?? '').localeCompare(a.done_at ?? ''))
    .slice(0, DONE_SHOWN);

  const change = async (c: TodoChange, verb: string) => {
    setBusy(c.title);
    try {
      const status = await writeTodo(c);
      if (status) showToast(`${verb}: ${c.title}`);
      await refresh();
      onChanged();
    } catch (e) {
      showToast(`Could not save: ${String(e)}`);
    } finally {
      setBusy(null);
    }
  };

  const tabButton = (id: Tab, label: string, n: number | null) => (
    <button
      key={id}
      className={`btn ${tab === id ? 'btn-primary' : 'btn-secondary'}`}
      onClick={() => setTab(id)}
      aria-pressed={tab === id}
    >
      {label}
      {n != null && <span style={{ opacity: 0.7, marginLeft: 6 }}>{n}</span>}
    </button>
  );

  return (
    <div style={{ maxWidth: '920px', margin: '0 auto' }}>
      <PageHeader
        title="Tasks"
        subtitle={
          <span style={{ color: c.textMuted, fontSize: tokens.type.small }}>
            Your one list. Agents add to it too, and tasks with a rule close themselves.
          </span>
        }
        right={
          <button className="btn btn-secondary" onClick={refresh} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Icon name="refresh" size={14} color="currentColor" /> Refresh
          </button>
        }
      />
      {error && <Notice>Could not read your tasks: {error}</Notice>}
      {data?.error && <Notice>{data.error}</Notice>}
      {data && !data.installed && <Notice tone="quiet">No ~/project-tracker on this Mac, so there is no task list to show.</Notice>}

      {data?.installed && (
        <>
          <AddTask projects={[...projectNames]} onAdd={(t) => change(t, 'Added')} busy={busy !== null} />

          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', margin: '20px 0 12px' }}>
            {tabButton('open', 'Open', open.length)}
            {tabButton('later', 'Later', later.length)}
            {tabButton('done', 'Done', null)}
            <span style={{ flex: 1 }} />
            <label style={{ fontSize: tokens.type.small, color: c.textDim, display: 'flex', gap: '6px', alignItems: 'center' }}>
              Project
              <select value={project} onChange={(e) => setProject(e.target.value)} style={{ padding: '6px 8px', fontSize: tokens.type.small }}>
                <option value="">All</option>
                {[...projectNames].map(([id, name]) => <option key={id} value={id}>{name}</option>)}
              </select>
            </label>
          </div>

          {tab === 'open' && (
            <Card padding="8px 22px 14px">
              {open.length === 0 && <Empty text="Nothing open. Nice." />}
              {URGENCIES.map((u) => {
                const rows = open.filter((t) => (t.urgency ?? 'whenever') === u);
                if (!rows.length) return null;
                return (
                  <div key={u} style={{ marginTop: '14px' }}>
                    <SectionLabel>{URGENCY_LABEL[u]} · {rows.length}</SectionLabel>
                    {rows.map((t) => (
                      <TodoRow key={t.title} todo={t} projectName={projectNames.get(t.project ?? '')} busy={busy === t.title} today={today} onChange={change} />
                    ))}
                  </div>
                );
              })}
            </Card>
          )}
          {tab === 'later' && (
            <Card padding="8px 22px 14px">
              {later.length === 0 && <Empty text="Nothing snoozed." />}
              {later.map((t) => (
                <TodoRow key={t.title} todo={t} projectName={projectNames.get(t.project ?? '')} busy={busy === t.title} today={today} onChange={change} />
              ))}
            </Card>
          )}
          {tab === 'done' && (
            <Card padding="8px 22px 14px">
              {done.length === 0 && <Empty text="Nothing done yet." />}
              {done.map((t) => (
                <TodoRow key={t.title} todo={t} projectName={projectNames.get(t.project ?? '')} busy={busy === t.title} today={today} onChange={change} />
              ))}
            </Card>
          )}
          {data.skipped > 0 && (
            <div style={{ fontSize: tokens.type.micro, color: c.textDim, marginTop: '10px' }}>
              {data.skipped} row{data.skipped === 1 ? '' : 's'} in todos.json are not task-shaped and are not shown.
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  const { tokens } = useTheme();
  return <div style={{ fontSize: tokens.type.small, color: tokens.colors.textDim, padding: '16px 0' }}>{text}</div>;
}

function AddTask({ projects, onAdd, busy }: { projects: [string, string][]; onAdd: (t: TodoChange) => Promise<void>; busy: boolean }) {
  const { tokens } = useTheme();
  const c = tokens.colors;
  const [title, setTitle] = useState('');
  const [detail, setDetail] = useState('');
  const [project, setProject] = useState('');
  const [urgency, setUrgency] = useState<Urgency>('soon');
  const [showFrom, setShowFrom] = useState('');

  const submit = async () => {
    const t = title.trim();
    if (!t) return;
    const change: TodoChange = { title: t, urgency };
    if (detail.trim()) change.detail = detail.trim();
    if (project) change.project = project;
    if (showFrom) change.show_from = showFrom;
    await onAdd(change);
    setTitle('');
    setDetail('');
    setShowFrom('');
  };

  const label = { fontSize: tokens.type.micro, color: c.textDim, display: 'flex', flexDirection: 'column' as const, gap: '4px' };
  return (
    <Card padding="18px 22px">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}
      >
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Add a task…"
          aria-label="New task"
          style={{ padding: '9px 11px', fontSize: '15px' }}
        />
        {title.trim() && (
          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <label style={{ ...label, flex: '1 1 220px' }}>
              Detail
              <input value={detail} onChange={(e) => setDetail(e.target.value)} style={{ padding: '7px 9px', fontSize: tokens.type.small }} />
            </label>
            <label style={label}>
              Project
              <select value={project} onChange={(e) => setProject(e.target.value)} style={{ padding: '7px 9px', fontSize: tokens.type.small }}>
                <option value="">Default (crafted)</option>
                {projects.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
              </select>
            </label>
            <label style={label}>
              Urgency
              <select value={urgency} onChange={(e) => setUrgency(e.target.value as Urgency)} style={{ padding: '7px 9px', fontSize: tokens.type.small }}>
                {URGENCIES.map((u) => <option key={u} value={u}>{URGENCY_LABEL[u]}</option>)}
              </select>
            </label>
            <label style={label}>
              Show from
              <input type="date" value={showFrom} min={ymd(new Date())} onChange={(e) => setShowFrom(e.target.value)} style={{ padding: '6px 9px', fontSize: tokens.type.small }} />
            </label>
            <button className="btn btn-primary" type="submit" disabled={busy}>Add</button>
          </div>
        )}
      </form>
    </Card>
  );
}

function TodoRow({ todo, projectName, busy, today, onChange }: {
  todo: Todo;
  projectName: string | undefined;
  busy: boolean;
  today: string;
  onChange: (c: TodoChange, verb: string) => Promise<void>;
}) {
  const { tokens } = useTheme();
  const c = tokens.colors;
  const [picking, setPicking] = useState(false);
  const snoozed = !!todo.show_from && todo.show_from > today;
  const rule = doneWhenText(todo.done_when);
  const meta = [
    projectName ?? todo.project,
    todo.added && `added ${shortDate(todo.added)}`,
    snoozed && `back ${shortDate(todo.show_from)}`,
    todo.done && todo.done_at && `done ${shortDate(todo.done_at)}`,
  ].filter(Boolean);

  const snooze = (date: string) => {
    setPicking(false);
    if (date) onChange({ title: todo.title, show_from: date }, `Snoozed to ${shortDate(date)}`);
  };

  return (
    <div style={{ display: 'flex', gap: '12px', padding: '12px 0', borderTop: `1px solid ${c.border}`, opacity: busy ? 0.55 : 1 }}>
      <button
        title={todo.done ? 'Reopen' : 'Mark done'}
        aria-label={todo.done ? `Reopen ${todo.title}` : `Mark ${todo.title} done`}
        disabled={busy}
        onClick={() => onChange(todo.done ? { title: todo.title, reopen: true } : { title: todo.title, done: true }, todo.done ? 'Reopened' : 'Done')}
        style={{
          width: 20, height: 20, marginTop: 2, flexShrink: 0, borderRadius: 6, cursor: 'pointer', padding: 0,
          border: `1.5px solid ${todo.done ? c.success : c.textDim}`, background: todo.done ? c.success : 'transparent',
          color: c.bg, fontSize: 12, lineHeight: '17px',
        }}
      >
        {todo.done ? '✓' : ''}
      </button>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: '15px', fontWeight: 500, textDecoration: todo.done ? 'line-through' : undefined, color: todo.done ? c.textMuted : c.text }}>
          {todo.url ? (
            <a href={todo.url} onClick={(e) => { e.preventDefault(); openExternal(todo.url); }} style={{ color: 'inherit' }}>
              {todo.title}
            </a>
          ) : (
            todo.title
          )}
        </div>
        {todo.detail && <div style={{ fontSize: tokens.type.small, color: c.textMuted, marginTop: 3, lineHeight: 1.45 }}>{todo.detail}</div>}
        <div style={{ fontSize: tokens.type.micro, color: c.textDim, marginTop: 4 }}>
          {meta.join(' · ')}
          {rule && !todo.done && <span> · {rule}</span>}
          {todo.done && todo.done_evidence && <span> · {todo.done_evidence}</span>}
        </div>
      </div>
      {!todo.done && (
        <div style={{ display: 'flex', gap: '6px', alignItems: 'flex-start', flexShrink: 0 }}>
          <select
            aria-label="Urgency"
            value={todo.urgency ?? 'whenever'}
            disabled={busy}
            onChange={(e) => onChange({ title: todo.title, urgency: e.target.value as Urgency }, `Moved to ${e.target.value}`)}
            style={{ padding: '4px 6px', fontSize: tokens.type.micro }}
          >
            {URGENCIES.map((u) => <option key={u} value={u}>{URGENCY_LABEL[u]}</option>)}
          </select>
          {snoozed ? (
            <button className="btn btn-secondary" disabled={busy} style={{ padding: '4px 10px', fontSize: tokens.type.micro }}
              onClick={() => onChange({ title: todo.title, show_from: today }, 'Back on the list')}>
              Show now
            </button>
          ) : picking ? (
            <input type="date" autoFocus min={daysFromToday(1)} aria-label="Snooze until"
              onChange={(e) => snooze(e.target.value)} onBlur={() => setPicking(false)}
              style={{ padding: '3px 6px', fontSize: tokens.type.micro }} />
          ) : (
            <select
              aria-label="Snooze"
              value=""
              disabled={busy}
              onChange={(e) => (e.target.value === 'pick' ? setPicking(true) : snooze(e.target.value))}
              style={{ padding: '4px 6px', fontSize: tokens.type.micro }}
            >
              <option value="">Snooze</option>
              <option value={daysFromToday(1)}>Tomorrow</option>
              <option value={daysFromToday(3)}>In 3 days</option>
              <option value={nextMonday()}>Next Monday</option>
              <option value={daysFromToday(14)}>In 2 weeks</option>
              <option value="pick">Pick a date…</option>
            </select>
          )}
        </div>
      )}
    </div>
  );
}
