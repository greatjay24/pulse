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
  teamId?: string; // For Vercel: team slug or ID (e.g., "greatjay24-projects")
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
