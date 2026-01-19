import { Platform, IntegrationType, App } from '../types';

// Platform metadata for display
export const PLATFORM_INFO: Record<Platform, { label: string; icon: string; description: string }> = {
  web: { label: 'Web App', icon: 'globe', description: 'SaaS, website, or web platform' },
  mobile: { label: 'Mobile App', icon: 'mobile', description: 'iOS, Android, or cross-platform' },
  service: { label: 'Service', icon: 'server', description: 'Agency, consulting, or freelance' },
  fun: { label: 'Fun Project', icon: 'rocket', description: 'Side project or experiment' },
};

// Platform-specific integrations (recommended for each platform)
export const PLATFORM_INTEGRATIONS: Record<Platform, IntegrationType[]> = {
  web: ['vercel', 'netlify', 'plausible', 'google_analytics', 'sentry', 'logrocket'],
  mobile: ['firebase', 'revenuecat', 'amplitude', 'sentry', 'mixpanel'],
  service: ['google_calendar', 'cal', 'slack', 'resend', 'intercom', 'crisp'],
  fun: ['plausible', 'vercel', 'supabase', 'posthog'],
};

// Shared integrations - show on ALL tabs with note "All platforms"
export const SHARED_INTEGRATIONS: IntegrationType[] = [
  // Payment providers (revenue is typically unified)
  'stripe', 'lemonsqueezy', 'paddle', 'gumroad',
  // Cross-platform tools
  'supabase', 'posthog', 'mixpanel', 'sentry',
  // Auth (usually shared)
  'clerk', 'auth0',
  // Email (usually shared)
  'resend', 'sendgrid', 'convertkit', 'mailchimp',
  // Communication (shared)
  'slack', 'discord',
];

// Check if an integration is shared across all platforms
export const isSharedIntegration = (type: IntegrationType): boolean =>
  SHARED_INTEGRATIONS.includes(type);

// Get the default platform for an integration type
export const getDefaultPlatformForIntegration = (type: IntegrationType): Platform | undefined => {
  if (isSharedIntegration(type)) return undefined;

  for (const [platform, integrations] of Object.entries(PLATFORM_INTEGRATIONS)) {
    if (integrations.includes(type)) {
      return platform as Platform;
    }
  }
  return undefined;
};

// Get recommended integrations for selected platforms (union of all)
export const getRecommendedIntegrations = (platforms: Platform[]): IntegrationType[] => {
  const recommended = new Set<IntegrationType>();

  for (const platform of platforms) {
    for (const integration of PLATFORM_INTEGRATIONS[platform]) {
      recommended.add(integration);
    }
  }

  // Also add shared integrations
  for (const integration of SHARED_INTEGRATIONS) {
    recommended.add(integration);
  }

  return Array.from(recommended);
};

// Check if an integration is recommended for any of the selected platforms
export const isRecommendedForPlatforms = (type: IntegrationType, platforms: Platform[]): boolean => {
  if (platforms.length === 0) return false;
  if (isSharedIntegration(type)) return true;

  return platforms.some(platform => PLATFORM_INTEGRATIONS[platform].includes(type));
};

// Migration: Add default platforms to existing apps that don't have them
export const migrateApp = (app: App): App => {
  if (!app.platforms || app.platforms.length === 0) {
    // Default to 'web' platform for existing projects
    return { ...app, platforms: ['web'] };
  }
  return app;
};

// Migration: Migrate an array of apps
export const migrateApps = (apps: App[]): App[] => {
  return apps.map(migrateApp);
};
