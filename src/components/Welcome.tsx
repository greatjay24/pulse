import { useCallback, useEffect, useState } from 'react';
import { useTheme } from '../contexts/ThemeContext';
import { SetupCheck } from '../types';
import { IS_TAURI, orgRead, setDemo } from '../utils/orgSource';
import { openExternal } from '../utils/tracker';
import { useToast } from '../utils/toast';
import { Icon } from './Icons';

export const SETUP_COMMAND = 'git clone https://github.com/greatjay24/pulse.git ~/pulse && python3 ~/pulse/kit/setup.py';
export const GUIDE_URL = 'https://github.com/greatjay24/pulse/blob/main/docs/GETTING_STARTED.md';
const CLAUDE_CODE_URL = 'https://docs.anthropic.com/en/docs/claude-code/setup';

function CheckRow({ ok, label, detail }: { ok: boolean | null; label: string; detail: string }) {
  const { tokens } = useTheme();
  const c = tokens.colors;
  const tone = ok === null ? c.textDim : ok ? c.success : c.warning;
  return (
    <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-start', padding: '10px 0' }}>
      <span style={{ marginTop: '2px', flexShrink: 0 }}>
        <Icon name={ok ? 'check' : 'alert'} size={16} color={tone} />
      </span>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: tokens.type.body, fontWeight: 600 }}>{label}</div>
        <div style={{ fontSize: tokens.type.small, color: c.textMuted, marginTop: '2px', overflowWrap: 'anywhere' }}>{detail}</div>
      </div>
    </div>
  );
}

// First run: no ~/portfolio/portfolio.json yet. Says what Pulse is, checks what setup needs,
// gives the one command to run, and offers the bundled demo org.
export function Welcome({ onRecheck }: { onRecheck: () => void }) {
  const { tokens } = useTheme();
  const c = tokens.colors;
  const [check, setCheck] = useState<SetupCheck | null>(null);
  const [copied, setCopied] = useState(false);

  const recheck = useCallback(() => {
    if (!IS_TAURI) return;
    orgRead('setup_check')
      .then((json) => setCheck(JSON.parse(json)))
      .catch(() => setCheck(null));
  }, []);

  useEffect(() => {
    recheck();
    window.addEventListener('focus', recheck);
    return () => window.removeEventListener('focus', recheck);
  }, [recheck]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(SETUP_COMMAND);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard refused: select the command so Cmd-C works.
      const el = document.getElementById('setup-command');
      if (el) window.getSelection()?.selectAllChildren(el);
    }
  };

  const claudeOk = check ? !!check.claude : null;
  const pythonOk = check ? !!check.python3 : null;

  return (
    <div style={{ height: '100vh', overflow: 'auto', background: c.bg, color: c.text, fontFamily: tokens.fonts.sans }}>
      <div style={{ maxWidth: '680px', margin: '0 auto', padding: '72px 32px 56px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '28px' }}>
          <Icon name="pulse" size={26} color={c.accent} />
          <span style={{ fontSize: tokens.type.small, letterSpacing: '0.08em', textTransform: 'uppercase', color: c.textMuted }}>Pulse</span>
        </div>
        <h1 style={{ fontFamily: tokens.fonts.display, fontSize: '44px', fontWeight: 500, letterSpacing: '-0.02em', lineHeight: 1.08 }}>
          Run every business from one desk.
        </h1>
        <div style={{ fontSize: tokens.type.lead, lineHeight: 1.6, color: c.textMuted, margin: '20px 0 40px' }}>
          <p>Each business you run gets an AI lead, a Claude Code agent that works overnight and keeps a short report.</p>
          <p>It handles what it can and brings you only what needs you: a decision, money, anything sent in your name, or your taste.</p>
          <p>Pulse shows those reports, the decisions waiting on you, and what your agents are doing right now.</p>
        </div>

        <section style={{ marginBottom: '32px' }}>
          <h2 style={{ fontFamily: tokens.fonts.display, fontSize: tokens.type.heading, fontWeight: 500, marginBottom: '8px' }}>1. What setup needs</h2>
          {IS_TAURI ? (
            <>
              <CheckRow
                ok={claudeOk}
                label="Claude Code"
                detail={check?.claude ? `Found at ${check.claude}. Make sure you're signed in: run "claude" once.` : check ? 'Not found. Install it and sign in, then check again.' : 'Checking…'}
              />
              <CheckRow
                ok={pythonOk}
                label="python3"
                detail={check?.python3 ? `Found at ${check.python3}.` : check ? 'Not found. Run "xcode-select --install" in Terminal, then check again.' : 'Checking…'}
              />
              {claudeOk === false && (
                <button className="btn btn-secondary" onClick={() => openExternal(CLAUDE_CODE_URL)} style={{ marginTop: '6px', display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                  <Icon name="external-link" size={14} color="currentColor" /> How to install Claude Code
                </button>
              )}
            </>
          ) : (
            <p style={{ fontSize: tokens.type.body, color: c.textMuted }}>Pulse checks for Claude Code and python3 when it runs as the desktop app.</p>
          )}
        </section>

        <section style={{ marginBottom: '40px' }}>
          <h2 style={{ fontFamily: tokens.fonts.display, fontSize: tokens.type.heading, fontWeight: 500, marginBottom: '8px' }}>2. Run setup in Terminal</h2>
          <p style={{ fontSize: tokens.type.body, color: c.textMuted, marginBottom: '14px', lineHeight: 1.55 }}>
            It asks your first name and your businesses, then builds your org in ~/portfolio and installs a lead for each one. It never schedules anything or changes your settings by itself.
          </p>
          <div style={{ display: 'flex', alignItems: 'stretch', border: `1px solid ${c.border}`, borderRadius: tokens.radius.md, background: c.bgCard, overflow: 'hidden' }}>
            <code id="setup-command" style={{ flex: 1, padding: '14px 16px', fontFamily: tokens.fonts.mono, fontSize: tokens.type.small, lineHeight: 1.5, overflowWrap: 'anywhere', userSelect: 'all' }}>
              {SETUP_COMMAND}
            </code>
            <button
              onClick={copy}
              aria-label="Copy the setup command"
              style={{ border: 'none', borderLeft: `1px solid ${c.border}`, background: 'transparent', color: copied ? c.success : c.text, padding: '0 18px', cursor: 'pointer', fontFamily: 'inherit', fontSize: tokens.type.small, fontWeight: 600, display: 'flex', alignItems: 'center', gap: '6px' }}
            >
              <Icon name={copied ? 'check' : 'download'} size={14} color="currentColor" /> {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <div style={{ display: 'flex', gap: '10px', marginTop: '16px', flexWrap: 'wrap' }}>
            {IS_TAURI && (
              <button className="btn btn-primary" onClick={() => { recheck(); onRecheck(); }} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                <Icon name="refresh" size={14} color="currentColor" /> I ran it, check again
              </button>
            )}
            <button className="btn btn-secondary" onClick={() => openExternal(GUIDE_URL)} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
              <Icon name="external-link" size={14} color="currentColor" /> Getting started guide
            </button>
          </div>
        </section>

        <section style={{ padding: '22px 24px', border: `1px solid ${c.border}`, borderRadius: tokens.radius.lg, background: c.bgElevated }}>
          <h2 style={{ fontFamily: tokens.fonts.display, fontSize: tokens.type.heading, fontWeight: 500, marginBottom: '6px' }}>Not ready yet? Look around first.</h2>
          <p style={{ fontSize: tokens.type.body, color: c.textMuted, marginBottom: '16px', lineHeight: 1.55 }}>
            The demo is a made-up org (Acme Studio, Northwind Supply, Globex Rentals) with reports, decisions, finished runs and a team at work. It's read-only: nothing you click changes anything.
          </p>
          <button className="btn btn-primary" onClick={() => setDemo(true)}>Try the demo</button>
        </section>
      </div>
    </div>
  );
}

// The demo's reminder that nothing is real, with the way out.
export function DemoBadge() {
  const { tokens } = useTheme();
  const c = tokens.colors;
  return (
    <div
      role="status"
      style={{ position: 'fixed', right: '20px', bottom: '20px', zIndex: 1000, display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 12px 10px 16px', borderRadius: '999px', background: c.bgElevated, border: `1px solid ${c.border}`, boxShadow: '0 6px 24px rgba(0,0,0,0.18)', fontSize: tokens.type.small }}
    >
      <span><strong>Demo org.</strong> <span style={{ color: c.textMuted }}>Fictional and read-only.</span></span>
      <button className="btn btn-secondary" onClick={() => setDemo(false)} style={{ padding: '6px 12px' }}>Exit demo</button>
    </div>
  );
}

export function Toast() {
  const { tokens } = useTheme();
  const c = tokens.colors;
  const toast = useToast();
  if (!toast) return null;
  return (
    <div
      key={toast.id}
      role="status"
      aria-live="polite"
      style={{ position: 'fixed', left: '50%', bottom: '76px', transform: 'translateX(-50%)', zIndex: 1001, maxWidth: 'min(560px, calc(100vw - 32px))', padding: '12px 18px', borderRadius: tokens.radius.md, background: c.text, color: c.bg, fontSize: tokens.type.small, lineHeight: 1.45, boxShadow: '0 8px 28px rgba(0,0,0,0.25)' }}
    >
      {toast.text}
    </div>
  );
}
