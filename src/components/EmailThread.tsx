// The whole email conversation behind an item, the way Gmail shows it: every message in order,
// the latest (and any unread) open, older ones folded to one line, quoted history behind "•••",
// attachments by name. Bodies come pre-sanitized from ~/portfolio/bin/email_thread.py and render in
// a script-free sandboxed iframe; remote images stay off until "Load images".
import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useTheme } from '../contexts/ThemeContext';
import { openExternal } from '../utils/tracker';
import { Icon } from './Icons';

export interface ThreadAddress {
  name: string;
  email: string;
}

export interface ThreadAttachment {
  name: string;
  mime: string;
  size: number;
}

export interface ThreadMessage {
  id: string | null;
  from: ThreadAddress;
  to: ThreadAddress[];
  cc: ThreadAddress[];
  date: string | null;
  ts?: number | null;
  snippet?: string;
  unread?: boolean;
  from_me?: boolean;
  rich?: boolean;
  body_html: string;
  remote_images?: number;
  attachments: ThreadAttachment[];
  draft?: boolean;
  label?: string;
}

export interface EmailThreadData {
  ok: boolean;
  account: string | null;
  account_label: string | null;
  subject: string;
  count: number;
  remote_images: number;
  images: boolean;
  gmail_url: string | null;
  messages: ThreadMessage[];
  draft: ThreadMessage | null;
  error?: string;
}

export type ThreadSource = { outbox: string } | { link: string } | { account: string; id: string };

export async function readEmailThread(source: ThreadSource, images = false): Promise<EmailThreadData> {
  return JSON.parse(await invoke<string>('read_email_thread', { ...source, images })) as EmailThreadData;
}

/** A Gmail web link Roo can open as a thread (rfc822msgid search or an #all/<thread> link). */
export function isThreadLink(url: string | null | undefined): url is string {
  return !!url && url.startsWith('https://mail.google.com/') && /rfc822msgid:|#(all|inbox|sent)\/[0-9a-f]{12,20}$/.test(url);
}

const who = (a: ThreadAddress | undefined) => (a ? a.name || a.email || 'Unknown' : 'Unknown');
const list = (xs: ThreadAddress[]) => xs.map((a) => (a.name ? `${a.name} <${a.email}>` : a.email)).join(', ');

function when(date: string | null | undefined): string {
  const t = date ? Date.parse(date) : NaN;
  if (Number.isNaN(t)) return date ?? '';
  const d = new Date(t);
  const sameDay = d.toDateString() === new Date().toDateString();
  return sameDay
    ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : d.toLocaleString([], { month: 'short', day: 'numeric', year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric', hour: 'numeric', minute: '2-digit' });
}

function size(n: number): string {
  if (!n) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** One sanitized body in a sandboxed iframe: no scripts run, links open in the browser, height follows content. */
function MessageBody({ html, rich, images, dark }: { html: string; rich: boolean; images: boolean; dark: boolean }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const white = rich || !dark;
  const fg = white ? '#1f1f1f' : '#ecebe4';
  const link = white ? '#1a5fb4' : '#8ab4f8';
  const csp = `default-src 'none'; style-src 'unsafe-inline'; img-src data:${images ? ' https:' : ''}; font-src data:`;
  const doc = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}">
<style>
html,body{margin:0;padding:0;background:${white ? '#ffffff' : 'transparent'};color:${fg};}
body{font:14px/1.55 -apple-system,BlinkMacSystemFont,'Helvetica Neue',Arial,sans-serif;padding:12px 14px;word-wrap:break-word;overflow-wrap:anywhere;}
a{color:${link}} img{max-width:100%;height:auto} table{max-width:100%}
.roo-text{white-space:pre-wrap}
.roo-img-alt{color:#888;font-size:12px}
details.roo-quote{margin-top:10px}
details.roo-quote>summary{display:inline-block;list-style:none;cursor:pointer;padding:0 8px;border-radius:8px;background:${white ? '#e8eaed' : '#333'};color:${white ? '#444' : '#ccc'};font-size:12px;line-height:16px;letter-spacing:1px}
details.roo-quote>summary::-webkit-details-marker{display:none}
details.roo-quote[open]>summary{margin-bottom:8px}
details.roo-quote>:not(summary){color:${white ? '#555' : '#aaa'};border-left:2px solid ${white ? '#ddd' : '#444'};padding-left:10px}
</style></head><body>${html}</body></html>`;

  const fit = useCallback(() => {
    const f = ref.current;
    const d = f?.contentDocument;
    if (!f || !d?.documentElement) return;
    f.style.height = `${Math.min(Math.max(d.documentElement.scrollHeight, 40), 20000)}px`;
  }, []);

  const onLoad = () => {
    const d = ref.current?.contentDocument;
    if (!d) return;
    fit();
    d.addEventListener('click', (e) => {
      const a = (e.target as Element | null)?.closest?.('a');
      if (!a) return;
      e.preventDefault(); // links never navigate the frame; web links open in the browser
      const href = a.getAttribute('href') ?? '';
      if (/^https?:\/\//i.test(href)) openExternal(href);
    });
    d.addEventListener('toggle', fit, true); // the quoted-text fold changes the height
    d.querySelectorAll('img').forEach((img) => img.addEventListener('load', fit));
  };

  return (
    <iframe
      ref={ref}
      title="Email message"
      sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
      srcDoc={doc}
      onLoad={onLoad}
      style={{ width: '100%', border: 'none', display: 'block', height: '60px', borderRadius: '8px', background: white ? '#fff' : 'transparent' }}
    />
  );
}

function MessageCard({ m, open, onToggle, images, last }: { m: ThreadMessage; open: boolean; onToggle: () => void; images: boolean; last: boolean }) {
  const { tokens, resolvedTheme } = useTheme();
  const c = tokens.colors;
  const draft = !!m.draft;
  return (
    <div
      style={{
        borderBottom: last ? 'none' : `1px solid ${c.border}`,
        ...(draft ? { border: `1px dashed ${c.warning}`, borderRadius: tokens.radius.md, marginTop: '10px', background: c.bgElevated } : {}),
      }}
    >
      <button
        onClick={onToggle}
        style={{
          display: 'flex', gap: '10px', alignItems: 'baseline', width: '100%', padding: '10px 12px', textAlign: 'left',
          background: 'transparent', border: 'none', color: c.text, fontFamily: 'inherit', cursor: 'pointer',
        }}
      >
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: 'flex', gap: '8px', alignItems: 'baseline', flexWrap: 'wrap' }}>
            <span style={{ fontSize: tokens.type.body, fontWeight: m.unread ? 700 : 600 }}>{m.from_me ? `${who(m.from)} (me)` : who(m.from)}</span>
            {!open && m.from.email && m.from.name && <span style={{ fontSize: tokens.type.micro, color: c.textDim }}>{m.from.email}</span>}
            {draft && (
              <span style={{ fontSize: tokens.type.micro, fontWeight: 600, color: c.warning, border: `1px solid ${c.warning}`, borderRadius: '6px', padding: '0 6px' }}>
                {m.label || 'Draft — not sent'}
              </span>
            )}
          </span>
          {open ? (
            <span style={{ display: 'block', fontSize: tokens.type.micro, color: c.textMuted, marginTop: '2px', lineHeight: 1.5 }}>
              {m.from.email && <>{m.from.email}<br /></>}
              to {list(m.to) || '—'}
              {m.cc.length > 0 && <> · cc {list(m.cc)}</>}
            </span>
          ) : (
            <span style={{ display: 'block', fontSize: tokens.type.small, color: c.textMuted, marginTop: '2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {m.snippet || ''}
            </span>
          )}
        </span>
        <span style={{ display: 'flex', gap: '6px', alignItems: 'center', fontSize: tokens.type.micro, color: c.textDim, whiteSpace: 'nowrap' }}>
          {m.attachments.length > 0 && <span title={`${m.attachments.length} attachment${m.attachments.length === 1 ? '' : 's'}`}>📎</span>}
          {when(m.date)}
        </span>
      </button>
      {open && (
        <div style={{ padding: '0 12px 12px' }}>
          <MessageBody html={m.body_html} rich={!!m.rich} images={images} dark={resolvedTheme === 'dark'} />
          {m.attachments.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '8px' }}>
              {m.attachments.map((a, i) => (
                <span key={i} title={a.mime} style={{ fontSize: tokens.type.micro, color: c.textMuted, border: `1px solid ${c.border}`, borderRadius: '6px', padding: '3px 8px' }}>
                  {a.name}{a.size ? <span style={{ color: c.textDim }}> · {size(a.size)}</span> : null}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * The thread view. `hideDraft`: the caller shows the Outbox draft itself (with Edit/Send) right after.
 */
export function EmailThread({ source, hideDraft = false, fallbackUrl = null }: { source: ThreadSource; hideDraft?: boolean; fallbackUrl?: string | null }) {
  const { tokens } = useTheme();
  const c = tokens.colors;
  const [data, setData] = useState<EmailThreadData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState<Record<number, boolean>>({});
  const key = JSON.stringify(source);

  const load = useCallback(async (images: boolean) => {
    setLoading(true);
    setError(null);
    try {
      setData(await readEmailThread(JSON.parse(key) as ThreadSource, images));
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [key]);

  useEffect(() => {
    setData(null);
    setOpen({});
    load(false);
  }, [load]);

  if (!data) {
    return (
      <div style={{ fontSize: tokens.type.small, color: error ? c.danger : c.textDim, padding: '10px 2px' }}>
        {error ? `Couldn't load the thread: ${error}` : 'Loading the thread…'}
        {error && (
          <button className="btn btn-secondary" style={{ marginLeft: '10px' }} onClick={() => load(false)}>Try again</button>
        )}
        {error && fallbackUrl && (
          <button className="btn btn-secondary" style={{ marginLeft: '8px' }} onClick={() => openExternal(fallbackUrl)}>Open in Gmail</button>
        )}
      </div>
    );
  }

  const msgs: ThreadMessage[] = [...data.messages, ...(data.draft && !hideDraft ? [{ ...data.draft, id: 'draft' }] : [])];
  const lastIdx = data.messages.length - 1;
  const isOpen = (i: number, m: ThreadMessage) => open[i] ?? (m.draft || i === lastIdx || !!m.unread);
  const allOpen = msgs.every((m, i) => isOpen(i, m));

  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', marginBottom: '6px' }}>
        <span style={{ fontSize: tokens.type.small, color: c.textMuted, flex: 1 }}>
          {data.messages.length > 0
            ? `${data.count} message${data.count === 1 ? '' : 's'} in this thread${data.account_label ? ` · ${data.account_label}` : ''}`
            : 'New conversation: nothing earlier to show'}
          {data.count > data.messages.length && ` (latest ${data.messages.length} shown)`}
        </span>
        {msgs.length > 1 && (
          <button className="btn btn-secondary" onClick={() => setOpen(Object.fromEntries(msgs.map((_, i) => [i, !allOpen])))}>
            {allOpen ? 'Collapse all' : 'Expand all'}
          </button>
        )}
        {data.remote_images > 0 && !data.images && (
          <button className="btn btn-secondary" disabled={loading} onClick={() => load(true)} title="Remote images can tell the sender you opened this">
            {loading ? 'Loading…' : 'Load images'}
          </button>
        )}
        {(data.gmail_url || fallbackUrl) && (
          <button className="btn btn-secondary" onClick={() => openExternal(data.gmail_url || fallbackUrl)} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Icon name="external-link" size={12} color="currentColor" /> Open in Gmail
          </button>
        )}
      </div>
      {data.error && <div style={{ fontSize: tokens.type.small, color: c.warning, marginBottom: '6px' }}>{data.error}</div>}
      {msgs.length > 0 && (
        <div style={{ border: `1px solid ${c.border}`, borderRadius: tokens.radius.md, background: c.bgCard, overflow: 'hidden' }}>
          {msgs.map((m, i) => (
            <MessageCard
              key={`${m.id ?? i}-${i}`}
              m={m}
              open={isOpen(i, m)}
              images={data.images}
              last={i === msgs.length - 1}
              onToggle={() => setOpen((o) => ({ ...o, [i]: !isOpen(i, m) }))}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/** A full-window sheet with one thread, for rows that used to jump straight to Gmail. */
export function EmailThreadModal({ title, source, fallbackUrl, onClose }: { title: string; source: ThreadSource; fallbackUrl?: string | null; onClose: () => void }) {
  const { tokens } = useTheme();
  const c = tokens.colors;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.45)', display: 'flex', justifyContent: 'center', alignItems: 'flex-start', padding: '48px 24px' }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={title}
        style={{ width: 'min(860px, 100%)', maxHeight: 'calc(100vh - 96px)', overflow: 'auto', background: c.bgElevated, border: `1px solid ${c.border}`, borderRadius: tokens.radius.lg, padding: '18px 20px', boxShadow: '0 20px 60px rgba(0,0,0,0.35)' }}
      >
        <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-start', marginBottom: '10px' }}>
          <div style={{ flex: 1, fontSize: '19px', fontWeight: 600, lineHeight: 1.35, color: c.text }}>{title}</div>
          <button className="btn btn-secondary" onClick={onClose} aria-label="Close">
            <Icon name="close" size={14} color="currentColor" />
          </button>
        </div>
        <EmailThread source={source} fallbackUrl={fallbackUrl} />
      </div>
    </div>
  );
}
