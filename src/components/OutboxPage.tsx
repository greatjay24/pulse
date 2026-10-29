import { useState } from 'react';
import { useTheme } from '../contexts/ThemeContext';
import { PortfolioEntity, PortfolioSnapshot } from '../types';
import { OutboxEntry } from '../types/ops';
import { editOutbox, sendOutbox, skipOutbox, useOutbox } from '../hooks/useOps';
import { splitAddresses } from '../utils/ops';
import { showToast } from '../utils/toast';
import { Card, Notice, PageHeader, SectionHeading, SectionLabel } from './BoardUI';
import { Icon } from './Icons';

const RECENT_SHOWN = 15;

function ago(at: string | null | undefined, now: number): string {
  const t = at ? Date.parse(at) : NaN;
  if (Number.isNaN(t)) return '';
  const mins = Math.max(0, Math.round((now - t) / 60_000));
  if (mins < 60) return `${mins}m ago`;
  if (mins < 48 * 60) return `${Math.round(mins / 60)}h ago`;
  return `${Math.round(mins / 1440)}d ago`;
}

// One message an agent wrote: who it's from and to, why, and the body. Send / Edit / Skip.
function OutboxItem({ entry, entity, onDone }: { entry: OutboxEntry; entity?: PortfolioEntity; onDone: () => void }) {
  const { tokens } = useTheme();
  const c = tokens.colors;
  const m = entry.item;
  const [editing, setEditing] = useState(false);
  const [to, setTo] = useState(m.to.join(', '));
  const [cc, setCc] = useState(m.cc.join(', '));
  const [subject, setSubject] = useState(m.subject);
  const [body, setBody] = useState(m.body);
  const [busy, setBusy] = useState<'send' | 'save' | 'skip' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const now = Date.now();

  const run = async (what: 'send' | 'save' | 'skip', fn: () => Promise<unknown>) => {
    setBusy(what);
    setError(null);
    try {
      await fn();
      if (what === 'save') setEditing(false);
      onDone();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  };

  const send = () =>
    run('send', async () => {
      const res = await sendOutbox(m.id, entry.content);
      if (res.warning) showToast(res.warning);
      else if (res.ok) showToast(`Sent to ${m.to.join(', ')}`);
    });

  const save = () =>
    run('save', () => editOutbox(m.id, { to: splitAddresses(to), cc: splitAddresses(cc), subject, body }));

  const field = { width: '100%', padding: '8px 10px', fontSize: tokens.type.small } as const;
  const meta = { fontSize: tokens.type.small, color: c.textMuted, lineHeight: 1.6 } as const;

  return (
    <Card>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '10px', flexWrap: 'wrap' }}>
        <SectionLabel style={{ marginBottom: 0 }}>{entity?.name ?? m.entity}</SectionLabel>
        <span style={{ fontSize: tokens.type.micro, color: c.textDim }}>
          by {m.created_by} · {ago(m.created_at, now)}
          {m.edited_at && ' · edited'}
          {m.draft && (m.draft.saved ? ' · also in Gmail Drafts' : ' · Gmail draft not saved')}
        </span>
      </div>

      <div style={{ margin: '12px 0', padding: '10px 14px', borderLeft: `3px solid ${c.accent}`, background: c.bgElevated, borderRadius: tokens.radius.sm, fontSize: tokens.type.small, lineHeight: 1.5 }}>
        <span style={{ fontWeight: 600 }}>Why: </span>
        {m.why}
      </div>

      {editing ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <label style={meta}>To <input value={to} onChange={(e) => setTo(e.target.value)} style={field} /></label>
          <label style={meta}>Cc <input value={cc} onChange={(e) => setCc(e.target.value)} style={field} placeholder="none" /></label>
          <label style={meta}>Subject <input value={subject} onChange={(e) => setSubject(e.target.value)} style={field} /></label>
          <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={Math.min(18, Math.max(6, body.split('\n').length + 1))} style={{ ...field, fontFamily: 'inherit', lineHeight: 1.55, resize: 'vertical' }} />
        </div>
      ) : (
        <>
          <div style={meta}>
            <div><span style={{ color: c.textDim }}>From</span> {m.account} mailbox</div>
            <div><span style={{ color: c.textDim }}>To</span> {m.to.join(', ')}</div>
            {m.cc.length > 0 && <div><span style={{ color: c.textDim }}>Cc</span> {m.cc.join(', ')}</div>}
            {m.in_reply_to && <div style={{ color: c.textDim }}>Reply in the existing thread</div>}
          </div>
          <div style={{ fontSize: '17px', fontWeight: 600, margin: '12px 0 8px' }}>{m.subject}</div>
          <div style={{ whiteSpace: 'pre-wrap', fontSize: tokens.type.body, lineHeight: 1.6, color: c.text, maxHeight: '320px', overflow: 'auto' }}>{m.body}</div>
        </>
      )}

      {error && <div style={{ marginTop: '12px', fontSize: tokens.type.small, color: c.danger }}>{error}</div>}

      <div style={{ display: 'flex', gap: '8px', marginTop: '16px', flexWrap: 'wrap' }}>
        {editing ? (
          <>
            <button className="btn btn-primary" disabled={!!busy} onClick={save}>{busy === 'save' ? 'Saving…' : 'Save'}</button>
            <button
              className="btn btn-secondary"
              disabled={!!busy}
              onClick={() => {
                setEditing(false);
                setTo(m.to.join(', '));
                setCc(m.cc.join(', '));
                setSubject(m.subject);
                setBody(m.body);
              }}
            >
              Cancel
            </button>
          </>
        ) : (
          <>
            <button className="btn btn-primary" disabled={!!busy} onClick={send} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Icon name="mail" size={14} color="currentColor" /> {busy === 'send' ? 'Sending…' : 'Send'}
            </button>
            <button className="btn btn-secondary" disabled={!!busy} onClick={() => setEditing(true)}>Edit</button>
            <button className="btn btn-secondary" disabled={!!busy} onClick={() => run('skip', () => skipOutbox(m.id))}>
              {busy === 'skip' ? 'Skipping…' : 'Skip'}
            </button>
          </>
        )}
      </div>
    </Card>
  );
}

function RecentRow({ entry, entity }: { entry: OutboxEntry; entity?: PortfolioEntity }) {
  const { tokens } = useTheme();
  const c = tokens.colors;
  const m = entry.item;
  const tone = m.status === 'sent' ? c.success : m.status === 'skipped' ? c.textDim : c.danger;
  const when = m.sent_at ?? m.skipped_at ?? m.created_at;
  return (
    <li style={{ display: 'flex', gap: '10px', fontSize: tokens.type.small, lineHeight: 1.5, padding: '8px 0', borderBottom: `1px solid ${c.border}` }}>
      <span style={{ color: tone, fontWeight: 600, width: '64px', flexShrink: 0 }}>{m.status}</span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ fontWeight: 600 }}>{m.subject}</span>
        <span style={{ color: c.textMuted }}> · {m.to.join(', ')} · {entity?.name ?? m.entity}</span>
        {m.error && <div style={{ color: c.danger }}>{m.error}{m.status === 'sending' || m.status === 'failed' ? ' Check Sent in Gmail before trying again.' : ''}</div>}
      </span>
      <span style={{ color: c.textDim, flexShrink: 0 }}>{when ? new Date(when).toLocaleDateString([], { month: 'short', day: 'numeric' }) : ''}</span>
    </li>
  );
}

// Messages agents drafted for the owner. Nothing leaves without a click on Send here.
export function OutboxPage({ snapshot }: { snapshot: PortfolioSnapshot | null }) {
  const { tokens } = useTheme();
  const { data, error, refresh } = useOutbox();
  const entities = snapshot?.registry?.entities ?? [];
  const byId = (id: string) => entities.find((e) => e.id === id);
  const pending = (data?.items ?? []).filter((e) => e.item.status === 'pending');
  const recent = (data?.items ?? []).filter((e) => e.item.status !== 'pending').slice(0, RECENT_SHOWN);

  return (
    <div style={{ maxWidth: '860px', margin: '0 auto' }}>
      <PageHeader
        title="Outbox"
        subtitle={<span style={{ color: tokens.colors.textMuted, fontSize: tokens.type.small }}>Agents write; you send. Nothing goes out without your click.</span>}
        right={
          <button className="btn btn-secondary" onClick={refresh} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Icon name="refresh" size={14} color="currentColor" /> Refresh
          </button>
        }
      />
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '16px' }}>
        {error && <Notice>Could not read the Outbox: {error}</Notice>}
        {data?.errors.map((e) => <Notice key={e} tone="quiet">{e}</Notice>)}
        {!data && !error && <Notice tone="quiet">Reading ~/portfolio/outbox…</Notice>}
      </div>

      <section style={{ marginBottom: '48px' }}>
        <SectionHeading note={pending.length ? 'newest first' : undefined}>Ready to send</SectionHeading>
        {data && pending.length === 0 && <div style={{ color: tokens.colors.textDim, fontSize: tokens.type.body }}>Nothing waiting. Agents add messages here when something needs to go out in your name.</div>}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {pending.map((e) => <OutboxItem key={`${e.item.id}-${e.content}`} entry={e} entity={byId(e.item.entity)} onDone={refresh} />)}
        </div>
      </section>

      {recent.length > 0 && (
        <section>
          <SectionHeading>Recent</SectionHeading>
          <ul style={{ listStyle: 'none' }}>
            {recent.map((e) => <RecentRow key={e.item.id} entry={e} entity={byId(e.item.entity)} />)}
          </ul>
        </section>
      )}
      {data?.key && (
        <div style={{ marginTop: '32px', fontSize: tokens.type.micro, color: tokens.colors.textDim }}>
          Send key {data.key} · held in your Keychain
        </div>
      )}
    </div>
  );
}

// Today: "3 messages ready to send", with who they're for. Hidden when the Outbox is empty.
export function OutboxCard({ snapshot, onOpen }: { snapshot: PortfolioSnapshot | null; onOpen: () => void }) {
  const { tokens } = useTheme();
  const c = tokens.colors;
  const { data } = useOutbox();
  const pending = (data?.items ?? []).filter((e) => e.item.status === 'pending');
  if (pending.length === 0) return null;
  const entities = snapshot?.registry?.entities ?? [];
  return (
    <Card>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '10px' }}>
        <SectionLabel style={{ marginBottom: 0 }}>Outbox</SectionLabel>
        <span style={{ flex: 1 }} />
        <button className="btn btn-secondary" onClick={onOpen} style={{ padding: '6px 12px' }}>Review →</button>
      </div>
      <div style={{ fontSize: '20px', fontWeight: 600, margin: '12px 0 10px', letterSpacing: '-0.01em' }}>
        {pending.length} {pending.length === 1 ? 'message' : 'messages'} ready to send
      </div>
      <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '6px' }}>
        {pending.slice(0, 4).map((e) => (
          <li key={e.item.id} style={{ fontSize: tokens.type.small, lineHeight: 1.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            <span style={{ fontWeight: 600 }}>{entities.find((x) => x.id === e.item.entity)?.name ?? e.item.entity}</span>{' '}
            <span style={{ color: c.textMuted }}>{e.item.subject} → {e.item.to.join(', ')}</span>
          </li>
        ))}
        {pending.length > 4 && <li style={{ fontSize: tokens.type.small, color: c.textDim }}>and {pending.length - 4} more</li>}
      </ul>
    </Card>
  );
}
