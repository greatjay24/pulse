import { invoke } from '@tauri-apps/api/core';
import { PortfolioEntity } from '../types';
import { DEMO } from './orgSource';

// The command box and the composers: what the owner types goes to a lead through
// ~/portfolio/bin/ask.py (Rust `ask_lead`), which starts a Claude Code run on the owner's own
// sign-in and answers at once with its run id. Everything after that (Working now,
// Conversations, notifications) reads the run's live file and transcript like any other run.

export const ORG_TARGET = 'org'; // the chief of staff: unclear or cross-cutting asks

export interface Route {
  target: string; // an entity id, or ORG_TARGET
  message: string; // with a leading "Name:" taken off
  why: 'prefix' | 'mention' | 'default';
}

function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Names an entity answers to: its name, its id and its lead ("Acme", "acme", "acme-lead").
function names(e: PortfolioEntity): string[] {
  return [e.name, e.id, e.lead ?? ''].filter(Boolean).map((n) => n.toLowerCase());
}

// "Acme: build a pricing page" goes to Acme's lead; "@acme …" or a single entity named
// anywhere does too; anything else goes to the chief of staff.
export function routeOf(text: string, entities: PortfolioEntity[]): Route {
  const trimmed = text.trim();
  const leads = entities.filter((e) => e.lead);
  const prefix = /^@?([^:\n]{1,60}):\s*/.exec(trimmed);
  if (prefix) {
    const head = prefix[1].trim().toLowerCase();
    if (['org', 'chief of staff', 'chief-of-staff', 'cos'].includes(head)) {
      return { target: ORG_TARGET, message: trimmed.slice(prefix[0].length), why: 'prefix' };
    }
    const hit = leads.find((e) => names(e).includes(head));
    if (hit) return { target: hit.id, message: trimmed.slice(prefix[0].length), why: 'prefix' };
  }
  const lower = trimmed.toLowerCase();
  const at = leads.filter((e) => names(e).some((n) => new RegExp(`(^|\\s)@${escape(n)}\\b`).test(lower)));
  if (at.length === 1) return { target: at[0].id, message: trimmed, why: 'mention' };
  const named = leads.filter((e) => names(e).some((n) => new RegExp(`(^|[^\\w-])${escape(n)}([^\\w-]|$)`).test(lower)));
  if (named.length === 1) return { target: named[0].id, message: trimmed, why: 'mention' };
  return { target: ORG_TARGET, message: trimmed, why: 'default' };
}

export interface AskResult {
  ok: true;
  run_id: string;
  agent: string;
  entity: string | null;
  queued: boolean;
}

export const DEMO_NOTICE = 'This is the demo: commands only run against your own org.';

export async function askLead(target: string, message: string, opts: { fresh?: boolean; session?: string } = {}): Promise<AskResult> {
  if (DEMO) throw new Error(DEMO_NOTICE);
  const json = await invoke<string>('ask_lead', { target, message, fresh: opts.fresh ?? false, session: opts.session ?? null, model: null });
  return JSON.parse(json);
}

export async function stopRun(runId: string): Promise<void> {
  if (DEMO) throw new Error(DEMO_NOTICE);
  await invoke<string>('stop_run', { runId });
}

// Recent commands, newest first; kept on this machine only.
const RECENT_KEY = 'pulse-recent-commands';
const RECENT_MAX = 8;

export interface RecentCommand {
  text: string;
  target: string;
  at: number;
}

export function recentCommands(): RecentCommand[] {
  try {
    const list = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
    return Array.isArray(list) ? list.filter((r) => typeof r?.text === 'string' && typeof r?.target === 'string').slice(0, RECENT_MAX) : [];
  } catch {
    return [];
  }
}

export function rememberCommand(text: string, target: string) {
  try {
    const next = [{ text, target, at: Date.now() }, ...recentCommands().filter((r) => r.text !== text)].slice(0, RECENT_MAX);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // no storage: recents are a convenience
  }
}

// A few starting points, built from the owner's own entities.
export function suggestions(entities: PortfolioEntity[]): string[] {
  const leads = entities.filter((e) => e.lead);
  const out = ["What's on my plate today?", 'What should I work on this week?'];
  if (leads[0]) out.push(`${leads[0].name}: what changed since yesterday?`);
  if (leads[1]) out.push(`${leads[1].name}: what's waiting on me?`);
  return out;
}

// The lead a target talks to, for labels.
export function leadOf(target: string, entities: PortfolioEntity[], chief: string | null): string {
  if (target === ORG_TARGET) return chief ?? 'chief-of-staff';
  return entities.find((e) => e.id === target)?.lead ?? target;
}

export function chiefOf(registry: unknown): string | null {
  const lead = (registry as { chief_of_staff?: { lead?: unknown } } | null)?.chief_of_staff?.lead;
  return typeof lead === 'string' ? lead : null;
}
