import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { useTheme } from '../contexts/ThemeContext';
import { IS_TAURI } from '../utils/orgSource';
import { PageHeader } from './BoardUI';
import { Icon } from './Icons';

// Real Claude Code sessions in Pulse tabs: each tab is a pseudo-terminal (Rust `pty_open`)
// running `claude --agent <lead>` (or plain `claude`) in ~ through the owner's login shell,
// so their environment and sign-in are the ones they use every day. Tabs live while Pulse
// runs, including when another page is showing; closing a tab ends its session.

export interface TerminalRequest {
  agent: string | null;
  nonce: number;
}

interface Tab {
  key: number;
  agent: string | null;
  id: number | null; // the pty, once open
  ended: boolean;
  error?: string;
}

// Output that arrives before a tab has registered its pty id waits here.
const early = new Map<number, string>();
const writers = new Map<number, (data: string) => void>();
const enders = new Map<number, () => void>();

let listening: Promise<void> | null = null;
function listenOnce(): Promise<void> {
  listening ??= Promise.all([
    listen<{ id: number; data: string }>('pty://data', (e) => {
      const w = writers.get(e.payload.id);
      if (w) w(e.payload.data);
      else early.set(e.payload.id, (early.get(e.payload.id) ?? '') + e.payload.data);
    }),
    listen<{ id: number }>('pty://exit', (e) => enders.get(e.payload.id)?.()),
  ]).then(() => undefined);
  return listening;
}

function TerminalView({ tab, active, onOpened, onEnded }: { tab: Tab; active: boolean; onOpened: (id: number) => void; onEnded: (error?: string) => void }) {
  const { tokens } = useTheme();
  const c = tokens.colors;
  const host = useRef<HTMLDivElement>(null);
  const term = useRef<Terminal | null>(null);
  const fit = useRef<FitAddon | null>(null);
  const ptyId = useRef<number | null>(null);

  useEffect(() => {
    if (!host.current) return;
    const t = new Terminal({
      fontFamily: tokens.fonts.mono,
      fontSize: 13,
      lineHeight: 1.2,
      cursorBlink: true,
      allowProposedApi: false,
      scrollback: 10_000,
      macOptionIsMeta: true,
      theme: { background: c.bgCard, foreground: c.text, cursor: c.accent, cursorAccent: c.bgCard, selectionBackground: c.accentGlow },
    });
    const f = new FitAddon();
    t.loadAddon(f);
    t.open(host.current);
    term.current = t;
    fit.current = f;
    // Cmd+C copies a selection (otherwise it is ^C for claude); Cmd+K stays Pulse's.
    t.attachCustomKeyEventHandler((e) => {
      if (e.type === 'keydown' && e.metaKey && e.key === 'c' && t.hasSelection()) {
        navigator.clipboard.writeText(t.getSelection()).catch(() => {});
        return false;
      }
      if (e.metaKey && e.key === 'k') return false;
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
    listenOnce()
      .then(() => invoke<number>('pty_open', { agent: tab.agent, cols: t.cols, rows: t.rows }))
      .then((id) => {
        if (disposed) {
          invoke('pty_close', { id }).catch(() => {});
          return;
        }
        ptyId.current = id;
        writers.set(id, (data) => t.write(data));
        enders.set(id, () => {
          t.write('\r\n\x1b[2m[session ended]\x1b[0m\r\n');
          onEnded();
        });
        const pending = early.get(id);
        if (pending) {
          t.write(pending);
          early.delete(id);
        }
        onOpened(id);
      })
      .catch((e) => {
        t.write(`\x1b[31m${String(e)}\x1b[0m\r\n`);
        onEnded(String(e));
      });

    const ro = new ResizeObserver(() => {
      if (!host.current || host.current.offsetWidth === 0) return;
      try {
        f.fit();
      } catch {
        return;
      }
      if (ptyId.current !== null) invoke('pty_resize', { id: ptyId.current, cols: t.cols, rows: t.rows }).catch(() => {});
    });
    ro.observe(host.current);

    return () => {
      disposed = true;
      ro.disconnect();
      input.dispose();
      if (ptyId.current !== null) {
        writers.delete(ptyId.current);
        enders.delete(ptyId.current);
        invoke('pty_close', { id: ptyId.current }).catch(() => {});
      }
      t.dispose();
    };
    // One terminal per tab for its whole life; theme changes apply below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (term.current) term.current.options.theme = { background: c.bgCard, foreground: c.text, cursor: c.accent, cursorAccent: c.bgCard, selectionBackground: c.accentGlow };
  }, [c.bgCard, c.text, c.accent, c.accentGlow]);

  useEffect(() => {
    if (!active) return;
    requestAnimationFrame(() => {
      try {
        fit.current?.fit();
      } catch {
        // hidden
      }
      term.current?.focus();
    });
  }, [active]);

  return (
    <div
      ref={host}
      style={{
        display: active ? 'block' : 'none',
        flex: 1,
        minHeight: 0,
        padding: '10px 12px',
        background: c.bgCard,
        border: `1px solid ${c.border}`,
        borderRadius: tokens.radius.md,
      }}
    />
  );
}

export function TerminalPage({ agents, request, visible }: { agents: string[]; request: TerminalRequest | null; visible: boolean }) {
  const { tokens } = useTheme();
  const c = tokens.colors;
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [active, setActive] = useState<number | null>(null);
  const [pick, setPick] = useState<string>('');
  const [notice, setNotice] = useState<string | null>(null);
  const nextKey = useRef(1);

  const add = useCallback((agent: string | null) => {
    const key = nextKey.current++;
    setTabs((t) => [...t, { key, agent, id: null, ended: false }]);
    setActive(key);
  }, []);

  const close = (key: number) => {
    const rest = tabs.filter((x) => x.key !== key);
    setTabs(rest);
    if (active === key) setActive(rest.length ? rest[rest.length - 1].key : null);
  };

  const handled = useRef<number | null>(null);
  useEffect(() => {
    if (!request || handled.current === request.nonce) return;
    handled.current = request.nonce;
    add(request.agent);
  }, [request, add]);

  const update = (key: number, patch: Partial<Tab>) => setTabs((t) => t.map((x) => (x.key === key ? { ...x, ...patch } : x)));

  const openOutside = (agent: string | null) => {
    setNotice(null);
    invoke('open_in_terminal', { agent }).catch((e) => setNotice(String(e)));
  };

  const current = tabs.find((t) => t.key === active) ?? null;
  const button = { background: 'none', border: `1px solid ${c.border}`, borderRadius: tokens.radius.sm, padding: '5px 12px', color: c.text, fontFamily: 'inherit', fontSize: tokens.type.small, cursor: 'pointer' } as const;

  return (
    <div style={{ display: visible ? 'flex' : 'none', flexDirection: 'column', height: '100%', maxWidth: '1400px', margin: '0 auto' }}>
      <PageHeader
        title="Terminal"
        subtitle="A full Claude Code session with any lead, on your own sign-in and environment."
        right={
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <select
              value={pick}
              onChange={(e) => setPick(e.target.value)}
              aria-label="Agent"
              style={{ background: c.bgCard, color: c.text, border: `1px solid ${c.border}`, borderRadius: tokens.radius.sm, padding: '5px 8px', fontFamily: 'inherit', fontSize: tokens.type.small }}
            >
              <option value="">claude (no agent)</option>
              {agents.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
            <button onClick={() => add(pick || null)} disabled={!IS_TAURI} style={{ ...button, background: c.accent, color: c.accentInk, border: 'none', fontWeight: 600 }}>
              New tab
            </button>
            <button onClick={() => openOutside(pick || null)} disabled={!IS_TAURI} style={button} title="Open the same session in Terminal.app">
              Open in Terminal.app
            </button>
          </div>
        }
      />
      {!IS_TAURI && <div style={{ color: c.textMuted }}>The terminal runs in the Pulse desktop app.</div>}
      {notice && <div style={{ color: c.danger, fontSize: tokens.type.small, marginBottom: '10px' }}>{notice}</div>}

      {tabs.length > 0 && (
        <div role="tablist" style={{ display: 'flex', gap: '4px', marginBottom: '8px', overflowX: 'auto' }}>
          {tabs.map((t) => (
            <div
              key={t.key}
              role="tab"
              aria-selected={t.key === active}
              onClick={() => setActive(t.key)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '6px 8px 6px 12px',
                borderRadius: tokens.radius.sm,
                background: t.key === active ? c.bgCardHover : 'transparent',
                border: `1px solid ${t.key === active ? c.border : 'transparent'}`,
                color: t.ended ? c.textDim : c.text,
                fontSize: tokens.type.small,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              <Icon name="terminal" size={12} color={t.ended ? c.textDim : c.accent} />
              {t.agent ?? 'claude'}
              {t.ended && ' · ended'}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  close(t.key);
                }}
                aria-label={`Close ${t.agent ?? 'claude'}`}
                title="Close (ends the session)"
                style={{ background: 'none', border: 'none', padding: '0 2px', color: c.textDim, cursor: 'pointer', display: 'flex' }}
              >
                <Icon name="close" size={12} color={c.textDim} />
              </button>
            </div>
          ))}
        </div>
      )}

      <div style={{ flex: 1, minHeight: '420px', display: 'flex', flexDirection: 'column' }}>
        {tabs.map((t) => (
          <TerminalView
            key={t.key}
            tab={t}
            active={visible && t.key === active}
            onOpened={(id) => update(t.key, { id })}
            onEnded={(error) => update(t.key, { ended: true, error })}
          />
        ))}
        {tabs.length === 0 && IS_TAURI && (
          <div style={{ color: c.textMuted, fontSize: '14px', lineHeight: 1.6 }}>
            Pick a lead and open a tab. It's the same <code style={{ fontFamily: tokens.fonts.mono }}>claude</code> you run in a terminal, started in your home folder.
          </div>
        )}
      </div>
      {current?.ended && (
        <div style={{ marginTop: '8px', display: 'flex', gap: '10px', alignItems: 'center', fontSize: tokens.type.small, color: c.textDim }}>
          Session ended.
          <button onClick={() => add(current.agent)} style={button}>
            Start again
          </button>
          <button onClick={() => close(current.key)} style={button}>
            Close tab
          </button>
        </div>
      )}
    </div>
  );
}
