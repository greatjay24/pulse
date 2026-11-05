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
