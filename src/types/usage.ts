// logs/usage/usage.json, written by bin/usage.py. Dollar figures are API-equivalent
// estimates: the plan is a subscription, so nothing here is charged.

export interface UsageTokens {
  input: number;
  output: number;
  cache_read: number;
  cache_write: number;
}

export interface UsageRun {
  id: string;
  run_id: string | null; // a transcript Pulse can open in Conversations
  source: 'runner' | 'session';
  kind: string; // nightly | weekly | act | chat | watch | check | learn | interactive | headless
  entity: string | null;
  agent: string | null;
  doing: string;
  started: string | null;
  ended: string | null;
  secs: number | null;
  ok: boolean | null;
  cost_usd: number | null;
  cost_basis: 'reported' | 'estimated' | null;
  tokens: UsageTokens | null;
  by_model: Record<string, UsageTokens & { cost_usd: number | null }> | null;
  models: string[];
  session_id: string | null;
  project?: string | null;
  hours: Record<string, number>; // hour start (ISO) -> cost in that hour
}

export interface UsageWindow {
  since: string;
  cost_usd: number;
  tokens: UsageTokens;
  runs: number;
  budget_usd: number | null;
  used: number | null; // share of the soft budget, 0..1+
  warn: boolean;
}

export interface PlanWindow {
  utilization: number; // 0..1, from Claude Code
  resets_at: string | null;
  status: string | null;
  reset_passed: boolean;
  warn: boolean;
}

export interface PlanReading {
  at: string;
  run_id: string | null;
  status: string | null;
  using_overage: boolean;
  age_secs: number | null;
  stale: boolean;
  windows: Record<string, PlanWindow>; // five_hour, seven_day, ...
}

export interface UsageReport {
  generated: string;
  sessions_scanned: boolean;
  warn_at: number;
  plan: PlanReading | null;
  windows: Record<'five_hour' | 'seven_day', UsageWindow>;
  implied_budget_usd: Partial<Record<'five_hour' | 'seven_day', number>>;
  runs: UsageRun[];
}

export interface UsageSnapshot {
  report: UsageReport | null;
  refresh_error: string | null;
}

// memory/preferences.json, written by bin/learn.py.
export interface LearnedPreference {
  id: string;
  text: string;
  area: string;
  entity: string | null;
  evidence: Record<string, number>;
  first_seen: string;
  last_seen: string;
  sources: string[];
  status: 'active' | 'superseded';
  superseded_by: string | null;
  disabled: boolean;
}

export interface PreferencesDoc {
  updated?: string;
  preferences: LearnedPreference[];
}
