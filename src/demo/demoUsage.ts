import { PreferencesDoc, UsageReport, UsageRun, UsageSnapshot, UsageTokens } from '../types/usage';

// The demo org's usage and learned preferences: fictional, generated the same way every time.

const HOUR = 3_600_000;

function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}

function hourIso(ms: number): string {
  const d = new Date(ms);
  d.setMinutes(0, 0, 0);
  return d.toISOString();
}

const LEADS: [string, string][] = [['acme', 'acme-lead'], ['northwind', 'northwind-lead'], ['globex', 'globex-lead'], ['personal', 'personal-lead']];

function run(id: string, kind: string, entity: string | null, agent: string | null, doing: string, start: number, mins: number,
  model: string, cost: number, perDollar: number, basis: 'reported' | 'estimated'): UsageRun {
  const t: UsageTokens = { input: Math.round(cost * 40), output: Math.round(cost * perDollar * 0.04), cache_read: Math.round(cost * perDollar * 0.8), cache_write: Math.round(cost * perDollar * 0.16) };
  const hours: Record<string, number> = {};
  const spans = Math.max(1, Math.ceil(mins / 60));
  for (let i = 0; i < spans; i++) hours[hourIso(start + i * HOUR)] = +(cost / spans).toFixed(4);
  return {
    id, run_id: kind === 'headless' || kind === 'interactive' ? null : id, source: kind === 'interactive' || kind === 'headless' ? 'session' : 'runner', kind, entity, agent, doing,
    started: new Date(start).toISOString(), ended: new Date(start + mins * 60_000).toISOString(), secs: mins * 60, ok: true,
    cost_usd: cost, cost_basis: basis, tokens: t, by_model: { [model]: { ...t, cost_usd: cost } }, models: [model], session_id: null, hours,
  };
}

export function demoUsage(): UsageSnapshot {
  const r = rng(7);
  const now = Date.now();
  const runs: UsageRun[] = [];
  for (let day = 0; day < 180; day++) {
    const base = new Date(now - day * 24 * HOUR);
    base.setHours(5, 30, 0, 0);
    if (base.getTime() > now) continue;
    for (const [entity, agent] of LEADS) {
      runs.push(run(`demo-n-${day}-${entity}`, 'nightly', entity, agent, 'Night shift', base.getTime(), 2, 'claude-sonnet-5-5', +(0.15 + r() * 0.25).toFixed(4), 420_000, 'reported'));
    }
    if (r() < 0.6) {
      const [entity, agent] = LEADS[Math.floor(r() * LEADS.length)];
      runs.push(run(`demo-c-${day}`, 'chat', entity, agent, 'Asked about this week’s pipeline', base.getTime() + 6 * HOUR, 8, 'claude-sonnet-5-5', +(0.5 + r() * 3).toFixed(4), 420_000, 'reported'));
    }
    if (r() < 0.5) {
      runs.push(run(`demo-a-${day}`, 'act', 'northwind', 'northwind-lead', 'Approve: raise wholesale prices', base.getTime() + 4 * HOUR, 2, 'claude-sonnet-5-5', +(0.2 + r() * 0.3).toFixed(4), 420_000, 'reported'));
    }
    if (r() < 0.7) {
      runs.push(run(`session-demo-${day}`, 'interactive', null, null, 'Claude Code in ~/projects/site', base.getTime() + 8 * HOUR, 90 + Math.round(r() * 120), 'claude-opus-5-5', +(4 + r() * 28).toFixed(4), 210_000, 'estimated'));
    }
    if (day % 7 === 0) {
      runs.push(run(`demo-w-${day}`, 'weekly', null, 'chief-of-staff', 'Weekly review', base.getTime() + HOUR, 12, 'claude-opus-5-5', +(2 + r() * 2).toFixed(4), 210_000, 'reported'));
    }
  }
  const generated = new Date(now).toISOString();
  const window = (secs: number, budget: number) => {
    const since = now - secs * 1000;
    let cost = 0;
    let n = 0;
    const tokens: UsageTokens = { input: 0, output: 0, cache_read: 0, cache_write: 0 };
    for (const x of runs) {
      const c = Object.entries(x.hours).filter(([h]) => Date.parse(h) + HOUR > since).reduce((s, [, v]) => s + v, 0);
      if (c > 0 && x.tokens && x.cost_usd) {
        cost += c;
        n += 1;
        for (const k of ['input', 'output', 'cache_read', 'cache_write'] as const) tokens[k] += Math.round(x.tokens[k] * (c / x.cost_usd));
      }
    }
    return { since: new Date(since).toISOString(), cost_usd: +cost.toFixed(2), tokens, runs: n,
      budget_usd: budget, used: +(cost / budget).toFixed(3), warn: cost / budget >= 0.8 };
  };
  const report: UsageReport = {
    generated, sessions_scanned: true, warn_at: 0.8,
    plan: {
      at: new Date(now - 40 * 60_000).toISOString(), run_id: null, status: 'allowed', using_overage: false, age_secs: 2400, stale: false,
      windows: {
        five_hour: { utilization: 0.34, resets_at: new Date(now + 2 * HOUR).toISOString(), status: 'allowed', reset_passed: false, warn: false },
        seven_day: { utilization: 0.83, resets_at: new Date(now + 50 * HOUR).toISOString(), status: 'allowed_warning', reset_passed: false, warn: true },
      },
    },
    windows: { five_hour: window(5 * 3600, 15), seven_day: window(7 * 86400, 180) },
    implied_budget_usd: {},
    runs: runs.sort((a, b) => (b.started ?? '').localeCompare(a.started ?? '')),
  };
  return { report, refresh_error: null };
}

export function demoPreferences(): PreferencesDoc {
  const day = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
  const p = (id: string, text: string, area: string, evidence: Record<string, number>, seen: number, extra = {}) => ({
    id, text, area, entity: null, evidence, first_seen: day(seen + 5), last_seen: day(seen), sources: [], status: 'active' as const, superseded_by: null, disabled: false, ...extra,
  });
  return {
    preferences: [
      p('p-a1b2c3', 'Prefers short emails: three sentences and one clear ask.', 'email', { edit: 4, said: 1 }, 1),
      p('p-d4e5f6', 'Never schedules posts on weekends.', 'posts', { skip: 3 }, 3),
      p('p-0a1b2c', 'Wants price changes announced with 30 days’ notice.', 'decisions', { discuss: 2, approve: 2 }, 6),
      p('p-3d4e5f', 'Prefers no bullet lists in grant answers.', 'grants', { edit: 2 }, 12, { status: 'superseded', superseded_by: 'p-6a7b8c' }),
      p('p-6a7b8c', 'Prefers short bullet lists in grant answers, five at most.', 'grants', { said: 1, edit: 1 }, 2),
    ],
  };
}
