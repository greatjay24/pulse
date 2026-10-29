// Platform types for multi-platform projects
export type Platform = 'web' | 'mobile' | 'service' | 'fun';

export interface App {
  id: string;
  name: string;
  domain?: string; // Domain for favicon (e.g., "example.com")
  color?: string; // Project color for calendar/analytics (e.g., "#8b5cf6")
  platforms: Platform[]; // Multi-platform support (Web, Mobile, Service, Fun)
  integrations: Integration[];
  googleCalendar?: GoogleCalendarConfig; // Per-project Google Calendar connection (legacy)
  googleAuth?: GoogleAuthConfig; // Unified Google auth for Calendar + Gmail
  github?: GitHubConfig; // GitHub integration config
}

// Predefined project colors
export const PROJECT_COLORS = [
  { name: 'Purple', value: '#8b5cf6' },
  { name: 'Blue', value: '#3b82f6' },
  { name: 'Green', value: '#22c55e' },
  { name: 'Orange', value: '#f97316' },
  { name: 'Pink', value: '#ec4899' },
  { name: 'Cyan', value: '#06b6d4' },
  { name: 'Red', value: '#ef4444' },
  { name: 'Yellow', value: '#eab308' },
];

export interface Integration {
  type: IntegrationType;
  apiKey?: string;
  projectId?: string;
  teamId?: string; // For Vercel: team slug or ID (e.g., "my-team-projects")
  enabled: boolean;
  platform?: Platform; // Which platform this integration belongs to (for filtering)
}

export type IntegrationType =
  // Payments & Revenue
  | 'stripe'
  | 'lemonsqueezy'
  | 'paddle'
  | 'revenuecat'
  | 'gumroad'
  // Analytics
  | 'posthog'
  | 'mixpanel'
  | 'amplitude'
  | 'plausible'
  | 'google_analytics'
  // Hosting & Deployment
  | 'vercel'
  | 'netlify'
  | 'railway'
  | 'render'
  | 'flyio'
  // Database & Backend
  | 'supabase'
  | 'firebase'
  | 'planetscale'
  | 'neon'
  | 'mongodb'
  // Auth
  | 'clerk'
  | 'auth0'
  // Email & Marketing
  | 'resend'
  | 'sendgrid'
  | 'convertkit'
  | 'mailchimp'
  | 'gmail'
  // Monitoring & Errors
  | 'sentry'
  | 'logrocket'
  // Calendar & Scheduling
  | 'google_calendar'
  | 'cal'
  // Communication
  | 'slack'
  | 'discord'
  // Support
  | 'intercom'
  | 'crisp'
  // Code & Version Control
  | 'github';

// ==========================================
// Stripe Types (Extended)
// ==========================================

export interface PlanRevenue {
  planId: string;
  planName: string;
  mrr: number;
  subscriberCount: number;
  percentOfTotal: number;
}

export interface MrrBridge {
  newMrr: number;
  expansionMrr: number;
  contractionMrr: number;
  churnedMrr: number;
  reactivationMrr: number;
  netNewMrr: number;
}

export interface StripeMetrics {
  mrr: number;
  activeSubscriptions: number;
  revenue30d: number;
  churnRate: number;
}

export interface DailyRevenue {
  date: string;
  revenue: number;
}

export interface StripeMetricsExtended extends StripeMetrics {
  arr: number;
  newMrr: number;
  expansionMrr: number;
  churnedMrr: number;
  netNewMrr: number;
  newSubscribers30d: number;
  churnedSubscribers30d: number;
  revenueGrowthRate: number;
  subscriberGrowthRate: number;
  arpu: number;
  ltvEstimate: number;
  revenueByPlan: PlanRevenue[];
  mrrBridge: MrrBridge;
  trialConversionRate: number;
  averageRevenuePerSubscription: number;
  dailyRevenue: DailyRevenue[];
  dailySubscribers: number[];
}

export interface StripeEvent {
  id: string;
  type: 'subscription.created' | 'subscription.updated' | 'subscription.deleted' |
        'invoice.paid' | 'invoice.payment_failed' | 'customer.created' |
        'charge.succeeded' | 'charge.failed' | 'payout.paid' | string;
  created: number;
  description: string;
  amount?: number;
  customerEmail?: string;
  planName?: string;
  currency?: string;
}

// ==========================================
// Unified Activity Event Types
// ==========================================

export type ActivitySource = 'stripe' | 'supabase' | 'vercel' | 'system';

export type ActivityType =
  // Stripe events
  | 'payment'
  | 'payment_failed'
  | 'subscription_created'
  | 'subscription_cancelled'
  | 'subscription_upgraded'
  | 'subscription_downgraded'
  | 'refund'
  | 'payout'
  // Supabase/Auth events
  | 'user_signup'
  | 'user_deleted'
  // Vercel events
  | 'deployment_success'
  | 'deployment_failed'
  // Milestones
  | 'milestone_mrr'
  | 'milestone_users'
  | 'milestone_subscribers';

export type AuthProvider = 'email' | 'google' | 'github' | 'apple' | 'twitter' | 'discord' | 'unknown';

export interface ActivityEvent {
  id: string;
  source: ActivitySource;
  type: ActivityType;
  timestamp: number; // Unix timestamp (seconds)
  title: string;
  description?: string;
  // Optional metadata based on event type
  amount?: number;
  currency?: string;
  email?: string;
  authProvider?: AuthProvider;
  planName?: string;
  milestoneValue?: number;
  deploymentUrl?: string;
  isPositive?: boolean; // For styling (green vs red)
}

export interface SupabaseUser {
  id: string;
  email?: string;
  created_at: string;
  last_sign_in_at?: string;
  app_metadata?: {
    provider?: string;
    providers?: string[];
  };
}

// ==========================================
// Calendar Types
// ==========================================

export interface CalendarEvent {
  id: string;
  title: string;
  startTime: string;
  endTime: string;
  source: 'google' | 'stripe' | 'custom';
  type: 'meeting' | 'deadline' | 'renewal' | 'trial_end' | 'payout' | 'other';
  description?: string;
  url?: string;
  color?: string;
  calendarName?: string;  // Name of the Google Calendar this event belongs to
  calendarColor?: string; // Color of the Google Calendar (hex, e.g., "#4285f4")
}

export interface GoogleCalendarConfig {
  enabled: boolean;
  accessToken?: string;
  refreshToken?: string;
  calendarIds: string[];
}

// Extended Google Auth config that supports multiple services (Calendar + Gmail)
export interface GoogleAuthConfig {
  enabled: boolean;
  accessToken?: string;
  refreshToken?: string;
  scopes: string[]; // Track granted scopes (calendar, gmail, etc.)
  calendarIds?: string[];
}

// ==========================================
// Gmail Types
// ==========================================

export interface GmailLabel {
  id: string;
  name: string;
  color?: string; // Hex color from Gmail
  type: 'system' | 'user'; // System labels (INBOX, SENT) vs user-created
}

export interface GmailMessage {
  id: string;
  threadId: string;
  from: string;
  fromName?: string;
  subject: string;
  snippet: string;
  date: number; // Unix timestamp
  labels: GmailLabel[]; // Resolved label objects with name + color
  isUnread: boolean;
}

export interface GmailMetrics {
  unreadCount: number;
  inboxCount: number;
  primaryUnread: number;
  lastFetched: string;
}

// ==========================================
// GitHub Types
// ==========================================

export interface GitHubConfig {
  enabled: boolean;
  personalAccessToken?: string;
  username?: string;
  repos?: string[]; // repos to track (owner/repo format)
}

export interface GitHubNotification {
  id: string;
  type: 'Issue' | 'PullRequest' | 'Release' | 'Discussion' | 'Commit';
  title: string;
  reason: string;
  repoName: string;
  url: string;
  updatedAt: string;
  unread: boolean;
}

export interface GitHubActivity {
  id: string;
  type: 'push' | 'pr' | 'issue' | 'star' | 'fork' | 'release' | 'comment';
  repoName: string;
  description: string;
  timestamp: string;
  url?: string;
}

export interface GitHubRepoStats {
  name: string;
  fullName: string;
  stars: number;
  forks: number;
  openIssues: number;
  openPRs: number;
  watchers: number;
}

export interface GitHubMetrics {
  totalStars: number;
  totalForks: number;
  openIssues: number;
  openPRs: number;
  notifications: GitHubNotification[];
  recentActivity: GitHubActivity[];
  repos: GitHubRepoStats[];
}

// ==========================================
// Analytics Types (PostHog / Google Analytics)
// ==========================================

export interface AnalyticsMetrics {
  source: 'posthog' | 'google_analytics';
  dau: number; // Daily Active Users
  wau: number; // Weekly Active Users
  mau: number; // Monthly Active Users
  dauChange?: number; // % change from previous period
  wauChange?: number;
  mauChange?: number;
  keyEvents?: AnalyticsEvent[];
}

export interface AnalyticsEvent {
  name: string;
  count: number;
  change: number; // % change from previous period
}

// ==========================================
// Vercel Types (Extended)
// ==========================================

export interface VercelMetrics {
  deployments: Deployment[];
  lastDeployedAt: string | null;
  status: 'ready' | 'building' | 'error' | 'unknown';
}

export interface VercelMetricsExtended extends VercelMetrics {
  totalDeployments30d: number;
  successRate: number;
  averageBuildTime: number;
  failedDeployments30d: number;
  domainsCount: number;
}

export interface Deployment {
  id: string;
  name: string;
  state: string;
  createdAt: string;
  url: string;
  buildDuration?: number;
  source?: string;
}

// ==========================================
// PostHog Types
// ==========================================

export interface PostHogMetrics {
  totalEvents24h: number;
  uniqueUsers24h: number;
  totalEvents7d: number;
  uniqueUsers7d: number;
}

export interface PostHogMetricsExtended extends PostHogMetrics {
  totalEvents30d: number;
  uniqueUsers30d: number;
  averageSessionDuration: number;
  bounceRate: number;
  topEvents: EventCount[];
  userGrowthRate: number;
}

export interface EventCount {
  eventName: string;
  count: number;
  change: number;
}

// ==========================================
// Supabase Types
// ==========================================

export interface SupabaseMetrics {
  totalUsers: number;
  newUsers7d: number;
  databaseSize: string;
  apiRequests24h: number;
}

export interface SupabaseMetricsExtended extends SupabaseMetrics {
  activeUsers7d: number;
  storageUsed: string;
  storageLimit: string;
  bandwidthUsed: string;
  functionInvocations24h: number;
  realtimeConnections: number;
}

// ==========================================
// App Metrics (Combined)
// ==========================================

export interface AppMetrics {
  stripe?: StripeMetrics | StripeMetricsExtended;
  vercel?: VercelMetrics | VercelMetricsExtended;
  posthog?: PostHogMetrics | PostHogMetricsExtended;
  supabase?: SupabaseMetrics | SupabaseMetricsExtended;
  stripeEvents?: StripeEvent[];
  calendarEvents?: CalendarEvent[];
  // Gmail metrics
  gmail?: GmailMetrics;
  gmailMessages?: GmailMessage[];
  // GitHub metrics
  github?: GitHubMetrics;
  // Analytics (DAU/MAU/WAU)
  analytics?: AnalyticsMetrics;
  lastUpdated: string;
}

// ==========================================
// Historical Data Types
// ==========================================

export interface MetricSnapshot {
  date: string;
  appId: string;
  stripe?: {
    mrr: number;
    activeSubscriptions: number;
    churnRate: number;
    arr: number;
  };
  vercel?: {
    deployments: number;
    successRate: number;
  };
  posthog?: {
    uniqueUsers: number;
    totalEvents: number;
  };
  supabase?: {
    totalUsers: number;
    apiRequests: number;
  };
}

export interface HistoricalData {
  appId: string;
  snapshots: MetricSnapshot[];
  lastUpdated: string;
}

// ==========================================
// Settings
// ==========================================

export interface Settings {
  apps: App[];
  refreshInterval: number; // minutes
  launchAtStartup: boolean;
  googleCalendar?: GoogleCalendarConfig;
  historyRetentionDays?: number;
  dashboardLayout?: GridLayoutItem[]; // User's custom grid layout
  saasMetrics?: boolean; // show the original SaaS-metrics pages (Overview, Analytics, Calendar); off by default
  notifications?: boolean; // native alerts for new urgent items; on unless turned off
}

// ==========================================
// UI State Types
// ==========================================

export type DetailPanelType =
  | 'mrr'
  | 'subscribers'
  | 'churn'
  | 'growth'
  | 'revenue-breakdown'
  | 'stripe-events'
  | 'calendar'
  | 'gmail'
  | 'github'
  | null;

export interface DetailPanelState {
  isOpen: boolean;
  type: DetailPanelType;
  appId?: string;
}

// ==========================================
// Dashboard Widget Types
// ==========================================

export type WidgetType =
  | 'stat-mrr'
  | 'stat-subscribers'
  | 'stat-churn'
  | 'stat-arpu'
  | 'stat-arr'
  | 'stat-ltv'
  | 'chart-revenue'
  | 'chart-subscribers'
  | 'chart-activity'
  | 'chart-churn'
  | 'calendar'
  | 'activity-feed'
  // Gmail widgets
  | 'stat-gmail-unread'
  | 'gmail-inbox'
  // GitHub widgets
  | 'stat-github-stars'
  | 'github-activity'
  // Analytics widgets
  | 'stat-analytics-dau'
  | 'stat-analytics-mau'
  | 'stat-analytics-wau';

export interface DashboardWidget {
  id: string;
  type: WidgetType;
  size: 'small' | 'medium' | 'large'; // small=1col, medium=2col, large=full
  row: 'stats' | 'charts' | 'bottom';
}

export interface DashboardLayout {
  widgets: DashboardWidget[];
}

// ==========================================
// Grid Layout Types (react-grid-layout)
// ==========================================

export interface GridLayoutItem {
  i: string; // Widget ID
  x: number; // X position in grid units
  y: number; // Y position in grid units
  w: number; // Width in grid units
  h: number; // Height in grid units
  minW?: number; // Minimum width
  minH?: number; // Minimum height
  maxW?: number; // Maximum width
  maxH?: number; // Maximum height
  static?: boolean; // If true, can't be moved or resized
}

export interface GridWidgetConfig {
  type: WidgetType;
  title: string;
  minW: number;
  minH: number;
  defaultW: number;
  defaultH: number;
  maxW?: number;
  maxH?: number;
}

export interface DashboardGridLayout {
  items: GridLayoutItem[];
  cols: number;
  rowHeight: number;
}

// ==========================================
// Portfolio (org board): mirrors ~/portfolio/STATUS_SCHEMA.md
// ==========================================

export type Health = 'green' | 'yellow' | 'red';
export type Gate = 'decision' | 'money' | 'relationship' | 'taste';

export interface PortfolioGroup {
  id: string;
  name: string;
}

export interface PortfolioEntity {
  id: string;
  name: string;
  group: string;
  parent: string | null;
  path: string;
  lead?: string;
  schedule?: string;
  tracker_projects?: string[]; // ~/project-tracker project ids that roll up into this entity
  logo?: string; // path under ~/portfolio/assets/, for light backgrounds
  logo_dark?: string; // the same mark for dark backgrounds
  color?: string; // hex; tints the initial when there is no logo
  runner?: string | { name: string; [k: string]: unknown }; // overrides the org's agent CLI for this entity
}

export interface PortfolioRegistry {
  groups: PortfolioGroup[];
  entities: PortfolioEntity[];
}

export interface EntityMetric {
  label: string;
  value: string;
  trend?: 'up' | 'down' | 'flat';
  source?: string;
}

export interface EntityLane {
  status: string;
  next: string;
}

export interface EntityDecision {
  id?: string; // stable slug, same decision = same id every run (older reports omit it)
  ask: string;
  recommend?: string;
  why?: string;
  gate?: Gate;
  due?: string | null;
  on_approve?: string; // what the lead does the moment the owner approves
}

export interface EntityStatus {
  entity: string;
  name: string;
  group: string;
  parent: string | null;
  stage?: string;
  updated?: string;
  health?: Health;
  health_why?: string; // one line: which health rule set the color
  headline?: string;
  metrics?: EntityMetric[];
  lanes?: Record<string, EntityLane>;
  decisions?: EntityDecision[];
  waiting_on?: { who: string; what: string; since?: string | null }[];
  risks?: { what: string; date?: string | null; severity?: 'high' | 'medium' | 'low' }[];
  next?: string[];
  done?: { what: string; link?: string | null; date?: string | null }[];
}

export interface PortfolioEntityReport {
  id: string;
  status: EntityStatus | null;
  error: string | null; // "missing", "malformed: …", etc. Either way the UI shows "no report yet".
  logo: string | null; // data: URL read by Rust from the registry's `logo`
  logo_dark: string | null;
  logo_error: string | null;
}

export interface PortfolioSnapshot {
  registry: PortfolioRegistry | null;
  registry_error: string | null;
  setup_needed?: boolean; // no ~/portfolio/portfolio.json yet: Pulse shows the welcome screen
  entities: PortfolioEntityReport[];
  week: string | null;
  read_at: string;
}

// ==========================================
// Decisions and activity: what the Rust `act_on_decision` / `read_activity` commands pass
// ==========================================

// approve | reject | discuss are the owner's (via act.py); done | reply are the lead's.
export type DecisionAction = 'approve' | 'reject' | 'discuss' | 'done' | 'reply';

export interface DecisionRow {
  id: string;
  action: DecisionAction;
  note?: string;
  at: string;
  ask?: string; // act.py copies these so an answer still reads after the decision leaves status.json
  recommend?: string;
}

export interface RunTokens {
  input: number;
  output: number;
}

// One agent run: an item of a nightly log (an array) or a whole act log (one object).
export interface AgentRun {
  agent: string;
  run_id?: string; // its transcript in logs/transcripts/ (runs from before transcripts have none)
  agents?: number; // subagents it deployed; 0 = worked solo (absent on runs from before tracking)
  ok?: boolean;
  result?: string;
  cost_usd?: number | null; // only when the runner reports it; never estimated
  tokens?: RunTokens; // runners that report tokens but not cost (Codex)
  runner?: string; // claude-code (absent on its runs) | codex | opencode
  secs?: number;
  models?: string[];
  // act runs only
  kind?: 'act';
  entity?: string;
  decision?: string;
  action?: 'approve' | 'reject' | 'discuss';
  running?: boolean;
  started?: string;
  finished?: string;
}

export interface DraftRow {
  date: string;
  entity: string;
  prospect?: string;
  vertical?: string;
  subject?: string;
  variant?: string;
  source?: string;
}

export interface ActivitySnapshot {
  runs: { file: string; data: AgentRun[] | AgentRun }[];
  decisions: { entity: string; rows: DecisionRow[] }[];
  drafts: DraftRow[];
  commits: { hash: string; at: string; subject: string }[];
  errors: string[];
  read_at: string;
}

// ==========================================
// Live runs and transcripts (~/portfolio/bin/live.py writes them; Rust `read_live`,
// `read_transcript` and `list_transcripts` read them)
// ==========================================

// `stopped` is Pulse's word for a run that says it is working but whose process is gone.
// `queued` is a chat message waiting for the lead's current reply to end (ask.py).
export type LiveState = 'running' | 'idle' | 'queued' | 'finished' | 'failed' | 'stopped';

export interface LiveRun {
  run_id: string;
  kind: string; // nightly | weekly | act | check | interactive | chat
  entity: string | null; // null = the whole org (chief of staff, a manager)
  agent: string;
  doing: string;
  started: string;
  pid: number;
  transcript: string;
  state: LiveState;
  step: string;
  step_at: string;
  updated: string;
  finished?: string;
  ok?: boolean;
  result?: string;
  cost_usd?: number | null;
  tokens?: RunTokens;
  runner?: string;
  secs?: number | null;
  last?: string; // interactive: the agent's last message
  team?: TeamMember[]; // subagents this run deployed
  deployments?: number;
  session_id?: string; // chat: the Claude session this run continues or started
  child_pid?: number;
  // Front door (ask.py extras): the run that handed this one off, its hand-off group, why it ran.
  parent_run?: string;
  group?: string;
  trigger?: 'report' | 'brief' | 'followup' | string;
  report_for?: string;
  source?: 'pulse' | 'telegram' | 'voice' | 'schedule' | string;
}

// A subagent a lead deployed. Agents deployed within a few seconds share a batch.
export interface TeamMember {
  id: string;
  type: string;
  description: string;
  prompt: string;
  background?: boolean;
  by?: string | null; // set when another subagent deployed it
  batch: number;
  started: string;
  status: 'running' | 'completed' | 'failed' | 'unfinished' | string;
  finished?: string;
  summary?: string;
  secs?: number | null;
}

export interface LiveSnapshot {
  runs: LiveRun[];
  errors: string[];
  read_at: string;
}

export type TranscriptLine =
  | { t: 'start'; at: string; run_id: string; kind: string; entity: string | null; agent: string; doing: string; prompt: string; parent_run?: string; trigger?: string; source?: string; report_for?: string }
  | { t: 'report'; at: string; text: string; detail?: string } // the leads' results coming back to the front door
  | { t: 'user'; at: string; text: string }
  | { t: 'text'; at: string; text: string; sub?: boolean }
  | { t: 'tool'; at: string; name: string; summary: string; sub?: boolean }
  | { t: 'error'; at: string; text: string }
  | { t: 'deploy'; at: string; agents: Omit<TeamMember, 'batch' | 'started' | 'status'>[]; sub?: boolean }
  | { t: 'agent_done'; at: string; id: string; status: string; summary: string; secs: number | null; tools: number | null }
  | { t: 'result'; at: string; ok: boolean; result: string; cost_usd: number | null; secs: number | null; turns?: number; models?: string[]; agents?: number; tokens?: RunTokens; runner?: string };

export interface Transcript {
  run_id: string;
  lines: TranscriptLine[];
  truncated: boolean;
}

export interface TranscriptSummary {
  run_id: string;
  start: TranscriptLine | null;
  last: TranscriptLine | null;
  modified: string;
}

// What the welcome screen checks (Rust `setup_check`): existence only, at fixed paths.
export interface SetupCheck {
  setup_needed: boolean;
  runners: { id: string; label: string; path: string | null }[]; // agent CLIs; setup needs one
  python3: string | null;
  tracker: boolean;
}

// ==========================================
// Tracker (~/project-tracker): what the Rust `read_tracker` command passes through
// ==========================================

export type Urgency = 'now' | 'soon' | 'whenever';

export interface TrackerTask {
  id: string;
  title: string;
  detail: string | null;
  url: string | null;
  project: string | null;
  kind: string | null;
  urgency: Urgency | null;
  status: 'open' | 'scheduled';
  source: string | null; // manual | email | github | git
  first_seen: number | null; // unix seconds
  show_from: string | null;
}

export interface TrackerEmail {
  account_label: string | null;
  sender: string | null;
  name: string | null;
  subject: string | null;
  date: string | null;
  age_days: number | null;
  project: string | null;
  urgency: Urgency | null;
  url: string | null;
}

export interface TrackerEmailSummary {
  collected_at: number | null;
  stale: boolean;
  age_hours: number | null;
  needs_reply: TrackerEmail[];
  replied_count: number;
  accounts_not_fetching: string[];
}

export interface TrackerRepo {
  id: string;
  name: string;
  exists: boolean;
  is_git: boolean;
  branch: string | null;
  dirty_count: number | null;
  days_idle: number | null;
  last_commit_ts: number | null;
}

export interface TrackerMoney {
  configured: boolean;
  sources: Record<'stripe' | 'email' | 'bank', { ok: boolean }>;
  totals: { today: number; d7: number; d30: number };
  counts: { today: number; d7: number; d30: number };
  failed_30d: number;
  refunds_30d: number;
  mrr_total: number;
  finance: MoneyFinance;
}

export type MoneySourceId = 'stripe' | 'email' | 'bank';

// Breakdowns from the Rust money port: the same counted events as the totals, per tracker project.
export interface MoneyFinance {
  coverage: {
    source: MoneySourceId;
    ok: boolean;
    reason: string | null;
    collected_at: number | null; // unix seconds
    window_days: number | null; // how far back the collector reaches
  }[];
  projects: ProjectFinance[];
  stripe_accounts: { project: string; ok: boolean; error: string | null; active: number; mrr: number }[];
  bank_accounts: { name: string; org: string; project: string | null; balance: number | null; currency: string }[];
}

export interface ProjectFinance {
  project: string; // tracker project id, or "unsorted"
  d30: number;
  d90: number;
  months: [string, number][]; // [YYYY-MM, total], oldest first
  by_channel: [MoneySourceId, number][]; // last 90 days
  by_rail: [MoneySourceId, string, number][]; // last 90 days: [channel, rail (zelle, venmo...), total]
  payers: { name: string; total: number; payments: number }[]; // last 90 days
  no_payer_90d: number;
}

export interface TrackerNote {
  status: string | null;
  goal: string | null;
  next: string | null;
  blocked_on: string | null;
}

export interface TrackerSnapshot {
  installed?: boolean; // false when there is no ~/project-tracker: the tracker is optional
  error: string | null; // ~/project-tracker missing
  file_errors: Record<string, string>;
  tasks: TrackerTask[];
  tasks_updated_at: number | null;
  email: TrackerEmailSummary | null;
  repos: TrackerRepo[];
  scanned_at: number | null;
  money: TrackerMoney;
  projects: { id: string; name: string | null; area: string | null }[];
  notes: Record<string, TrackerNote>;
  read_at: string;
}
