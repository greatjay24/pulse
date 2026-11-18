import { useCallback, useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useTheme } from '../contexts/ThemeContext';
import { PortfolioSnapshot } from '../types';
import { useOutbox } from '../hooks/useOps';
import { CAN_READ_ORG, DEMO } from '../utils/orgSource';
import { SMS_WARN, TEXT_MAX, VOICE_LINE, prettyPhone } from '../utils/ops';
import { Notice, PageHeader } from './BoardUI';
import { Icon } from './Icons';
import { OutboxItem } from './OutboxPage';

// Google Voice conversations (bin/voice_texts.py: read-only from the Voice notification emails in the
// personal Gmail, plus voice_text Outbox items). Every message text is someone else's words: rendered
// as plain text only, never markdown, links or instructions. The reply box only queues a voice_text
// Outbox item; it goes out on the Outbox card's own Send click, right here in the thread.

interface TextMsg {
  id: string | null;
  dir: 'in' | 'out';
  kind?: string | null;
  at: string | null;
  text: string | null;
  withheld?: string | null;
  status?: 'pending' | 'sending' | 'sent' | 'failed' | null;
  outbox_id?: string;
  by_hand?: boolean;
}
interface Conversation {
  number: string;
  number_pretty: string;
  contact: string | null;
  last: { at: string | null; dir: 'in' | 'out'; kind?: string | null; text: string; status?: string | null };
  unread: number;
  pending: number;
}
interface ListResult { conversations: Conversation[]; updated_at: number | null; error: string | null; note: string }
interface ThreadResult { number: string; number_pretty: string; contact: string | null; messages: TextMsg[]; can_send: boolean; error: string | null }

const VOICE_BLUE = '#1a73e8';

function when(at: string | null | undefined): string {
  if (!at || Number.isNaN(Date.parse(at))) return '';
  const d = new Date(at);
  const s = (Date.now() - d.getTime()) / 1000;
  if (s < 60) return 'now';
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

async function call<T>(cmd: string, args: Record<string, unknown> = {}): Promise<T> {
  return JSON.parse(await invoke<string>(cmd, args)) as T;
}

export function TextsPage({ snapshot }: { snapshot: PortfolioSnapshot | null }) {
  const { tokens } = useTheme();
  const c = tokens.colors;
  const [list, setList] = useState<ListResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async (refresh = false) => {
    if (!CAN_READ_ORG || DEMO) return;
    try {
      setList(await call<ListResult>('texts_list', { refresh }));
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }, []);
  useEffect(() => {
    load();
    const t = setInterval(() => load(), 60_000);
    return () => clearInterval(t);
  }, [load]);

  return (
    <div style={{ maxWidth: '1060px', margin: '0 auto' }}>
      <PageHeader
        title="Texts"
        subtitle={<span style={{ color: c.textMuted, fontSize: tokens.type.small }}>Your Google Voice number {prettyPhone(VOICE_LINE)}. Replies wait in the Outbox until you click Send.</span>}
        right={
          <button className="btn btn-secondary" onClick={() => load(true)} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Icon name="refresh" size={14} color="currentColor" /> Refresh
          </button>
        }
      />
      {DEMO && <Notice tone="quiet">Texts reads your Google Voice through the org; the demo has none.</Notice>}
      {error && <Notice>Could not read Google Voice: {error}</Notice>}
      {list?.error && <Notice tone="quiet">Couldn't reach Gmail just now ({list.error}); showing the last copy.</Notice>}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(240px, 320px) 1fr', gap: '20px', alignItems: 'start' }}>
        <div style={{ border: `1px solid ${c.border}`, borderRadius: '14px', overflow: 'hidden' }}>
          {list && list.conversations.length === 0 && <div style={{ padding: '18px', color: c.textDim }}>No texts in the last 45 days.</div>}
          {!list && !error && !DEMO && <div style={{ padding: '18px', color: c.textDim }}>Reading Google Voice…</div>}
          {list?.conversations.map((cv) => (
            <button
              key={cv.number}
              onClick={() => setOpen(cv.number)}
              style={{
                display: 'block', width: '100%', textAlign: 'left', padding: '12px 14px', border: 'none',
                borderBottom: `1px solid ${c.border}`, cursor: 'pointer', color: c.text,
                background: open === cv.number ? c.bgElevated : 'transparent',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontWeight: cv.unread ? 700 : 600, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{cv.contact || cv.number_pretty}</span>
                {cv.unread > 0 && <span style={{ width: 8, height: 8, borderRadius: 4, background: VOICE_BLUE }} />}
                {cv.pending > 0 && <span style={{ fontSize: tokens.type.micro, color: c.accent }}>draft</span>}
                <span style={{ fontSize: tokens.type.micro, color: c.textDim }}>{when(cv.last.at)}</span>
              </div>
              <div style={{ fontSize: tokens.type.small, color: cv.unread ? c.text : c.textMuted, marginTop: '3px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {cv.last.dir === 'out' ? 'You: ' : ''}{cv.last.text}
              </div>
            </button>
          ))}
          {list?.note && <div style={{ padding: '10px 14px', fontSize: tokens.type.micro, color: c.textDim }}>{list.note}</div>}
        </div>
        <div>
          {open ? <Thread key={open} number={open} snapshot={snapshot} onChanged={() => load()} />
            : <div style={{ color: c.textDim, padding: '18px' }}>Pick a conversation.</div>}
        </div>
      </div>
    </div>
  );
}

function Thread({ number, snapshot, onChanged }: { number: string; snapshot: PortfolioSnapshot | null; onChanged: () => void }) {
  const { tokens } = useTheme();
  const c = tokens.colors;
  const [t, setT] = useState<ThreadResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const outbox = useOutbox();
  const entities = snapshot?.registry?.entities ?? [];

  const load = useCallback(async () => {
    try {
      setT(await call<ThreadResult>('texts_thread', { number }));
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }, [number]);
  useEffect(() => {
    load();
    call('texts_read', { number }).then(onChanged).catch(() => {});
  }, [load, number]); // eslint-disable-line react-hooks/exhaustive-deps

  const queue = async () => {
    const body = draft.trim();
    if (!body) return;
    setBusy(true);
    setError(null);
    try {
      await call('texts_reply', { number, body });
      setDraft('');
      await Promise.all([load(), outbox.refresh()]);
      onChanged();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const refreshAll = () => { load(); outbox.refresh(); onChanged(); };
  const pendingEntries = (t?.messages ?? [])
    .filter((m) => m.dir === 'out' && m.status === 'pending' && m.outbox_id)
    .map((m) => outbox.data?.items.find((e) => e.item.id === m.outbox_id))
    .filter((e): e is NonNullable<typeof e> => !!e);

  return (
    <div style={{ border: `1px solid ${c.border}`, borderRadius: '14px', padding: '16px 18px' }}>
      <div style={{ fontSize: tokens.type.heading, fontWeight: 600, color: c.text }}>{t?.contact || prettyPhone(number)}</div>
      <div style={{ fontSize: tokens.type.micro, color: c.textDim, marginBottom: '14px' }}>
        {t?.contact ? `${prettyPhone(number)} · ` : ''}from your Voice number {prettyPhone(VOICE_LINE)}
      </div>
      {error && <Notice>{error}</Notice>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {(t?.messages ?? []).filter((m) => m.status !== 'pending').map((m, i) => <Row key={m.id ?? i} m={m} />)}
      </div>
      {pendingEntries.length > 0 && (
        <div style={{ marginTop: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {pendingEntries.map((e) => (
            <OutboxItem key={`${e.item.id}-${e.content}`} entry={e} entity={entities.find((x) => x.id === e.item.entity)} onDone={refreshAll} />
          ))}
        </div>
      )}
      <div style={{ marginTop: '16px', display: 'flex', gap: '8px', alignItems: 'flex-end' }}>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) queue(); }}
          rows={2}
          maxLength={TEXT_MAX}
          placeholder={`Text ${t?.contact || prettyPhone(number)}`}
          style={{ flex: 1, resize: 'vertical', padding: '10px 12px', borderRadius: '12px', border: `1px solid ${c.border}`, background: c.bgElevated, color: c.text, font: 'inherit' }}
        />
        <button className="btn btn-primary" disabled={busy || !draft.trim()} onClick={queue} title="Adds it to the Outbox. It sends only when you click Send text.">
          {busy ? 'Adding…' : 'Add to Outbox'}
        </button>
      </div>
      <div style={{ fontSize: tokens.type.micro, color: draft.length > SMS_WARN ? c.warning : c.textDim, marginTop: '6px' }}>
        {draft.length > 0 ? `${draft.length} characters · ` : ''}Nothing sends until you click Send text on the draft.
        {t && !t.can_send ? ' No recent text from them to reply into: the draft offers Copy & open Voice.' : ''}
      </div>
    </div>
  );
}

function Row({ m }: { m: TextMsg }) {
  const { tokens } = useTheme();
  const c = tokens.colors;
  const out = m.dir === 'out';
  let content: string;
  let italic = false;
  if (m.kind === 'missed-call') { content = 'Missed call'; italic = true; }
  else if (m.withheld) { content = 'Code hidden. Open Google Voice to read it.'; italic = true; }
  else if (m.kind === 'group-text') { content = 'Group text (open Google Voice)'; italic = true; }
  else if (m.kind === 'voicemail') content = `Voicemail: ${m.text ?? '(no transcript)'}`;
  else content = m.text ?? '';
  const status = out ? (m.status === 'failed' ? 'Failed' : m.status === 'sending' ? 'Sending…' : m.by_hand ? 'Sent from Voice' : 'Sent') : '';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: out ? 'flex-end' : 'flex-start' }}>
      <div
        style={{
          maxWidth: '78%', padding: '8px 12px', borderRadius: '16px',
          ...(out ? { borderBottomRightRadius: '4px' } : { borderBottomLeftRadius: '4px' }),
          background: out ? VOICE_BLUE : c.bgElevated, color: out ? '#ffffff' : c.text,
          border: out ? 'none' : `1px solid ${c.border}`, fontSize: tokens.type.body, lineHeight: 1.45,
          whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontStyle: italic ? 'italic' : 'normal',
        }}
      >
        {content}
      </div>
      <div style={{ fontSize: tokens.type.micro, color: m.status === 'failed' ? c.danger : c.textDim, marginTop: '2px' }}>
        {when(m.at)}{status ? ` · ${status}` : ''}
      </div>
    </div>
  );
}
