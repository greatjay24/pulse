import { invoke } from '@tauri-apps/api/core';
import { IS_TAURI } from './orgSource';
import { DEFAULT_ENGINE, SpokenStream, VoiceEngine, engineOf, speakable, summaryOf } from './voiceText';

export { speakable, summaryOf } from './voiceText';
export type { VoiceEngine } from './voiceText';

// Voice: replies read aloud with Roo's own British voice (Kokoro on this Mac, Rust tts.rs) or
// macOS's voices (`say`, also the fallback), and the global hotkey that opens the listening
// panel. Settings are kept on this machine only.

export type SpeakMode = 'summary' | 'full' | 'off';

export interface VoiceSettings {
  mode: SpeakMode; // summary: the first paragraph only (default); full: the whole reply
  engine: VoiceEngine; // 'mac' (default) for the voice below, or Roo British 1 or 2
  voice: string | null; // an installed Mac voice; null = the system voice (default; also Roo British's fallback)
  rate: number; // words a minute (Mac and system voices)
  hotkey: string; // Tauri accelerator for the listening panel
  proactive: boolean; // Roo speaks first: interrupts and the morning brief (hooks/useProactiveVoice.ts)
  quietStart: string; // "HH:MM": no proactive speech from here...
  quietEnd: string; // ...until here
}

export const DEFAULT_HOTKEY = 'Alt+Shift+Space';
const KEY = 'pulse-voice';
const DEFAULTS: VoiceSettings = { mode: 'summary', engine: DEFAULT_ENGINE, voice: null, rate: 190, hotkey: DEFAULT_HOTKEY, proactive: true, quietStart: '21:00', quietEnd: '08:00' };
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
// Shortcuts that don't collide with common Mac apps (⌥Space is ChatGPT's and Claude's launcher).
export const HOTKEYS: { value: string; label: string }[] = [
  { value: 'Alt+Shift+Space', label: '⌥⇧Space' },
  { value: 'Control+Alt+Space', label: '⌃⌥Space' },
  { value: 'Control+Alt+KeyP', label: '⌃⌥P' },
  { value: 'Alt+Shift+KeyJ', label: '⌥⇧J' },
];

export function loadVoice(): VoiceSettings {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return {
      mode: v.mode === 'full' || v.mode === 'off' ? v.mode : 'summary',
      engine: engineOf(v.engine),
      voice: typeof v.voice === 'string' && v.voice ? v.voice : null,
      rate: typeof v.rate === 'number' && v.rate >= 80 && v.rate <= 400 ? v.rate : DEFAULTS.rate,
      hotkey: typeof v.hotkey === 'string' && v.hotkey ? v.hotkey : DEFAULT_HOTKEY,
      proactive: v.proactive !== false,
      quietStart: typeof v.quietStart === 'string' && HHMM.test(v.quietStart) ? v.quietStart : DEFAULTS.quietStart,
      quietEnd: typeof v.quietEnd === 'string' && HHMM.test(v.quietEnd) ? v.quietEnd : DEFAULTS.quietEnd,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveVoice(v: VoiceSettings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(v));
  } catch {
    // no storage: the defaults apply next time
  }
}

export async function speak(text: string, full = false) {
  if (!IS_TAURI) return;
  const v = loadVoice();
  const say = full ? speakable(text) : summaryOf(text);
  if (!say) return;
  await invoke('speak', { text: say, voice: v.voice, rate: v.rate, engine: v.engine });
}

export interface ReplyStream {
  push(text: string): void; // the reply's next piece of text, as it streams in
  end(): Promise<void>; // the reply is complete
}

// A reply read aloud while it streams in: Roo's voice starts on the first complete sentence.
// Text is markdown as written; it's cleaned for the ear here. full = false speaks the summary
// (first paragraph) only. Stop with stopSpeaking() as usual. null when there's nothing to do.
export async function speakStream(full = false): Promise<ReplyStream | null> {
  if (!IS_TAURI) return null;
  const v = loadVoice();
  const id = await invoke<number>('speak_begin', { voice: v.voice, rate: v.rate, engine: v.engine });
  const spoken = new SpokenStream(full);
  let chain = Promise.resolve(); // keep appends in order
  const send = (text: string) => {
    if (text) chain = chain.then(() => invoke<void>('speak_append', { id, text })).catch(() => {});
  };
  return {
    push: (text) => send(spoken.push(text)),
    end: () => {
      send(spoken.end());
      return (chain = chain.then(() => invoke<void>('speak_end', { id })).catch(() => {}));
    },
  };
}

// A streamed reply read aloud per the settings (null when replies aren't read aloud).
export function speakReplyStream(): Promise<ReplyStream | null> {
  const mode = loadVoice().mode;
  return mode === 'off' ? Promise.resolve(null) : speakStream(mode === 'full');
}

// Load Roo's voice ahead of the first reply (the model takes about a second to load).
export async function warmVoice() {
  if (IS_TAURI && loadVoice().engine !== 'mac') await invoke('voice_warm');
}

export interface VoiceEngineStatus {
  installed: boolean;
  reason: string | null;
}

export async function voiceEngineStatus(): Promise<VoiceEngineStatus> {
  return IS_TAURI ? invoke<VoiceEngineStatus>('voice_engine_status') : { installed: false, reason: null };
}

export async function stopSpeaking() {
  if (IS_TAURI) await invoke('stop_speaking');
}

// A reply finishing: read aloud per the settings.
export function speakReply(text: string) {
  const mode = loadVoice().mode;
  if (mode === 'off') return;
  speak(text, mode === 'full').catch(() => {});
}

export interface InstalledVoice {
  name: string;
  locale: string;
}

export async function listVoices(): Promise<InstalledVoice[]> {
  return IS_TAURI ? invoke<InstalledVoice[]>('list_voices') : [];
}

export async function applyHotkey(hotkey: string): Promise<string> {
  return invoke<string>('set_listen_hotkey', { shortcut: hotkey });
}

export async function openListenPanel() {
  if (IS_TAURI) await invoke('open_listen_panel');
}

// "Brief me", "morning brief", "end of day recap": a briefing rather than a message.
export function briefKindOf(text: string, now = new Date()): 'morning' | 'evening' | null {
  const t = text.trim().toLowerCase().replace(/[.!?]+$/, '');
  if (/^(recap|end[- ]of[- ]day( recap)?|evening (brief|recap)|recap (my|the) day|wrap (up )?(my|the) day)$/.test(t)) return 'evening';
  if (/^(morning brief|brief me( on (today|the morning))?|(give me|what'?s) (my|the) (morning )?brief(ing)?|(brief|briefing) please)$/.test(t)) {
    return t.startsWith('morning') || now.getHours() < 16 ? 'morning' : 'evening';
  }
  return null;
}

export async function briefMe(kind: 'morning' | 'evening') {
  const json = await invoke<string>('pulse_brief', { kind });
  return JSON.parse(json) as { run_id: string };
}

export function defaultBriefKind(now = new Date()): 'morning' | 'evening' {
  return now.getHours() < 16 ? 'morning' : 'evening';
}
