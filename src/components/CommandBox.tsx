import { useEffect, useMemo, useRef, useState } from 'react';
import { useTheme } from '../contexts/ThemeContext';
import { PortfolioEntity } from '../types';
import { ORG_TARGET, askLead, leadOf, recentCommands, rememberCommand, routeOf, suggestions } from '../utils/command';
import { Icon } from './Icons';

// ⌘K: the owner types what they need; it goes to the right lead (from a "Name:" prefix or a
// mention, or the chief of staff), a run starts at once and its conversation opens live.
export function CommandBox({
  entities,
  chief,
  onClose,
  onStarted,
}: {
  entities: PortfolioEntity[];
  chief: string | null;
  onClose: () => void;
  onStarted: (runId: string) => void;
}) {
  const { tokens } = useTheme();
  const c = tokens.colors;
  const [text, setText] = useState('');
  const [override, setOverride] = useState<string | null>(null);
  const [fresh, setFresh] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const leads = entities.filter((e) => e.lead);
  const route = useMemo(() => routeOf(text, entities), [text, entities]);
  const target = override ?? route.target;
  const recent = useMemo(() => recentCommands(), []);
  const ideas = useMemo(() => suggestions(entities), [entities]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const send = async () => {
    const message = override ? text.trim() : route.message.trim();
    if (!message || sending) return;
    setSending(true);
    setError(null);
    try {
      const r = await askLead(target, message, { fresh });
      rememberCommand(text.trim(), target);
      onStarted(r.run_id);
      onClose();
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
      setSending(false);
    }
  };

  const pick = (value: string) => {
    setText(value);
    setOverride(null);
    inputRef.current?.focus();
  };

  const routedBy = override ? 'chosen' : route.why === 'prefix' ? 'from the prefix' : route.why === 'mention' ? 'mentioned' : 'cross-cutting or unclear';

  return (
    <div
      role="dialog"
      aria-modal
      aria-label="Ask a lead"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          onClose();
        }
      }}
      style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.42)', display: 'flex', justifyContent: 'center', alignItems: 'flex-start', paddingTop: '14vh' }}
    >
      <div
        style={{
          width: 'min(680px, calc(100vw - 32px))',
          background: c.bgElevated,
          border: `1px solid ${c.borderHover}`,
          borderRadius: tokens.radius.lg,
          boxShadow: '0 24px 60px rgba(0,0,0,0.35)',
          overflow: 'hidden',
          fontFamily: tokens.fonts.sans,
          color: c.text,
        }}
      >
        <div style={{ display: 'flex', gap: '12px', padding: '16px 18px 10px', alignItems: 'flex-start' }}>
          <span style={{ paddingTop: '3px' }}>
            <Icon name="command" size={16} color={c.textDim} />
          </span>
          <textarea
            ref={inputRef}
            value={text}
            rows={Math.min(6, Math.max(1, text.split('\n').length))}
            placeholder="Ask a lead anything. Start with a name to route it: “Acme: draft the pricing page”"
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                send();
              }
            }}
            style={{ flex: 1, resize: 'none', background: 'transparent', border: 'none', outline: 'none', padding: 0, color: c.text, fontFamily: 'inherit', fontSize: '16px', lineHeight: 1.5 }}
          />
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 18px 12px', flexWrap: 'wrap', fontSize: tokens.type.small, color: c.textMuted }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            To
            <select
              value={target}
              onChange={(e) => setOverride(e.target.value)}
              style={{ background: c.bgCard, color: c.text, border: `1px solid ${c.border}`, borderRadius: tokens.radius.sm, padding: '4px 8px', fontFamily: 'inherit', fontSize: 'inherit' }}
            >
              <option value={ORG_TARGET}>Chief of staff ({chief ?? 'chief-of-staff'})</option>
              {leads.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name} ({e.lead})
                </option>
              ))}
            </select>
          </label>
          <span style={{ color: c.textDim }}>{routedBy}</span>
          <label style={{ display: 'flex', alignItems: 'center', gap: '6px', marginLeft: 'auto', cursor: 'pointer' }}>
            <input type="checkbox" checked={fresh} onChange={(e) => setFresh(e.target.checked)} />
            New conversation
          </label>
          <button
            onClick={send}
            disabled={sending || !text.trim()}
            style={{
              background: c.accent,
              color: c.accentInk,
              border: 'none',
              borderRadius: tokens.radius.sm,
              padding: '6px 14px',
              fontFamily: 'inherit',
              fontSize: tokens.type.small,
              fontWeight: 600,
              cursor: sending || !text.trim() ? 'default' : 'pointer',
              opacity: sending || !text.trim() ? 0.5 : 1,
            }}
          >
            {sending ? 'Starting…' : `Send to ${leadOf(target, entities, chief)}`}
          </button>
        </div>
        {error && <div style={{ padding: '0 18px 12px', fontSize: tokens.type.small, color: c.danger }}>{error}</div>}

        {!text.trim() && (
          <div style={{ borderTop: `1px solid ${c.border}`, padding: '10px 8px 12px', maxHeight: '40vh', overflowY: 'auto' }}>
            {recent.length > 0 && <ListLabel>Recent</ListLabel>}
            {recent.map((r) => (
              <Choice key={`r-${r.at}`} onClick={() => pick(r.text)} hint={leadOf(r.target, entities, chief)}>
                {r.text}
              </Choice>
            ))}
            <ListLabel>Try</ListLabel>
            {ideas.map((s) => (
              <Choice key={s} onClick={() => pick(s)}>
                {s}
              </Choice>
            ))}
          </div>
        )}

        <div style={{ borderTop: `1px solid ${c.border}`, padding: '8px 18px', fontSize: tokens.type.micro, color: c.textDim, display: 'flex', gap: '14px' }}>
          <span>Enter sends</span>
          <span>Shift+Enter new line</span>
          <span>Esc closes</span>
          <span style={{ marginLeft: 'auto' }}>Runs on your Claude sign-in, under the org's guardrails</span>
        </div>
      </div>
    </div>
  );
}

function ListLabel({ children }: { children: React.ReactNode }) {
  const { tokens } = useTheme();
  return (
    <div style={{ fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: tokens.colors.textDim, padding: '8px 10px 4px' }}>
      {children}
    </div>
  );
}

function Choice({ children, hint, onClick }: { children: React.ReactNode; hint?: string; onClick: () => void }) {
  const { tokens } = useTheme();
  const c = tokens.colors;
  return (
    <button
      onClick={onClick}
      onMouseEnter={(e) => (e.currentTarget.style.background = c.bgCardHover)}
      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
      style={{ display: 'flex', width: '100%', gap: '10px', alignItems: 'baseline', padding: '7px 10px', background: 'transparent', border: 'none', borderRadius: tokens.radius.sm, color: c.text, fontFamily: 'inherit', fontSize: '14px', textAlign: 'left', cursor: 'pointer' }}
    >
      <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{children}</span>
      {hint && <span style={{ fontSize: tokens.type.micro, color: c.textDim }}>{hint}</span>}
    </button>
  );
}
