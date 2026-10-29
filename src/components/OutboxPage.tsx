import { ReactNode, useState } from 'react';
import { useTheme } from '../contexts/ThemeContext';
import { PortfolioEntity, PortfolioSnapshot } from '../types';
import { OutboxEdit, OutboxEntry, OutboxMessage } from '../types/ops';
import { editOutbox, markPublished, sendOutbox, skipOutbox, useOutbox } from '../hooks/useOps';
import { EDITABLE, PUBLISH_KINDS, channelLabel, formatMinor, isMoneyKind, isWebLink, kindLabel, kindOf, primaryLabel, splitAddresses } from '../utils/ops';
import { openExternal } from '../utils/tracker';
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

// The text the owner pastes when finishing a post, text, DM or Slack message by hand.
function pasteText(m: OutboxMessage): string {
  const parts = [m.title, m.body.trimEnd()];
  if (kindOf(m) === 'post' && m.link) parts.push(m.link);
  return parts.filter(Boolean).join('\n\n');
}

async function copy(text: string, what = 'Copied') {
  try {
    await navigator.clipboard.writeText(text);
    showToast(what);
    return true;
  } catch {
    showToast('Could not copy; select the text instead');
    return false;
  }
}

// What a click does, said plainly for the demo and the button's title.
function clickMeans(m: OutboxMessage): string {
  switch (kindOf(m)) {
    case 'email':
      return 'send this message from the right mailbox, threaded, and mark it sent';
    case 'stripe_send_invoice':
      return 'check the draft in Stripe, finalize it and have Stripe email it';
    case 'stripe_send_quote':
      return 'check the draft in Stripe and finalize it, ready for you to send';
    case 'stripe_refund':
      return 'check the charge in Stripe and create the refund';
    case 'stripe_subscription':
      return m.action === 'update' ? 'check the prices and change the subscription in Stripe' : 'check the prices and start the subscription in Stripe';
    default:
      return 'approve it and copy it, ready for you to paste where it goes';
  }
}

function Meta({ label, children }: { label: string; children: ReactNode }) {
  const { tokens } = useTheme();
  return (
    <div>
      <span style={{ color: tokens.colors.textDim }}>{label}</span> {children}
    </div>
  );
}

// ---------- previews, one per kind ----------

function Body({ text, boxed = false }: { text: string; boxed?: boolean }) {
  const { tokens } = useTheme();
  const c = tokens.colors;
  return (
    <div
      style={{
        whiteSpace: 'pre-wrap',
        fontSize: tokens.type.body,
        lineHeight: 1.6,
        color: c.text,
        maxHeight: '320px',
        overflow: 'auto',
        ...(boxed ? { padding: '12px 14px', border: `1px solid ${c.border}`, borderRadius: tokens.radius.md, background: c.bgElevated } : {}),
      }}
    >
      {text}
    </div>
  );
}

function Preview({ m }: { m: OutboxMessage }) {
  const { tokens } = useTheme();
  const c = tokens.colors;
  const meta = { fontSize: tokens.type.small, color: c.textMuted, lineHeight: 1.6 } as const;
  const kind = kindOf(m);

  if (kind === 'email') {
    return (
      <>
        <div style={meta}>
          <Meta label="From">{m.account} mailbox</Meta>
          <Meta label="To">{m.to.join(', ')}</Meta>
          {m.cc.length > 0 && <Meta label="Cc">{m.cc.join(', ')}</Meta>}
          {m.in_reply_to && <div style={{ color: c.textDim }}>Reply in the existing thread</div>}
        </div>
        <div style={{ fontSize: '17px', fontWeight: 600, margin: '12px 0 8px' }}>{m.subject}</div>
        <Body text={m.body} />
      </>
    );
  }

  if (isMoneyKind(kind)) {
    const rows: [string, ReactNode][] = [];
    if (m.customer) rows.push(['Customer', m.customer]);
    if (kind === 'stripe_send_invoice') rows.push(['Due', m.due_date ?? 'per invoice terms']);
    if (kind === 'stripe_refund') rows.push(['Of', <code key="c" style={{ fontFamily: tokens.fonts.mono, fontSize: tokens.type.micro }}>{m.stripe_id}</code>], ['Reason', m.reason?.replace(/_/g, ' ') ?? 'not given']);
    if (kind === 'stripe_subscription') {
      rows.push(['Billing', `every ${m.interval ?? 'period'}, invoices emailed${m.action === 'create' ? `, due in ${m.days_until_due ?? 30} days` : ''}`]);
    }
    const per = kind === 'stripe_subscription' && m.interval ? ` / ${m.interval}` : '';
    return (
      <>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '12px', flexWrap: 'wrap', margin: '4px 0 10px' }}>
          <span style={{ fontSize: '30px', fontWeight: 600, letterSpacing: '-0.02em', fontVariantNumeric: 'tabular-nums' }}>
            {formatMinor(m.amount, m.currency)}
            <span style={{ fontSize: tokens.type.body, fontWeight: 500, color: c.textMuted }}>{per}</span>
          </span>
          <span style={{ fontSize: tokens.type.body, color: c.textMuted }}>{m.subject}</span>
        </div>
        <div style={meta}>
          {rows.map(([k, v]) => (
            <Meta key={k} label={k}>{v}</Meta>
          ))}
        </div>
        {m.body.trim() && (
          <div style={{ marginTop: '12px', fontFamily: tokens.fonts.mono, fontSize: tokens.type.small, lineHeight: 1.7, whiteSpace: 'pre-wrap', color: c.text }}>{m.body}</div>
        )}
        <div style={{ marginTop: '12px', fontSize: tokens.type.micro, color: c.textDim, lineHeight: 1.5 }}>
          Runs in Stripe with the {m.entity} agent key when you click Approve. Stripe is re-checked first; if anything changed, nothing happens.
        </div>
      </>
    );
  }

  // Posts, texts, DMs, Slack: what will be pasted, and where.
  return (
    <>
      <div style={meta}>
        {kind === 'post' && <Meta label="On">{channelLabel(m.channel)}</Meta>}
        {kind === 'text' && <Meta label="To">{m.to.join(', ')}</Meta>}
        {kind === 'dm' && <Meta label="To">{m.to.join(', ')} on {channelLabel(m.channel)}</Meta>}
        {kind === 'slack' && <Meta label="In">{m.channel}</Meta>}
        {m.link && <Meta label="Link">{m.link}</Meta>}
        {m.media && m.media.length > 0 && <Meta label="Media">{m.media.join(', ')}</Meta>}
      </div>
      {m.title && <div style={{ fontSize: '17px', fontWeight: 600, margin: '12px 0 0' }}>{m.title}</div>}
      <div style={{ marginTop: '12px' }}>
        <Body text={m.body} boxed />
      </div>
    </>
  );
}

// ---------- editing, by kind ----------

function EditForm({ m, onSave, onCancel, busy }: { m: OutboxMessage; onSave: (f: OutboxEdit) => void; onCancel: () => void; busy: boolean }) {
  const { tokens } = useTheme();
  const fields = EDITABLE[kindOf(m)] ?? [];
  const [to, setTo] = useState(m.to.join(', '));
  const [cc, setCc] = useState(m.cc.join(', '));
  const [subject, setSubject] = useState(m.subject);
  const [title, setTitle] = useState(m.title ?? '');
  const [link, setLink] = useState(m.link ?? '');
  const [body, setBody] = useState(m.body);
  const field = { width: '100%', padding: '8px 10px', fontSize: tokens.type.small } as const;
  const meta = { fontSize: tokens.type.small, color: tokens.colors.textMuted, lineHeight: 1.6 } as const;
  const has = (f: keyof OutboxEdit) => fields.includes(f);
  const toLabel = kindOf(m) === 'text' ? 'To (phone numbers)' : kindOf(m) === 'dm' ? 'To (handles)' : 'To';

  const save = () => {
    const out: OutboxEdit = {};
    if (has('to')) out.to = splitAddresses(to);
    if (has('cc')) out.cc = splitAddresses(cc);
    if (has('subject')) out.subject = subject;
    if (has('title')) out.title = title;
    if (has('link')) out.link = link.trim() || null;
    if (has('body')) out.body = body;
    onSave(out);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      {has('to') && <label style={meta}>{toLabel} <input value={to} onChange={(e) => setTo(e.target.value)} style={field} /></label>}
      {has('cc') && <label style={meta}>Cc <input value={cc} onChange={(e) => setCc(e.target.value)} style={field} placeholder="none" /></label>}
      {has('subject') && <label style={meta}>Subject <input value={subject} onChange={(e) => setSubject(e.target.value)} style={field} /></label>}
      {has('title') && <label style={meta}>Title <input value={title} onChange={(e) => setTitle(e.target.value)} style={field} placeholder="none" /></label>}
      {has('link') && <label style={meta}>Link <input value={link} onChange={(e) => setLink(e.target.value)} style={field} placeholder="https://" /></label>}
      <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={Math.min(18, Math.max(6, body.split('\n').length + 1))} style={{ ...field, fontFamily: 'inherit', lineHeight: 1.55, resize: 'vertical' }} />
      <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
        <button className="btn btn-primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</button>
        <button className="btn btn-secondary" disabled={busy} onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

// ---------- one pending item ----------

function KindTag({ m }: { m: OutboxMessage }) {
  const { tokens } = useTheme();
  const c = tokens.colors;
  const money = isMoneyKind(kindOf(m));
  return (
    <span
      style={{
        fontSize: tokens.type.micro,
        fontWeight: 600,
        padding: '2px 8px',
        borderRadius: '999px',
        border: `1px solid ${money ? c.accent : c.border}`,
        color: money ? c.accent : c.textMuted,
      }}
    >
      {kindLabel(m)}
    </span>
  );
}

function OutboxItem({ entry, entity, onDone }: { entry: OutboxEntry; entity?: PortfolioEntity; onDone: () => void }) {
  const { tokens } = useTheme();
  const c = tokens.colors;
  const m = entry.item;
  const kind = kindOf(m);
  const label = primaryLabel(kind);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState<'go' | 'save' | 'skip' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const now = Date.now();

  const run = async (what: 'go' | 'save' | 'skip', fn: () => Promise<unknown>) => {
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

  const go = () =>
    run('go', async () => {
      const res = await sendOutbox(m.id, entry.content, clickMeans(m));
      if (res.warning) showToast(res.warning);
      if (!res.ok) return;
      if (kind === 'email') showToast(`Sent to ${m.to.join(', ')}`);
      else if (PUBLISH_KINDS.includes(kind)) await copy(pasteText(m), 'Approved and copied. Paste it where it goes, then mark it published.');
      else showToast(res.next_step ?? `${kindLabel(m)}: done in Stripe`);
    });

  const busyLabel = { Send: 'Sending…', Publish: 'Approving…', Approve: 'Approving…' }[label];

  return (
    <Card>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
        <SectionLabel style={{ marginBottom: 0 }}>{entity?.name ?? m.entity}</SectionLabel>
        <KindTag m={m} />
        <span style={{ fontSize: tokens.type.micro, color: c.textDim }}>
          by {m.created_by} · {ago(m.created_at, now)}
          {m.edited_at && ' · edited'}
          {kind === 'email' && m.draft && (m.draft.saved ? ' · also in Gmail Drafts' : ' · Gmail draft not saved')}
        </span>
      </div>

      <div style={{ margin: '12px 0', padding: '10px 14px', borderLeft: `3px solid ${c.accent}`, background: c.bgElevated, borderRadius: tokens.radius.sm, fontSize: tokens.type.small, lineHeight: 1.5 }}>
        <span style={{ fontWeight: 600 }}>Why: </span>
        {m.why}
      </div>

      {editing ? (
        <EditForm m={m} busy={busy === 'save'} onCancel={() => setEditing(false)} onSave={(f) => run('save', () => editOutbox(m.id, f))} />
      ) : (
        <Preview m={m} />
      )}

      {error && <div style={{ marginTop: '12px', fontSize: tokens.type.small, color: c.danger }}>{error}</div>}

      {!editing && (
        <div style={{ display: 'flex', gap: '8px', marginTop: '16px', flexWrap: 'wrap', alignItems: 'center' }}>
          <button className="btn btn-primary" disabled={!!busy} onClick={go} title={`Click to ${clickMeans(m)}`} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Icon name={kind === 'email' ? 'mail' : isMoneyKind(kind) ? 'credit-card' : 'check'} size={14} color="currentColor" /> {busy === 'go' ? busyLabel : label}
          </button>
          {EDITABLE[kind] && (
            <button className="btn btn-secondary" disabled={!!busy} onClick={() => setEditing(true)}>Edit</button>
          )}
          <button className="btn btn-secondary" disabled={!!busy} onClick={() => run('skip', () => skipOutbox(m.id))}>
            {busy === 'skip' ? 'Skipping…' : 'Skip'}
          </button>
          {isMoneyKind(kind) && <span style={{ fontSize: tokens.type.micro, color: c.textDim }}>To change it, ask the lead to edit it in Stripe and queue it again.</span>}
        </div>
      )}
    </Card>
  );
}

// ---------- approved, waiting on the owner's hands ----------

function FinishItem({ entry, entity, onDone }: { entry: OutboxEntry; entity?: PortfolioEntity; onDone: () => void }) {
  const { tokens } = useTheme();
  const c = tokens.colors;
  const m = entry.item;
  const kind = kindOf(m);
  const publishable = PUBLISH_KINDS.includes(kind);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const done = async () => {
    setBusy(true);
    setError(null);
    try {
      await markPublished(m.id);
      onDone();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <li style={{ padding: '14px 0', borderBottom: `1px solid ${c.border}` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', fontSize: tokens.type.small }}>
        <KindTag m={m} />
        <span style={{ fontWeight: 600, minWidth: 0 }}>{m.subject}</span>
        <span style={{ color: c.textMuted }}>· {entity?.name ?? m.entity}</span>
      </div>
      <div style={{ fontSize: tokens.type.small, color: c.textMuted, margin: '6px 0 10px', lineHeight: 1.5 }}>
        {m.next_step ?? 'Approved. Finish it by hand.'}
        {kind === 'text' && m.to.length > 0 && <> To {m.to.join(', ')}.</>}
      </div>
      {error && <div style={{ marginBottom: '8px', fontSize: tokens.type.small, color: c.danger }}>{error}</div>}
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
        {publishable && (
          <button className="btn btn-secondary" onClick={() => copy(pasteText(m))} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Icon name="download" size={14} color="currentColor" /> Copy text
          </button>
        )}
        {isWebLink(m.link) && (
          <button className="btn btn-secondary" onClick={() => openExternal(m.link!)} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Icon name="external-link" size={14} color="currentColor" /> {isMoneyKind(kind) ? 'Open in Stripe' : `Open ${channelLabel(m.channel) || 'link'}`}
          </button>
        )}
        {publishable && (
          <button className="btn btn-primary" disabled={busy} onClick={done}>{busy ? 'Saving…' : 'Mark published'}</button>
        )}
      </div>
    </li>
  );
}

function RecentRow({ entry, entity }: { entry: OutboxEntry; entity?: PortfolioEntity }) {
  const { tokens } = useTheme();
  const c = tokens.colors;
  const m = entry.item;
  const tone = m.status === 'sent' || m.status === 'published' ? c.success : m.status === 'skipped' ? c.textDim : c.danger;
  const when = m.sent_at ?? m.published_at ?? m.skipped_at ?? m.created_at;
  const who = m.to.length ? m.to.join(', ') : m.customer ?? channelLabel(m.channel);
  return (
    <li style={{ display: 'flex', gap: '10px', fontSize: tokens.type.small, lineHeight: 1.5, padding: '8px 0', borderBottom: `1px solid ${c.border}` }}>
      <span style={{ color: tone, fontWeight: 600, width: '72px', flexShrink: 0 }}>{m.status}</span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ fontWeight: 600 }}>{m.subject}</span>
        <span style={{ color: c.textMuted }}> · {kindLabel(m)}{who ? ` · ${who}` : ''} · {entity?.name ?? m.entity}</span>
        {isWebLink(m.link) && isMoneyKind(kindOf(m)) && m.status === 'sent' && (
          <button onClick={() => openExternal(m.link!)} style={{ marginLeft: '8px', background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: c.accent, fontSize: tokens.type.small, fontFamily: 'inherit' }}>
            open
          </button>
        )}
        {m.error && (
          <div style={{ color: c.danger }}>
            {m.error}
            {(m.status === 'sending' || m.status === 'failed') && (isMoneyKind(kindOf(m)) ? ' Check it in Stripe before queueing it again.' : kindOf(m) === 'email' ? ' Check Sent in Gmail before trying again.' : '')}
          </div>
        )}
      </span>
      <span style={{ color: c.textDim, flexShrink: 0 }}>{when ? new Date(when).toLocaleDateString([], { month: 'short', day: 'numeric' }) : ''}</span>
    </li>
  );
}

// Everything agents prepared for the owner. Nothing leaves, posts or moves money without a click here.
export function OutboxPage({ snapshot }: { snapshot: PortfolioSnapshot | null }) {
  const { tokens } = useTheme();
  const { data, error, refresh } = useOutbox();
  const entities = snapshot?.registry?.entities ?? [];
  const byId = (id: string) => entities.find((e) => e.id === id);
  const items = data?.items ?? [];
  const pending = items.filter((e) => e.item.status === 'pending');
  // Money first: it's the click with the most at stake.
  pending.sort((a, b) => Number(isMoneyKind(kindOf(b.item))) - Number(isMoneyKind(kindOf(a.item))));
  const finish = items.filter((e) => e.item.status === 'approved');
  const recent = items.filter((e) => !['pending', 'approved'].includes(e.item.status)).slice(0, RECENT_SHOWN);

  return (
    <div style={{ maxWidth: '860px', margin: '0 auto' }}>
      <PageHeader
        title="Outbox"
        subtitle={<span style={{ color: tokens.colors.textMuted, fontSize: tokens.type.small }}>Agents prepare; you decide. Nothing is sent, posted or charged without your click.</span>}
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
        <SectionHeading note={pending.length ? 'money first, then newest' : undefined}>Waiting for you</SectionHeading>
        {data && pending.length === 0 && <div style={{ color: tokens.colors.textDim, fontSize: tokens.type.body }}>Nothing waiting. Agents add emails, posts, messages and billing here when something needs your click.</div>}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {pending.map((e) => <OutboxItem key={`${e.item.id}-${e.content}`} entry={e} entity={byId(e.item.entity)} onDone={refresh} />)}
        </div>
      </section>

      {finish.length > 0 && (
        <section style={{ marginBottom: '48px' }}>
          <SectionHeading note="approved; no publishing connector yet">Finish by hand</SectionHeading>
          <ul style={{ listStyle: 'none' }}>
            {finish.map((e) => <FinishItem key={e.item.id} entry={e} entity={byId(e.item.entity)} onDone={refresh} />)}
          </ul>
        </section>
      )}

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
          Approval key {data.key} · held in your Keychain
        </div>
      )}
    </div>
  );
}

// Today: "3 items waiting", with what and who they're for. Hidden when the Outbox is empty.
export function OutboxCard({ snapshot, onOpen }: { snapshot: PortfolioSnapshot | null; onOpen: () => void }) {
  const { tokens } = useTheme();
  const c = tokens.colors;
  const { data } = useOutbox();
  const pending = (data?.items ?? []).filter((e) => e.item.status === 'pending');
  if (pending.length === 0) return null;
  const entities = snapshot?.registry?.entities ?? [];
  const money = pending.filter((e) => isMoneyKind(kindOf(e.item))).length;
  return (
    <Card>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '10px' }}>
        <SectionLabel style={{ marginBottom: 0 }}>Outbox</SectionLabel>
        <span style={{ flex: 1 }} />
        <button className="btn btn-secondary" onClick={onOpen} style={{ padding: '6px 12px' }}>Review →</button>
      </div>
      <div style={{ fontSize: '20px', fontWeight: 600, margin: '12px 0 10px', letterSpacing: '-0.01em' }}>
        {pending.length} {pending.length === 1 ? 'item' : 'items'} waiting for your click
        {money > 0 && <span style={{ color: c.textMuted, fontWeight: 500 }}> · {money} billing</span>}
      </div>
      <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '6px' }}>
        {pending.slice(0, 4).map((e) => (
          <li key={e.item.id} style={{ fontSize: tokens.type.small, lineHeight: 1.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            <span style={{ fontWeight: 600 }}>{entities.find((x) => x.id === e.item.entity)?.name ?? e.item.entity}</span>{' '}
            <span style={{ color: c.textMuted }}>
              {kindLabel(e.item)}: {e.item.subject}
              {e.item.to.length > 0 && kindOf(e.item) === 'email' ? ` → ${e.item.to.join(', ')}` : ''}
            </span>
          </li>
        ))}
        {pending.length > 4 && <li style={{ fontSize: tokens.type.small, color: c.textDim }}>and {pending.length - 4} more</li>}
      </ul>
    </Card>
  );
}
