import { invoke } from '@tauri-apps/api/core';
import { demoRead } from '../demo/demoOrg';

// Where the org views read from: the Rust commands over ~/portfolio, or in demo mode the
// fictional org bundled with the app. Demo mode lasts for the window's session (or opens with
// ?demo in a browser preview); turning it on or off reloads, so every store starts clean.

export const IS_TAURI = typeof window !== 'undefined' && !!(window as any).__TAURI_INTERNALS__;
const DEMO_KEY = 'pulse-demo';

export const DEMO: boolean = (() => {
  if (typeof window === 'undefined') return false;
  try {
    return sessionStorage.getItem(DEMO_KEY) === '1' || new URLSearchParams(window.location.search).has('demo');
  } catch {
    return false;
  }
})();

// True when the org views have something to read: the desktop app, or the demo anywhere.
export const CAN_READ_ORG = IS_TAURI || DEMO;

export function setDemo(on: boolean) {
  try {
    if (on) sessionStorage.setItem(DEMO_KEY, '1');
    else sessionStorage.removeItem(DEMO_KEY);
  } catch {
    // no session storage: the ?demo flag below still carries it
  }
  const url = new URL(window.location.href);
  if (on) url.searchParams.set('demo', '1');
  else url.searchParams.delete('demo');
  window.location.replace(url.toString());
}

// The org's read commands return JSON strings; the demo hands back the same strings.
export async function orgRead(cmd: string, args?: Record<string, unknown>): Promise<string> {
  if (DEMO) return JSON.stringify(demoRead(cmd, args));
  return invoke<string>(cmd, args);
}
