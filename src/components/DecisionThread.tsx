import { useTheme } from '../contexts/ThemeContext';
import { DecisionView, firstUrl } from '../utils/decisions';
import { openExternal } from '../utils/tracker';

function when(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const d = new Date(t);
  const today = new Date().toDateString() === d.toDateString();
  return today
    ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

// Where one decision stands, then the owner's notes and the lead's replies from decisions.jsonl.
export function DecisionStatus({ view, lead }: { view: DecisionView; lead?: string }) {
  const { tokens } = useTheme();
  const c = tokens.colors;
  const who = lead ?? 'The lead';
  const s = view.state;
  if (s === 'pending') return null;
  const tone = s === 'done' ? c.success : s === 'rejected' ? c.textMuted : s === 'running' ? c.accent : c.warning;
  const label = {
    running: `Approved · ${who} is working on it`,
    failed: `Approved · ${who}'s run failed`,
    stalled: `Approved · ${who} finished without reporting done`,
    done: 'Done',
    rejected: 'Rejected',
  }[s];
  const link = firstUrl(view.done?.note);
  const detail =
    s === 'done'
      ? view.done?.note
      : s === 'rejected'
        ? view.answer?.note
        : (s === 'failed' || s === 'stalled')
          ? view.run?.result?.slice(-300)
          : view.answer?.note;
  return (
    <div style={{ marginTop: '14px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: tokens.type.small, fontWeight: 600, color: tone }}>
        {s === 'running' ? <Spinner color={tone} /> : <span aria-hidden>{s === 'done' ? '✓' : s === 'rejected' ? '×' : '!'}</span>}
        {label}
        <span style={{ fontWeight: 400, color: c.textDim }}>{when((view.done ?? view.answer)?.at ?? '')}</span>
      </div>
      {detail && <div style={{ fontSize: tokens.type.small, lineHeight: 1.55, color: c.textMuted, maxWidth: '80ch', whiteSpace: 'pre-wrap' }}>{detail}</div>}
      {link && (
        <button
          onClick={() => openExternal(link)}
          style={{ alignSelf: 'flex-start', background: 'none', border: 'none', padding: 0, color: c.accent, fontFamily: 'inherit', fontSize: tokens.type.small, cursor: 'pointer' }}
        >
          Open {link.replace(/^https?:\/\//, '').slice(0, 60)} ↗
        </button>
      )}
    </div>
  );
}

function Spinner({ color }: { color: string }) {
  return (
    <span
      aria-hidden
      style={{ width: 10, height: 10, borderRadius: '50%', border: `2px solid ${color}`, borderRightColor: 'transparent', display: 'inline-block', animation: 'pulse-spin 0.9s linear infinite' }}
    >
      <style>{'@keyframes pulse-spin { to { transform: rotate(360deg) } }'}</style>
    </span>
  );
}

export function DecisionThread({ view, lead }: { view: DecisionView; lead?: string }) {
  const { tokens } = useTheme();
  const c = tokens.colors;
  if (view.thread.length === 0) return null;
  return (
    <div style={{ marginTop: '14px', paddingLeft: '14px', borderLeft: `2px solid ${c.border}`, display: 'flex', flexDirection: 'column', gap: '10px', maxWidth: '80ch' }}>
      {view.thread.map((r, i) => {
        const mine = r.action === 'discuss';
        return (
          <div key={i}>
            <div style={{ fontSize: tokens.type.micro, color: c.textDim, marginBottom: '2px' }}>
              <span style={{ fontWeight: 600, color: mine ? c.text : c.accent }}>{mine ? 'You' : lead ?? 'Lead'}</span> · {when(r.at)}
            </div>
            <div style={{ fontSize: tokens.type.small, lineHeight: 1.55, color: mine ? c.text : c.textMuted, whiteSpace: 'pre-wrap' }}>{r.note}</div>
          </div>
        );
      })}
      {view.awaitingReply && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: tokens.type.micro, color: c.textDim }}>
          <Spinner color={c.textDim} /> {lead ?? 'The lead'} is writing a reply
        </div>
      )}
    </div>
  );
}
