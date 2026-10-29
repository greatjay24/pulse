import { useState } from 'react';
import { useTheme } from '../contexts/ThemeContext';
import { EntityDecision } from '../types';
import { answerDecision } from '../hooks/useOrgActivity';
import { DecisionView, decisionId, needsConfirm } from '../utils/decisions';

type Action = 'approve' | 'reject' | 'discuss';

// Approve (labeled with the recommendation), Reject and Discuss for one decision. Every answer
// goes through act.py, which records it and runs the entity's lead. Money and relationship
// items ask first, because approving them starts work that touches money or someone else.
export function DecisionActions({ entityId, lead, decision, view, compact = false }: {
  entityId: string;
  lead?: string;
  decision: EntityDecision;
  view: DecisionView;
  compact?: boolean;
}) {
  const { tokens } = useTheme();
  const c = tokens.colors;
  const id = decisionId(decision);
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [sending, setSending] = useState<Action | null>(null);
  const [error, setError] = useState<string | null>(null);

  const send = async (action: Action, text?: string) => {
    setSending(action);
    setError(null);
    try {
      await answerDecision(entityId, id, action, text);
      if (action === 'discuss') {
        setNote('');
        setNoteOpen(false);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setSending(null);
      setConfirming(false);
    }
  };

  const approve = () => (needsConfirm(decision) ? setConfirming(true) : send('approve'));
  const final = view.state === 'done' || view.state === 'rejected';
  const canAnswer = view.state === 'pending';
  const canRetry = view.state === 'failed' || view.state === 'stalled';
  const label = decision.recommend ? `Approve: ${decision.recommend}` : 'Approve';
  const who = lead ?? 'The lead';

  if (final) return null;

  return (
    <div style={{ marginTop: compact ? '10px' : '16px' }}>
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
        {canAnswer && (
          <button
            className="btn btn-primary"
            onClick={approve}
            disabled={!!sending}
            title={decision.on_approve ? `On approve: ${decision.on_approve}` : label}
            style={{ maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', padding: compact ? '7px 12px' : undefined }}
          >
            {sending === 'approve' ? 'Sending…' : label}
          </button>
        )}
        {canRetry && (
          <button className="btn btn-primary" onClick={() => send('approve')} disabled={!!sending} style={{ padding: compact ? '7px 12px' : undefined }}>
            {sending === 'approve' ? 'Sending…' : `Run ${who} again`}
          </button>
        )}
        {canAnswer && (
          <button className="btn btn-secondary" onClick={() => send('reject')} disabled={!!sending} style={{ padding: compact ? '7px 12px' : undefined }}>
            {sending === 'reject' ? 'Sending…' : 'Reject'}
          </button>
        )}
        <button
          className="btn btn-secondary"
          onClick={() => setNoteOpen(!noteOpen)}
          disabled={!!sending}
          aria-expanded={noteOpen}
          style={{ padding: compact ? '7px 12px' : undefined }}
        >
          Discuss
        </button>
      </div>

      {noteOpen && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (note.trim()) send('discuss', note.trim());
          }}
          style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '10px', maxWidth: '72ch' }}
        >
          <textarea
            autoFocus
            value={note}
            maxLength={2000}
            onChange={(e) => setNote(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && note.trim()) send('discuss', note.trim());
              if (e.key === 'Escape') setNoteOpen(false);
            }}
            placeholder={`Ask ${who} a question or push back. It replies here.`}
            rows={3}
            style={{
              width: '100%',
              padding: '10px 12px',
              fontFamily: 'inherit',
              fontSize: tokens.type.small,
              lineHeight: 1.5,
              color: c.text,
              background: c.bg,
              border: `1px solid ${c.border}`,
              borderRadius: tokens.radius.sm,
              resize: 'vertical',
            }}
          />
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <button type="submit" className="btn btn-primary" disabled={!note.trim() || !!sending} style={{ padding: '7px 12px' }}>
              {sending === 'discuss' ? 'Sending…' : 'Send to lead'}
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => setNoteOpen(false)} style={{ padding: '7px 12px' }}>
              Cancel
            </button>
            <span style={{ fontSize: tokens.type.micro, color: c.textDim }}>⌘↩ to send</span>
          </div>
        </form>
      )}

      {error && (
        <div role="alert" style={{ fontSize: tokens.type.small, color: c.danger, marginTop: '8px' }}>
          Not sent: {error}
        </div>
      )}

      {confirming && (
        <ConfirmApprove
          decision={decision}
          who={who}
          sending={sending === 'approve'}
          onCancel={() => setConfirming(false)}
          onConfirm={() => send('approve')}
        />
      )}
    </div>
  );
}

function ConfirmApprove({ decision, who, sending, onCancel, onConfirm }: {
  decision: EntityDecision;
  who: string;
  sending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { tokens } = useTheme();
  const c = tokens.colors;
  const what = decision.gate === 'money' ? 'money' : 'someone outside (anything in your name)';
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Confirm approval"
      onClick={onCancel}
      onKeyDown={(e) => e.key === 'Escape' && onCancel()}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '24px' }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ width: '100%', maxWidth: '520px', background: c.bgCard, border: `1px solid ${c.border}`, borderRadius: tokens.radius.lg, padding: '24px 26px', color: c.text }}
      >
        <div style={{ fontSize: tokens.type.micro, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.09em', color: c.warning, marginBottom: '10px' }}>
          {decision.gate} gate
        </div>
        <h3 style={{ fontFamily: tokens.fonts.display, fontSize: '22px', fontWeight: 500, lineHeight: 1.3, marginBottom: '12px' }}>{decision.ask}</h3>
        {decision.recommend && (
          <p style={{ fontSize: tokens.type.body, lineHeight: 1.55, marginBottom: '10px' }}>
            <span style={{ color: c.accent, fontWeight: 600 }}>You approve </span>
            {decision.recommend}
          </p>
        )}
        {decision.on_approve && (
          <p style={{ fontSize: tokens.type.small, lineHeight: 1.55, color: c.textMuted, marginBottom: '10px' }}>
            {who} will: {decision.on_approve}
          </p>
        )}
        <p style={{ fontSize: tokens.type.small, lineHeight: 1.55, color: c.textMuted, marginBottom: '20px' }}>
          This one involves {what}. {who} starts on it now, but agents only draft: nothing is sent, paid, signed or
          merged in your name. You'll get the draft or link to send or pay yourself.
        </p>
        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
          <button className="btn btn-secondary" onClick={onCancel} autoFocus>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={onConfirm} disabled={sending}>
            {sending ? 'Sending…' : 'Approve'}
          </button>
        </div>
      </div>
    </div>
  );
}
