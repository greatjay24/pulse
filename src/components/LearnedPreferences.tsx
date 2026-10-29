import { useState } from 'react';
import { useTheme } from '../contexts/ThemeContext';
import { LearnedPreference } from '../types/usage';
import { setPreferenceDisabled, usePreferences } from '../hooks/useUsage';
import { Notice } from './BoardUI';

// What Pulse has learned: the preferences bin/learn.py drew from the owner's edits, skips,
// rejections and corrections. Every agent reads the enabled ones at session start
// (~/portfolio/memory/preferences.md). Off keeps the line; nothing here deletes.

const EVIDENCE: Record<string, [string, string]> = {
  edit: ['edited 1 item', 'edited {n} items'],
  sales_edit: ['edited 1 sales draft', 'edited {n} sales drafts'],
  skip: ['skipped 1 item', 'skipped {n} items'],
  reject: ['rejected 1 decision', 'rejected {n} decisions'],
  discuss: ['said so on 1 decision', 'said so on {n} decisions'],
  said: ['said so once', 'said so {n} times'],
  approve: ['approved 1 as-is', 'approved {n} as-is'],
};

function evidence(p: LearnedPreference): string {
  const parts = Object.entries(p.evidence ?? {})
    .filter(([, n]) => n > 0)
    .map(([k, n]) => (EVIDENCE[k] ? (n === 1 ? EVIDENCE[k][0] : EVIDENCE[k][1].replace('{n}', String(n))) : `${k} ${n}`));
  const d = new Date(`${p.last_seen}T12:00:00`);
  const day = isNaN(d.getTime()) ? '' : d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  return [parts.join(', '), day].filter(Boolean).join(' · ');
}

function Switch({ on, onChange, label, busy }: { on: boolean; onChange: () => void; label: string; busy: boolean }) {
  const { tokens } = useTheme();
  return (
    <button role="switch" aria-checked={on} aria-label={label} onClick={onChange} disabled={busy}
      style={{ width: '40px', height: '22px', borderRadius: '11px', border: 'none', cursor: busy ? 'default' : 'pointer', position: 'relative', flexShrink: 0,
        background: on ? tokens.colors.accent : tokens.colors.bgElevated, opacity: busy ? 0.6 : 1 }}>
      <span style={{ position: 'absolute', top: '3px', left: on ? '21px' : '3px', width: '16px', height: '16px', borderRadius: '50%', background: 'white',
        boxShadow: '0 1px 3px rgba(0,0,0,0.2)', transition: 'left 0.2s ease' }} />
    </button>
  );
}

export function LearnedPreferences() {
  const { tokens } = useTheme();
  const c = tokens.colors;
  const { doc, error, reload, setDoc } = usePreferences();
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const prefs = doc?.preferences ?? [];
  const active = prefs.filter((p) => p.status === 'active');
  const superseded = prefs.filter((p) => p.status === 'superseded');

  const toggle = async (p: LearnedPreference) => {
    setBusy(p.id);
    setFailed(null);
    try {
      await setPreferenceDisabled(p.id, !p.disabled);
      setDoc((d) => d && { ...d, preferences: d.preferences.map((x) => (x.id === p.id ? { ...x, disabled: !p.disabled } : x)) });
      reload();
    } catch (e) {
      setFailed(String(e));
    } finally {
      setBusy(null);
    }
  };

  const card = { background: c.bgCard, border: `1px solid ${c.border}`, borderRadius: tokens.radius.lg, padding: '8px 24px' };
  return (
    <div style={{ maxWidth: '760px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <div>
        <div style={{ fontSize: '18px', fontWeight: 600, color: c.text }}>What Pulse has learned</div>
        <div style={{ fontSize: tokens.type.small, color: c.textMuted, marginTop: '6px', lineHeight: 1.5 }}>
          Every night Pulse reads what you edit before sending, what you skip or reject, and what you tell your leads, and
          writes it down as preferences. Every agent follows the ones that are on. Turning one off keeps it on file.
        </div>
      </div>
      {error && <Notice>Couldn't read preferences: {error}</Notice>}
      {failed && <Notice>Couldn't change that preference: {failed}</Notice>}
      <div style={card}>
        {active.length === 0 && <div style={{ padding: '16px 0', fontSize: tokens.type.small, color: c.textDim }}>Nothing learned yet. The first night after you edit or skip something, it shows up here.</div>}
        {active.map((p, i) => (
          <div key={p.id} style={{ display: 'flex', gap: '16px', alignItems: 'flex-start', padding: '14px 0', borderTop: i ? `1px solid ${c.border}` : 'none' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: tokens.type.body, color: p.disabled ? c.textDim : c.text, textDecoration: p.disabled ? 'line-through' : 'none', lineHeight: 1.4 }}>{p.text}</div>
              <div style={{ fontSize: tokens.type.micro, color: c.textDim, marginTop: '4px' }}>
                {p.area}{p.entity ? ` · ${p.entity}` : ''} · {evidence(p)}{p.disabled ? ' · off' : ''}
              </div>
            </div>
            <Switch on={!p.disabled} busy={busy === p.id} onChange={() => toggle(p)} label={`${p.disabled ? 'Turn on' : 'Turn off'}: ${p.text}`} />
          </div>
        ))}
      </div>
      {superseded.length > 0 && (
        <details>
          <summary style={{ fontSize: tokens.type.small, color: c.textMuted, cursor: 'pointer' }}>Replaced by a newer preference ({superseded.length})</summary>
          <div style={{ ...card, marginTop: '10px' }}>
            {superseded.map((p, i) => (
              <div key={p.id} style={{ padding: '12px 0', borderTop: i ? `1px solid ${c.border}` : 'none', fontSize: tokens.type.small, color: c.textDim }}>
                {p.text}
                <div style={{ fontSize: tokens.type.micro, marginTop: '3px' }}>{evidence(p)}</div>
              </div>
            ))}
          </div>
        </details>
      )}
      <div style={{ fontSize: tokens.type.micro, color: c.textDim, lineHeight: 1.5 }}>
        Stored in ~/portfolio/memory/preferences.json; agents read preferences.md. Lines you add to preferences.md under its "Added by" section are kept as written.
      </div>
    </div>
  );
}
