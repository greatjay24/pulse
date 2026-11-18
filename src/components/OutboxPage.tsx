import { ReactNode, useState } from 'react';
import { useTheme } from '../contexts/ThemeContext';
import { PortfolioEntity, PortfolioSnapshot } from '../types';
import { OutboxEdit, OutboxEntry, OutboxMessage, VoiceTextRow } from '../types/ops';
import { editOutbox, markHandSent, markPublished, sendOutbox, skipOutbox, useOutbox } from '../hooks/useOps';
import { EDITABLE, PUBLISH_KINDS, SMS_WARN, TEXT_MAX, VOICE_LINE, channelLabel, composeUrl, formatMinor, isEmailKind, isMoneyKind, isVoiceKind, isWebLink, kindLabel, kindOf, pasteText, placeholders, prettyPhone, primaryLabel, socialChannel, splitAddresses, voiceLink } from '../utils/ops';
import { openExternal } from '../utils/tracker';
import { revealItemInDir } from '@tauri-apps/plugin-opener';
import { showToast } from '../utils/toast';
import { Card, Notice, PageHeader, SectionHeading, SectionLabel } from './BoardUI';
import { Icon } from './Icons';
import { EmailThread } from './EmailThread';

const RECENT_SHOWN = 15;

function ago(at: string | null | undefined, now: number): string {
  const t = at ? Date.parse(at) : NaN;
  if (Number.isNaN(t)) return '';
  const mins = Math.max(0, Math.round((now - t) / 60_000));
  if (mins < 60) return `${mins}m ago`;
  if (mins < 48 * 60) return `${Math.round(mins / 60)}h ago`;
  return `${Math.round(mins / 1440)}d ago`;
}

// Copy & open: the text on the clipboard, the compose screen in the browser.
async function copyAndOpen(m: OutboxMessage, what?: string) {
  const url = composeUrl(m);
  await copy(pasteText(m), what ?? (url ? `Copied. Paste it into ${channelLabel(socialChannel(m))}.` : 'Copied'));
  if (url) openExternal(url);
}

function showFile(path: string | undefined) {
  if (!path || !path.startsWith('/')) return;
  revealItemInDir(path).catch(() => showToast('Could not show the file in Finder'));
}

const fileName = (p: string) => p.split('/').pop() || p;

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

// Who a Voice text goes to: the contact's name, else the number.
const voiceWho = (m: OutboxMessage) => m.contact || prettyPhone(m.to[0]);

// Copy & open Voice: the text on the clipboard, the conversation in Google Voice in the browser.
async function copyAndOpenVoice(m: OutboxMessage) {
  await copy(m.body, `Copied. Paste it into the conversation with ${voiceWho(m)}, send it, then mark it sent.`);
  openExternal(voiceLink(m));
}

// What a click does, said plainly for the demo and the button's title.
function clickMeans(m: OutboxMessage): string {
  switch (kindOf(m)) {
    case 'email':
      return 'send this message from the right mailbox, threaded, and mark it sent';
    case 'voice_text':
      return `send this text from your Voice number ${prettyPhone(VOICE_LINE)} to ${voiceWho(m)} and mark it sent`;
    case 'resend_email':
      return `send this message through Resend as ${m.from ?? 'the sender shown'} and mark it sent`;
    case 'youtube_upload':
      return m.publish_at
        ? `upload the video to YouTube (${m.channel}) as private, scheduled to go public ${m.publish_at.replace('T', ' ')}`
        : `upload the video to YouTube (${m.channel}) as ${m.privacy ?? 'private'}, in the background`;
    case 'tiktok_post':
      return 'approve it, copy the caption and open TikTok Studio to upload it';
    case 'stripe_send_invoice':
      return 'check the draft in Stripe, finalize it and have Stripe email it';
    case 'stripe_send_quote':
      return 'check the draft in Stripe and finalize it, ready for you to send';
    case 'stripe_refund':
      return 'check the charge in Stripe and create the refund';
    case 'stripe_subscription':
      return m.action === 'update' ? 'check the prices and change the subscription in Stripe' : 'check the prices and start the subscription in Stripe';
    case 'stripe_charge':
      return `charge ${formatMinor(m.amount, m.currency)} to ${m.card ?? 'the saved card'} now, without the customer present`;
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

// The conversation a reply draft answers, Gmail-style, above the draft itself (Roo reads it read-only).
function ThreadAbove({ id }: { id: string }) {
  const { tokens } = useTheme();
  const [shown, setShown] = useState(true);
  return (
    <div style={{ margin: '12px 0 4px' }}>
      <button className="btn btn-secondary" onClick={() => setShown(!shown)} style={{ fontSize: tokens.type.micro, marginBottom: '8px' }}>
        {shown ? 'Hide the thread' : 'Show the thread'}
      </button>
      {shown && <EmailThread source={{ outbox: id }} hideDraft />}
    </div>
  );
}

// Text-message bubbles. Every string here is third-party or agent text: rendered as plain text only.
function Bubble({ out, draft, children }: { out: boolean; draft?: boolean; children: ReactNode }) {
  const { tokens } = useTheme();
  const c = tokens.colors;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: out ? 'flex-end' : 'flex-start' }}>
      <div
        style={{
          maxWidth: '78%',
          padding: '8px 12px',
          borderRadius: '16px',
          ...(out ? { borderBottomRightRadius: '4px' } : { borderBottomLeftRadius: '4px' }),
          background: out ? VOICE_BLUE : c.bgElevated,
          color: out ? '#ffffff' : c.text,
          border: out ? (draft ? `2px dashed rgba(255,255,255,0.55)` : 'none') : `1px solid ${c.border}`,
          fontSize: tokens.type.body,
          lineHeight: 1.45,
          whiteSpace: 'pre-wrap',
          overflowWrap: 'anywhere',
        }}
      >
        {children}
      </div>
    </div>
  );
}

const VOICE_BLUE = '#1a73e8';

function VoiceRow({ r }: { r: VoiceTextRow }) {
  const { tokens } = useTheme();
  const c = tokens.colors;
  const out = r.dir === 'out';
  const when = r.at && !Number.isNaN(Date.parse(r.at))
    ? new Date(r.at).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
    : null;
  let content: ReactNode;
  if (r.kind === 'missed-call') content = <span style={{ fontStyle: 'italic' }}>Missed call</span>;
  else if (r.withheld) content = <span style={{ fontStyle: 'italic' }}>(withheld: {r.withheld})</span>;
  else if (r.kind === 'voicemail') content = <>Voicemail: {r.text ?? '(no transcript)'}</>;
  else content = r.text ?? '';
  return (
    <div>
      <Bubble out={out}>{content}</Bubble>
      {when && (
        <div style={{ fontSize: tokens.type.micro, color: c.textDim, marginTop: '2px', textAlign: out ? 'right' : 'left' }}>
          {when}{r.kind === 'group-text' ? ' · group text' : ''}
        </div>
      )}
    </div>
  );
}

function CharCount({ n }: { n: number }) {
  const { tokens } = useTheme();
  const c = tokens.colors;
  const long = n > SMS_WARN;
  return (
    <div style={{ fontSize: tokens.type.micro, color: n > TEXT_MAX ? c.danger : long ? c.warning : c.textDim, textAlign: 'right', marginTop: '4px' }}>
      {n} characters{long ? `: long for a text (over ${SMS_WARN}), it may arrive split or cut` : ''}
    </div>
  );
}

function VoiceTextPreview({ m }: { m: OutboxMessage }) {
  const { tokens } = useTheme();
  const c = tokens.colors;
  const number = m.to[0] ?? '';
  const rows = m.conversation ?? [];
  return (
    <>
      <div style={{ fontSize: tokens.type.small, color: c.textMuted, lineHeight: 1.6 }}>
        Text from your Voice number {prettyPhone(VOICE_LINE)} → <span style={{ color: c.text, fontWeight: 600 }}>{m.contact || prettyPhone(number)}</span>
        {m.contact && <> · {prettyPhone(number)}</>}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '12px', padding: '14px', border: `1px solid ${c.border}`, borderRadius: tokens.radius.md, maxHeight: '420px', overflow: 'auto' }}>
        {rows.length === 0 && <div style={{ fontSize: tokens.type.micro, color: c.textDim, textAlign: 'center' }}>No earlier texts with this number in Roo</div>}
        {rows.map((r, i) => <VoiceRow key={i} r={r} />)}
        <div>
          <Bubble out draft>{m.body}</Bubble>
          <div style={{ fontSize: tokens.type.micro, color: c.textDim, marginTop: '2px', textAlign: 'right' }}>Draft</div>
        </div>
      </div>
      <CharCount n={m.body.length} />
      {!m.reply_to && (
        <div style={{ marginTop: '8px', fontSize: tokens.type.small, color: c.textMuted }}>
          Nobody has texted from this number yet, so send it from the Voice app.
        </div>
      )}
    </>
  );
}

function Preview({ m }: { m: OutboxMessage }) {
  const { tokens } = useTheme();
  const c = tokens.colors;
  const meta = { fontSize: tokens.type.small, color: c.textMuted, lineHeight: 1.6 } as const;
  const kind = kindOf(m);

  if (isEmailKind(kind)) {
    return (
      <>
        <div style={meta}>
          {kind === 'resend_email' ? (
            <Meta label="From">
              {m.from_name ? `${m.from_name} <${m.from}>` : m.from} <span style={{ color: c.textDim }}>via Resend</span>
            </Meta>
          ) : (
            <Meta label="From">{m.account} mailbox</Meta>
          )}
          {m.reply_to && <Meta label="Replies to">{m.reply_to}</Meta>}
          <Meta label="To">{m.to.join(', ')}</Meta>
          {m.cc.length > 0 && <Meta label="Cc">{m.cc.join(', ')}</Meta>}
          {m.in_reply_to && <div style={{ color: c.textDim }}>Reply in the existing thread</div>}
        </div>
        {kind === 'email' && m.in_reply_to && <ThreadAbove id={m.id} />}
        <div style={{ display: 'flex', gap: '10px', alignItems: 'baseline', flexWrap: 'wrap', margin: '12px 0 8px' }}>
          <span style={{ fontSize: '17px', fontWeight: 600 }}>{m.subject}</span>
          <span style={{ fontSize: tokens.type.micro, fontWeight: 600, color: c.warning, border: `1px solid ${c.warning}`, borderRadius: '6px', padding: '0 6px' }}>
            Draft — not sent
          </span>
        </div>
        <Body text={m.body} />
      </>
    );
  }

  if (isVoiceKind(kind)) return <VoiceTextPreview m={m} />;

  if (isMoneyKind(kind)) {
    const rows: [string, ReactNode][] = [];
    if (m.customer) rows.push(['Customer', m.customer]);
    if (kind === 'stripe_charge') {
      rows.push(['Card', m.card ?? 'card on file'], ['Receipt says', m.description ?? '']);
      if (m.statement_descriptor_suffix) rows.push(['Statement', `…${m.statement_descriptor_suffix}`]);
    }
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

  if (kind === 'tiktok_post' || kind === 'youtube_upload') {
    const video = m.media?.[0];
    const yt = kind === 'youtube_upload';
    const flags = yt
      ? [m.privacy ?? 'private', m.made_for_kids === 'yes' ? 'made for kids' : 'not made for kids', m.ai_altered === 'yes' ? 'altered or synthetic: yes' : null]
      : [m.privacy ?? 'public', m.ai_label === 'yes' ? 'AI-generated label on' : 'no AI label'];
    const left = placeholders(m);
    return (
      <>
        <div style={meta}>
          <Meta label="On">{yt ? `YouTube (${m.channel})` : `TikTok as ${m.account}`}</Meta>
          {video && (
            <Meta label="Video">
              {video.startsWith('/') ? (
                <button onClick={() => showFile(video)} title={video} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: c.accent, fontSize: 'inherit', fontFamily: 'inherit' }}>
                  {fileName(video)}
                </button>
              ) : (
                video
              )}
            </Meta>
          )}
          <Meta label="Settings">{flags.filter(Boolean).join(' · ')}</Meta>
          {yt && m.publish_at && <Meta label="Goes public">{m.publish_at.replace('T', ' ')}</Meta>}
          {!yt && m.schedule && <Meta label="Post on">{m.schedule.replace('T', ' ')}</Meta>}
          {yt && m.tags && m.tags.length > 0 && <Meta label="Tags">{m.tags.join(', ')}</Meta>}
        </div>
        {m.title && <div style={{ fontSize: '17px', fontWeight: 600, margin: '12px 0 0' }}>{m.title}</div>}
        <div style={{ marginTop: '12px' }}>
          <Body text={m.body} boxed />
        </div>
        {left.length > 0 && (
          <div style={{ marginTop: '10px', fontSize: tokens.type.small, color: c.danger }}>
            Fill in {left.join(', ')} first (Edit).{yt ? ' Upload refuses until then.' : ''}
          </div>
        )}
        {m.notes && (
          <div style={{ marginTop: '10px', fontSize: tokens.type.small, color: c.textMuted, lineHeight: 1.5 }}>
            <span style={{ color: c.textDim }}>By hand after: </span>
            {m.notes}
          </div>
        )}
        <div style={{ marginTop: '12px', fontSize: tokens.type.micro, color: c.textDim, lineHeight: 1.5 }}>
          {yt
            ? 'Upload sends the video to YouTube through its API on your click. Nothing goes up before.'
            : 'TikTok has no hands-off posting yet: Approve copies the caption and opens TikTok Studio; you upload the video there.'}
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
      {isVoiceKind(kindOf(m)) && <CharCount n={body.length} />}
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

export function OutboxItem({ entry, entity, onDone }: { entry: OutboxEntry; entity?: PortfolioEntity; onDone: () => void }) {
  const { tokens } = useTheme();
  const c = tokens.colors;
  const m = entry.item;
  const kind = kindOf(m);
  const label = primaryLabel(kind);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState<'go' | 'save' | 'skip' | 'hand' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [skipping, setSkipping] = useState(false);
  const [skipWhy, setSkipWhy] = useState('');
  const [confirming, setConfirming] = useState(false);
  // voice_text: Copy & open Voice was clicked, so offer Mark sent.
  const [openedVoice, setOpenedVoice] = useState(false);
  const voice = isVoiceKind(kind);
  const canSend = !voice || !!m.reply_to;
  const now = Date.now();

  const run = async (what: 'go' | 'save' | 'skip' | 'hand', fn: () => Promise<unknown>) => {
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
      setConfirming(false);
      const res = await sendOutbox(m.id, entry.content, clickMeans(m));
      if (res.warning) showToast(res.warning);
      if (!res.ok) return;
      if (voice) showToast(`Text sent to ${voiceWho(m)} from your Voice number`);
      else if (isEmailKind(kind)) showToast(`Sent to ${m.to.join(', ')}${kind === 'resend_email' ? ` as ${m.from}` : ''}`);
      else if (kind === 'youtube_upload') showToast(res.next_step ?? 'Uploading to YouTube in the background');
      else if (composeUrl(m)) await copyAndOpen(m, `Approved and copied. Paste it into ${channelLabel(socialChannel(m))}, then mark it published.`);
      else if (PUBLISH_KINDS.includes(kind)) await copy(pasteText(m), 'Approved and copied. Paste it where it goes, then mark it published.');
      else showToast(res.next_step ?? `${kindLabel(m)}: done in Stripe`);
    });

  // Money moves on this click: confirm it in a second step first.
  const approve = () => (isMoneyKind(kind) ? setConfirming(true) : go());

  const busyLabel = { Send: 'Sending…', Publish: 'Approving…', Approve: 'Approving…', Upload: 'Starting upload…' }[label];

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
          {canSend && (
            <button className="btn btn-primary" disabled={!!busy} onClick={approve} title={`Click to ${clickMeans(m)}`} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Icon name={voice ? 'mobile' : isEmailKind(kind) ? 'mail' : isMoneyKind(kind) ? 'credit-card' : kind === 'youtube_upload' ? 'cloud' : 'check'} size={14} color="currentColor" /> {busy === 'go' ? busyLabel : voice ? 'Send text' : label}
            </button>
          )}
          {EDITABLE[kind] && (
            <button className="btn btn-secondary" disabled={!!busy} onClick={() => setEditing(true)}>Edit</button>
          )}
          <button className="btn btn-secondary" disabled={!!busy} onClick={() => setSkipping((v) => !v)}>
            {busy === 'skip' ? 'Skipping…' : 'Skip'}
          </button>
          {voice && (
            <button className={`btn ${canSend || openedVoice ? 'btn-secondary' : 'btn-primary'}`} disabled={!!busy}
              onClick={async () => { await copyAndOpenVoice(m); setOpenedVoice(true); }}
              title="Copy the text and open the conversation in Google Voice, to send it yourself" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Icon name="external-link" size={14} color="currentColor" /> Copy &amp; open Voice
            </button>
          )}
          {voice && openedVoice && (
            <button className="btn btn-primary" disabled={!!busy} onClick={() => run('hand', () => markHandSent(m.id))} title="You sent it from the Google Voice app: mark it sent">
              {busy === 'hand' ? 'Saving…' : 'Mark sent'}
            </button>
          )}
          {isMoneyKind(kind) && <span style={{ fontSize: tokens.type.micro, color: c.textDim }}>To change it, ask the lead to edit it in Stripe and queue it again.</span>}
        </div>
      )}

      {confirming && <ConfirmMoney m={m} busy={busy === 'go'} onCancel={() => setConfirming(false)} onConfirm={go} />}

      {!editing && skipping && (
        <div style={{ display: 'flex', gap: '6px', marginTop: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ fontSize: tokens.type.micro, color: c.textDim }}>Why? Roo learns from it.</span>
          {SKIP_REASONS.map((r) => (
            <button key={r} className="btn btn-secondary" disabled={!!busy} style={{ fontSize: tokens.type.micro, padding: '3px 8px' }}
              onClick={() => run('skip', () => skipOutbox(m.id, r))}>{r}</button>
          ))}
          <input value={skipWhy} onChange={(e) => setSkipWhy(e.target.value)} maxLength={300} placeholder="Or say why"
            onKeyDown={(e) => { if (e.key === 'Enter' && !busy) run('skip', () => skipOutbox(m.id, skipWhy)); }}
            style={{ flex: '1 1 140px', minWidth: 0, fontSize: tokens.type.small, padding: '4px 8px', borderRadius: tokens.radius.sm,
              border: `1px solid ${c.border}`, background: c.bgElevated, color: c.text }} />
          <button className="btn btn-secondary" disabled={!!busy} onClick={() => run('skip', () => skipOutbox(m.id, skipWhy))}>
            {skipWhy.trim() ? 'Skip' : 'Skip, no reason'}
          </button>
        </div>
      )}
    </Card>
  );
}

function ConfirmMoney({ m, busy, onCancel, onConfirm }: { m: OutboxMessage; busy: boolean; onCancel: () => void; onConfirm: () => void }) {
  const { tokens } = useTheme();
  const c = tokens.colors;
  const charge = kindOf(m) === 'stripe_charge';
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Confirm money action"
      onClick={onCancel}
      onKeyDown={(e) => e.key === 'Escape' && onCancel()}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '24px' }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ width: '100%', maxWidth: '480px', background: c.bgCard, border: `1px solid ${c.border}`, borderRadius: tokens.radius.lg, padding: '24px 26px', color: c.text }}
      >
        <div style={{ fontSize: tokens.type.micro, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.09em', color: c.warning, marginBottom: '10px' }}>
          {kindLabel(m)} · {m.entity}
        </div>
        <div style={{ fontSize: '34px', fontWeight: 600, letterSpacing: '-0.02em', fontVariantNumeric: 'tabular-nums', marginBottom: '6px' }}>
          {formatMinor(m.amount, m.currency)}
        </div>
        {m.customer && <div style={{ fontSize: tokens.type.body, marginBottom: '4px' }}>{m.customer}</div>}
        {charge && m.card && <div style={{ fontSize: tokens.type.small, color: c.textMuted, marginBottom: '4px' }}>{m.card}</div>}
        <p style={{ fontSize: tokens.type.small, lineHeight: 1.55, color: c.textMuted, margin: '14px 0 20px' }}>
          {charge
            ? 'This charges their saved card right now, without them present. If the card declines or the bank asks them to authenticate, nothing is charged and it shows in Activity.'
            : `Roo will ${clickMeans(m)}. Stripe is re-checked first; if anything changed, nothing happens.`}
        </p>
        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
          <button className="btn btn-secondary" onClick={onCancel} autoFocus>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={onConfirm} disabled={busy}>
            {busy ? 'Approving…' : charge ? `Charge ${formatMinor(m.amount, m.currency)}` : 'Approve'}
          </button>
        </div>
      </div>
    </div>
  );
}

// One click skips with that reason; bin/outbox_learn.py groups repeated reasons into lessons.
const SKIP_REASONS = ['Not needed', 'Too long', 'Wrong tone', 'No hook', "I'll handle it", 'Someone else handles it'];

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
        {publishable && composeUrl(m) ? (
          <button className="btn btn-secondary" onClick={() => copyAndOpen(m)} title="Copy the text and open the place to post it" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Icon name="external-link" size={14} color="currentColor" /> Copy &amp; open {channelLabel(socialChannel(m))}
          </button>
        ) : publishable ? (
          <button className="btn btn-secondary" onClick={() => copy(pasteText(m))} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Icon name="download" size={14} color="currentColor" /> Copy text
          </button>
        ) : null}
        {kind === 'tiktok_post' && m.media?.[0]?.startsWith('/') && (
          <button className="btn btn-secondary" onClick={() => showFile(m.media?.[0])}>Show video</button>
        )}
        {isWebLink(m.link) && !(publishable && composeUrl(m)) && (
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
  const voice = isVoiceKind(kindOf(m));
  const who = voice ? voiceWho(m) : m.to.length ? m.to.join(', ') : m.customer ?? channelLabel(m.channel);
  return (
    <li style={{ display: 'flex', gap: '10px', fontSize: tokens.type.small, lineHeight: 1.5, padding: '8px 0', borderBottom: `1px solid ${c.border}` }}>
      <span style={{ color: tone, fontWeight: 600, width: '72px', flexShrink: 0 }}>{m.status}</span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ fontWeight: 600 }}>{m.subject}</span>
        <span style={{ color: c.textMuted }}> · {kindLabel(m)}{who ? ` · ${who}` : ''} · {entity?.name ?? m.entity}{voice && m.sent_by_hand ? ' · sent from the Voice app' : ''}</span>
        {isWebLink(m.link) && (isMoneyKind(kindOf(m)) || kindOf(m) === 'youtube_upload') && ['sent', 'published'].includes(m.status) && (
          <button onClick={() => openExternal(m.link!)} style={{ marginLeft: '8px', background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: c.accent, fontSize: tokens.type.small, fontFamily: 'inherit' }}>
            open
          </button>
        )}
        {kindOf(m) === 'youtube_upload' && !m.error && m.next_step && <div style={{ color: c.textMuted }}>{m.next_step}</div>}
        {m.error && (
          <div style={{ color: c.danger }}>
            {m.error}
            {(m.status === 'sending' || m.status === 'failed') && (isMoneyKind(kindOf(m)) ? ' Check it in Stripe before queueing it again.' : kindOf(m) === 'email' ? ' Check Sent in Gmail before trying again.' : kindOf(m) === 'resend_email' ? ' Check Emails in the Resend dashboard before trying again.' : kindOf(m) === 'youtube_upload' ? ' Check Content in YouTube Studio before trying again.' : voice ? ' Check the conversation in Google Voice before trying again.' : '')}
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
              {e.item.to.length > 0 && isEmailKind(kindOf(e.item)) ? ` → ${e.item.to.join(', ')}` : isVoiceKind(kindOf(e.item)) ? ` → ${voiceWho(e.item)}` : ''}
            </span>
          </li>
        ))}
        {pending.length > 4 && <li style={{ fontSize: tokens.type.small, color: c.textDim }}>and {pending.length - 4} more</li>}
      </ul>
    </Card>
  );
}
