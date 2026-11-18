import { useCallback, useEffect, useRef, useState } from 'react';
import { Channel, invoke } from '@tauri-apps/api/core';
import { openUrl } from '@tauri-apps/plugin-opener';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { WebglAddon } from '@xterm/addon-webgl';
import '@xterm/xterm/css/xterm.css';
import { useTheme } from '../contexts/ThemeContext';
import { IS_TAURI } from '../utils/orgSource';
import {
  FONT_SIZES,
  TabRef,
  TermEntry,
  TermList,
  businessColor,
  claudeState,
  defaultName,
  nextAfterClose,
  pageKey,
  restorable,
  shortPath,
  tabForIndex,
  tabId,
  zoomed,
} from '../utils/terminal';
import { Icon } from './Icons';

// Terminal: every terminal session on this Mac, in tabs.
//
// Sessions Roo can attach to run inside tmux (src-tauri/src/terminals.rs): a tab is a real
// terminal (xterm.js on a pty running `tmux attach`), and Terminal.app can attach to the same
// session at the same time. Closing a tab, or quitting Roo, only detaches: the session keeps going.
// Terminal.app windows opened before that (plain shells, not tmux) are listed too; Roo can't take
// one over, so it mirrors it read-only and can bring it to the front. Nothing is typed into them.

export interface TerminalRequest {
  agent: string | null;
  nonce: number;
}

export type TerminalLayout = 'full' | 'split';

// Jay's Terminal profile is SF Mono; the system face resolves to it.
const TERM_FONT = "'SF Mono', SFMono-Regular, ui-monospace, Menlo, monospace";
const TERM_THEME = {
  background: '#101415',
  foreground: '#e8e3da',
  cursor: '#e8e3da',
  cursorAccent: '#101415',
  selectionBackground: 'rgba(120, 160, 200, 0.38)',
  black: '#1d2224',
  red: '#e5574b',
  green: '#7cc48a',
  yellow: '#e7b04f',
  blue: '#5f9fe0',
  magenta: '#c27ad8',
  cyan: '#5fbcb0',
  white: '#d8d2c8',
  brightBlack: '#6b7375',
  brightRed: '#f0806f',
  brightGreen: '#9ad7a5',
  brightYellow: '#f2c877',
  brightBlue: '#8bbbec',
  brightMagenta: '#d7a0e6',
  brightCyan: '#8ad3c9',
  brightWhite: '#f5f1ea',
};

const LIST_EVERY = 3000;
const PEEK_EVERY = 1500;
const store = {
  get<T>(k: string, fallback: T): T {
    try {
      const v = localStorage.getItem(k);
      return v === null ? fallback : (JSON.parse(v) as T);
    } catch {
      return fallback;
    }
  },
  set(k: string, v: unknown) {
    try {
      localStorage.setItem(k, JSON.stringify(v));
    } catch {
      // private mode: the page still works, it just won't remember
    }
  },
};

// ------------------------------------------
// A tab attached to a tmux session
// ------------------------------------------

interface TermHandle {
  find: (q: string, back?: boolean) => void;
  clearFind: () => void;
  focus: () => void;
}

function TmuxView({
  name,
  active,
  fontSize,
  handle,
  onEnded,
}: {
  name: string;
  active: boolean;
  fontSize: number;
  handle: (h: TermHandle | null) => void;
  onEnded: () => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const term = useRef<Terminal | null>(null);
  const fit = useRef<FitAddon | null>(null);
  const ptyId = useRef<number | null>(null);
  const resizeFrame = useRef(0);

  const sendSize = () => {
    const t = term.current;
    if (t && ptyId.current !== null) invoke('pty_resize', { id: ptyId.current, cols: t.cols, rows: t.rows }).catch(() => {});
  };

  useEffect(() => {
    if (!host.current) return;
    const t = new Terminal({
      fontFamily: TERM_FONT,
      fontSize,
      lineHeight: 1.15,
      cursorBlink: true,
      allowProposedApi: true,
      scrollback: 20_000,
      macOptionIsMeta: true,
      macOptionClickForcesSelection: true,
      rightClickSelectsWord: true,
      drawBoldTextInBrightColors: false,
      theme: TERM_THEME,
    });
    const f = new FitAddon();
    const s = new SearchAddon();
    t.loadAddon(f);
    t.loadAddon(s);
    t.loadAddon(new Unicode11Addon());
    t.unicode.activeVersion = '11';
    t.loadAddon(new WebLinksAddon((_e, uri) => void openUrl(uri).catch(() => {})));
    t.open(host.current);
    try {
      const gl = new WebglAddon();
      gl.onContextLoss(() => gl.dispose()); // falls back to the DOM renderer
      t.loadAddon(gl);
    } catch {
      // no WebGL: the DOM renderer is fine
    }
    term.current = t;
    fit.current = f;

    t.attachCustomKeyEventHandler((e) => {
      if (e.type !== 'keydown') return true;
      // Cmd+C copies a selection; with none it does nothing (Ctrl+C is the interrupt, as in Terminal).
      if (e.metaKey && !e.ctrlKey && e.key === 'c') {
        if (t.hasSelection()) navigator.clipboard.writeText(t.getSelection()).catch(() => {});
        return false;
      }
      if (e.metaKey && e.key === 'a') {
        t.selectAll();
        return false;
      }
      // Shift+Enter is a new line in Claude Code (it reads Esc+Return as Option+Return).
      if (e.key === 'Enter' && e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) {
        if (ptyId.current !== null) invoke('pty_write', { id: ptyId.current, data: '\x1b\r' }).catch(() => {});
        return false;
      }
      // Every other Cmd shortcut belongs to Roo or the page (paste arrives as a paste event).
      if (e.metaKey) return false;
      return true;
    });

    try {
      f.fit();
    } catch {
      // not laid out yet; the resize observer fits it
    }

    let disposed = false;
    const input = t.onData((data) => {
      if (ptyId.current !== null) invoke('pty_write', { id: ptyId.current, data }).catch(() => {});
    });
    const channel = new Channel<ArrayBuffer | Uint8Array | number[] | { exit?: boolean }>();
    channel.onmessage = (m) => {
      if (m instanceof ArrayBuffer) t.write(new Uint8Array(m));
      else if (m instanceof Uint8Array) t.write(m);
      else if (Array.isArray(m)) t.write(new Uint8Array(m));
      else if (m && m.exit) {
        ptyId.current = null;
        if (!disposed) {
          t.write('\r\n\x1b[2m[detached: the session ended or was closed]\x1b[0m\r\n');
          onEnded();
        }
      }
    };
    invoke<number>('term_attach', { name, cols: t.cols, rows: t.rows, onData: channel })
      .then((id) => {
        if (disposed) {
          invoke('pty_close', { id }).catch(() => {});
          return;
        }
        ptyId.current = id;
        sendSize(); // the final size, in case the layout settled while attaching
      })
      .catch((e) => {
        t.write(`\x1b[31m${String(e)}\x1b[0m\r\n`);
        onEnded();
      });

    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(resizeFrame.current);
      resizeFrame.current = requestAnimationFrame(() => {
        if (!host.current || host.current.offsetWidth === 0) return;
        const before = `${t.cols}x${t.rows}`;
        try {
          f.fit();
        } catch {
          return;
        }
        if (`${t.cols}x${t.rows}` !== before) sendSize();
      });
    });
    ro.observe(host.current);

    handle({
      find: (q, back) => void (back ? s.findPrevious(q) : s.findNext(q, { incremental: true })),
      clearFind: () => s.clearDecorations(),
      focus: () => t.focus(),
    });

    return () => {
      disposed = true;
      handle(null);
      ro.disconnect();
      cancelAnimationFrame(resizeFrame.current);
      input.dispose();
      if (ptyId.current !== null) invoke('pty_close', { id: ptyId.current }).catch(() => {});
      t.dispose();
    };
    // One terminal per tab for its whole life; size changes apply below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const t = term.current;
    if (!t || t.options.fontSize === fontSize) return;
    t.options.fontSize = fontSize;
    try {
      fit.current?.fit();
    } catch {
      return;
    }
    sendSize();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fontSize]);

  useEffect(() => {
    if (!active) return;
    requestAnimationFrame(() => {
      try {
        fit.current?.fit();
      } catch {
        // hidden
      }
      sendSize(); // tmux sizes a shared session to the client used last
      term.current?.focus();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  return <div ref={host} style={{ display: active ? 'block' : 'none', position: 'absolute', inset: '8px 4px 4px 10px' }} />;
}

// ------------------------------------------
// A Terminal.app window Roo can only show
// ------------------------------------------

function PeekView({ tty, active, fontSize }: { tty: string; active: boolean; fontSize: number }) {
  const [text, setText] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const box = useRef<HTMLPreElement>(null);
  const pinned = useRef(true);

  useEffect(() => {
    if (!active) return;
    let stop = false;
    let timer = 0;
    const tick = () => {
      invoke<string>('term_peek', { tty })
        .then((t) => {
          if (stop) return;
          setText(t);
          setError(null);
        })
        .catch((e) => {
          if (!stop) setError(String(e));
        })
        .finally(() => {
          if (!stop) timer = window.setTimeout(tick, PEEK_EVERY);
        });
    };
    tick();
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, [tty, active]);

  useEffect(() => {
    if (pinned.current && box.current) box.current.scrollTop = box.current.scrollHeight;
  }, [text]);

  return (
    <pre
      ref={box}
      onScroll={(e) => {
        const el = e.currentTarget;
        pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
      }}
      style={{
        display: active ? 'block' : 'none',
        position: 'absolute',
        inset: 0,
        margin: 0,
        padding: '10px 12px',
        overflow: 'auto',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
        fontFamily: TERM_FONT,
        fontSize,
        lineHeight: 1.15,
        color: error ? TERM_THEME.brightRed : TERM_THEME.foreground,
        background: TERM_THEME.background,
        userSelect: 'text',
      }}
    >
      {error ?? text}
    </pre>
  );
}

// ------------------------------------------
// New terminal
// ------------------------------------------

interface Folder {
  name: string;
  path: string;
}

interface NewRequest {
  name: string;
  cwd: string;
  claude: boolean;
  agent: string | null;
}

function NewTerminal({ agents, onCreate, onCancel }: { agents: string[]; onCreate: (r: NewRequest) => Promise<void>; onCancel: () => void }) {
  const { tokens } = useTheme();
  const c = tokens.colors;
  const [folders, setFolders] = useState<Folder[]>([]);
  const [cwd, setCwd] = useState<string>(() => store.get('roo.terminal.lastCwd', ''));
  const [name, setName] = useState('');
  const [claude, setClaude] = useState<boolean>(() => store.get('roo.terminal.claude', true));
  const [agent, setAgent] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    invoke<Folder[]>('term_folders')
      .then((f) => {
        setFolders(f);
        setCwd((cur) => (f.some((x) => x.path === cur) ? cur : f[0]?.path ?? ''));
      })
      .catch((e) => setError(String(e)));
    nameRef.current?.focus();
  }, []);

  const folder = folders.find((f) => f.path === cwd);
  const submit = async () => {
    if (!cwd || busy) return;
    setBusy(true);
    setError(null);
    store.set('roo.terminal.lastCwd', cwd);
    store.set('roo.terminal.claude', claude);
    try {
      await onCreate({ name: defaultName(name, folder?.name ?? ''), cwd, claude, agent: claude && agent ? agent : null });
    } catch (e) {
      setError(String(e));
      setBusy(false);
    }
  };

  const field = { background: c.bgCard, color: c.text, border: `1px solid ${c.border}`, borderRadius: tokens.radius.sm, padding: '7px 9px', fontFamily: 'inherit', fontSize: tokens.type.small, width: '100%' } as const;
  const label = { display: 'flex', flexDirection: 'column', gap: '4px', fontSize: tokens.type.small, color: c.textMuted } as const;
  return (
    <div
      onKeyDown={(e) => {
        if (e.key === 'Escape') onCancel();
        if (e.key === 'Enter' && !e.shiftKey && (e.target as HTMLElement).tagName !== 'SELECT') {
          e.preventDefault();
          void submit();
        }
      }}
      onClick={onCancel}
      style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: '60px', zIndex: 5 }}
    >
      <div
        role="dialog"
        aria-label="New terminal"
        onClick={(e) => e.stopPropagation()}
        style={{ width: 'min(440px, 92%)', background: c.bgElevated, border: `1px solid ${c.border}`, borderRadius: tokens.radius.md, padding: '18px', display: 'flex', flexDirection: 'column', gap: '12px' }}
      >
        <div style={{ fontWeight: 600 }}>New terminal</div>
        <label style={label}>
          Folder
          <select value={cwd} onChange={(e) => setCwd(e.target.value)} style={field}>
            {folders.map((f) => (
              <option key={f.path} value={f.path}>
                {f.name}
              </option>
            ))}
          </select>
        </label>
        <label style={label}>
          Name
          <input ref={nameRef} value={name} onChange={(e) => setName(e.target.value)} placeholder={defaultName('', folder?.name ?? '')} style={field} />
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: tokens.type.small }}>
          <input type="checkbox" checked={claude} onChange={(e) => setClaude(e.target.checked)} />
          Start Claude Code, named the same
        </label>
        {claude && agents.length > 0 && (
          <select value={agent} onChange={(e) => setAgent(e.target.value)} aria-label="Agent" style={field}>
            <option value="">No agent (plain claude)</option>
            {agents.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        )}
        {error && <div style={{ color: c.danger, fontSize: tokens.type.small }}>{error}</div>}
        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
          <button onClick={onCancel} style={{ background: 'none', border: `1px solid ${c.border}`, borderRadius: tokens.radius.sm, padding: '6px 12px', color: c.text, fontFamily: 'inherit', fontSize: tokens.type.small, cursor: 'pointer' }}>
            Cancel
          </button>
          <button onClick={() => void submit()} disabled={busy || !cwd} style={{ background: c.accent, color: c.accentInk, border: 'none', borderRadius: tokens.radius.sm, padding: '6px 14px', fontWeight: 600, fontFamily: 'inherit', fontSize: tokens.type.small, cursor: 'pointer' }}>
            {busy ? 'Starting…' : 'Open'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------
// The page
// ------------------------------------------

function useTermList(enabled: boolean) {
  const [list, setList] = useState<TermList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const refresh = useCallback(() => {
    if (!IS_TAURI || inFlight.current) return;
    inFlight.current = true;
    invoke<TermList>('term_list')
      .then((l) => {
        setList(l);
        setError(null);
      })
      .catch((e) => setError(String(e)))
      .finally(() => {
        inFlight.current = false;
      });
  }, []);
  useEffect(() => {
    if (!enabled) return;
    refresh();
    const t = window.setInterval(refresh, LIST_EVERY);
    window.addEventListener('focus', refresh);
    return () => {
      clearInterval(t);
      window.removeEventListener('focus', refresh);
    };
  }, [enabled, refresh]);
  return { list, error, refresh };
}

export function TerminalPage({
  agents,
  request,
  visible,
  layout,
  onLayout,
}: {
  agents: string[];
  request: TerminalRequest | null;
  visible: boolean;
  layout: TerminalLayout;
  onLayout: (l: TerminalLayout) => void;
}) {
  const { tokens } = useTheme();
  const c = tokens.colors;
  const { list, error: listError, refresh } = useTermList(visible);
  const [tabs, setTabs] = useState<TabRef[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [ended, setEnded] = useState<Record<string, boolean>>({});
  const [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmEnd, setConfirmEnd] = useState<string | null>(null);
  const [rail, setRail] = useState<boolean>(() => store.get('roo.terminal.rail', true));
  const [fontSize, setFontSize] = useState<number>(() => store.get('roo.terminal.fontSize', FONT_SIZES.start));
  const [finding, setFinding] = useState(false);
  const [query, setQuery] = useState('');
  const handles = useRef(new Map<string, TermHandle>());
  const restored = useRef(false);
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  const activeRef = useRef(active);
  activeRef.current = active;

  useEffect(() => store.set('roo.terminal.rail', rail), [rail]);
  useEffect(() => store.set('roo.terminal.fontSize', fontSize), [fontSize]);
  useEffect(() => {
    if (restored.current) store.set('roo.terminal.tabs', tabs.flatMap((t) => (t.kind === 'tmux' ? [t.name] : [])));
  }, [tabs]);

  // Tabs open last time come back once the list is in (only sessions still running).
  useEffect(() => {
    if (restored.current || !list) return;
    restored.current = true;
    const back = restorable(store.get('roo.terminal.tabs', []), list.entries);
    if (back.length) {
      setTabs((cur) => [...back.filter((b) => !cur.some((x) => tabId(x) === tabId(b))), ...cur]);
      setActive((a) => a ?? tabId(back[0]));
    }
  }, [list]);

  const open = useCallback((t: TabRef) => {
    const id = tabId(t);
    setTabs((cur) => (cur.some((x) => tabId(x) === id) ? cur : [...cur, t]));
    setEnded((e) => ({ ...e, [id]: false }));
    setActive(id);
  }, []);

  const close = useCallback((id: string) => {
    const ids = tabsRef.current.map(tabId);
    setActive((a) => nextAfterClose(ids, id, a));
    setTabs((cur) => cur.filter((x) => tabId(x) !== id));
    handles.current.delete(id);
  }, []);

  const openEntry = (e: TermEntry) => {
    if (e.kind === 'tmux' && e.tmux) open({ kind: 'tmux', name: e.tmux });
    else if (e.tty) open({ kind: 'peek', tty: e.tty, label: e.label });
    else setNotice(`${e.label} is running outside Terminal.app, so Roo can't show it.`);
  };

  const create = useCallback(
    async (r: NewRequest) => {
      const name = await invoke<string>('term_new', { req: { ...r, cols: 120, rows: 36 } });
      setCreating(false);
      open({ kind: 'tmux', name });
      refresh();
    },
    [open, refresh],
  );

  // "Open in terminal" from Conversations: the lead's own session, reused when it's running.
  const handled = useRef<number | null>(null);
  useEffect(() => {
    if (!request || handled.current === request.nonce) return;
    handled.current = request.nonce;
    if (request.agent) create({ name: request.agent, cwd: '~', claude: true, agent: request.agent }).catch((e) => setNotice(String(e)));
    else setCreating(true);
  }, [request, create]);

  // Page shortcuts, ahead of the terminal and the menu bar, while the page shows.
  useEffect(() => {
    if (!visible) return;
    const onKey = (e: KeyboardEvent) => {
      const k = pageKey(e);
      if (!k) return;
      e.preventDefault();
      e.stopPropagation();
      const ts = tabsRef.current;
      if (k.do === 'new') setCreating(true);
      else if (k.do === 'close') {
        if (activeRef.current) close(activeRef.current);
      } else if (k.do === 'tab') {
        const i = tabForIndex(ts.length, k.index);
        if (i !== null) setActive(tabId(ts[i]));
      } else if (k.do === 'find') setFinding(true);
      else if (k.do === 'zoom') setFontSize((s) => zoomed(s, k.by));
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [visible, close]);

  const current = tabs.find((t) => tabId(t) === active) ?? null;
  const entries = list?.entries ?? [];
  const inRoo = entries.filter((e) => e.kind === 'tmux');
  const outside = entries.filter((e) => e.kind === 'terminal');
  const entryFor = (t: TabRef | null) => (t ? entries.find((e) => e.id === tabId(t)) ?? null : null);
  const currentEntry = entryFor(current);
  const home = list?.home ?? null;
  const currentHandle = () => (current ? handles.current.get(tabId(current)) : undefined);

  const button = { background: 'none', border: `1px solid ${c.border}`, borderRadius: tokens.radius.sm, padding: '5px 10px', color: c.text, fontFamily: 'inherit', fontSize: tokens.type.small, cursor: 'pointer', whiteSpace: 'nowrap' } as const;
  const dot = (label: string, size = 8) => <span style={{ width: size, height: size, borderRadius: '50%', flex: 'none', background: businessColor(label) ?? c.textDim }} />;
  const stateChip = (e: TermEntry | null) => {
    const s = claudeState(e?.claude ?? null);
    if (!s) return null;
    const color = s.tone === 'busy' ? c.warning : s.tone === 'waiting' ? c.success : c.textDim;
    return <span style={{ fontSize: '11px', color }}>{s.text}</span>;
  };

  const row = (e: TermEntry) => {
    const isOpen = tabs.some((t) => tabId(t) === e.id);
    return (
      <button
        key={e.id}
        onClick={() => openEntry(e)}
        title={e.kind === 'tmux' ? 'Open in a tab' : 'Show this Terminal window (view only)'}
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'stretch',
          gap: '2px',
          width: '100%',
          textAlign: 'left',
          background: active === e.id ? c.bgCardHover : 'none',
          border: 'none',
          borderRadius: tokens.radius.sm,
          padding: '7px 8px',
          color: c.text,
          fontFamily: 'inherit',
          cursor: 'pointer',
        }}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: '7px', fontSize: tokens.type.small, fontWeight: isOpen ? 600 : 400 }}>
          {dot(e.label)}
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.label}</span>
        </span>
        <span style={{ display: 'flex', gap: '8px', paddingLeft: '15px', fontSize: '11px', color: c.textDim, overflow: 'hidden', whiteSpace: 'nowrap' }}>
          {stateChip(e)}
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{shortPath(e.cwd, home)}</span>
        </span>
      </button>
    );
  };

  const groupTitle = (t: string) => <div style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.06em', color: c.textDim, padding: '10px 8px 4px' }}>{t}</div>;

  return (
    <div style={{ display: visible ? 'flex' : 'none', flexDirection: 'column', height: '100%', minHeight: 0, position: 'relative' }}>
      {/* Toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px', flexWrap: 'wrap' }}>
        <button onClick={() => setRail((r) => !r)} style={button} title={rail ? 'Hide the session list' : 'Show every session'}>
          {rail ? 'Hide list' : `Sessions (${entries.length})`}
        </button>
        <button onClick={() => setCreating(true)} disabled={!IS_TAURI} style={{ ...button, background: c.accent, color: c.accentInk, border: 'none', fontWeight: 600 }} title="New terminal (⌘T)">
          New terminal
        </button>
        <div style={{ flex: 1 }} />
        {current?.kind === 'tmux' && (
          <>
            <button onClick={() => invoke('term_open_outside', { name: current.name }).catch((e) => setNotice(String(e)))} style={button} title="Attach Terminal.app to this same session">
              Also open in Terminal.app
            </button>
            {confirmEnd === current.name ? (
              <button
                onClick={() => {
                  const id = tabId(current);
                  invoke('term_kill', { name: current.name })
                    .then(() => {
                      close(id);
                      refresh();
                    })
                    .catch((e) => setNotice(String(e)))
                    .finally(() => setConfirmEnd(null));
                }}
                onBlur={() => setConfirmEnd(null)}
                autoFocus
                style={{ ...button, color: c.danger, borderColor: c.danger }}
              >
                End it (stops what's running)
              </button>
            ) : (
              <button onClick={() => setConfirmEnd(current.name)} style={button} title="End the session and everything running in it. Closing the tab only detaches.">
                End session
              </button>
            )}
          </>
        )}
        <div role="group" aria-label="Layout" style={{ display: 'flex', border: `1px solid ${c.border}`, borderRadius: tokens.radius.sm, overflow: 'hidden' }}>
          {(['full', 'split'] as const).map((l) => (
            <button
              key={l}
              onClick={() => onLayout(l)}
              aria-pressed={layout === l}
              style={{ ...button, border: 'none', borderRadius: 0, background: layout === l ? c.bgCardHover : 'none', color: layout === l ? c.text : c.textMuted }}
            >
              {l === 'full' ? 'Full' : 'Beside chat'}
            </button>
          ))}
        </div>
      </div>

      {!IS_TAURI && <div style={{ color: c.textMuted }}>The terminal runs in the Roo desktop app.</div>}
      {list && !list.tmux && (
        <div style={{ color: c.warning, fontSize: tokens.type.small, marginBottom: '8px' }}>
          Roo's terminals run in tmux, which isn't installed. In Terminal, run <code style={{ fontFamily: tokens.fonts.mono }}>brew install tmux</code> once.
        </div>
      )}
      {(notice || listError) && (
        <div style={{ color: c.danger, fontSize: tokens.type.small, marginBottom: '8px', display: 'flex', gap: '8px', alignItems: 'center' }}>
          {notice ?? listError}
          {notice && (
            <button onClick={() => setNotice(null)} style={{ ...button, padding: '0 6px' }}>
              OK
            </button>
          )}
        </div>
      )}

      <div style={{ flex: 1, minHeight: 0, display: 'flex', gap: '10px' }}>
        {/* Every session on the Mac */}
        {rail && (
          <div style={{ width: '250px', flex: 'none', overflowY: 'auto', background: c.bgCard, border: `1px solid ${c.border}`, borderRadius: tokens.radius.md, padding: '4px' }}>
            {groupTitle('In Roo')}
            {inRoo.map(row)}
            {list && !inRoo.length && (
              <div style={{ fontSize: '12px', color: c.textDim, padding: '4px 8px 8px', lineHeight: 1.5 }}>None yet. ⌘T opens one, and Terminal.app can attach to it too.</div>
            )}
            {outside.length > 0 && (
              <>
                {groupTitle('In Terminal.app (view only)')}
                <div style={{ fontSize: '11px', color: c.textDim, padding: '0 8px 6px', lineHeight: 1.45 }}>
                  Opened before Roo had terminals, so Roo can show these but can't type in them. Terminals you open from now on run fully in Roo.
                </div>
                {outside.map(row)}
              </>
            )}
            {list?.terminal_access === false && (
              <div style={{ fontSize: '11px', color: c.warning, padding: '8px', lineHeight: 1.45 }}>
                To list and mirror every Terminal window, allow Roo under System Settings › Privacy & Security › Automation › Roo › Terminal.
              </div>
            )}
          </div>
        )}

        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          {/* Tabs */}
          {tabs.length > 0 && (
            <div role="tablist" style={{ display: 'flex', gap: '2px', overflowX: 'auto', flex: 'none' }}>
              {tabs.map((t, i) => {
                const id = tabId(t);
                const label = t.kind === 'tmux' ? t.name : t.label;
                const busy = entryFor(t)?.claude?.status === 'busy';
                return (
                  <div
                    key={id}
                    role="tab"
                    aria-selected={id === active}
                    onClick={() => setActive(id)}
                    title={`${label}${i < 9 ? `  ⌘${i + 1}` : ''}`}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '7px',
                      padding: '6px 6px 6px 10px',
                      borderRadius: `${tokens.radius.sm} ${tokens.radius.sm} 0 0`,
                      background: id === active ? TERM_THEME.background : 'transparent',
                      color: ended[id] ? c.textDim : id === active ? TERM_THEME.foreground : c.textMuted,
                      fontSize: tokens.type.small,
                      cursor: 'pointer',
                      whiteSpace: 'nowrap',
                      maxWidth: '240px',
                    }}
                  >
                    {dot(label, 7)}
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', fontStyle: t.kind === 'peek' ? 'italic' : 'normal' }}>{label}</span>
                    {busy && <span title="Claude is working" style={{ width: 6, height: 6, borderRadius: '50%', flex: 'none', background: c.warning }} />}
                    <button
                      onClick={(ev) => {
                        ev.stopPropagation();
                        close(id);
                      }}
                      aria-label={`Close ${label}`}
                      title={t.kind === 'tmux' ? 'Close tab (⌘W). The session keeps running.' : 'Close'}
                      style={{ background: 'none', border: 'none', padding: '0 2px', cursor: 'pointer', display: 'flex' }}
                    >
                      <Icon name="close" size={11} color={c.textDim} />
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {/* View-only banner for Terminal.app windows */}
          {current?.kind === 'peek' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '7px 10px', background: c.bgCard, border: `1px solid ${c.border}`, borderBottom: 'none', fontSize: '12px', color: c.textMuted }}>
              <span style={{ flex: 1 }}>Open in Terminal (not attachable yet). Roo mirrors this window read-only. {stateChip(currentEntry)}</span>
              <button onClick={() => invoke('term_focus', { tty: current.tty }).catch((e) => setNotice(String(e)))} style={button}>
                Go to window
              </button>
            </div>
          )}

          {/* Find (⌘F) */}
          {finding && current?.kind === 'tmux' && (
            <div style={{ display: 'flex', gap: '6px', padding: '6px', background: TERM_THEME.background, borderBottom: `1px solid ${c.border}` }}>
              <input
                autoFocus
                value={query}
                placeholder="Find"
                onChange={(e) => {
                  setQuery(e.target.value);
                  currentHandle()?.find(e.target.value);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') currentHandle()?.find(query, e.shiftKey);
                  if (e.key === 'Escape') {
                    currentHandle()?.clearFind();
                    setFinding(false);
                    currentHandle()?.focus();
                  }
                }}
                style={{ flex: 1, background: c.bgCard, color: c.text, border: `1px solid ${c.border}`, borderRadius: tokens.radius.sm, padding: '4px 8px', fontFamily: 'inherit', fontSize: tokens.type.small }}
              />
              <span style={{ fontSize: '11px', color: c.textDim, alignSelf: 'center' }}>Enter next · ⇧Enter previous · Esc close</span>
            </div>
          )}

          <div
            style={{
              flex: 1,
              minHeight: 0,
              position: 'relative',
              background: tabs.length ? TERM_THEME.background : 'transparent',
              borderRadius: `0 ${tokens.radius.md} ${tokens.radius.md} ${tokens.radius.md}`,
              overflow: 'hidden',
            }}
          >
            {tabs.map((t) =>
              t.kind === 'tmux' ? (
                <TmuxView
                  key={tabId(t)}
                  name={t.name}
                  active={visible && tabId(t) === active}
                  fontSize={fontSize}
                  handle={(h) => {
                    if (h) handles.current.set(tabId(t), h);
                    else handles.current.delete(tabId(t));
                  }}
                  onEnded={() => {
                    setEnded((e) => ({ ...e, [tabId(t)]: true }));
                    refresh();
                  }}
                />
              ) : (
                <PeekView key={tabId(t)} tty={t.tty} active={visible && tabId(t) === active} fontSize={fontSize} />
              ),
            )}
            {tabs.length === 0 && IS_TAURI && (
              <div style={{ color: c.textMuted, fontSize: '14px', lineHeight: 1.7, maxWidth: '560px', padding: '8px 4px' }}>
                <p style={{ margin: '0 0 10px' }}>
                  Every terminal you open here runs in tmux: it's the same session in Roo and in Terminal.app, and it keeps running when you close the tab or quit Roo.
                </p>
                <p style={{ margin: '0 0 10px' }}>
                  <b>⌘T</b> new terminal · <b>⌘W</b> close tab · <b>⌘1–9</b> switch · <b>⌘F</b> find · <b>⌘C / ⌘V</b> copy and paste · <b>⌘+ / ⌘−</b> text size · <b>⇧Enter</b> new line in Claude
                </p>
                <p style={{ margin: 0 }}>Pick a session from the list, or start one.</p>
              </div>
            )}
            {current && ended[tabId(current)] && (
              <div style={{ position: 'absolute', right: 12, bottom: 12 }}>
                <button onClick={() => close(tabId(current))} style={{ ...button, background: c.bgCard }}>
                  Close tab
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {creating && <NewTerminal agents={agents} onCreate={create} onCancel={() => setCreating(false)} />}
    </div>
  );
}
