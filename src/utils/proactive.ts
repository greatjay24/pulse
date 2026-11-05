// Proactive voice: Roo speaks first, in one short sentence, when the watcher has something that
// needs the owner (a reply to send, a decision, money, a meeting about to start). Pure functions only:
// the hook (hooks/useProactiveVoice.ts) reads, gates and speaks.
//
// Privacy: what is spoken is built from templates, never read out raw. Amounts, account and phone
// numbers, addresses, links and anything token-shaped are removed; bank and card alerts are
// spoken as "an account notice"; text messages say who, never what.

export interface NotifyRow {
  id: string;
  at?: string;
  delivered_at?: string;
  level?: string; // info | urgent
  entity?: string | null;
  title?: string;
  source?: string | null;
  event_key?: string | null;
}

export interface CalendarRow {
  id: string;
  start: string;
  summary?: string | null;
  my_response?: string | null;
  people?: number;
}

export interface Interrupt {
  id: string;
  at: number; // ms: when it reached Roo
  clause: string; // "Northwind replied about the proposal"
  ask: string | null; // "Want me to draft a response?"
  draft: string; // what the Roo thread's box is filled with when the owner opens it
}

export const BATCH_MS = 10 * 60 * 1000; // at most one spoken interrupt per 10 minutes
export const STALE_MS = 2 * 60 * 60 * 1000; // older than this, the brief or Roo covers it
export const MEETING_SOON_MS = 10 * 60 * 1000;
const SHORT_WORDS = 8;

// "21:00"-"08:00": wraps midnight. Equal times mean never quiet.
export function isQuiet(now: Date, start: string, end: string): boolean {
  const hm = (s: string) => {
    const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
    return m ? Number(m[1]) * 60 + Number(m[2]) : null;
  };
  const s = hm(start);
  const e = hm(end);
  if (s === null || e === null || s === e) return false;
  const t = now.getHours() * 60 + now.getMinutes();
  return s < e ? t >= s && t < e : t >= s || t < e;
}

// Removes what must never be said aloud.
export function scrub(text: string): string {
  return (text ?? '')
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/\S+@\S+\.\S+/g, ' ')
    .replace(/\b(sk|pk|rk|whsec|ghp|gho|xox[a-z])[_-][A-Za-z0-9_-]{6,}/g, ' ')
    .replace(/\b[A-Za-z0-9_-]{24,}\b/g, ' ')
    .replace(/(?:[$€£¥]|\b(?:USD|EUR|GBP)\s?)\s?\d[\d,]*(?:\.\d+)?\s?(?:[kKmMbB]\b|(?:thousand|million|billion)\b)?/g, 'an amount')
    .replace(/\b\d[\d,]*(?:\.\d+)?\s?(?:dollars|bucks|USD)\b/gi, 'an amount')
    .replace(/\(?\b(?:acct|account|card|ending(?: in)?|x{2,})\.?\s*#?\s*\d{2,}\)?/gi, ' ')
    .replace(/\+?\d[\d\s().-]{6,}\d/g, ' ')
    .replace(/\b\d{4,}\b/g, ' ')
    .replace(/[\[\]{}<>|*_`#"]/g, '')
    .replace(/\(\s*\)/g, '')
    .replace(/\s+([,.:;!?])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

// A title cut to a few words for the ear: scrubbed, amounts dropped rather than named.
const DANGLING = /^(for|on|to|and|or|the|a|an|of|with|in|at|about|from|by|re|–|-|—)$/i;
function short(text: string, words = SHORT_WORDS): string {
  const clean = scrub(text).replace(/[,;:]?\s*\ban amount\b/g, '').replace(/\s@\s/g, ' at ').replace(/:\s+/g, ', ');
  const w = clean.split(' ').filter(Boolean).slice(0, words);
  while (w.length && DANGLING.test(w[w.length - 1].replace(/[.,;:]+$/, ''))) w.pop();
  return w.join(' ').replace(/[.:;,\s]+$/, '');
}

// Money words in a task or deadline title: say only that there is one.
const MONEY_WORDS = /(overdraft|balance|declined|payment|loan|statement|invoice|tax|settlement|refund|deposit|bank|card|wire|transfer)/i;

// Sentence case reads naturally after "about" ("Site visit notes" -> "site visit notes");
// Title Case and acronyms are likely names, so they stay.
function lowerFirst(s: string): string {
  const rest = s.split(' ').slice(1);
  return /^[A-Z][a-z]/.test(s) && !rest.some((w) => /^[A-Z]/.test(w)) ? s.charAt(0).toLowerCase() + s.slice(1) : s;
}

// Senders that never expect a reply (same idea as watch.py's AUTOMATED).
const AUTOMATED = /^(no[-._]?reply|do[-._]?not[-._]?reply|notifications?|notify|alerts?|mailer-daemon|updates?|news(letter)?|marketing|hello|info|receipts?|support|billing|statements?)|no[-._]?reply|notifications?/i;
const FINANCIAL = /(chase|bank|coinbase|amex|americanexpress|capitalone|citi|wellsfargo|mercury|paypal|venmo|zelle|fidelity|schwab|vanguard|robinhood|discover|synchrony|creditcard|credit|irs\.gov|ally|sofi|brex|ramp)/i;
const FREE_MAIL = /^(gmail|googlemail|yahoo|outlook|hotmail|live|icloud|me|mac|aol|proton|protonmail|msn|comcast)\./i;

function orgOf(domain: string): string | null {
  if (FREE_MAIL.test(domain)) return null;
  const parts = domain.toLowerCase().split('.');
  const base = parts.length >= 2 ? parts[parts.length - 2] : parts[0];
  if (!base || base.length < 2 || /\d/.test(base)) return null;
  return base.charAt(0).toUpperCase() + base.slice(1);
}

function cleanSubject(subject: string): { reply: boolean; topic: string } {
  let s = subject.replace(/\[[^\]]*\]/g, ' ');
  let reply = false;
  for (;;) {
    const m = /^\s*(re|fwd?|fw|aw|tr)\s*:\s*/i.exec(s);
    if (!m) break;
    if (/^re/i.test(m[1])) reply = true;
    s = s.slice(m[0].length);
  }
  return { reply, topic: lowerFirst(short(s)) };
}

function forWhom(entity: string | null | undefined, names: Record<string, string>): string {
  if (!entity || entity === 'personal') return 'you';
  return names[entity] ?? entity.charAt(0).toUpperCase() + entity.slice(1);
}

function rowTime(r: NotifyRow): number {
  const t = Date.parse(r.delivered_at || r.at || '');
  return Number.isFinite(t) ? t : 0;
}

// One watcher row -> what Roo would say, or null when it isn't for the owner to act on now.
export function interruptFor(r: NotifyRow, names: Record<string, string> = {}): Interrupt | null {
  const title = (r.title ?? '').replace(/\s+/g, ' ').trim();
  const src = r.source ?? '';
  const key = r.event_key ?? '';
  const who = forWhom(r.entity, names);
  const urgent = r.level === 'urgent';
  const at = rowTime(r);
  const make = (clause: string, ask: string | null, draft: string): Interrupt | null =>
    clause.trim() ? { id: r.id, at, clause: clause.trim(), ask, draft } : null;
  const look = 'Want to take a look?';

  if (src === 'email') {
    const m = /^([^\s:]+@[^\s:]+):\s*(.*)$/.exec(title);
    if (!m) return urgent ? make(`an urgent email for ${who}`, look, `The watcher flagged this email: ${title}. What do I need to do?`) : null;
    const [, sender, subject] = m;
    const [local, domain = ''] = sender.toLowerCase().split('@');
    const draft = `This email came in: ${title}. Read the whole thread and draft a reply in the Outbox for me to review.`;
    if (AUTOMATED.test(local) || AUTOMATED.test(domain)) {
      if (FINANCIAL.test(domain)) return make(`there's a new account notice for ${who}`, look, `An account notice came in: ${title}. What do I need to do? Don't read me balances.`);
      return urgent ? make(`an urgent notice for ${who}`, look, draft) : null;
    }
    const { reply, topic } = cleanSubject(subject);
    const org = orgOf(domain);
    const about = topic ? ` about ${topic}` : '';
    const clause = org ? `${org} ${reply ? 'replied' : 'emailed'}${about}` : `${reply ? 'a reply' : 'a new email'} for ${who}${about}`;
    return make(clause, 'Want me to draft a response?', draft);
  }

  if (src === 'voice') {
    const m = /^(Text|Voicemail|Missed call|Group text) from (.+?)(?::|\s\(|$)/.exec(title);
    if (!m) return null;
    const name = short(m[2], 4);
    const kind = m[1].toLowerCase();
    const article = kind === 'voicemail' ? 'a voicemail' : `a ${kind}`;
    return make(`${article} from ${name || 'an unknown number'}`, null, `I got ${article} from ${name || 'an unknown number'} on Google Voice. What do I need to do?`);
  }

  if (src === 'stripe' || src === 'payments') {
    if (/^Payment failed/i.test(title)) return make(`a payment for ${who} failed`, look, `A payment failed: ${title}. What should I do?`);
    if (/^Dispute/i.test(title)) return make(`a dispute was opened for ${who}`, look, `A dispute was opened: ${title}. Walk me through it.`);
    if (/^Invoice overdue/i.test(title)) return make(`an invoice for ${who} is overdue`, look, `An invoice is overdue: ${title}. Draft a reminder in the Outbox.`);
    return urgent ? make(`something about money for ${who}`, look, `${title}. What do I need to do?`) : null;
  }

  if (src === 'calendar') {
    const m = /^Invite (?:waiting|from [^:]+):\s*(.+?)(?:\s\(.*)?$/.exec(title);
    if (m) return make(`a new invite is waiting: ${short(m[1])}`, look, `An invite is waiting: ${title}. Should I accept?`);
    return null;
  }

  if (src === 'deadlines') {
    const decision = key.startsWith('deadline:decision') || key.startsWith('deadline:action') || key.startsWith('task:');
    if (!decision && !urgent) return null;
    const m = /^(Past due[^:]*|Due today|Due in [^:]+|Back on your list today):\s*(.+)$/.exec(title);
    const raw = m ? m[2] : title;
    const what = FINANCIAL.test(raw) || MONEY_WORDS.test(raw) ? `a money item for ${who}` : short(raw);
    if (!what) return null;
    const when = !m ? 'needs you' : /^Past due/i.test(m[1]) ? 'past due' : /^Due today/i.test(m[1]) ? 'due today' : /^Back/i.test(m[1]) ? 'back on your list today' : 'due soon';
    return make(`${when}: ${what}`, null, `${title}. Help me close this out.`);
  }

  if (urgent) {
    const what = short(title);
    return make(what ? `something urgent for ${who}: ${what}` : `something urgent for ${who}`, look, `${title}. What do I need to do?`);
  }
  return null;
}

// A meeting with other people that starts within ten minutes.
export function meetingInterrupt(e: CalendarRow, now: number): Interrupt | null {
  const start = Date.parse(e.start);
  if (!Number.isFinite(start) || (e.people ?? 0) < 2 || e.my_response === 'declined') return null;
  const left = start - now;
  if (left <= 0 || left > MEETING_SOON_MS) return null;
  const mins = Math.max(1, Math.round(left / 60000));
  const what = short(e.summary ?? '', 6) || 'your next meeting';
  return {
    id: `cal-${e.id}-${start}`.replace(/[^A-Za-z0-9_:.-]/g, '-').slice(0, 80),
    at: now,
    clause: `${what} starts in ${mins} minute${mins === 1 ? '' : 's'}`,
    ask: null,
    draft: `My meeting "${e.summary ?? ''}" starts in ${mins} minutes. Give me a two-line prep.`,
  };
}

function listOf(parts: string[]): string {
  if (parts.length <= 1) return parts.join('');
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(', ')}, and ${parts[parts.length - 1]}`;
}

const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];

// Several interrupts -> one sentence, addressed by name when the registry gives one
// (portfolio.json front_door.call_owner).
export function sentenceFor(items: Interrupt[], name: string | null = null): string {
  if (items.length === 0) return '';
  const open = (rest: string) => (name ? `${name}, ${rest}` : rest.charAt(0).toUpperCase() + rest.slice(1));
  if (items.length === 1) {
    const it = items[0];
    return `${open(it.clause)}.${it.ask ? ` ${it.ask}` : ''}`;
  }
  const n = WORDS[items.length] ?? String(items.length);
  if (items.length <= 3) return `${open(`${n} things`)}: ${listOf(items.map((i) => i.clause))}.`;
  return `${open(`${n} things need you`)}, starting with ${items[0].clause} and ${items[1].clause}. They're in Roo.`;
}

export function ownerNameOf(registry: unknown): string | null {
  const v = (registry as { front_door?: { call_owner?: unknown } } | null)?.front_door?.call_owner;
  return typeof v === 'string' && /^[\p{L} .'-]{1,30}$/u.test(v.trim()) ? v.trim() : null;
}

export function draftFor(items: Interrupt[]): string {
  if (items.length === 1) return items[0].draft;
  return `A few things came in:\n${items.map((i) => `- ${i.draft}`).join('\n')}\nTake them in order and tell me what you need from me.`;
}

// The first 2-3 sentences of a brief's spoken paragraph, scrubbed.
export function briefOpening(spoken: string, sentences = 3): string {
  const parts = scrub(spoken).split(/(?<=[.!?])\s+(?=[A-Z0-9"'])/).filter(Boolean);
  return parts.slice(0, sentences).join(' ');
}

export function localDay(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function isFresh(it: Interrupt, now: number): boolean {
  return it.at > 0 && now - it.at < STALE_MS;
}

// ------------------------------------------------------------------
// Meeting prep (~/portfolio/bin/meeting_prep.py writes the briefs and when each is due)
// ------------------------------------------------------------------

export interface PrepRow {
  key: string;
  title?: string;
  start: string;
  entity?: string | null;
  who?: string | null; // "Sam at Northwind": made for speech by the watcher
  spoken?: string | null; // the brief in at most two sentences
  status?: string; // ready | pending | thin | prepped_elsewhere | retry | failed
  slots?: Record<string, string>; // night | pre -> ISO time
  delivered?: Record<string, unknown>;
  ids?: string[]; // the calendar event ids it covers
}

export interface PrepOffer {
  tag: string; // "<key>:<slot>": what Roo tells the watcher it offered
  slot: 'night' | 'pre';
  text: string; // what Roo says and shows
  spoken: string; // the brief itself, said when the owner says yes
  draft: string; // the Roo thread's box when the owner opens it
}

export const PREP_NIGHT_WINDOW_MS = 150 * 60 * 1000; // a night brief not offered by 22:30 waits for the morning

function clockOf(d: Date): string {
  const h = d.getHours() % 12 || 12;
  const m = d.getMinutes();
  return `${h}${m ? `:${String(m).padStart(2, '0')}` : ''} ${d.getHours() < 12 ? 'am' : 'pm'}`;
}

// The prep due now for one meeting, or null. Ready briefs only; a slot is offered once (here or by
// Telegram), never after the meeting starts. Quiet hours don't apply: these nudges are deliberate.
export function prepOffer(r: PrepRow, now: number, offered: Set<string>, name: string | null = null): PrepOffer | null {
  if (!r || r.status !== 'ready' || typeof r.key !== 'string') return null;
  const start = Date.parse(r.start);
  if (!Number.isFinite(start) || now >= start) return null;
  const slots = (['pre', 'night'] as const).filter((s) => typeof r.slots?.[s] === 'string');
  for (const slot of slots) {
    const at = Date.parse(r.slots![slot]);
    const tag = `${r.key}:${slot}`;
    if (!Number.isFinite(at) || now < at || offered.has(tag) || r.delivered?.[slot]) continue;
    if (slot === 'night' && now - at > PREP_NIGHT_WINDOW_MS) continue;
    const hey = name ? `Hey ${name}, ` : 'Hey, ';
    const who = short(r.who ?? '', 6);
    const title = short(r.title ?? '', 6) || 'your meeting';
    const meeting = who ? `your meeting with ${who}` : title;
    const mins = Math.max(1, Math.round((start - now) / 60000));
    const text =
      slot === 'pre'
        ? `${hey}${meeting} is in ${mins} minute${mins === 1 ? '' : 's'}. Want a quick brief?`
        : `${hey}${meeting} is tomorrow at ${clockOf(new Date(start))}. Your brief is ready. Want a quick look?`;
    return {
      tag,
      slot,
      text,
      spoken: briefOpening(r.spoken ?? '', 2),
      draft: `Give me the quick brief for "${r.title ?? ''}". It's in ~/portfolio/watch/prep/${r.key}.md.`,
    };
  }
  return null;
}

// Calendar ids a ready brief covers: Roo's plain "starts in 10 minutes" stays quiet for those.
export function preppedIds(rows: PrepRow[]): Set<string> {
  const out = new Set<string>();
  for (const r of rows) if (r?.status === 'ready') for (const id of r.ids ?? []) if (typeof id === 'string') out.add(id);
  return out;
}

// One reminder per meeting when the same one is on two of the owner's calendars.
export function dedupeCalendar(rows: CalendarRow[]): CalendarRow[] {
  const seen = new Set<string>();
  return rows.filter((e) => {
    const words = (e.summary ?? '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter(Boolean).slice(0, 2).join(' ');
    const k = `${Date.parse(e.start)}|${words}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
