import { useState } from 'react';
import { useTheme } from '../contexts/ThemeContext';
import { PortfolioSnapshot } from '../types';
import { Goal } from '../types/ops';
import { saveGoal, useGoals } from '../hooks/useOps';
import { PACE_LABEL, Pace, formatAmount, formatDate, pace, parseAmount, progress } from '../utils/ops';
import { Card, EntityMark, Notice, PageHeader, SectionLabel } from './BoardUI';
import { Icon } from './Icons';

export function paceTone(p: Pace, c: { success: string; warning: string; danger: string; textDim: string }): string {
  return p === 'done' || p === 'on-track' ? c.success : p === 'at-risk' ? c.warning : p === 'missed' ? c.danger : c.textDim;
}

export function GoalBar({ goal, height = 6 }: { goal: Goal; height?: number }) {
  const { tokens } = useTheme();
  const c = tokens.colors;
  const p = progress(goal);
  const tone = paceTone(pace(goal), c);
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={p == null ? undefined : Math.round(p * 100)}
      style={{ height, borderRadius: height, background: c.bgElevated, overflow: 'hidden', width: '100%' }}
    >
      {p != null && <div style={{ width: `${Math.max(p * 100, p > 0 ? 2 : 0)}%`, height: '100%', background: tone, borderRadius: height }} />}
    </div>
  );
}

// One goal: title, progress toward the target with the date, pace, and an inline editor that
// writes goals.json through the validated Rust command.
function GoalRow({ entityId, goal, onSaved }: { entityId: string; goal: Goal; onSaved: () => void }) {
  const { tokens } = useTheme();
  const c = tokens.colors;
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    title: goal.title,
    metric: goal.metric,
    target: goal.target == null ? '' : String(goal.target),
    current: goal.current == null ? '' : String(goal.current),
    unit: goal.unit,
    by: goal.by ?? '',
    owner_note: goal.owner_note,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const p = pace(goal);

  const save = async (extra: Partial<Goal> = {}) => {
    const target = parseAmount(form.target);
    const current = parseAmount(form.current);
    if (target === 'invalid' || current === 'invalid') {
      setError('Target and current must be numbers (or empty).');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const edit = editing ? { title: form.title, metric: form.metric, target, current, unit: form.unit, by: form.by || null, owner_note: form.owner_note } : {};
      await saveGoal(entityId, { id: goal.id, ...edit, ...extra });
      setEditing(false);
      onSaved();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const input = (key: keyof typeof form, label: string, width = '100%', type = 'text') => (
    <label style={{ fontSize: tokens.type.micro, color: c.textDim, display: 'flex', flexDirection: 'column', gap: '4px', width }}>
      {label}
      <input type={type} value={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })} style={{ padding: '7px 9px', fontSize: tokens.type.small }} />
    </label>
  );

  return (
    <div style={{ padding: '16px 0', borderTop: `1px solid ${c.border}` }}>
      {editing ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {input('title', 'Goal')}
          {input('metric', 'Measured by')}
          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
            {input('current', 'Current', '120px')}
            {input('target', 'Target', '120px')}
            {input('unit', 'Unit', '100px')}
            {input('by', 'By', '160px', 'date')}
          </div>
          {input('owner_note', 'Your note')}
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '10px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '16px', fontWeight: 600 }}>{goal.title}</span>
            {goal.proposed && (
              <span style={{ fontSize: tokens.type.micro, color: c.accent, border: `1px solid ${c.accent}`, borderRadius: '999px', padding: '1px 8px' }}>proposed</span>
            )}
            <span style={{ flex: 1 }} />
            <span style={{ fontSize: tokens.type.small, fontWeight: 600, color: paceTone(p, c) }}>{PACE_LABEL[p]}</span>
          </div>
          <div style={{ fontSize: tokens.type.small, color: c.textMuted, margin: '4px 0 10px' }}>
            {goal.metric}: <span style={{ color: c.text, fontWeight: 600 }}>{formatAmount(goal.current, goal.unit)}</span> of {formatAmount(goal.target, goal.unit)}
            {goal.unit && goal.unit !== 'USD' && goal.unit !== '%' ? ` ${goal.unit}` : ''} · by {formatDate(goal.by)} · source: {goal.source}
          </div>
          <GoalBar goal={goal} />
          {(goal.lead_note || goal.owner_note) && (
            <div style={{ fontSize: tokens.type.small, color: c.textDim, marginTop: '8px', lineHeight: 1.5 }}>
              {goal.owner_note && <div>{goal.owner_note}</div>}
              {goal.lead_note && <div>Lead: {goal.lead_note}</div>}
            </div>
          )}
        </>
      )}
      {error && <div style={{ color: c.danger, fontSize: tokens.type.small, marginTop: '8px' }}>{error}</div>}
      <div style={{ display: 'flex', gap: '8px', marginTop: '10px' }}>
        {editing ? (
          <>
            <button className="btn btn-primary" disabled={busy} onClick={() => save(goal.proposed ? { proposed: false } : {})}>
              {busy ? 'Saving…' : goal.proposed ? 'Save and confirm' : 'Save'}
            </button>
            <button className="btn btn-secondary" disabled={busy} onClick={() => setEditing(false)}>Cancel</button>
          </>
        ) : (
          <>
            {goal.proposed && (
              <button className="btn btn-secondary" disabled={busy} onClick={() => save({ proposed: false })}>Confirm</button>
            )}
            <button className="btn btn-secondary" disabled={busy} onClick={() => setEditing(true)}>Edit</button>
          </>
        )}
      </div>
    </div>
  );
}

// Every business's goals: progress toward each target, with its date and whether it's on pace.
export function GoalsPage({ snapshot }: { snapshot: PortfolioSnapshot | null }) {
  const { tokens } = useTheme();
  const { data, error, refresh } = useGoals();
  const entities = snapshot?.registry?.entities ?? [];
  const reports = new Map((snapshot?.entities ?? []).map((r) => [r.id, r]));

  return (
    <div style={{ maxWidth: '920px', margin: '0 auto' }}>
      <PageHeader
        title="Goals"
        subtitle={<span style={{ color: tokens.colors.textMuted, fontSize: tokens.type.small }}>Leads plan against these and update current values each night.</span>}
        right={
          <button className="btn btn-secondary" onClick={refresh} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Icon name="refresh" size={14} color="currentColor" /> Refresh
          </button>
        }
      />
      {error && <Notice>Could not read goals: {error}</Notice>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
        {entities.map((e) => {
          const r = data?.entities.find((x) => x.entity === e.id);
          const goals = r?.goals?.goals ?? [];
          const report = reports.get(e.id);
          return (
            <Card key={e.id}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '6px' }}>
                <EntityMark entity={e} logos={report ? { logo: report.logo, logo_dark: report.logo_dark } : null} size={32} />
                <SectionLabel style={{ marginBottom: 0 }}>{e.name}</SectionLabel>
              </div>
              {r?.error && r.error !== 'missing' && <Notice>goals.json: {r.error}</Notice>}
              {goals.length === 0 && (
                <div style={{ fontSize: tokens.type.small, color: tokens.colors.textDim, padding: '12px 0' }}>
                  No goals yet. The lead proposes them in {e.path}/goals.json.
                </div>
              )}
              {goals.map((g) => <GoalRow key={`${g.id}-${g.updated ?? ''}`} entityId={e.id} goal={g} onSaved={refresh} />)}
            </Card>
          );
        })}
      </div>
    </div>
  );
}
