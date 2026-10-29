import { useEffect, useRef, useState } from 'react';
import { useTheme } from '../contexts/ThemeContext';
import { LiveRun } from '../types';
import { askLead, stopRun } from '../utils/command';
import { LiveDot } from './WorkingNow';

// The box under a conversation. A message continues the latest conversation with this lead
// (ask.py resumes its Claude session) unless "New conversation" is on. While the lead is
// replying, Enter queues the message (it goes once the reply ends); "Stop and send" ends the
// reply first.
export function Composer({
  target,
  lead,
  replying,
  queued,
  onSent,
}: {
  target: string;
  lead: string;
  replying: LiveRun | null; // this lead's chat run in progress
  queued: number; // messages waiting behind it
  onSent: (runId: string) => void;
}) {
  const { tokens } = useTheme();
  const c = tokens.colors;
  const [text, setText] = useState('');
  const [fresh, setFresh] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setText('');
    setFresh(false);
    setError(null);
  }, [target]);

  const send = async (stopFirst: boolean) => {
    const message = text.trim();
    if (!message || busy) return;
    setBusy(true);
    setError(null);
    try {
      if (stopFirst && replying) await stopRun(replying.run_id);
      const r = await askLead(target, message, { fresh });
      setText('');
      setFresh(false);
      onSent(r.run_id);
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
      ref.current?.focus();
    }
  };

  const stop = async () => {
    if (!replying) return;
    setError(null);
    try {
      await stopRun(replying.run_id);
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    }
  };

  const linkButton = { background: 'none', border: 'none', padding: 0, fontFamily: 'inherit', fontSize: tokens.type.small, cursor: 'pointer' } as const;

  return (
    <div style={{ position: 'sticky', bottom: '-36px', paddingBottom: '20px', paddingTop: '8px', background: c.bg }}>
      {replying && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: tokens.type.small, color: c.accent, marginBottom: '8px' }}>
          <LiveDot color={c.accent} pulsing />
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {lead} is replying: {replying.step}
            {queued > 0 && <span style={{ color: c.textDim }}> · {queued} queued</span>}
          </span>
          <button onClick={stop} style={{ ...linkButton, marginLeft: 'auto', color: c.danger }}>
            Stop
          </button>
        </div>
      )}
      <div style={{ border: `1px solid ${c.borderHover}`, borderRadius: tokens.radius.md, background: c.bgCard, padding: '10px 12px' }}>
        <textarea
          ref={ref}
          value={text}
          rows={Math.min(8, Math.max(2, text.split('\n').length))}
          placeholder={fresh ? `Start a new conversation with ${lead}` : `Message ${lead}`}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              send(false);
            } else if (e.key === 'Escape') {
              ref.current?.blur();
            }
          }}
          style={{ width: '100%', resize: 'none', background: 'transparent', border: 'none', outline: 'none', padding: 0, color: c.text, fontFamily: 'inherit', fontSize: '14px', lineHeight: 1.55 }}
        />
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px', fontSize: tokens.type.micro, color: c.textDim }}>
          <button onClick={() => setFresh(!fresh)} aria-pressed={fresh} style={{ ...linkButton, fontSize: tokens.type.micro, color: fresh ? c.accent : c.textDim }}>
            {fresh ? '● New conversation' : 'Continues the last conversation · start new'}
          </button>
          <span style={{ marginLeft: 'auto' }}>{replying ? 'Enter queues' : 'Enter sends'} · Shift+Enter new line</span>
          {replying && (
            <button onClick={() => send(true)} disabled={busy || !text.trim()} style={{ ...linkButton, fontSize: tokens.type.micro, color: c.accent, opacity: busy || !text.trim() ? 0.5 : 1 }}>
              Stop and send
            </button>
          )}
          <button
            onClick={() => send(false)}
            disabled={busy || !text.trim()}
            style={{ background: c.accent, color: c.accentInk, border: 'none', borderRadius: tokens.radius.sm, padding: '5px 12px', fontFamily: 'inherit', fontSize: tokens.type.small, fontWeight: 600, cursor: 'pointer', opacity: busy || !text.trim() ? 0.5 : 1 }}
          >
            {busy ? 'Sending…' : replying ? 'Queue' : 'Send'}
          </button>
        </div>
      </div>
      {error && <div style={{ marginTop: '6px', fontSize: tokens.type.small, color: c.danger }}>{error}</div>}
    </div>
  );
}
