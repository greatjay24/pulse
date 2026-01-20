import { useState, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useTheme, fontOptions, ThemeMode, FontChoice } from '../contexts/ThemeContext';
import { App, IntegrationType, PROJECT_COLORS, GoogleCalendarConfig } from '../types';
import { Icon } from './Icons';

// Check if running in Tauri environment (Tauri v2 uses __TAURI_INTERNALS__)
const IS_TAURI = typeof window !== 'undefined' && !!(window as any).__TAURI_INTERNALS__;

interface SettingsProps {
  apps: App[];
  onSave: (apps: App[]) => void;
  onClose: () => void;
  inline?: boolean; // Render inline instead of as overlay
}

const INTEGRATION_LABELS: Partial<Record<IntegrationType, string>> = {
  stripe: 'Stripe',
  vercel: 'Vercel',
  posthog: 'PostHog',
  supabase: 'Supabase',
  lemonsqueezy: 'LemonSqueezy',
  paddle: 'Paddle',
  revenuecat: 'RevenueCat',
  gumroad: 'Gumroad',
  mixpanel: 'Mixpanel',
  amplitude: 'Amplitude',
  plausible: 'Plausible',
  google_analytics: 'Google Analytics',
  netlify: 'Netlify',
  railway: 'Railway',
  render: 'Render',
  flyio: 'Fly.io',
  firebase: 'Firebase',
  planetscale: 'PlanetScale',
  neon: 'Neon',
  mongodb: 'MongoDB Atlas',
  clerk: 'Clerk',
  auth0: 'Auth0',
  resend: 'Resend',
  sendgrid: 'SendGrid',
  convertkit: 'ConvertKit',
  mailchimp: 'Mailchimp',
  gmail: 'Gmail',
  sentry: 'Sentry',
  logrocket: 'LogRocket',
  google_calendar: 'Google Calendar',
  cal: 'Cal.com',
  slack: 'Slack',
  discord: 'Discord',
  intercom: 'Intercom',
  crisp: 'Crisp',
  github: 'GitHub',
};

export function Settings({ apps, onSave, onClose, inline = false }: SettingsProps) {
  const { tokens, themeMode, setThemeMode, fontChoice, setFontChoice } = useTheme();
  const [editedApps, setEditedApps] = useState<App[]>(apps);
  const [activeAppId, setActiveAppId] = useState<string | null>(apps[0]?.id || null);
  const [activeTab, setActiveTab] = useState<'appearance' | 'apps'>('appearance');
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'idle'>('idle');
  const isFirstRender = useRef(true);
  const isSyncingFromProps = useRef(false);
  const onSaveRef = useRef(onSave);
  const prevAppsRef = useRef(apps);

  // Google Calendar OAuth state (per-app)
  const [calendarConnectingAppId, setCalendarConnectingAppId] = useState<string | null>(null);
  const [calendarError, setCalendarError] = useState<string | null>(null);

  // Auto-launch state
  const [autoLaunchEnabled, setAutoLaunchEnabled] = useState(false);
  const [autoLaunchLoading, setAutoLaunchLoading] = useState(true);

  // Load auto-launch status on mount
  useEffect(() => {
    if (IS_TAURI) {
      invoke<boolean>('get_auto_launch_enabled')
        .then(setAutoLaunchEnabled)
        .catch(console.error)
        .finally(() => setAutoLaunchLoading(false));
    } else {
      setAutoLaunchLoading(false);
    }
  }, []);

  const handleAutoLaunchToggle = async () => {
    if (!IS_TAURI) return;
    const newValue = !autoLaunchEnabled;
    try {
      await invoke('set_auto_launch_enabled', { enabled: newValue });
      setAutoLaunchEnabled(newValue);
    } catch (err) {
      console.error('Failed to toggle auto-launch:', err);
    }
  };

  const handleConnectCalendar = async (appId: string) => {
    if (!IS_TAURI) {
      setCalendarError('Calendar connection only works in the desktop app');
      return;
    }

    try {
      setCalendarConnectingAppId(appId);
      setCalendarError(null);

      // This opens the browser, waits for callback, and returns tokens directly
      const tokenResponse = await invoke<string>('start_google_oauth');
      const tokens = JSON.parse(tokenResponse);

      // Update the app's Google Calendar config
      const newConfig: GoogleCalendarConfig = {
        enabled: true,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        calendarIds: ['primary'],
      };

      // Update the app with the calendar config
      setEditedApps(prev => prev.map(app =>
        app.id === appId
          ? { ...app, googleCalendar: newConfig }
          : app
      ));

      setCalendarConnectingAppId(null);
    } catch (err) {
      setCalendarError(`Failed to connect: ${err}`);
      setCalendarConnectingAppId(null);
    }
  };

  const handleDisconnectCalendar = (appId: string) => {
    setEditedApps(prev => prev.map(app =>
      app.id === appId
        ? { ...app, googleCalendar: { enabled: false, calendarIds: [] } }
        : app
    ));
  };

  // Keep the ref updated with latest onSave
  useEffect(() => {
    onSaveRef.current = onSave;
  }, [onSave]);

  // Sync editedApps when apps prop changes from external source (not from our own save)
  useEffect(() => {
    // Only sync if apps actually changed (by reference) and we didn't cause it
    if (apps !== prevAppsRef.current) {
      prevAppsRef.current = apps;
      isSyncingFromProps.current = true;
      setEditedApps(apps);
    }
  }, [apps]);

  // Auto-save with debounce when editedApps changes (but not from prop sync)
  useEffect(() => {
    // Skip the first render (initial load)
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }

    // Skip if this change came from syncing with props
    if (isSyncingFromProps.current) {
      isSyncingFromProps.current = false;
      return;
    }

    setSaveStatus('saving');
    const timeoutId = setTimeout(() => {
      onSaveRef.current(editedApps);
      setSaveStatus('saved');
      // Reset to idle after showing "saved" briefly
      setTimeout(() => setSaveStatus('idle'), 1500);
    }, 500); // Debounce: save 500ms after last change

    return () => clearTimeout(timeoutId);
  }, [editedApps]);

  const addApp = () => {
    const newApp: App = {
      id: crypto.randomUUID(),
      name: 'New App',
      platforms: ['web'],
      integrations: [],
    };
    setEditedApps([...editedApps, newApp]);
    setActiveAppId(newApp.id);
  };

  const updateApp = (id: string, updates: Partial<App>) => {
    setEditedApps(editedApps.map(app =>
      app.id === id ? { ...app, ...updates } : app
    ));
  };

  const deleteApp = (id: string) => {
    setEditedApps(editedApps.filter(app => app.id !== id));
    if (activeAppId === id) {
      setActiveAppId(editedApps[0]?.id || null);
    }
  };

  const addIntegration = (appId: string, type: IntegrationType) => {
    setEditedApps(editedApps.map(app => {
      if (app.id !== appId) return app;
      if (app.integrations.some(i => i.type === type)) return app;
      return {
        ...app,
        integrations: [...app.integrations, { type, enabled: true }],
      };
    }));
  };

  const updateIntegration = (appId: string, type: IntegrationType, updates: { apiKey?: string; projectId?: string; teamId?: string }) => {
    setEditedApps(editedApps.map(app => {
      if (app.id !== appId) return app;
      return {
        ...app,
        integrations: app.integrations.map(i =>
          i.type === type ? { ...i, ...updates } : i
        ),
      };
    }));
  };

  const removeIntegration = (appId: string, type: IntegrationType) => {
    setEditedApps(editedApps.map(app => {
      if (app.id !== appId) return app;
      return {
        ...app,
        integrations: app.integrations.filter(i => i.type !== type),
      };
    }));
  };

  const activeApp = editedApps.find(app => app.id === activeAppId);

  return (
    <div
      style={{
        ...(inline ? {} : {
          position: 'fixed',
          inset: 0,
          background: tokens.colors.bg,
          zIndex: 50,
          display: 'flex',
          flexDirection: 'column',
        }),
      }}
    >
      {/* Header */}
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: inline ? '32px' : '0',
          padding: inline ? '0' : '16px 24px',
          borderBottom: inline ? 'none' : `1px solid ${tokens.colors.border}`,
        }}
      >
        <div>
          <h2 style={{ fontSize: '24px', fontWeight: 600, color: tokens.colors.text, marginBottom: inline ? '4px' : '0' }}>
            Settings
          </h2>
          {inline && (
            <p style={{ color: tokens.colors.textMuted, fontSize: '14px' }}>
              Manage your preferences and integrations.
            </p>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          {/* Auto-save status indicator */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '6px 12px',
              borderRadius: tokens.radius.sm,
              background: saveStatus === 'saved' ? tokens.colors.successMuted :
                         saveStatus === 'saving' ? tokens.colors.bgCardHover : 'transparent',
              opacity: saveStatus === 'idle' ? 0 : 1,
              transform: saveStatus === 'idle' ? 'translateY(-4px)' : 'translateY(0)',
              transition: 'all 0.2s ease',
            }}
          >
            {saveStatus === 'saved' && (
              <Icon name="check" size={14} color={tokens.colors.success} />
            )}
            <span
              style={{
                fontSize: '12px',
                fontWeight: 500,
                color: saveStatus === 'saved' ? tokens.colors.success : tokens.colors.textMuted,
              }}
            >
              {saveStatus === 'saving' ? 'Saving...' : saveStatus === 'saved' ? 'Saved' : ''}
            </span>
          </div>
          {!inline && (
            <button
              onClick={onClose}
              style={{
                padding: '10px 16px',
                fontSize: '13px',
                color: 'white',
                background: tokens.colors.accent,
                border: 'none',
                borderRadius: tokens.radius.sm,
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              Done
            </button>
          )}
        </div>
      </header>

      <div style={{ flex: 1, display: 'flex', overflow: inline ? 'visible' : 'hidden', gap: inline ? '24px' : '0' }}>
        {/* Tab List */}
        <div
          style={{
            width: inline ? '220px' : '200px',
            borderRight: inline ? 'none' : `1px solid ${tokens.colors.border}`,
            padding: inline ? '0' : '16px',
            background: inline ? 'transparent' : tokens.colors.bgElevated,
            ...(inline && {
              background: tokens.colors.bgCard,
              border: `1px solid ${tokens.colors.border}`,
              borderRadius: tokens.radius.lg,
              padding: '16px',
              height: 'fit-content',
            }),
          }}
        >
          {[
            { id: 'appearance', label: 'Appearance', icon: 'settings' },
            { id: 'apps', label: 'Apps', icon: 'mobile' },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as typeof activeTab)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                width: '100%',
                padding: '10px 12px',
                fontSize: '14px',
                fontWeight: 500,
                color: activeTab === tab.id ? tokens.colors.text : tokens.colors.textMuted,
                background: activeTab === tab.id ? tokens.colors.bgCard : 'transparent',
                border: 'none',
                borderRadius: tokens.radius.sm,
                cursor: 'pointer',
                fontFamily: 'inherit',
                textAlign: 'left',
                marginBottom: '4px',
              }}
            >
              <Icon name={tab.icon} size={16} color={activeTab === tab.id ? tokens.colors.text : tokens.colors.textMuted} />
              {tab.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div style={{ flex: 1, padding: '24px 32px' }}>
          {/* Appearance Tab */}
          {activeTab === 'appearance' && (
            <div style={{ maxWidth: '600px' }}>
              <h3 style={{ fontSize: '16px', fontWeight: 600, marginBottom: '24px', color: tokens.colors.text }}>
                Appearance
              </h3>

              {/* Theme Toggle */}
              <div
                style={{
                  background: tokens.colors.bgCard,
                  border: `1px solid ${tokens.colors.border}`,
                  borderRadius: tokens.radius.lg,
                  padding: '24px',
                  marginBottom: '24px',
                }}
              >
                <label
                  style={{
                    display: 'block',
                    color: tokens.colors.textMuted,
                    fontSize: '13px',
                    marginBottom: '12px',
                    fontWeight: 500,
                  }}
                >
                  Theme
                </label>
                <div style={{ display: 'flex', gap: '8px' }}>
                  {[
                    { id: 'light' as ThemeMode, label: 'Light', icon: 'sun' },
                    { id: 'dark' as ThemeMode, label: 'Dark', icon: 'moon' },
                    { id: 'system' as ThemeMode, label: 'System', icon: 'settings' },
                  ].map((option) => (
                    <button
                      key={option.id}
                      onClick={() => setThemeMode(option.id)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        padding: '10px 16px',
                        borderRadius: tokens.radius.sm,
                        border: `1px solid ${themeMode === option.id ? tokens.colors.accent : tokens.colors.border}`,
                        background: themeMode === option.id ? tokens.colors.accentGlow : 'transparent',
                        color: themeMode === option.id ? tokens.colors.text : tokens.colors.textMuted,
                        fontSize: '13px',
                        fontWeight: 500,
                        cursor: 'pointer',
                        fontFamily: 'inherit',
                        transition: 'all 0.15s ease',
                      }}
                    >
                      <Icon name={option.icon} size={14} color={themeMode === option.id ? tokens.colors.text : tokens.colors.textMuted} />
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Font Toggle */}
              <div
                style={{
                  background: tokens.colors.bgCard,
                  border: `1px solid ${tokens.colors.border}`,
                  borderRadius: tokens.radius.lg,
                  padding: '24px',
                }}
              >
                <label
                  style={{
                    display: 'block',
                    color: tokens.colors.textMuted,
                    fontSize: '13px',
                    marginBottom: '12px',
                    fontWeight: 500,
                  }}
                >
                  Font
                </label>
                <div style={{ display: 'flex', gap: '8px' }}>
                  {(Object.entries(fontOptions) as [FontChoice, typeof fontOptions.inter][]).map(([id, font]) => (
                    <button
                      key={id}
                      onClick={() => setFontChoice(id)}
                      style={{
                        padding: '10px 16px',
                        borderRadius: tokens.radius.sm,
                        border: `1px solid ${fontChoice === id ? tokens.colors.accent : tokens.colors.border}`,
                        background: fontChoice === id ? tokens.colors.accentGlow : 'transparent',
                        color: fontChoice === id ? tokens.colors.text : tokens.colors.textMuted,
                        fontSize: '13px',
                        fontWeight: 500,
                        cursor: 'pointer',
                        fontFamily: font.sans,
                        transition: 'all 0.15s ease',
                      }}
                    >
                      {font.label}
                    </button>
                  ))}
                </div>
                <p
                  style={{
                    color: tokens.colors.textDim,
                    fontSize: '12px',
                    marginTop: '12px',
                  }}
                >
                  Preview: The quick brown fox jumps over the lazy dog. 0123456789
                </p>
              </div>

              {/* Auto-Launch Toggle */}
              {IS_TAURI && (
                <div
                  style={{
                    background: tokens.colors.bgCard,
                    border: `1px solid ${tokens.colors.border}`,
                    borderRadius: tokens.radius.lg,
                    padding: '24px',
                    marginTop: '24px',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                    }}
                  >
                    <div>
                      <label
                        style={{
                          display: 'block',
                          color: tokens.colors.text,
                          fontSize: '14px',
                          fontWeight: 500,
                          marginBottom: '4px',
                        }}
                      >
                        Auto-launch at 7:30 AM
                      </label>
                      <p
                        style={{
                          color: tokens.colors.textDim,
                          fontSize: '12px',
                          margin: 0,
                        }}
                      >
                        Open Pulse automatically every morning to review your dashboard
                      </p>
                    </div>
                    <button
                      onClick={handleAutoLaunchToggle}
                      disabled={autoLaunchLoading}
                      style={{
                        position: 'relative',
                        width: '44px',
                        height: '24px',
                        borderRadius: '12px',
                        border: 'none',
                        background: autoLaunchEnabled ? tokens.colors.accent : tokens.colors.bgElevated,
                        cursor: autoLaunchLoading ? 'wait' : 'pointer',
                        transition: 'background 0.2s ease',
                        opacity: autoLaunchLoading ? 0.5 : 1,
                      }}
                    >
                      <div
                        style={{
                          position: 'absolute',
                          top: '2px',
                          left: autoLaunchEnabled ? '22px' : '2px',
                          width: '20px',
                          height: '20px',
                          borderRadius: '10px',
                          background: 'white',
                          boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                          transition: 'left 0.2s ease',
                        }}
                      />
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Apps Tab */}
          {activeTab === 'apps' && (
            <div style={{ display: 'flex', gap: '24px' }}>
              {/* App List */}
              <div style={{ width: '180px', flexShrink: 0 }}>
                <button
                  onClick={addApp}
                  style={{
                    width: '100%',
                    marginBottom: '12px',
                    padding: '10px',
                    fontSize: '13px',
                    textAlign: 'left',
                    color: tokens.colors.accent,
                    background: 'transparent',
                    border: `1px dashed ${tokens.colors.border}`,
                    borderRadius: tokens.radius.sm,
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                  }}
                >
                  + Add App
                </button>
                {editedApps.map(app => (
                  <button
                    key={app.id}
                    onClick={() => setActiveAppId(app.id)}
                    style={{
                      width: '100%',
                      padding: '10px 12px',
                      fontSize: '13px',
                      textAlign: 'left',
                      borderRadius: tokens.radius.sm,
                      background: activeAppId === app.id ? tokens.colors.bgCard : 'transparent',
                      color: activeAppId === app.id ? tokens.colors.text : tokens.colors.textMuted,
                      border: 'none',
                      cursor: 'pointer',
                      fontFamily: 'inherit',
                      marginBottom: '4px',
                    }}
                  >
                    {app.name}
                  </button>
                ))}
              </div>

              {/* App Settings */}
              <div style={{ flex: 1, maxWidth: '500px', paddingBottom: '40px' }}>
                {activeApp ? (
                  <div>
                    <div style={{ marginBottom: '24px' }}>
                      <label
                        style={{
                          display: 'block',
                          fontSize: '13px',
                          color: tokens.colors.textMuted,
                          marginBottom: '8px',
                        }}
                      >
                        App Name
                      </label>
                      <input
                        type="text"
                        value={activeApp.name}
                        onChange={(e) => updateApp(activeApp.id, { name: e.target.value })}
                        style={{
                          width: '100%',
                          padding: '12px 16px',
                          background: tokens.colors.bgCard,
                          border: `1px solid ${tokens.colors.border}`,
                          borderRadius: tokens.radius.sm,
                          color: tokens.colors.text,
                          fontSize: '14px',
                          fontFamily: 'inherit',
                          outline: 'none',
                        }}
                      />
                    </div>

                    <div style={{ marginBottom: '24px' }}>
                      <label
                        style={{
                          display: 'block',
                          fontSize: '13px',
                          color: tokens.colors.textMuted,
                          marginBottom: '8px',
                        }}
                      >
                        Website Domain
                      </label>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        {activeApp.domain && (
                          <img
                            src={`https://www.google.com/s2/favicons?domain=${activeApp.domain}&sz=64`}
                            alt=""
                            style={{
                              width: '24px',
                              height: '24px',
                              borderRadius: '4px',
                            }}
                          />
                        )}
                        <input
                          type="text"
                          value={activeApp.domain || ''}
                          onChange={(e) => updateApp(activeApp.id, { domain: e.target.value })}
                          placeholder="e.g., myapp.com"
                          style={{
                            flex: 1,
                            padding: '12px 16px',
                            background: tokens.colors.bgCard,
                            border: `1px solid ${tokens.colors.border}`,
                            borderRadius: tokens.radius.sm,
                            color: tokens.colors.text,
                            fontSize: '14px',
                            fontFamily: 'inherit',
                            outline: 'none',
                          }}
                        />
                      </div>
                      <p
                        style={{
                          fontSize: '12px',
                          color: tokens.colors.textDim,
                          marginTop: '8px',
                        }}
                      >
                        Used to display the app's favicon in the sidebar
                      </p>
                    </div>

                    <div style={{ marginBottom: '24px' }}>
                      <label
                        style={{
                          display: 'block',
                          fontSize: '13px',
                          color: tokens.colors.textMuted,
                          marginBottom: '8px',
                        }}
                      >
                        Project Color
                      </label>
                      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                        {PROJECT_COLORS.map((color) => (
                          <button
                            key={color.value}
                            onClick={() => updateApp(activeApp.id, { color: color.value })}
                            title={color.name}
                            style={{
                              width: '32px',
                              height: '32px',
                              borderRadius: tokens.radius.sm,
                              background: color.value,
                              border: activeApp.color === color.value
                                ? '3px solid white'
                                : '3px solid transparent',
                              cursor: 'pointer',
                              boxShadow: activeApp.color === color.value
                                ? `0 0 0 2px ${color.value}`
                                : 'none',
                              transition: 'all 0.15s ease',
                            }}
                          />
                        ))}
                      </div>
                      <p
                        style={{
                          fontSize: '12px',
                          color: tokens.colors.textDim,
                          marginTop: '8px',
                        }}
                      >
                        Used in calendar and analytics charts
                      </p>
                    </div>

                    <div style={{ marginBottom: '24px' }}>
                      <label
                        style={{
                          display: 'block',
                          fontSize: '13px',
                          color: tokens.colors.textMuted,
                          marginBottom: '12px',
                        }}
                      >
                        Integrations
                      </label>

                      {/* Available integrations */}
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '16px' }}>
                        {(['stripe', 'vercel', 'posthog', 'supabase', 'github'] as IntegrationType[])
                          .filter(type => !activeApp.integrations.some(i => i.type === type))
                          .map(type => (
                            <button
                              key={type}
                              onClick={() => addIntegration(activeApp.id, type)}
                              style={{
                                padding: '6px 12px',
                                fontSize: '12px',
                                background: tokens.colors.bgCard,
                                border: `1px solid ${tokens.colors.border}`,
                                borderRadius: tokens.radius.sm,
                                color: tokens.colors.textMuted,
                                cursor: 'pointer',
                                fontFamily: 'inherit',
                              }}
                            >
                              + {INTEGRATION_LABELS[type]}
                            </button>
                          ))
                        }
                      </div>

                      {/* Configured integrations */}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                        {activeApp.integrations.map(integration => (
                          <div
                            key={integration.type}
                            style={{
                              padding: '16px',
                              background: tokens.colors.bgCard,
                              borderRadius: tokens.radius.md,
                              border: `1px solid ${tokens.colors.border}`,
                            }}
                          >
                            <div
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                marginBottom: '12px',
                              }}
                            >
                              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <h4 style={{ fontWeight: 500, fontSize: '14px', color: tokens.colors.text }}>
                                  {INTEGRATION_LABELS[integration.type]}
                                </h4>
                                {integration.apiKey && (
                                  <span
                                    style={{
                                      padding: '2px 8px',
                                      borderRadius: '10px',
                                      fontSize: '11px',
                                      fontWeight: 500,
                                      background: tokens.colors.successMuted,
                                      color: tokens.colors.success,
                                    }}
                                  >
                                    Connected
                                  </span>
                                )}
                              </div>
                              <button
                                onClick={() => removeIntegration(activeApp.id, integration.type)}
                                style={{
                                  color: tokens.colors.danger,
                                  background: 'none',
                                  border: 'none',
                                  fontSize: '12px',
                                  cursor: 'pointer',
                                  fontFamily: 'inherit',
                                }}
                              >
                                Remove
                              </button>
                            </div>

                            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                              {/* Show default API Key field for non-GitHub integrations */}
                              {integration.type !== 'github' && (
                                <div>
                                  <label
                                    style={{
                                      display: 'block',
                                      fontSize: '11px',
                                      color: tokens.colors.textDim,
                                      marginBottom: '6px',
                                    }}
                                  >
                                    API Key
                                  </label>
                                  <input
                                    type="password"
                                    value={integration.apiKey || ''}
                                    onChange={(e) => updateIntegration(activeApp.id, integration.type, { apiKey: e.target.value })}
                                    placeholder={`Enter ${INTEGRATION_LABELS[integration.type]} API key`}
                                    style={{
                                      width: '100%',
                                      padding: '10px 12px',
                                      fontSize: '13px',
                                      background: tokens.colors.bg,
                                      border: `1px solid ${tokens.colors.border}`,
                                      borderRadius: tokens.radius.sm,
                                      color: tokens.colors.text,
                                      fontFamily: 'inherit',
                                      outline: 'none',
                                    }}
                                  />
                                </div>
                              )}

                              {(integration.type === 'vercel' || integration.type === 'supabase' || integration.type === 'posthog') && (
                                <div>
                                  <label
                                    style={{
                                      display: 'block',
                                      fontSize: '11px',
                                      color: tokens.colors.textDim,
                                      marginBottom: '6px',
                                    }}
                                  >
                                    {integration.type === 'vercel' ? 'Project Name or ID' :
                                     integration.type === 'supabase' ? 'Project Ref' :
                                     'Project ID'}
                                  </label>
                                  <input
                                    type="text"
                                    value={integration.projectId || ''}
                                    onChange={(e) => updateIntegration(activeApp.id, integration.type, { projectId: e.target.value })}
                                    placeholder={integration.type === 'vercel' ? 'e.g., my-project or prj_xxx' : 'Enter project ID'}
                                    style={{
                                      width: '100%',
                                      padding: '10px 12px',
                                      fontSize: '13px',
                                      background: tokens.colors.bg,
                                      border: `1px solid ${tokens.colors.border}`,
                                      borderRadius: tokens.radius.sm,
                                      color: tokens.colors.text,
                                      fontFamily: 'inherit',
                                      outline: 'none',
                                    }}
                                  />
                                </div>
                              )}
                              {integration.type === 'vercel' && (
                                <div>
                                  <label
                                    style={{
                                      display: 'block',
                                      fontSize: '11px',
                                      color: tokens.colors.textDim,
                                      marginBottom: '6px',
                                    }}
                                  >
                                    Team Slug (if using a team)
                                  </label>
                                  <input
                                    type="text"
                                    value={integration.teamId || ''}
                                    onChange={(e) => updateIntegration(activeApp.id, integration.type, { teamId: e.target.value })}
                                    placeholder="e.g., my-team"
                                    style={{
                                      width: '100%',
                                      padding: '10px 12px',
                                      fontSize: '13px',
                                      background: tokens.colors.bg,
                                      border: `1px solid ${tokens.colors.border}`,
                                      borderRadius: tokens.radius.sm,
                                      color: tokens.colors.text,
                                      fontFamily: 'inherit',
                                      outline: 'none',
                                    }}
                                  />
                                  <p
                                    style={{
                                      fontSize: '10px',
                                      color: tokens.colors.textDim,
                                      marginTop: '4px',
                                    }}
                                  >
                                    Found in your URL: vercel.com/<strong>team-slug</strong>/project
                                  </p>
                                </div>
                              )}
                              {integration.type === 'github' && (
                                <>
                                  <div>
                                    <label
                                      style={{
                                        display: 'block',
                                        fontSize: '11px',
                                        color: tokens.colors.textDim,
                                        marginBottom: '6px',
                                      }}
                                    >
                                      Personal Access Token
                                    </label>
                                    <input
                                      type="password"
                                      value={integration.apiKey || ''}
                                      onChange={(e) => updateIntegration(activeApp.id, integration.type, { apiKey: e.target.value })}
                                      placeholder="ghp_xxxxxxxxxxxx"
                                      style={{
                                        width: '100%',
                                        padding: '10px 12px',
                                        fontSize: '13px',
                                        background: tokens.colors.bg,
                                        border: `1px solid ${tokens.colors.border}`,
                                        borderRadius: tokens.radius.sm,
                                        color: tokens.colors.text,
                                        fontFamily: 'inherit',
                                        outline: 'none',
                                      }}
                                    />
                                    <p
                                      style={{
                                        fontSize: '10px',
                                        color: tokens.colors.textDim,
                                        marginTop: '4px',
                                      }}
                                    >
                                      Create at github.com/settings/tokens with repo and notifications permissions
                                    </p>
                                  </div>
                                  <div>
                                    <label
                                      style={{
                                        display: 'block',
                                        fontSize: '11px',
                                        color: tokens.colors.textDim,
                                        marginBottom: '6px',
                                      }}
                                    >
                                      GitHub Username
                                    </label>
                                    <input
                                      type="text"
                                      value={integration.teamId || ''}
                                      onChange={(e) => updateIntegration(activeApp.id, integration.type, { teamId: e.target.value })}
                                      placeholder="e.g., octocat"
                                      style={{
                                        width: '100%',
                                        padding: '10px 12px',
                                        fontSize: '13px',
                                        background: tokens.colors.bg,
                                        border: `1px solid ${tokens.colors.border}`,
                                        borderRadius: tokens.radius.sm,
                                        color: tokens.colors.text,
                                        fontFamily: 'inherit',
                                        outline: 'none',
                                      }}
                                    />
                                  </div>
                                  <div>
                                    <label
                                      style={{
                                        display: 'block',
                                        fontSize: '11px',
                                        color: tokens.colors.textDim,
                                        marginBottom: '6px',
                                      }}
                                    >
                                      Repositories to track <span style={{ color: tokens.colors.accent }}>*</span>
                                    </label>
                                    <input
                                      type="text"
                                      value={integration.projectId || ''}
                                      onChange={(e) => updateIntegration(activeApp.id, integration.type, { projectId: e.target.value })}
                                      placeholder="owner/repo, owner/another-repo"
                                      style={{
                                        width: '100%',
                                        padding: '10px 12px',
                                        fontSize: '13px',
                                        background: tokens.colors.bg,
                                        border: `1px solid ${integration.projectId ? tokens.colors.border : 'rgba(239, 68, 68, 0.5)'}`,
                                        borderRadius: tokens.radius.sm,
                                        color: tokens.colors.text,
                                        fontFamily: 'inherit',
                                        outline: 'none',
                                      }}
                                    />
                                    <p
                                      style={{
                                        fontSize: '10px',
                                        color: tokens.colors.textDim,
                                        marginTop: '4px',
                                      }}
                                    >
                                      Format: owner/repo (comma-separated for multiple)
                                    </p>
                                  </div>
                                </>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Google Calendar Connection (per-project) */}
                    <div style={{ marginBottom: '24px' }}>
                      <label
                        style={{
                          display: 'block',
                          fontSize: '13px',
                          color: tokens.colors.textMuted,
                          marginBottom: '12px',
                        }}
                      >
                        Google Calendar
                      </label>
                      <div
                        style={{
                          padding: '16px',
                          background: tokens.colors.bgCard,
                          borderRadius: tokens.radius.md,
                          border: `1px solid ${tokens.colors.border}`,
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' }}>
                          <img
                            src="https://www.google.com/s2/favicons?domain=calendar.google.com&sz=64"
                            alt=""
                            style={{ width: '20px', height: '20px', borderRadius: '4px' }}
                          />
                          <div style={{ flex: 1 }}>
                            <div style={{ color: tokens.colors.text, fontWeight: 500, fontSize: '13px' }}>
                              Show your upcoming events for this project
                            </div>
                          </div>
                          {activeApp.googleCalendar?.enabled && (
                            <span
                              style={{
                                padding: '3px 8px',
                                borderRadius: '12px',
                                fontSize: '11px',
                                fontWeight: 500,
                                background: tokens.colors.successMuted,
                                color: tokens.colors.success,
                              }}
                            >
                              Connected
                            </span>
                          )}
                        </div>

                        {activeApp.googleCalendar?.enabled ? (
                          <button
                            onClick={() => handleDisconnectCalendar(activeApp.id)}
                            style={{
                              padding: '8px 14px',
                              borderRadius: tokens.radius.sm,
                              border: `1px solid ${tokens.colors.border}`,
                              background: 'transparent',
                              color: tokens.colors.textMuted,
                              fontSize: '12px',
                              fontWeight: 500,
                              cursor: 'pointer',
                              fontFamily: 'inherit',
                            }}
                          >
                            Disconnect Calendar
                          </button>
                        ) : calendarConnectingAppId === activeApp.id ? (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                              <div
                                className="spin"
                                style={{
                                  width: '16px',
                                  height: '16px',
                                  border: `2px solid ${tokens.colors.border}`,
                                  borderTopColor: tokens.colors.accent,
                                  borderRadius: '50%',
                                }}
                              />
                              <p style={{ color: tokens.colors.textMuted, fontSize: '12px' }}>
                                Waiting for authorization in browser...
                              </p>
                            </div>
                            <button
                              onClick={() => {
                                setCalendarConnectingAppId(null);
                                setCalendarError(null);
                              }}
                              style={{
                                padding: '6px 12px',
                                background: 'transparent',
                                border: `1px solid ${tokens.colors.border}`,
                                borderRadius: tokens.radius.sm,
                                color: tokens.colors.textDim,
                                fontSize: '11px',
                                cursor: 'pointer',
                                fontFamily: 'inherit',
                              }}
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => handleConnectCalendar(activeApp.id)}
                            style={{
                              padding: '8px 14px',
                              borderRadius: tokens.radius.sm,
                              border: 'none',
                              background: tokens.colors.accent,
                              color: 'white',
                              fontSize: '12px',
                              fontWeight: 500,
                              cursor: 'pointer',
                              fontFamily: 'inherit',
                            }}
                          >
                            Connect Google Calendar
                          </button>
                        )}

                        {calendarError && calendarConnectingAppId === activeApp.id && (
                          <p style={{ color: tokens.colors.danger, fontSize: '11px', marginTop: '10px' }}>
                            {calendarError}
                          </p>
                        )}
                      </div>
                    </div>

                    <div
                      style={{
                        paddingTop: '16px',
                        borderTop: `1px solid ${tokens.colors.border}`,
                      }}
                    >
                      <button
                        onClick={() => deleteApp(activeApp.id)}
                        style={{
                          fontSize: '13px',
                          color: tokens.colors.danger,
                          background: 'none',
                          border: 'none',
                          cursor: 'pointer',
                          fontFamily: 'inherit',
                        }}
                      >
                        Delete App
                      </button>
                    </div>
                  </div>
                ) : (
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      height: '200px',
                      color: tokens.colors.textMuted,
                    }}
                  >
                    Add an app to get started
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
