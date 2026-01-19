import React, { useState, useEffect } from 'react';
import { useTheme } from '../contexts/ThemeContext';
import { IntegrationType, GoogleCalendarConfig } from '../types';
import { useGoogleOAuth } from '../hooks/useGoogleOAuth';

// Form field configuration
interface FormField {
  key: 'apiKey' | 'projectId' | 'teamId';
  label: string;
  type: 'text' | 'password';
  placeholder?: string;
  required: boolean;
  helpText?: string;
}

interface ApiKeyFormConfig {
  type: 'api_key';
  fields: FormField[];
  helpText?: string;
  helpUrl?: string;
}

interface OAuthFormConfig {
  type: 'oauth';
  provider: 'google';
  helpText?: string;
}

type FormConfig = ApiKeyFormConfig | OAuthFormConfig;

// Credential values returned by the form
export interface CredentialValues {
  apiKey?: string;
  projectId?: string;
  teamId?: string;
}

// Form configurations for each integration type
const INTEGRATION_FORMS: Partial<Record<IntegrationType, FormConfig>> = {
  // Payments & Revenue
  stripe: {
    type: 'api_key',
    fields: [
      { key: 'apiKey', label: 'Secret Key', type: 'password', placeholder: 'sk_live_...', required: true }
    ],
    helpText: 'Find your API key in Stripe Dashboard → Developers → API Keys',
    helpUrl: 'https://dashboard.stripe.com/apikeys'
  },
  lemonsqueezy: {
    type: 'api_key',
    fields: [
      { key: 'apiKey', label: 'API Key', type: 'password', required: true }
    ],
    helpText: 'Find your API key in Lemon Squeezy Settings → API'
  },
  paddle: {
    type: 'api_key',
    fields: [
      { key: 'apiKey', label: 'API Key', type: 'password', required: true }
    ]
  },
  revenuecat: {
    type: 'api_key',
    fields: [
      { key: 'apiKey', label: 'API Key', type: 'password', required: true }
    ]
  },
  gumroad: {
    type: 'api_key',
    fields: [
      { key: 'apiKey', label: 'Access Token', type: 'password', required: true }
    ]
  },

  // Analytics
  posthog: {
    type: 'api_key',
    fields: [
      { key: 'apiKey', label: 'Project API Key', type: 'password', required: true },
      { key: 'projectId', label: 'Project ID', type: 'text', placeholder: 'e.g., 12345', required: false }
    ],
    helpText: 'Find in PostHog → Project Settings → Project API Key'
  },
  mixpanel: {
    type: 'api_key',
    fields: [
      { key: 'apiKey', label: 'API Secret', type: 'password', required: true },
      { key: 'projectId', label: 'Project ID', type: 'text', required: false }
    ]
  },
  amplitude: {
    type: 'api_key',
    fields: [
      { key: 'apiKey', label: 'API Key', type: 'password', required: true }
    ]
  },
  plausible: {
    type: 'api_key',
    fields: [
      { key: 'apiKey', label: 'API Key', type: 'password', required: true },
      { key: 'projectId', label: 'Site Domain', type: 'text', placeholder: 'e.g., mysite.com', required: true }
    ]
  },
  google_analytics: {
    type: 'oauth',
    provider: 'google',
    helpText: 'Connect your Google account to access Analytics data'
  },

  // Hosting & Deployment
  vercel: {
    type: 'api_key',
    fields: [
      { key: 'apiKey', label: 'Access Token', type: 'password', required: true },
      { key: 'projectId', label: 'Project Name or ID', type: 'text', placeholder: 'e.g., my-project', required: false },
      { key: 'teamId', label: 'Team Slug', type: 'text', placeholder: 'Optional - for team projects', required: false }
    ],
    helpText: 'Create a token at vercel.com/account/tokens',
    helpUrl: 'https://vercel.com/account/tokens'
  },
  netlify: {
    type: 'api_key',
    fields: [
      { key: 'apiKey', label: 'Personal Access Token', type: 'password', required: true }
    ]
  },
  railway: {
    type: 'api_key',
    fields: [
      { key: 'apiKey', label: 'API Token', type: 'password', required: true }
    ]
  },
  render: {
    type: 'api_key',
    fields: [
      { key: 'apiKey', label: 'API Key', type: 'password', required: true }
    ]
  },
  flyio: {
    type: 'api_key',
    fields: [
      { key: 'apiKey', label: 'Access Token', type: 'password', required: true }
    ]
  },

  // Database & Backend
  supabase: {
    type: 'api_key',
    fields: [
      { key: 'apiKey', label: 'Service Role Key', type: 'password', required: true },
      { key: 'projectId', label: 'Project Ref', type: 'text', placeholder: 'e.g., abcdefghijklmnop', required: true }
    ],
    helpText: 'Find in Supabase Dashboard → Settings → API'
  },
  firebase: {
    type: 'api_key',
    fields: [
      { key: 'apiKey', label: 'Web API Key', type: 'password', required: true },
      { key: 'projectId', label: 'Project ID', type: 'text', required: true }
    ]
  },
  planetscale: {
    type: 'api_key',
    fields: [
      { key: 'apiKey', label: 'Service Token', type: 'password', required: true }
    ]
  },
  neon: {
    type: 'api_key',
    fields: [
      { key: 'apiKey', label: 'API Key', type: 'password', required: true }
    ]
  },
  mongodb: {
    type: 'api_key',
    fields: [
      { key: 'apiKey', label: 'API Key', type: 'password', required: true }
    ]
  },

  // Auth
  clerk: {
    type: 'api_key',
    fields: [
      { key: 'apiKey', label: 'Secret Key', type: 'password', placeholder: 'sk_live_...', required: true }
    ]
  },
  auth0: {
    type: 'api_key',
    fields: [
      { key: 'apiKey', label: 'API Token', type: 'password', required: true },
      { key: 'projectId', label: 'Domain', type: 'text', placeholder: 'e.g., myapp.auth0.com', required: true }
    ]
  },

  // Email & Marketing
  resend: {
    type: 'api_key',
    fields: [
      { key: 'apiKey', label: 'API Key', type: 'password', placeholder: 're_...', required: true }
    ]
  },
  sendgrid: {
    type: 'api_key',
    fields: [
      { key: 'apiKey', label: 'API Key', type: 'password', required: true }
    ]
  },
  convertkit: {
    type: 'api_key',
    fields: [
      { key: 'apiKey', label: 'API Secret', type: 'password', required: true }
    ]
  },
  mailchimp: {
    type: 'api_key',
    fields: [
      { key: 'apiKey', label: 'API Key', type: 'password', required: true }
    ]
  },

  // Monitoring & Errors
  sentry: {
    type: 'api_key',
    fields: [
      { key: 'apiKey', label: 'Auth Token', type: 'password', required: true },
      { key: 'projectId', label: 'Organization Slug', type: 'text', required: false }
    ]
  },
  logrocket: {
    type: 'api_key',
    fields: [
      { key: 'apiKey', label: 'API Key', type: 'password', required: true }
    ]
  },

  // Calendar & Scheduling
  google_calendar: {
    type: 'oauth',
    provider: 'google',
    helpText: 'Connect your Google account to display calendar events'
  },
  cal: {
    type: 'api_key',
    fields: [
      { key: 'apiKey', label: 'API Key', type: 'password', required: true }
    ]
  },

  // Communication
  slack: {
    type: 'api_key',
    fields: [
      { key: 'apiKey', label: 'Bot Token', type: 'password', placeholder: 'xoxb-...', required: true }
    ]
  },
  discord: {
    type: 'api_key',
    fields: [
      { key: 'apiKey', label: 'Bot Token', type: 'password', required: true }
    ]
  },

  // Support
  intercom: {
    type: 'api_key',
    fields: [
      { key: 'apiKey', label: 'Access Token', type: 'password', required: true }
    ]
  },
  crisp: {
    type: 'api_key',
    fields: [
      { key: 'apiKey', label: 'API Key', type: 'password', required: true }
    ]
  },

  // Code & Version Control
  github: {
    type: 'api_key',
    fields: [
      { key: 'apiKey', label: 'Personal Access Token', type: 'password', placeholder: 'ghp_...', required: true, helpText: 'Create at github.com/settings/tokens with repo and notifications permissions' },
      { key: 'teamId', label: 'GitHub Username', type: 'text', placeholder: 'e.g., octocat', required: true },
      { key: 'projectId', label: 'Repositories', type: 'text', placeholder: 'owner/repo, owner/repo2', required: true, helpText: 'Format: owner/repo (comma-separated for multiple)' }
    ],
    helpUrl: 'https://github.com/settings/tokens'
  },

  // Gmail (uses same OAuth as calendar)
  gmail: {
    type: 'oauth',
    provider: 'google',
    helpText: 'Connect your Google account to display inbox'
  },
};

// Integration display names
const INTEGRATION_NAMES: Partial<Record<IntegrationType, string>> = {
  stripe: 'Stripe',
  lemonsqueezy: 'Lemon Squeezy',
  paddle: 'Paddle',
  revenuecat: 'RevenueCat',
  gumroad: 'Gumroad',
  posthog: 'PostHog',
  mixpanel: 'Mixpanel',
  amplitude: 'Amplitude',
  plausible: 'Plausible',
  google_analytics: 'Google Analytics',
  vercel: 'Vercel',
  netlify: 'Netlify',
  railway: 'Railway',
  render: 'Render',
  flyio: 'Fly.io',
  supabase: 'Supabase',
  firebase: 'Firebase',
  planetscale: 'PlanetScale',
  neon: 'Neon',
  mongodb: 'MongoDB',
  clerk: 'Clerk',
  auth0: 'Auth0',
  resend: 'Resend',
  sendgrid: 'SendGrid',
  convertkit: 'ConvertKit',
  mailchimp: 'Mailchimp',
  sentry: 'Sentry',
  logrocket: 'LogRocket',
  google_calendar: 'Google Calendar',
  cal: 'Cal.com',
  slack: 'Slack',
  discord: 'Discord',
  intercom: 'Intercom',
  crisp: 'Crisp',
  github: 'GitHub',
  gmail: 'Gmail',
};

interface IntegrationConfigFormProps {
  integrationType: IntegrationType;
  initialValues?: CredentialValues;
  onValuesChange: (values: CredentialValues) => void;
  onOAuthSuccess?: (config: GoogleCalendarConfig) => void;
  disabled?: boolean;
  compact?: boolean; // For use in grid layout
}

export function IntegrationConfigForm({
  integrationType,
  initialValues = {},
  onValuesChange,
  onOAuthSuccess,
  disabled = false,
  compact = false,
}: IntegrationConfigFormProps) {
  const { tokens } = useTheme();
  const [values, setValues] = useState<CredentialValues>(initialValues);
  const { status: oauthStatus, error: oauthError, connect, reset } = useGoogleOAuth();

  const config = INTEGRATION_FORMS[integrationType];
  const integrationName = INTEGRATION_NAMES[integrationType] || integrationType;

  // Sync values to parent
  useEffect(() => {
    onValuesChange(values);
  }, [values, onValuesChange]);

  // Reset values when integration type changes
  useEffect(() => {
    setValues(initialValues);
    reset();
  }, [integrationType]);

  const handleFieldChange = (key: keyof CredentialValues, value: string) => {
    setValues(prev => ({ ...prev, [key]: value }));
  };

  const handleOAuthConnect = async () => {
    const result = await connect();
    if (result && onOAuthSuccess) {
      onOAuthSuccess(result);
    }
  };

  if (!config) {
    return (
      <div style={{ color: tokens.colors.textDim, fontSize: '13px' }}>
        Configuration for {integrationName} is not available yet.
      </div>
    );
  }

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: compact ? '8px 10px' : '10px 12px',
    fontSize: '13px',
    background: tokens.colors.bg,
    border: `1px solid ${tokens.colors.border}`,
    borderRadius: tokens.radius.sm,
    color: tokens.colors.text,
    fontFamily: 'inherit',
    outline: 'none',
  };

  const labelStyle: React.CSSProperties = {
    display: 'block',
    fontSize: '11px',
    color: tokens.colors.textDim,
    marginBottom: '6px',
  };

  // OAuth form (Google)
  if (config.type === 'oauth') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {config.helpText && (
          <p style={{ fontSize: '12px', color: tokens.colors.textMuted, margin: 0 }}>
            {config.helpText}
          </p>
        )}

        {oauthStatus === 'idle' && (
          <button
            onClick={handleOAuthConnect}
            disabled={disabled}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              padding: '10px 16px',
              background: tokens.colors.accent,
              color: '#fff',
              border: 'none',
              borderRadius: tokens.radius.sm,
              fontSize: '13px',
              fontWeight: 500,
              cursor: disabled ? 'not-allowed' : 'pointer',
              opacity: disabled ? 0.5 : 1,
              fontFamily: 'inherit',
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
            </svg>
            Connect Google Account
          </button>
        )}

        {oauthStatus === 'connecting' && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            padding: '12px',
            background: tokens.colors.bgCard,
            borderRadius: tokens.radius.sm,
            border: `1px solid ${tokens.colors.border}`,
          }}>
            <div style={{
              width: '16px',
              height: '16px',
              border: `2px solid ${tokens.colors.accent}`,
              borderTopColor: 'transparent',
              borderRadius: '50%',
              animation: 'spin 1s linear infinite',
            }} />
            <span style={{ fontSize: '13px', color: tokens.colors.textMuted }}>
              Waiting for authorization...
            </span>
            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
          </div>
        )}

        {oauthStatus === 'success' && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '12px',
            background: 'rgba(34, 197, 94, 0.1)',
            borderRadius: tokens.radius.sm,
            border: '1px solid rgba(34, 197, 94, 0.3)',
          }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2">
              <polyline points="20,6 9,17 4,12" />
            </svg>
            <span style={{ fontSize: '13px', color: '#22c55e', fontWeight: 500 }}>
              Connected!
            </span>
          </div>
        )}

        {oauthStatus === 'error' && (
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
            padding: '12px',
            background: 'rgba(239, 68, 68, 0.1)',
            borderRadius: tokens.radius.sm,
            border: '1px solid rgba(239, 68, 68, 0.3)',
          }}>
            <span style={{ fontSize: '12px', color: '#ef4444' }}>
              {oauthError}
            </span>
            <button
              onClick={() => { reset(); handleOAuthConnect(); }}
              style={{
                padding: '6px 12px',
                background: 'transparent',
                color: '#ef4444',
                border: '1px solid rgba(239, 68, 68, 0.3)',
                borderRadius: tokens.radius.sm,
                fontSize: '12px',
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              Try Again
            </button>
          </div>
        )}
      </div>
    );
  }

  // API Key form
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: compact ? '10px' : '14px' }}>
      {config.fields.map((field) => (
        <div key={field.key}>
          <label style={labelStyle}>
            {field.label}
            {field.required && <span style={{ color: tokens.colors.accent }}> *</span>}
          </label>
          <input
            type={field.type}
            value={values[field.key] || ''}
            onChange={(e) => handleFieldChange(field.key, e.target.value)}
            placeholder={field.placeholder}
            disabled={disabled}
            style={{
              ...inputStyle,
              borderColor: field.required && !values[field.key] ? 'rgba(239, 68, 68, 0.4)' : tokens.colors.border,
              opacity: disabled ? 0.5 : 1,
            }}
          />
          {field.helpText && (
            <p style={{ fontSize: '10px', color: tokens.colors.textDim, marginTop: '4px', margin: '4px 0 0 0' }}>
              {field.helpText}
            </p>
          )}
        </div>
      ))}

      {config.helpText && (
        <p style={{ fontSize: '11px', color: tokens.colors.textDim, margin: 0 }}>
          {config.helpText}
          {config.helpUrl && (
            <>
              {' '}
              <a
                href={config.helpUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: tokens.colors.accent }}
              >
                Open →
              </a>
            </>
          )}
        </p>
      )}
    </div>
  );
}

// Export utilities
export { INTEGRATION_FORMS, INTEGRATION_NAMES };
export type { FormConfig };
