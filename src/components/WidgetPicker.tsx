import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { WidgetType, IntegrationType, Integration, App, GoogleCalendarConfig } from '../types';
import { useTheme } from '../contexts/ThemeContext';
import { IntegrationConfigForm, CredentialValues, INTEGRATION_NAMES } from './IntegrationConfigForm';
import { ProjectCredentialsGrid, ProjectCredentialConfig } from './ProjectCredentialsGrid';

// Map widgets to their required integrations
const WIDGET_INTEGRATIONS: Record<WidgetType, IntegrationType[]> = {
  'stat-mrr': ['stripe', 'lemonsqueezy', 'paddle', 'revenuecat', 'gumroad'],
  'stat-subscribers': ['stripe', 'lemonsqueezy', 'paddle', 'revenuecat'],
  'stat-churn': ['stripe'],
  'stat-arpu': ['stripe'],
  'stat-arr': ['stripe', 'lemonsqueezy', 'paddle'],
  'stat-ltv': ['stripe'],
  'chart-revenue': ['stripe', 'lemonsqueezy', 'paddle'],
  'chart-subscribers': ['stripe', 'lemonsqueezy'],
  'chart-activity': ['stripe', 'vercel'],
  'chart-churn': ['stripe'],
  'calendar': ['google_calendar'],
  'activity-feed': [],
  // Gmail widgets
  'stat-gmail-unread': ['gmail'],
  'gmail-inbox': ['gmail'],
  // GitHub widgets
  'stat-github-stars': ['github'],
  'github-activity': ['github'],
  // Analytics widgets
  'stat-analytics-dau': ['posthog', 'google_analytics'],
  'stat-analytics-mau': ['posthog', 'google_analytics'],
  'stat-analytics-wau': ['posthog', 'google_analytics'],
};

interface WidgetOption {
  type: WidgetType;
  name: string;
  description: string;
  icon: React.ReactNode;
  category: 'stats' | 'charts' | 'other';
}

const widgetOptions: WidgetOption[] = [
  {
    type: 'stat-mrr',
    name: 'Monthly Revenue',
    description: 'MRR with trend indicator',
    category: 'stats',
    icon: (
      <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
  },
  {
    type: 'stat-subscribers',
    name: 'Subscribers',
    description: 'Active subscriber count',
    category: 'stats',
    icon: (
      <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    ),
  },
  {
    type: 'stat-churn',
    name: 'Churn Rate',
    description: 'Monthly churn percentage',
    category: 'stats',
    icon: (
      <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 17h8m0 0V9m0 8l-8-8-4 4-6-6" />
      </svg>
    ),
  },
  {
    type: 'stat-arpu',
    name: 'Avg Revenue/User',
    description: 'ARPU metric',
    category: 'stats',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
        <path d="M13.976 9.15c-2.172-.806-3.356-1.426-3.356-2.409 0-.831.683-1.305 1.901-1.305 2.227 0 4.515.858 6.09 1.631l.89-5.494C18.252.975 15.697 0 12.165 0 9.667 0 7.589.654 6.104 1.872 4.56 3.147 3.757 4.992 3.757 7.218c0 4.039 2.467 5.76 6.476 7.219 2.585.92 3.445 1.574 3.445 2.583 0 .98-.84 1.545-2.354 1.545-1.875 0-4.965-.921-6.99-2.109l-.9 5.555C5.175 22.99 8.385 24 11.714 24c2.641 0 4.843-.624 6.328-1.813 1.664-1.305 2.525-3.236 2.525-5.732 0-4.128-2.524-5.851-6.591-7.305z"/>
      </svg>
    ),
  },
  {
    type: 'stat-arr',
    name: 'Annual Revenue',
    description: 'ARR metric',
    category: 'stats',
    icon: (
      <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
      </svg>
    ),
  },
  {
    type: 'stat-ltv',
    name: 'Lifetime Value',
    description: 'Estimated customer LTV',
    category: 'stats',
    icon: (
      <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
      </svg>
    ),
  },
  {
    type: 'chart-revenue',
    name: 'Revenue Trend',
    description: 'Revenue over time',
    category: 'charts',
    icon: (
      <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 12l3-3 3 3 4-4M8 21l4-4 4 4M3 4h18M4 4h16v12a1 1 0 01-1 1H5a1 1 0 01-1-1V4z" />
      </svg>
    ),
  },
  {
    type: 'chart-subscribers',
    name: 'Subscriber Growth',
    description: 'Subscribers over time',
    category: 'charts',
    icon: (
      <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16 8v8m-4-5v5m-4-2v2m-2 4h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
      </svg>
    ),
  },
  {
    type: 'chart-activity',
    name: 'Daily Activity',
    description: 'Activity bar chart',
    category: 'charts',
    icon: (
      <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
      </svg>
    ),
  },
  {
    type: 'calendar',
    name: 'Calendar',
    description: 'Monthly calendar view',
    category: 'other',
    icon: (
      <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
      </svg>
    ),
  },
  {
    type: 'activity-feed',
    name: 'Activity Feed',
    description: 'Recent events & activity',
    category: 'other',
    icon: (
      <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 01-2-2V7m2 13a2 2 0 002-2V9a2 2 0 00-2-2h-2m-4-3H9M7 16h6M7 8h6v4H7V8z" />
      </svg>
    ),
  },
  // Gmail widgets
  {
    type: 'stat-gmail-unread',
    name: 'Unread Emails',
    description: 'Gmail unread count',
    category: 'stats',
    icon: (
      <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
      </svg>
    ),
  },
  {
    type: 'gmail-inbox',
    name: 'Gmail Inbox',
    description: 'Recent emails with labels',
    category: 'other',
    icon: (
      <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
        <polyline points="22,6 12,13 2,6" strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} />
      </svg>
    ),
  },
  // GitHub widgets
  {
    type: 'stat-github-stars',
    name: 'GitHub Stars',
    description: 'Total stars across repos',
    category: 'stats',
    icon: (
      <svg width="20" height="20" fill="currentColor" viewBox="0 0 24 24">
        <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
      </svg>
    ),
  },
  {
    type: 'github-activity',
    name: 'GitHub Activity',
    description: 'Notifications, activity & repos',
    category: 'other',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/>
      </svg>
    ),
  },
  // Analytics widgets
  {
    type: 'stat-analytics-dau',
    name: 'Daily Active Users',
    description: 'DAU from analytics',
    category: 'stats',
    icon: (
      <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
      </svg>
    ),
  },
  {
    type: 'stat-analytics-mau',
    name: 'Monthly Active Users',
    description: 'MAU metric',
    category: 'stats',
    icon: (
      <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    ),
  },
  {
    type: 'stat-analytics-wau',
    name: 'Weekly Active Users',
    description: 'WAU metric',
    category: 'stats',
    icon: (
      <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
      </svg>
    ),
  },
];

// Step types for multi-step flow
type Step = 'select' | 'configure';

interface WidgetPickerProps {
  isOpen: boolean;
  onClose: () => void;
  onAdd: (type: WidgetType) => void;
  existingWidgets: WidgetType[];
  appIntegrations?: Integration[];
  // NEW: Context and settings update
  context: 'overview' | 'project';
  currentApp?: App;
  allApps: App[];
  onUpdateSettings: (apps: App[]) => Promise<void>;
}

export function WidgetPicker({
  isOpen,
  onClose,
  onAdd,
  existingWidgets,
  appIntegrations = [],
  context,
  currentApp,
  allApps,
  onUpdateSettings,
}: WidgetPickerProps) {
  const { tokens } = useTheme();

  // Multi-step state
  const [step, setStep] = useState<Step>('select');
  const [selectedWidget, setSelectedWidget] = useState<WidgetType | null>(null);
  const [requiredIntegration, setRequiredIntegration] = useState<IntegrationType | null>(null);

  // Credential state for single project
  const [singleCredentials, setSingleCredentials] = useState<CredentialValues>({});
  const [singleOAuthConfig, setSingleOAuthConfig] = useState<GoogleCalendarConfig | null>(null);

  // Credential state for multi-project (overview)
  const [multiCredentials, setMultiCredentials] = useState<Record<string, ProjectCredentialConfig>>({});

  // Reset state when modal opens/closes
  useEffect(() => {
    if (!isOpen) {
      setStep('select');
      setSelectedWidget(null);
      setRequiredIntegration(null);
      setSingleCredentials({});
      setSingleOAuthConfig(null);
      setMultiCredentials({});
    }
  }, [isOpen]);

  const categories = [
    { id: 'stats', name: 'Statistics' },
    { id: 'charts', name: 'Charts' },
    { id: 'other', name: 'Other' },
  ];

  // Check if a widget has its required integration connected
  const getWidgetStatus = (widgetType: WidgetType): {
    hasIntegration: boolean;
    missingIntegration: IntegrationType | null;
    integrationName: string | null;
  } => {
    const requiredIntegrations = WIDGET_INTEGRATIONS[widgetType];

    if (requiredIntegrations.length === 0) {
      return { hasIntegration: true, missingIntegration: null, integrationName: null };
    }

    const hasAny = requiredIntegrations.some(reqType =>
      appIntegrations.some(i => i.type === reqType && i.enabled && i.apiKey)
    );

    if (hasAny) {
      return { hasIntegration: true, missingIntegration: null, integrationName: null };
    }

    const firstRequired = requiredIntegrations[0];
    return {
      hasIntegration: false,
      missingIntegration: firstRequired,
      integrationName: INTEGRATION_NAMES[firstRequired] || firstRequired
    };
  };

  // Handle widget click - either add directly or go to configure step
  const handleWidgetClick = (widget: WidgetOption) => {
    const isAdded = existingWidgets.includes(widget.type);
    if (isAdded) return;

    const { hasIntegration, missingIntegration } = getWidgetStatus(widget.type);

    if (hasIntegration) {
      // Integration already configured, add widget directly
      onAdd(widget.type);
      onClose();
    } else if (missingIntegration) {
      // Need to configure integration first
      setSelectedWidget(widget.type);
      setRequiredIntegration(missingIntegration);
      setStep('configure');
    }
  };

  // Handle credential values change for single project
  const handleSingleCredentialsChange = useCallback((values: CredentialValues) => {
    setSingleCredentials(values);
  }, []);

  // Handle OAuth success for single project
  const handleSingleOAuthSuccess = useCallback((config: GoogleCalendarConfig) => {
    setSingleOAuthConfig(config);
  }, []);

  // Handle multi-project credentials change
  const handleMultiCredentialsChange = useCallback((credentials: Record<string, ProjectCredentialConfig>) => {
    setMultiCredentials(credentials);
  }, []);

  // Check if form is valid for submission
  const isFormValid = (): boolean => {
    if (!requiredIntegration) return false;

    const isOAuth = requiredIntegration === 'google_calendar' || requiredIntegration === 'gmail' || requiredIntegration === 'google_analytics';

    if (context === 'project') {
      if (isOAuth) {
        return singleOAuthConfig?.enabled === true;
      }
      // For API key integrations, check required fields
      return !!singleCredentials.apiKey;
    } else {
      // Overview: at least one project must be configured
      return Object.values(multiCredentials).some(c => {
        if (c.skip) return false;
        if (isOAuth) return c.googleCalendar?.enabled;
        return !!c.apiKey;
      });
    }
  };

  // Handle form submission
  const handleSubmit = async () => {
    if (!selectedWidget || !requiredIntegration) return;

    const isOAuth = requiredIntegration === 'google_calendar' || requiredIntegration === 'gmail' || requiredIntegration === 'google_analytics';

    if (context === 'project' && currentApp) {
      // Single project: update current app's integrations
      let updatedApp: App;

      if (isOAuth) {
        // For OAuth, update googleCalendar config
        updatedApp = {
          ...currentApp,
          googleCalendar: singleOAuthConfig || currentApp.googleCalendar,
        };
      } else {
        // For API key, add/update integration
        const existingIndex = currentApp.integrations.findIndex(i => i.type === requiredIntegration);
        const newIntegration: Integration = {
          type: requiredIntegration,
          apiKey: singleCredentials.apiKey,
          projectId: singleCredentials.projectId,
          teamId: singleCredentials.teamId,
          enabled: true,
        };

        const newIntegrations = existingIndex >= 0
          ? currentApp.integrations.map((i, idx) => idx === existingIndex ? newIntegration : i)
          : [...currentApp.integrations, newIntegration];

        updatedApp = { ...currentApp, integrations: newIntegrations };
      }

      // Update settings
      const updatedApps = allApps.map(a => a.id === currentApp.id ? updatedApp : a);
      await onUpdateSettings(updatedApps);
    } else {
      // Overview: update all configured apps
      const updatedApps = allApps.map(app => {
        const creds = multiCredentials[app.id];
        if (!creds || creds.skip) return app;

        if (isOAuth) {
          if (!creds.googleCalendar?.enabled) return app;
          return { ...app, googleCalendar: creds.googleCalendar };
        } else {
          if (!creds.apiKey) return app;

          const existingIndex = app.integrations.findIndex(i => i.type === requiredIntegration);
          const newIntegration: Integration = {
            type: requiredIntegration,
            apiKey: creds.apiKey,
            projectId: creds.projectId,
            teamId: creds.teamId,
            enabled: true,
          };

          const newIntegrations = existingIndex >= 0
            ? app.integrations.map((i, idx) => idx === existingIndex ? newIntegration : i)
            : [...app.integrations, newIntegration];

          return { ...app, integrations: newIntegrations };
        }
      });

      await onUpdateSettings(updatedApps);
    }

    // Add widget and close
    onAdd(selectedWidget);
    onClose();
  };

  // Get selected widget info
  const selectedWidgetInfo = selectedWidget
    ? widgetOptions.find(w => w.type === selectedWidget)
    : null;

  const integrationDisplayName = requiredIntegration
    ? INTEGRATION_NAMES[requiredIntegration] || requiredIntegration
    : '';

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 100,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            style={{
              position: 'absolute',
              inset: 0,
              background: 'rgba(0, 0, 0, 0.7)',
              backdropFilter: 'blur(8px)',
            }}
          />

          {/* Modal */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            style={{
              position: 'relative',
              background: tokens.colors.bgElevated,
              border: `1px solid ${tokens.colors.border}`,
              borderRadius: tokens.radius.xl,
              width: step === 'configure' && context === 'overview' ? '800px' : '680px',
              maxWidth: '95vw',
              overflow: 'hidden',
              boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
            }}
          >
            {/* Header */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '20px 24px',
                borderBottom: `1px solid ${tokens.colors.border}`,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                {step === 'configure' && (
                  <button
                    onClick={() => setStep('select')}
                    style={{
                      width: '32px',
                      height: '32px',
                      borderRadius: tokens.radius.sm,
                      border: `1px solid ${tokens.colors.border}`,
                      background: 'transparent',
                      color: tokens.colors.textMuted,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                    </svg>
                  </button>
                )}
                <div>
                  <h2 style={{ fontSize: '18px', fontWeight: 600, marginBottom: '4px' }}>
                    {step === 'select' ? 'Add Widget' : `Configure ${integrationDisplayName}`}
                  </h2>
                  <p style={{ fontSize: '13px', color: tokens.colors.textMuted }}>
                    {step === 'select'
                      ? 'Choose a widget to add to your dashboard'
                      : context === 'project'
                        ? `Connect ${integrationDisplayName} for ${currentApp?.name || 'this project'}`
                        : `Connect ${integrationDisplayName} for your projects`
                    }
                  </p>
                </div>
              </div>
              <button
                onClick={onClose}
                style={{
                  width: '32px',
                  height: '32px',
                  borderRadius: tokens.radius.sm,
                  border: `1px solid ${tokens.colors.border}`,
                  background: 'transparent',
                  color: tokens.colors.textMuted,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transition: 'all 0.15s ease',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = tokens.colors.bgCard;
                  e.currentTarget.style.borderColor = tokens.colors.borderHover;
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'transparent';
                  e.currentTarget.style.borderColor = tokens.colors.border;
                }}
              >
                <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Content */}
            <div style={{ padding: '20px 24px', overflowY: 'auto', maxHeight: 'calc(80vh - 160px)' }}>
              {step === 'select' ? (
                // Step 1: Widget Selection
                <>
                  {categories.map((category, categoryIndex) => {
                    const categoryWidgets = widgetOptions.filter((w) => w.category === category.id);
                    if (categoryWidgets.length === 0) return null;

                    return (
                      <div key={category.id} style={{ marginBottom: categoryIndex < categories.length - 1 ? '28px' : 0 }}>
                        <h3
                          style={{
                            fontSize: '13px',
                            fontWeight: 600,
                            color: tokens.colors.textMuted,
                            textTransform: 'uppercase',
                            letterSpacing: '0.05em',
                            marginBottom: '14px',
                          }}
                        >
                          {category.name}
                        </h3>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '10px' }}>
                          {categoryWidgets.map((widget) => {
                            const isAdded = existingWidgets.includes(widget.type);
                            const { hasIntegration, integrationName } = getWidgetStatus(widget.type);
                            const needsIntegration = !hasIntegration && !isAdded;

                            return (
                              <button
                                key={widget.type}
                                onClick={() => handleWidgetClick(widget)}
                                disabled={isAdded}
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: '12px',
                                  padding: '14px 16px',
                                  borderRadius: tokens.radius.lg,
                                  border: `1px solid ${
                                    isAdded
                                      ? tokens.colors.border
                                      : needsIntegration
                                        ? '#f59e0b30'
                                        : tokens.colors.border
                                  }`,
                                  background: isAdded
                                    ? tokens.colors.bgCard
                                    : needsIntegration
                                      ? '#f59e0b08'
                                      : tokens.colors.bgCard,
                                  color: tokens.colors.text,
                                  cursor: isAdded ? 'not-allowed' : 'pointer',
                                  opacity: isAdded ? 0.5 : 1,
                                  transition: 'all 0.2s ease',
                                  textAlign: 'left',
                                  fontFamily: 'inherit',
                                }}
                                onMouseEnter={(e) => {
                                  if (isAdded) return;
                                  if (needsIntegration) {
                                    e.currentTarget.style.borderColor = '#f59e0b60';
                                    e.currentTarget.style.background = '#f59e0b12';
                                  } else {
                                    e.currentTarget.style.borderColor = tokens.colors.accent;
                                    e.currentTarget.style.background = `${tokens.colors.accent}10`;
                                  }
                                }}
                                onMouseLeave={(e) => {
                                  if (isAdded) return;
                                  if (needsIntegration) {
                                    e.currentTarget.style.borderColor = '#f59e0b30';
                                    e.currentTarget.style.background = '#f59e0b08';
                                  } else {
                                    e.currentTarget.style.borderColor = tokens.colors.border;
                                    e.currentTarget.style.background = tokens.colors.bgCard;
                                  }
                                }}
                              >
                                <div
                                  style={{
                                    width: '40px',
                                    height: '40px',
                                    borderRadius: tokens.radius.md,
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    background: isAdded
                                      ? tokens.colors.bgElevated
                                      : needsIntegration
                                        ? '#f59e0b20'
                                        : `${tokens.colors.accent}15`,
                                    color: isAdded
                                      ? tokens.colors.textDim
                                      : needsIntegration
                                        ? '#f59e0b'
                                        : tokens.colors.accent,
                                    flexShrink: 0,
                                  }}
                                >
                                  {widget.icon}
                                </div>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <div
                                    style={{
                                      fontSize: '14px',
                                      fontWeight: 500,
                                      marginBottom: '2px',
                                      color: isAdded ? tokens.colors.textMuted : tokens.colors.text,
                                    }}
                                  >
                                    {widget.name}
                                  </div>
                                  <div
                                    style={{
                                      fontSize: '12px',
                                      color: needsIntegration ? '#f59e0b' : tokens.colors.textDim,
                                      whiteSpace: 'nowrap',
                                      overflow: 'hidden',
                                      textOverflow: 'ellipsis',
                                    }}
                                  >
                                    {needsIntegration
                                      ? `Connect ${integrationName}`
                                      : widget.description
                                    }
                                  </div>
                                </div>
                                {isAdded ? (
                                  <div
                                    style={{
                                      width: '22px',
                                      height: '22px',
                                      borderRadius: '50%',
                                      background: `${tokens.colors.success}20`,
                                      display: 'flex',
                                      alignItems: 'center',
                                      justifyContent: 'center',
                                      flexShrink: 0,
                                    }}
                                  >
                                    <svg width="12" height="12" fill={tokens.colors.success} viewBox="0 0 20 20">
                                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                                    </svg>
                                  </div>
                                ) : needsIntegration ? (
                                  <div
                                    style={{
                                      width: '22px',
                                      height: '22px',
                                      borderRadius: '50%',
                                      background: '#f59e0b20',
                                      display: 'flex',
                                      alignItems: 'center',
                                      justifyContent: 'center',
                                      flexShrink: 0,
                                    }}
                                  >
                                    <svg width="12" height="12" fill="none" stroke="#f59e0b" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                                    </svg>
                                  </div>
                                ) : (
                                  <div
                                    style={{
                                      width: '22px',
                                      height: '22px',
                                      borderRadius: '50%',
                                      background: `${tokens.colors.accent}15`,
                                      display: 'flex',
                                      alignItems: 'center',
                                      justifyContent: 'center',
                                      flexShrink: 0,
                                    }}
                                  >
                                    <svg width="12" height="12" fill="none" stroke={tokens.colors.accent} viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                                    </svg>
                                  </div>
                                )}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </>
              ) : (
                // Step 2: Configure Integration
                <>
                  {selectedWidgetInfo && (
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '12px',
                      padding: '14px 16px',
                      background: tokens.colors.bgCard,
                      borderRadius: tokens.radius.lg,
                      marginBottom: '20px',
                    }}>
                      <div
                        style={{
                          width: '40px',
                          height: '40px',
                          borderRadius: tokens.radius.md,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          background: `${tokens.colors.accent}15`,
                          color: tokens.colors.accent,
                          flexShrink: 0,
                        }}
                      >
                        {selectedWidgetInfo.icon}
                      </div>
                      <div>
                        <div style={{ fontSize: '14px', fontWeight: 500 }}>{selectedWidgetInfo.name}</div>
                        <div style={{ fontSize: '12px', color: tokens.colors.textDim }}>{selectedWidgetInfo.description}</div>
                      </div>
                    </div>
                  )}

                  {context === 'project' && requiredIntegration ? (
                    // Single project configuration
                    <IntegrationConfigForm
                      integrationType={requiredIntegration}
                      onValuesChange={handleSingleCredentialsChange}
                      onOAuthSuccess={handleSingleOAuthSuccess}
                    />
                  ) : requiredIntegration ? (
                    // Multi-project configuration (overview)
                    <ProjectCredentialsGrid
                      apps={allApps}
                      integrationType={requiredIntegration}
                      onCredentialsChange={handleMultiCredentialsChange}
                    />
                  ) : null}
                </>
              )}
            </div>

            {/* Footer (only for configure step) */}
            {step === 'configure' && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'flex-end',
                  gap: '12px',
                  padding: '16px 24px',
                  borderTop: `1px solid ${tokens.colors.border}`,
                  background: tokens.colors.bgCard,
                }}
              >
                <button
                  onClick={() => setStep('select')}
                  style={{
                    padding: '10px 20px',
                    borderRadius: tokens.radius.sm,
                    border: `1px solid ${tokens.colors.border}`,
                    background: 'transparent',
                    color: tokens.colors.text,
                    fontSize: '13px',
                    fontWeight: 500,
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                  }}
                >
                  Back
                </button>
                <button
                  onClick={handleSubmit}
                  disabled={!isFormValid()}
                  style={{
                    padding: '10px 20px',
                    borderRadius: tokens.radius.sm,
                    border: 'none',
                    background: isFormValid() ? tokens.colors.accent : tokens.colors.bgCardHover,
                    color: isFormValid() ? '#fff' : tokens.colors.textDim,
                    fontSize: '13px',
                    fontWeight: 500,
                    cursor: isFormValid() ? 'pointer' : 'not-allowed',
                    fontFamily: 'inherit',
                  }}
                >
                  Add Widget
                </button>
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
