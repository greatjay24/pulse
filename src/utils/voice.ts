import { invoke } from '@tauri-apps/api/core';
import { IS_TAURI } from './orgSource';

// Voice: replies read aloud with macOS's own voices (Rust `speak`, which runs `say`), and the
// global hotkey that opens the listening panel. Settings are kept on this machine only.

export type SpeakMode = 'summary' | 'full' | 'off';

export interface VoiceSettings {
  mode: SpeakMode; // summary: the first paragraph only (default); full: the whole reply
  voice: string | null; // an installed voice; null = the system voice
  rate: number; // words a minute
  hotkey: string; // Tauri accelerator for the listening panel
}

export const DEFAULT_HOTKEY = 'Alt+Shift+Space';
const KEY = 'pulse-voice';
const DEFAULTS: VoiceSettings = { mode: 'summary', voice: null, rate: 190, hotkey: DEFAULT_HOTKEY };
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
      voice: typeof v.voice === 'string' && v.voice ? v.voice : null,
      rate: typeof v.rate === 'number' && v.rate >= 80 && v.rate <= 400 ? v.rate : DEFAULTS.rate,
      hotkey: typeof v.hotkey === 'string' && v.hotkey ? v.hotkey : DEFAULT_HOTKEY,
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

// Text fit for the ear: no markdown, links, code or bullets.
export function speakable(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/^\s*(#{1,6}|[-*•]|\d+\.)\s+/gm, '')
    .replace(/[*_~>|]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// The summary line: the reply's first paragraph (the front door writes its one-sentence answer,
// or a brief's spoken sentences, there), clipped to what's quick to hear.
export function summaryOf(text: string): string {
  const first = (text ?? '').trim().split(/\n\s*\n|\n---/)[0] ?? '';
  const spoken = speakable(first);
  return spoken.length > 600 ? spoken.slice(0, 600).replace(/\s+\S*$/, '') + '.' : spoken;
}

export async function speak(text: string, full = false) {
  if (!IS_TAURI) return;
  const v = loadVoice();
  const say = full ? speakable(text) : summaryOf(text);
  if (!say) return;
  await invoke('speak', { text: say, voice: v.voice, rate: v.rate });
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
