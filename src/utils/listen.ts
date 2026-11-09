// How the listening panel decides you're done talking. Kept free of imports so node's test
// runner can load it (tests/listen.test.ts). Settings live on this machine only.

// press: the hotkey starts listening, the hotkey again (or Enter) sends. Pauses never send.
// hold:  hold the hotkey while you talk, let go to send (a quick tap works like press).
// pause: sends after a pause of `pauseSecs` (the old behaviour), or on Enter.
export type ListenMode = 'press' | 'hold' | 'pause';

export interface ListenSettings {
  mode: ListenMode;
  pauseSecs: number; // pause mode only
  converse: boolean; // conversation mode: the panel opens always listening (see Converse below)
  endpointSecs: number; // conversation mode: the pause that ends a turn
}

export const LISTEN_MODES: { value: ListenMode; label: string }[] = [
  { value: 'press', label: 'Press to send' },
  { value: 'hold', label: 'Hold to talk' },
  { value: 'pause', label: 'Send when I pause' },
];
export const PAUSE_MIN = 1;
export const PAUSE_MAX = 6;
export const MAX_LISTEN_SECS = 180; // one thought, however long, up to three minutes
export const HOLD_MIN_MS = 600; // a hold shorter than this is a tap
const KEY = 'pulse-listen';
export const ENDPOINT_MIN = 0.6;
export const ENDPOINT_MAX = 2;
const DEFAULTS: ListenSettings = { mode: 'press', pauseSecs: 2.5, converse: false, endpointSecs: 1 };

export function parseListen(raw: string | null): ListenSettings {
  try {
    const v = JSON.parse(raw ?? '{}');
    const mode: ListenMode = v?.mode === 'hold' || v?.mode === 'pause' ? v.mode : 'press';
    const p = Number(v?.pauseSecs);
    const pauseSecs = Number.isFinite(p) && p >= PAUSE_MIN && p <= PAUSE_MAX ? Math.round(p * 10) / 10 : DEFAULTS.pauseSecs;
    const e = Number(v?.endpointSecs);
    const endpointSecs = Number.isFinite(e) && e >= ENDPOINT_MIN && e <= ENDPOINT_MAX ? Math.round(e * 10) / 10 : DEFAULTS.endpointSecs;
    return { mode, pauseSecs, converse: v?.converse === true, endpointSecs };
  } catch {
    return { ...DEFAULTS };
  }
}

export function loadListen(): ListenSettings {
  try {
    return parseListen(localStorage.getItem(KEY));
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveListen(s: ListenSettings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // no storage: the defaults apply next time
  }
}

// pulse-listen's pause and max (Rust start_listening): pause 0 = only the hotkey or Enter sends.
export function helperArgs(s: ListenSettings): { pause: number; max: number } {
  return { pause: s.mode === 'pause' ? s.pauseSecs : 0, max: MAX_LISTEN_SECS };
}

// The line the panel shows while it listens.
export function listeningHint(s: ListenSettings, hotkey: string): string {
  if (s.mode === 'hold') return `Listening. Let go of ${hotkey} to send.`;
  if (s.mode === 'pause') return `Listening. Pause ${s.pauseSecs} s or press Enter to send.`;
  return `Listening. Press ${hotkey} again to send.`;
}

// What the hotkey does in the panel, by what the panel is doing.
export function onHotkey(
  s: ListenSettings,
  key: 'pressed' | 'released',
  phase: string,
  heldMs: number,
): 'send' | 'restart' | 'none' {
  const listening = phase === 'listening' || phase === 'starting';
  if (key === 'released') return s.mode === 'hold' && listening && heldMs >= HOLD_MIN_MS ? 'send' : 'none';
  if (listening || phase === 'typing') return 'send';
  if (phase === 'reply' || phase === 'error' || phase === 'waiting') return 'restart';
  return 'none';
}

// What to send when the helper's final transcript arrives: its text, unless it came back emptier
// than the words already on screen (a recognizer reset after a pause), which then win.
export function finalText(final: string, onScreen: string): string {
  const f = (final ?? '').trim();
  const o = (onScreen ?? '').trim();
  if (!f) return o;
  if (f.length < o.length && (o.includes(f) || f.length < o.length / 2)) return o;
  return f;
}

// ---------------------------------------------------------------------------------------------
// Conversation mode: always listening, full duplex. pulse-listen --converse streams what it hears
// in the current turn ({type:'partial', text, turn}); this decides, from the outside:
//   - when a turn is over (a pause of endpointSecs), so the panel sends it and asks for the next;
//   - what of it is Roo's own voice leaking back (the echo gate, on top of the helper's echo
//     cancellation): words that follow what Roo is saying, or said a moment ago, are dropped;
//   - barge-in: real words from the owner while Roo talks stop Roo at once;
//   - when the conversation has gone quiet long enough to switch itself off.

export const CONVERSE_IDLE_MS = 5 * 60_000; // no one has said anything for five minutes: off
export const ECHO_TAIL_MS = 1500; // the recognizer lags Roo's voice by about this much
export const BARGE_MIN_WORDS = 2; // one stray word isn't an interruption ("stop" is)

const norm = (w: string) => w.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

// The heard text with Roo's own words taken out. A stretch of heard words is echo when it follows
// Roo's text pair by pair for three words or more; Roo's words right next to such a stretch, and a
// single misheard word inside one, go with it. Two words or fewer, all Roo's, are echo too.
// What's left is the owner's.
export function stripEcho(heard: string, spoken: string): string {
  const raw = (heard ?? '').split(/\s+/).filter((w) => norm(w));
  const h = raw.map(norm);
  const s = (spoken ?? '').split(/\s+/).map(norm).filter(Boolean);
  if (!h.length) return '';
  if (!s.length) return raw.join(' ');
  const vocab = new Set(s);
  if (h.length <= 2) return h.every((w) => vocab.has(w)) ? '' : raw.join(' ');
  const pairs = new Set(s.slice(1).map((w, i) => `${s[i]} ${w}`));
  const cov = h.map(() => false);
  for (let i = 0; i + 1 < h.length; i++) if (pairs.has(`${h[i]} ${h[i + 1]}`)) cov[i] = cov[i + 1] = true;
  // Only stretches of three or more count: two words in common is just English.
  for (let i = 0; i < h.length; ) {
    if (!cov[i]) {
      i++;
      continue;
    }
    let j = i;
    while (j < h.length && cov[j]) j++;
    if (j - i < 3) for (let k = i; k < j; k++) cov[k] = false;
    i = j;
  }
  // Grow over Roo's words next to a stretch, and over one misheard word before more of Roo's.
  for (let changed = true; changed; ) {
    changed = false;
    for (let i = 0; i < h.length; i++) {
      if (cov[i]) continue;
      const after = i > 0 && cov[i - 1];
      const before = i + 1 < h.length && cov[i + 1];
      const misheard = after && i + 1 < h.length && vocab.has(h[i + 1]);
      if (((after || before) && vocab.has(h[i])) || misheard) {
        cov[i] = true;
        changed = true;
      }
    }
  }
  return raw.filter((_, i) => !cov[i]).join(' ');
}

const STOP_PHRASES = new Set(['stop', 'wait', 'hold on', 'hang on', 'never mind', 'nevermind', 'shush', 'quiet', 'be quiet', 'pause', 'enough', 'cancel', 'stop talking', 'shut up', 'thats enough']);
const LEAD_INS = new Set(['hey', 'roo', 'ok', 'okay', 'no', 'oh']);

// "Stop", "hey Roo, wait", "stop stop": telling Roo to be quiet, not asking it anything.
export function isStopPhrase(own: string): boolean {
  const w = (own ?? '').split(/\s+/).map(norm).filter(Boolean);
  while (w.length > 1 && LEAD_INS.has(w[0])) w.shift();
  while (w.length > 1 && (w[w.length - 1] === 'please' || w[w.length - 1] === 'roo')) w.pop();
  if (!w.length) return false;
  return STOP_PHRASES.has(w.join(' ')) || w.every((x) => x === w[0] && STOP_PHRASES.has(x));
}

export function isBargeIn(own: string): boolean {
  const n = (own ?? '').split(/\s+/).filter((w) => norm(w)).length;
  return n >= BARGE_MIN_WORDS || (n > 0 && isStopPhrase(own));
}

export type ConverseAction =
  | { type: 'barge' } // stop Roo talking, now
  | { type: 'send'; text: string } // the turn is over: send it, then listen_next
  | { type: 'discard' } // the turn was only Roo's echo (or "stop"): listen_next, send nothing
  | { type: 'idle' }; // five quiet minutes: conversation mode off

// One conversation's turn-taking. Feed it the helper's partials, and a tick every ~150 ms, each
// with whether Roo is speaking and what Roo is saying (its reply text); act on what comes back.
export class Converse {
  private turn = 0; // partials from an earlier turn (still in flight) are ignored
  private heard = '';
  private changedAt = 0;
  private echoed = false; // some of this turn was heard while Roo spoke: gate it
  private barged = false;
  private spokeAt = -Infinity;
  private activeAt: number;
  private endpointMs: number;
  private idleMs: number;

  constructor(endpointSecs: number, now: number, idleMs = CONVERSE_IDLE_MS) {
    this.endpointMs = endpointSecs * 1000;
    this.idleMs = idleMs;
    this.activeAt = now;
  }

  // What the owner has said this turn (echo removed), for the panel to show.
  own(echo: string): string {
    return this.echoed ? stripEcho(this.heard, echo) : this.heard.trim();
  }

  private note(now: number, speaking: boolean) {
    if (speaking) this.spokeAt = this.activeAt = now;
  }

  partial(turn: number, text: string, now: number, speaking: boolean, echo: string): ConverseAction | null {
    if (turn < this.turn) return null;
    if (turn > this.turn) this.reset(turn);
    this.note(now, speaking);
    this.heard = text ?? '';
    this.changedAt = now;
    if (now - this.spokeAt < ECHO_TAIL_MS) this.echoed = true;
    const own = this.own(echo);
    if (!own) return null;
    this.activeAt = now;
    if (speaking && !this.barged && isBargeIn(own)) {
      this.barged = true;
      return { type: 'barge' };
    }
    return null;
  }

  tick(now: number, speaking: boolean, echo: string): ConverseAction | null {
    this.note(now, speaking);
    if (this.heard.trim() && now - this.changedAt >= this.endpointMs) return this.take(now, echo);
    if (now - this.activeAt >= this.idleMs) return { type: 'idle' };
    return null;
  }

  // Roo is still working on an answer: the quiet timeout waits for it.
  touch(now: number) {
    this.activeAt = now;
  }

  // The hotkey in conversation mode: take the turn now, without waiting for the pause.
  takeNow(now: number, echo: string): ConverseAction | null {
    return this.heard.trim() ? this.take(now, echo) : null;
  }

  private take(now: number, echo: string): ConverseAction {
    const own = this.own(echo);
    this.reset(this.turn + 1);
    if (!own || isStopPhrase(own)) return { type: 'discard' };
    this.activeAt = now;
    return { type: 'send', text: own };
  }

  private reset(turn: number) {
    this.turn = turn;
    this.heard = '';
    this.echoed = false;
    this.barged = false;
  }
}
