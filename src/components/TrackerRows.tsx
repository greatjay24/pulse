import { ReactNode } from 'react';
import { useTheme } from '../contexts/ThemeContext';
import { TrackerEmail, TrackerNote, TrackerRepo, TrackerTask, Urgency } from '../types';
import { formatIdle, formatWaiting, isGate, openExternal } from '../utils/tracker';
import { Icon } from './Icons';

function UrgencyDot({ urgency }: { urgency: Urgency | null }) {
  const { tokens } = useTheme();
  const color =
    urgency === 'now' ? tokens.colors.danger : urgency === 'soon' ? tokens.colors.warning : tokens.colors.textDim;
  return (
    <span
      title={urgency ?? 'no urgency'}
      style={{ width: 8, height: 8, borderRadius: '50%', background: color, flexShrink: 0, marginTop: '6px' }}
    />
  );
}

// A list row; when it has an http(s) link the whole row opens it in the browser.
function Row({ url, children }: { url: string | null; children: ReactNode }) {
  const { tokens } = useTheme();
  const linked = !!url && /^https?:\/\//i.test(url);
  const style = {
    display: 'flex',
    gap: '12px',
    alignItems: 'flex-start',
    width: '100%',
    padding: '12px 16px',
    textAlign: 'left' as const,
    fontFamily: 'inherit',
    color: tokens.colors.text,
    background: 'transparent',
    border: 'none',
    borderRadius: tokens.radius.sm,
    transition: 'background 0.15s ease',
  };
  if (!linked) return <div style={style}>{children}</div>;
  return (
    <button
      onClick={() => openExternal(url)}
      title={url ?? undefined}
      onMouseEnter={(e) => (e.currentTarget.style.background = tokens.colors.bgCardHover)}
      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
      style={{ ...style, cursor: 'pointer' }}
    >
      {children}
      <span style={{ marginTop: '3px', flexShrink: 0, opacity: 0.6 }}>
        <Icon name="external-link" size={12} color={tokens.colors.textDim} />
      </span>
    </button>
  );
}

export function RowList({ children }: { children: ReactNode }) {
  const { tokens } = useTheme();
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        padding: '6px',
        background: tokens.colors.bgCard,
        border: `1px solid ${tokens.colors.border}`,
        borderRadius: tokens.radius.md,
        minWidth: 0,
      }}
    >
      {children}
    </div>
  );
}

export function TaskRow({ task, now }: { task: TrackerTask; now: number }) {
  const { tokens } = useTheme();
  const gate = isGate(task);
  const waiting = task.status === 'scheduled' ? (task.show_from ? `from ${task.show_from}` : null) : formatWaiting(task.first_seen, now);
  return (
    <Row url={task.url}>
      <UrgencyDot urgency={task.urgency} />
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'flex', gap: '8px', alignItems: 'baseline', flexWrap: 'wrap' }}>
          {gate && (
            <span
              style={{
                fontSize: '11px',
                fontWeight: 600,
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
                padding: '1px 7px',
                borderRadius: '20px',
                background: tokens.colors.accentGlow,
                color: tokens.colors.accent,
              }}
            >
              Gate
            </span>
          )}
          <span style={{ fontSize: '15px', fontWeight: gate ? 600 : 500, lineHeight: 1.45 }}>{task.title}</span>
        </span>
        {task.detail && (
          <span
            title={task.detail}
            style={{
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
              fontSize: '13px',
              lineHeight: 1.55,
              color: tokens.colors.textMuted,
              marginTop: '3px',
              maxWidth: '90ch',
            }}
          >
            {task.detail}
          </span>
        )}
      </span>
      {waiting && (
        <span style={{ fontSize: '12px', color: tokens.colors.textDim, whiteSpace: 'nowrap', marginTop: '3px' }}>{waiting}</span>
      )}
    </Row>
  );
}

export function ReplyRow({ email }: { email: TrackerEmail }) {
  const { tokens } = useTheme();
  const from = email.name && email.sender ? `${email.name} <${email.sender}>` : email.name || email.sender || 'Unknown sender';
  const age = email.age_days === null ? null : email.age_days < 1 ? 'today' : `${Math.floor(email.age_days)}d`;
  return (
    <Row url={email.url}>
      <UrgencyDot urgency={email.urgency} />
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: '15px', fontWeight: 500, lineHeight: 1.45 }}>{email.subject || '(no subject)'}</span>
        <span style={{ display: 'block', fontSize: '13px', color: tokens.colors.textMuted, marginTop: '3px' }}>
          {from}
          {email.account_label && <span style={{ color: tokens.colors.textDim }}> · {email.account_label}</span>}
        </span>
      </span>
      {age && <span style={{ fontSize: '12px', color: tokens.colors.textDim, whiteSpace: 'nowrap', marginTop: '3px' }}>{age}</span>}
    </Row>
  );
}

export function RepoRow({ repo, note }: { repo: TrackerRepo; note: TrackerNote | null }) {
  const { tokens } = useTheme();
  const dirty = repo.dirty_count ?? 0;
  return (
    <div style={{ display: 'flex', gap: '16px', alignItems: 'baseline', padding: '12px 16px', flexWrap: 'wrap' }}>
      <span style={{ flex: '1 1 220px', minWidth: 0 }}>
        <span style={{ fontSize: '15px', fontWeight: 500 }}>{repo.name}</span>
        {note?.next && (
          <span style={{ display: 'block', fontSize: '12px', color: tokens.colors.textMuted, marginTop: '2px', lineHeight: 1.5 }}>
            <span style={{ color: tokens.colors.textDim }}>Next </span>
            {note.next}
          </span>
        )}
      </span>
      {!repo.exists ? (
        <span style={{ fontSize: '12px', color: tokens.colors.warning }}>folder missing</span>
      ) : !repo.is_git ? (
        <span style={{ fontSize: '12px', color: tokens.colors.textDim }}>not a git repo</span>
      ) : (
        <>
          <span style={{ fontFamily: tokens.fonts.mono, fontSize: '12px', color: tokens.colors.textMuted }}>{repo.branch ?? '?'}</span>
          <span style={{ fontSize: '12px', color: dirty > 0 ? tokens.colors.warning : tokens.colors.textDim, minWidth: '96px' }}>
            {dirty > 0 ? `${dirty} uncommitted` : 'clean'}
          </span>
        </>
      )}
      <span style={{ fontSize: '12px', color: tokens.colors.textDim, minWidth: '72px', textAlign: 'right' }}>{formatIdle(repo.days_idle)}</span>
    </div>
  );
}
