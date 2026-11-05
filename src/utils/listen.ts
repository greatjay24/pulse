// How the listening panel decides you're done talking. Kept free of imports so node's test
// runner can load it (tests/listen.test.ts). Settings live on this machine only.

// press: the hotkey starts listening, the hotkey again (or Enter) sends. Pauses never send.
// hold:  hold the hotkey while you talk, let go to send (a quick tap works like press).
// pause: sends after a pause of `pauseSecs` (the old behaviour), or on Enter.
export type ListenMode = 'press' | 'hold' | 'pause';

export interface ListenSettings {
  mode: ListenMode;
  pauseSecs: number; // pause mode only
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
const DEFAULTS: ListenSettings = { mode: 'press', pauseSecs: 2.5 };

export function parseListen(raw: string | null): ListenSettings {
  try {
    const v = JSON.parse(raw ?? '{}');
    const mode: ListenMode = v?.mode === 'hold' || v?.mode === 'pause' ? v.mode : 'press';
    const p = Number(v?.pauseSecs);
    const pauseSecs = Number.isFinite(p) && p >= PAUSE_MIN && p <= PAUSE_MAX ? Math.round(p * 10) / 10 : DEFAULTS.pauseSecs;
    return { mode, pauseSecs };
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
