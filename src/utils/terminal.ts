// The Terminal page's rules, kept apart from React so they can be tested (tests/terminal.test.ts).

export interface ClaudeInfo {
  name: string | null;
  status: string | null; // Claude Code's own words: idle, busy, shell
  pid: number;
}

// One terminal session on this Mac (src-tauri/src/terminals.rs `Entry`).
export interface TermEntry {
  id: string; // "tmux:<name>", "tty:/dev/ttys012" or "pid:<n>"
  kind: 'tmux' | 'terminal';
  label: string;
  tmux: string | null;
  tty: string | null;
  cwd: string | null;
  claude: ClaudeInfo | null;
  clients: number;
  activity: number | null;
}

export interface TermList {
  home: string;
  tmux: boolean;
  terminal_access: boolean | null;
  entries: TermEntry[];
}

// A Roo tab: attached to a tmux session, or a read-only mirror of a Terminal.app window.
export type TabRef = { kind: 'tmux'; name: string } | { kind: 'peek'; tty: string; label: string };

export const tabId = (t: TabRef) => (t.kind === 'tmux' ? `tmux:${t.name}` : `tty:${t.tty}`);

// The business a session belongs to, from the "Visuo · Give It a Try" names open-sessions.sh
// gives, coloured as its Terminal windows are (see ~/portfolio/bin/open-sessions.sh).
const BUSINESS_COLORS: Record<string, string> = {
  personal: '#3b6fd6',
  visuo: '#8a46d6',
  btp: '#2e9a52',
  org: '#d0901c',
  crafted: '#d64545',
  ayson: '#1e9e9e',
};

export function businessOf(label: string): string | null {
  const i = label.indexOf(' · ');
  return i > 0 ? label.slice(0, i) : null;
}

export function businessColor(label: string): string | null {
  const b = businessOf(label);
  return b ? BUSINESS_COLORS[b.toLowerCase()] ?? null : null;
}

// What Claude Code is doing, in words for the list.
export function claudeState(c: ClaudeInfo | null): { text: string; tone: 'busy' | 'waiting' | 'quiet' } | null {
  if (!c) return null;
  if (c.status === 'busy') return { text: 'working', tone: 'busy' };
  if (c.status === 'idle') return { text: 'waiting for you', tone: 'waiting' };
  if (c.status === 'shell') return { text: 'running a command', tone: 'busy' };
  return { text: 'Claude Code', tone: 'quiet' };
}

// "~/Visuo/studio-media" style, for the second line of a row.
export function shortPath(cwd: string | null, home: string | null): string {
  if (!cwd) return '';
  if (home && (cwd === home || cwd.startsWith(home + '/'))) return '~' + cwd.slice(home.length);
  return cwd;
}

// Tabs saved from last time that can come back: tmux sessions still running. (Mirrors of
// Terminal.app windows aren't restored; they're one click away in the list.)
export function restorable(saved: unknown, entries: TermEntry[]): TabRef[] {
  if (!Array.isArray(saved)) return [];
  const running = new Set(entries.filter((e) => e.kind === 'tmux' && e.tmux).map((e) => e.tmux as string));
  const seen = new Set<string>();
  const out: TabRef[] = [];
  for (const n of saved) {
    if (typeof n === 'string' && running.has(n) && !seen.has(n)) {
      seen.add(n);
      out.push({ kind: 'tmux', name: n });
    }
  }
  return out;
}

// The tab to show after closing one: its right neighbour, else its left, else none.
export function nextAfterClose(ids: string[], closing: string, active: string | null): string | null {
  if (active !== closing) return active;
  const i = ids.indexOf(closing);
  const rest = ids.filter((x) => x !== closing);
  if (!rest.length) return null;
  return rest[Math.min(i, rest.length - 1)];
}

// Keys the terminal page takes before the terminal (and before the menu): ⌘T new, ⌘W close tab,
// ⌘1..9 pick a tab, ⌘F find, ⌘= / ⌘- / ⌘0 text size. Everything else goes to the program.
export type PageKey = { do: 'new' } | { do: 'close' } | { do: 'tab'; index: number } | { do: 'find' } | { do: 'zoom'; by: 1 | -1 | 0 };

export function pageKey(e: { metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean; key: string }): PageKey | null {
  if (!e.metaKey || e.ctrlKey || e.altKey) return null;
  const k = e.key.toLowerCase();
  if (e.shiftKey) return k === '+' ? { do: 'zoom', by: 1 } : null;
  if (k === 't') return { do: 'new' };
  if (k === 'w') return { do: 'close' };
  if (k === 'f') return { do: 'find' };
  if (k === '=' || k === '+') return { do: 'zoom', by: 1 };
  if (k === '-') return { do: 'zoom', by: -1 };
  if (k === '0') return { do: 'zoom', by: 0 };
  if (/^[1-9]$/.test(k)) return { do: 'tab', index: Number(k) - 1 };
  return null;
}

// ⌘9 is the last tab, as in Terminal and browsers.
export function tabForIndex(count: number, index: number): number | null {
  if (!count) return null;
  if (index === 8) return count - 1;
  return index < count ? index : null;
}

// A name for a new terminal: what was typed, else "<folder>" (and claude names its session the same).
export function defaultName(typed: string, folderName: string): string {
  const t = typed.trim();
  return t || folderName.replace(/\s*\(.*\)\s*$/, '').trim() || 'Terminal';
}

export const FONT_SIZES = { min: 9, max: 24, start: 12 };

export function zoomed(size: number, by: 1 | -1 | 0): number {
  if (by === 0) return FONT_SIZES.start;
  return Math.max(FONT_SIZES.min, Math.min(FONT_SIZES.max, size + by));
}
