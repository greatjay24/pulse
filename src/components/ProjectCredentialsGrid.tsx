import { useState, useEffect } from 'react';
import { useTheme } from '../contexts/ThemeContext';
import { App, IntegrationType, GoogleCalendarConfig } from '../types';
import { IntegrationConfigForm, CredentialValues, INTEGRATION_NAMES } from './IntegrationConfigForm';

// Credential config per project
export interface ProjectCredentialConfig {
  apiKey?: string;
  projectId?: string;
  teamId?: string;
  skip: boolean;
  googleCalendar?: GoogleCalendarConfig; // For OAuth integrations
}

interface ProjectCredentialsGridProps {
  apps: App[];
  integrationType: IntegrationType;
  onCredentialsChange: (credentials: Record<string, ProjectCredentialConfig>) => void;
}

export function ProjectCredentialsGrid({
  apps,
  integrationType,
  onCredentialsChange,
}: ProjectCredentialsGridProps) {
  const { tokens } = useTheme();
  const integrationName = INTEGRATION_NAMES[integrationType] || integrationType;

  // Initialize credentials state for all apps
  const [credentials, setCredentials] = useState<Record<string, ProjectCredentialConfig>>(() => {
    const initial: Record<string, ProjectCredentialConfig> = {};
    apps.forEach(app => {
      // Check if app already has this integration configured
      const existingIntegration = app.integrations.find(i => i.type === integrationType);
      initial[app.id] = {
        apiKey: existingIntegration?.apiKey || '',
        projectId: existingIntegration?.projectId || '',
        teamId: existingIntegration?.teamId || '',
        skip: false,
        googleCalendar: app.googleCalendar,
      };
    });
    return initial;
  });

  // Sync credentials to parent
  useEffect(() => {
    onCredentialsChange(credentials);
  }, [credentials, onCredentialsChange]);

  const handleValuesChange = (appId: string, values: CredentialValues) => {
    setCredentials(prev => ({
      ...prev,
      [appId]: {
        ...prev[appId],
        ...values,
      },
    }));
  };

  const handleSkipChange = (appId: string, skip: boolean) => {
    setCredentials(prev => ({
      ...prev,
      [appId]: {
        ...prev[appId],
        skip,
      },
    }));
  };

  const handleOAuthSuccess = (appId: string, config: GoogleCalendarConfig) => {
    setCredentials(prev => ({
      ...prev,
      [appId]: {
        ...prev[appId],
        googleCalendar: config,
        skip: false,
      },
    }));
  };

  // Check if this is an OAuth integration
  const isOAuth = integrationType === 'google_calendar' || integrationType === 'gmail' || integrationType === 'google_analytics';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <p style={{
        fontSize: '13px',
        color: tokens.colors.textMuted,
        margin: 0,
      }}>
        Configure {integrationName} for each project. Projects without credentials will not display this widget.
      </p>

      <div style={{
        display: 'grid',
        gridTemplateColumns: apps.length === 1 ? '1fr' : 'repeat(auto-fill, minmax(280px, 1fr))',
        gap: '16px',
      }}>
        {apps.map(app => {
          const creds = credentials[app.id];
          const isSkipped = creds?.skip;
          const hasExistingConfig = isOAuth
            ? creds?.googleCalendar?.enabled
            : creds?.apiKey;

          return (
            <div
              key={app.id}
              style={{
                padding: '16px',
                background: isSkipped ? tokens.colors.bg : tokens.colors.bgCard,
                borderRadius: tokens.radius.md,
                border: `1px solid ${isSkipped ? tokens.colors.border : tokens.colors.borderHover}`,
                opacity: isSkipped ? 0.6 : 1,
                transition: 'all 0.2s ease',
              }}
            >
              {/* Project Header */}
              <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: '14px',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  {/* Project color dot */}
                  <div style={{
                    width: '10px',
                    height: '10px',
                    borderRadius: '50%',
                    background: app.color || tokens.colors.accent,
                  }} />
                  <span style={{
                    fontSize: '14px',
                    fontWeight: 500,
                    color: tokens.colors.text,
                  }}>
                    {app.name}
                  </span>
                </div>

                {/* Skip checkbox */}
                <label style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  cursor: 'pointer',
                  fontSize: '11px',
                  color: tokens.colors.textDim,
                }}>
                  <input
                    type="checkbox"
                    checked={isSkipped}
                    onChange={(e) => handleSkipChange(app.id, e.target.checked)}
                    style={{ cursor: 'pointer' }}
                  />
                  Skip
                </label>
              </div>

              {/* Credential Form or Skip Message */}
              {isSkipped ? (
                <div style={{
                  padding: '20px',
                  textAlign: 'center',
                  color: tokens.colors.textDim,
                  fontSize: '12px',
                }}>
                  Widget will not be added to this project
                </div>
              ) : hasExistingConfig && isOAuth ? (
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
                    Already connected
                  </span>
                </div>
              ) : (
                <IntegrationConfigForm
                  integrationType={integrationType}
                  initialValues={{
                    apiKey: creds?.apiKey,
                    projectId: creds?.projectId,
                    teamId: creds?.teamId,
                  }}
                  onValuesChange={(values) => handleValuesChange(app.id, values)}
                  onOAuthSuccess={(config) => handleOAuthSuccess(app.id, config)}
                  compact
                />
              )}
            </div>
          );
        })}
      </div>

      {/* Summary */}
      <div style={{
        padding: '12px 16px',
        background: tokens.colors.bg,
        borderRadius: tokens.radius.sm,
        fontSize: '12px',
        color: tokens.colors.textDim,
      }}>
        {(() => {
          const configuredCount = Object.values(credentials).filter(c => {
            if (c.skip) return false;
            if (isOAuth) return c.googleCalendar?.enabled;
            return c.apiKey;
          }).length;
          const skippedCount = Object.values(credentials).filter(c => c.skip).length;

          if (configuredCount === 0 && skippedCount === apps.length) {
            return 'All projects skipped. Widget will not be added.';
          }
          if (configuredCount === 0) {
            return 'Enter credentials for at least one project to add the widget.';
          }
          return `Widget will be added to ${configuredCount} project${configuredCount !== 1 ? 's' : ''}${skippedCount > 0 ? `, ${skippedCount} skipped` : ''}.`;
        })()}
      </div>
    </div>
  );
}
