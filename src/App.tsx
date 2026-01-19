import { useState, useEffect, useCallback, useMemo } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { ThemeProvider, useTheme } from './contexts/ThemeContext';
import { Sidebar } from './components/Sidebar';
import { StatCard } from './components/StatCard';
import { MiniChart } from './components/MiniChart';
import { MiniCalendar } from './components/MiniCalendar';
import { ActivityFeed } from './components/ActivityFeed';
import { Settings } from './components/Settings';
import { DetailPanel } from './components/DetailPanel';
import { AddWidgetCard } from './components/AddWidgetCard';
import { CalendarPage } from './components/CalendarPage';
import { AnalyticsPage } from './components/AnalyticsPage';
import { AddProjectModal } from './components/AddProjectModal';
import { PlatformTabs } from './components/PlatformTabs';
import { WidgetPicker } from './components/WidgetPicker';
import { SettingsIcon, AnalyticsIcon } from './components/Icons';
import { GmailInboxWidget } from './components/GmailInboxWidget';
import { GitHubActivityWidget } from './components/GitHubActivityWidget';
import { App, AppMetrics, Settings as SettingsType, DetailPanelType, Platform, GoogleCalendarConfig, CalendarEvent, WidgetType, GmailMessage, GmailMetrics, GitHubMetrics, GridLayoutItem } from './types';
import { DashboardGrid, DEFAULT_LAYOUT, addWidgetToLayout } from './components/DashboardGrid';
import { CardRect } from './components/StatCard';
import { useHistory } from './hooks/useHistory';
import { migrateApps } from './utils/platforms';
import './index.css';

// Check if running in Tauri environment (Tauri v2 uses __TAURI_INTERNALS__)
const IS_TAURI = typeof window !== 'undefined' && !!(window as any).__TAURI_INTERNALS__;

function DashboardContent() {
  const { tokens } = useTheme();
  const [settings, setSettings] = useState<SettingsType>({
    apps: [],
    refreshInterval: 5,
    launchAtStartup: false,
  });
  const [settingsLoaded, setSettingsLoaded] = useState(false); // Track if initial load completed
  const [metrics, setMetrics] = useState<Record<string, AppMetrics | null>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [selectedAppId, setSelectedAppId] = useState<string | null>(null);
  const [activeNav, setActiveNav] = useState('overview');
  const [detailPanel, setDetailPanel] = useState<{ isOpen: boolean; type: DetailPanelType; originRect: CardRect | null }>({
    isOpen: false,
    type: null,
    originRect: null,
  });
  const [showAddProjectModal, setShowAddProjectModal] = useState(false);
  const [showWidgetPicker, setShowWidgetPicker] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false); // Toggle for customization mode
  const [gridLayout, setGridLayout] = useState<GridLayoutItem[]>(() =>
    settings.dashboardLayout && settings.dashboardLayout.length > 0
      ? settings.dashboardLayout
      : DEFAULT_LAYOUT
  );
  const [deleteConfirm, setDeleteConfirm] = useState<{ isOpen: boolean; appId: string | null; appName: string }>({
    isOpen: false,
    appId: null,
    appName: '',
  });
  const [activePlatformTab, setActivePlatformTab] = useState<'overview' | Platform>('overview');
  const [calendarEvents, setCalendarEvents] = useState<CalendarEvent[]>([]);

  // Gmail data state
  const [gmailData, setGmailData] = useState<{
    metrics?: GmailMetrics;
    messages?: GmailMessage[];
  } | null>(null);

  // GitHub data state
  const [githubData, setGithubData] = useState<GitHubMetrics | null>(null);

  // Historical data for the selected app (or first app if none selected)
  const effectiveAppId = selectedAppId || settings.apps[0]?.id || null;
  const { snapshots, saveSnapshot } = useHistory(effectiveAppId);

  const loadSettings = useCallback(async () => {
    if (!IS_TAURI) {
      // In web mode, try to load from localStorage
      const saved = localStorage.getItem('pulse_settings');
      if (saved) {
        const parsedSettings = JSON.parse(saved);
        // Migrate apps to ensure they have platforms array
        parsedSettings.apps = migrateApps(parsedSettings.apps || []);
        setSettings(parsedSettings);
      }
      setSettingsLoaded(true);
      return;
    }
    try {
      const savedSettings = await invoke<string>('get_settings');
      if (savedSettings) {
        const parsedSettings = JSON.parse(savedSettings);
        // Migrate apps to ensure they have platforms array
        parsedSettings.apps = migrateApps(parsedSettings.apps || []);
        setSettings(parsedSettings);
      }
      setSettingsLoaded(true);
    } catch (error) {
      console.error('Failed to load settings:', error);
      setSettingsLoaded(true); // Still mark as loaded to prevent blocking
    }
  }, []);

  const saveSettingsToStore = async (newSettings: SettingsType) => {
    // Don't save until initial settings are loaded (prevents overwriting with empty data during HMR)
    if (!settingsLoaded) {
      console.warn('Skipping save: settings not loaded yet');
      return;
    }
    try {
      if (IS_TAURI) {
        await invoke('save_settings', { settings: JSON.stringify(newSettings) });
      } else {
        // In web mode, save to localStorage
        localStorage.setItem('pulse_settings', JSON.stringify(newSettings));
      }
    } catch (error) {
      console.error('Failed to save settings:', error);
    }
  };

  // Fetch calendar events from all connected apps (per-project calendar)
  const fetchAllCalendarEvents = useCallback(async () => {
    if (!IS_TAURI) return;

    const allEvents: CalendarEvent[] = [];

    for (const app of settings.apps) {
      const config = app.googleCalendar;
      if (!config?.enabled || !config?.accessToken) continue;

      try {
        const eventsJson = await invoke<string>('fetch_google_calendar', {
          accessToken: config.accessToken,
        });

        // Check if token expired
        if (eventsJson === 'TOKEN_EXPIRED' && config.refreshToken) {
          // Try to refresh the token
          const tokenResponse = await invoke<string>('refresh_google_token', {
            refreshToken: config.refreshToken,
          });
          const newTokens = JSON.parse(tokenResponse);

          // Update the app's config with new access token
          const updatedConfig: GoogleCalendarConfig = {
            ...config,
            accessToken: newTokens.access_token,
          };
          const updatedApps = settings.apps.map(a =>
            a.id === app.id ? { ...a, googleCalendar: updatedConfig } : a
          );
          const newSettings = { ...settings, apps: updatedApps };
          setSettings(newSettings);
          await saveSettingsToStore(newSettings);

          // Retry fetch with new token
          const retryEventsJson = await invoke<string>('fetch_google_calendar', {
            accessToken: newTokens.access_token,
          });
          const retryEvents: CalendarEvent[] = JSON.parse(retryEventsJson);
          // Tag each event with the app's project color
          const eventsWithAppColor = retryEvents.map(e => ({ ...e, color: app.color }));
          allEvents.push(...eventsWithAppColor);
          continue;
        }

        const events: CalendarEvent[] = JSON.parse(eventsJson);
        // Tag each event with the app's project color
        const eventsWithAppColor = events.map(e => ({ ...e, color: app.color }));
        allEvents.push(...eventsWithAppColor);
      } catch (error) {
        console.error(`Failed to fetch calendar events for ${app.name}:`, error);
        // If token expired error, try to refresh
        if (String(error).includes('TOKEN_EXPIRED') && config.refreshToken) {
          try {
            const tokenResponse = await invoke<string>('refresh_google_token', {
              refreshToken: config.refreshToken,
            });
            const newTokens = JSON.parse(tokenResponse);
            const updatedConfig: GoogleCalendarConfig = {
              ...config,
              accessToken: newTokens.access_token,
            };
            const updatedApps = settings.apps.map(a =>
              a.id === app.id ? { ...a, googleCalendar: updatedConfig } : a
            );
            const newSettings = { ...settings, apps: updatedApps };
            setSettings(newSettings);
            await saveSettingsToStore(newSettings);
          } catch (refreshError) {
            console.error('Failed to refresh token:', refreshError);
          }
        }
      }
    }

    setCalendarEvents(allEvents);
  }, [settings.apps]);

  // Fetch Gmail data (uses same Google OAuth tokens as Calendar)
  const fetchGmailData = useCallback(async () => {
    if (!IS_TAURI) return;

    // Gmail uses the same OAuth as Calendar - check if any app has Google Calendar connected
    for (const app of settings.apps) {
      const config = app.googleCalendar;
      if (!config?.enabled || !config?.accessToken) continue;

      try {
        const gmailJson = await invoke<string>('fetch_gmail', {
          accessToken: config.accessToken,
        });

        const data = JSON.parse(gmailJson);
        setGmailData({
          metrics: data.metrics,
          messages: data.messages,
        });
        return; // Only need data from one account
      } catch (error) {
        console.error('Failed to fetch Gmail data:', error);
        // Try token refresh if expired
        if (String(error).includes('401') && config.refreshToken) {
          try {
            const tokenResponse = await invoke<string>('refresh_google_token', {
              refreshToken: config.refreshToken,
            });
            const newTokens = JSON.parse(tokenResponse);
            const updatedConfig: GoogleCalendarConfig = {
              ...config,
              accessToken: newTokens.access_token,
            };
            const updatedApps = settings.apps.map(a =>
              a.id === app.id ? { ...a, googleCalendar: updatedConfig } : a
            );
            const newSettings = { ...settings, apps: updatedApps };
            setSettings(newSettings);
            await saveSettingsToStore(newSettings);

            // Retry with new token
            const retryJson = await invoke<string>('fetch_gmail', {
              accessToken: newTokens.access_token,
            });
            const retryData = JSON.parse(retryJson);
            setGmailData({
              metrics: retryData.metrics,
              messages: retryData.messages,
            });
          } catch (refreshError) {
            console.error('Failed to refresh Gmail token:', refreshError);
          }
        }
      }
    }
  }, [settings.apps]);

  // Fetch GitHub data
  const fetchGitHubData = useCallback(async () => {
    if (!IS_TAURI) return;

    for (const app of settings.apps) {
      const githubIntegration = app.integrations.find(i => i.type === 'github');
      if (!githubIntegration?.enabled || !githubIntegration?.apiKey || !githubIntegration?.projectId) continue;

      const token = githubIntegration.apiKey;
      const username = githubIntegration.teamId || ''; // We store username in teamId field
      const repos = githubIntegration.projectId
        ? githubIntegration.projectId.split(',').map(r => r.trim()).filter(r => r)
        : [];

      try {
        const githubJson = await invoke<string>('fetch_github_metrics', {
          token,
          username,
          repos,
        });

        const data = JSON.parse(githubJson);
        setGithubData(data);
        return; // Only need data from one account
      } catch (error) {
        console.error('Failed to fetch GitHub data:', error);
      }
    }
  }, [settings.apps]);

  const saveSettings = async (apps: App[]) => {
    // Don't save until initial settings are loaded (prevents overwriting with empty data during HMR)
    if (!settingsLoaded) {
      console.warn('Skipping save: settings not loaded yet');
      return;
    }

    const newSettings = { ...settings, apps };

    // Check if any API credentials changed (to trigger refresh)
    const oldKeys = settings.apps.flatMap(a => a.integrations.map(i => i.apiKey || '')).join('|');
    const newKeys = apps.flatMap(a => a.integrations.map(i => i.apiKey || '')).join('|');
    const credentialsChanged = oldKeys !== newKeys;

    try {
      if (IS_TAURI) {
        await invoke('save_settings', { settings: JSON.stringify(newSettings) });
      } else {
        localStorage.setItem('pulse_settings', JSON.stringify(newSettings));
      }
      setSettings(newSettings);

      // If API credentials changed, refresh metrics after a short delay
      if (credentialsChanged) {
        setTimeout(() => refreshMetrics(), 1000);
      }
    } catch (error) {
      console.error('Failed to save settings:', error);
    }
  };

  const closeSettings = () => {
    setShowSettings(false);
    refreshMetrics(); // Refresh when user is done with settings
  };

  const handleDeleteApp = (appId: string) => {
    const app = settings.apps.find(a => a.id === appId);
    if (app) {
      setDeleteConfirm({ isOpen: true, appId, appName: app.name });
    }
  };

  const confirmDeleteApp = () => {
    if (deleteConfirm.appId) {
      const updatedApps = settings.apps.filter(a => a.id !== deleteConfirm.appId);
      const newSettings = { ...settings, apps: updatedApps };
      setSettings(newSettings);
      saveSettingsToStore(newSettings);

      // If we deleted the selected app, clear selection
      if (selectedAppId === deleteConfirm.appId) {
        setSelectedAppId(null);
        setActiveNav('overview');
      }
    }
    setDeleteConfirm({ isOpen: false, appId: null, appName: '' });
  };

  const refreshMetrics = useCallback(async () => {
    if (settings.apps.length === 0) {
      setIsLoading(false);
      return;
    }

    setIsRefreshing(true);

    try {
      const results: Record<string, AppMetrics | null> = {};

      for (const app of settings.apps) {
        try {
          const appMetrics = await invoke<string>('fetch_app_metrics', {
            app: JSON.stringify(app),
          });
          results[app.id] = JSON.parse(appMetrics);
        } catch (error) {
          console.error(`Failed to fetch metrics for ${app.name}:`, error);
          results[app.id] = null;
        }
      }

      setMetrics(results);

      // Save snapshot for each app with metrics
      for (const [, appMetrics] of Object.entries(results)) {
        if (appMetrics) {
          saveSnapshot(appMetrics);
        }
      }

      // Also refresh calendar events from all apps with calendar connected
      const hasAnyCalendarConnected = settings.apps.some(app => app.googleCalendar?.enabled);
      if (hasAnyCalendarConnected) {
        fetchAllCalendarEvents();
        // Gmail uses the same OAuth, so fetch Gmail too
        fetchGmailData();
      }

      // Fetch GitHub data if any app has GitHub integration with repos configured
      const hasGitHub = settings.apps.some(app =>
        app.integrations.some(i => i.type === 'github' && i.enabled && i.apiKey && i.projectId)
      );
      if (hasGitHub) {
        fetchGitHubData();
      }
    } catch (error) {
      console.error('Failed to refresh metrics:', error);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [settings.apps, saveSnapshot, fetchAllCalendarEvents, fetchGmailData, fetchGitHubData]);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  // Fetch calendar events when settings are loaded (for apps with calendar connected)
  useEffect(() => {
    const hasAnyCalendarConnected = settings.apps.some(app => app.googleCalendar?.enabled && app.googleCalendar?.accessToken);
    if (hasAnyCalendarConnected) {
      fetchAllCalendarEvents();
    }
  }, [settings.apps, fetchAllCalendarEvents]);

  // Reset platform tab when selected app changes
  useEffect(() => {
    setActivePlatformTab('overview');
  }, [selectedAppId]);

  useEffect(() => {
    if (settings.apps.length > 0) {
      refreshMetrics();
      const interval = setInterval(refreshMetrics, settings.refreshInterval * 60 * 1000);
      return () => clearInterval(interval);
    } else {
      setIsLoading(false);
    }
  }, [settings.apps, settings.refreshInterval, refreshMetrics]);

  // Calculate totals from actual data (no fallbacks - show real numbers only)
  const totalMRR = Object.values(metrics).reduce((sum, m) => sum + (m?.stripe?.mrr || 0), 0);
  const totalPayingUsers = Object.values(metrics).reduce((sum, m) => sum + (m?.stripe?.activeSubscriptions || 0), 0);
  const totalUsers = Object.values(metrics).reduce((sum, m) => sum + (m?.supabase?.totalUsers || 0), 0);
  const averageChurn = Object.values(metrics).filter(m => m?.stripe?.churnRate).length > 0
    ? Object.values(metrics).reduce((sum, m) => sum + (m?.stripe?.churnRate || 0), 0) / Object.values(metrics).filter(m => m?.stripe?.churnRate).length
    : 0;
  const hasApps = settings.apps.length > 0;

  // Get selected app data
  const selectedApp = selectedAppId ? settings.apps.find(a => a.id === selectedAppId) : null;
  const selectedMetrics = selectedAppId ? metrics[selectedAppId] : null;

  // Use real data only - no sample fallbacks
  // Use Math.abs to avoid negative zero display issue
  const displayMRR = Math.abs(selectedMetrics?.stripe?.mrr ?? totalMRR) || 0;
  const displayPayingUsers = selectedMetrics?.stripe?.activeSubscriptions ?? totalPayingUsers;
  const displayTotalUsers = selectedMetrics?.supabase?.totalUsers ?? totalUsers;
  const displayChurn = Math.abs(selectedMetrics?.stripe?.churnRate ?? averageChurn) || 0;

  // Get extended stripe metrics for daily data
  // Get Stripe extended metrics - fall back to first app if on Overview
  const effectiveMetrics = selectedMetrics || (Object.values(metrics)[0] as AppMetrics | undefined);
  const stripeExtended = effectiveMetrics?.stripe as import('./types').StripeMetricsExtended | undefined;

  // Generate chart data from real-time daily revenue (or historical snapshots as fallback)
  const revenueChartData = stripeExtended?.dailyRevenue?.length
    ? stripeExtended.dailyRevenue.map(d => d.revenue)
    : snapshots.length > 0
      ? snapshots.slice(-30).map(s => s.stripe?.mrr || 0)
      : [];

  // Subscriber chart from daily data or snapshots
  const subscriberChartData = stripeExtended?.dailySubscribers?.length
    ? stripeExtended.dailySubscribers
    : snapshots.length > 0
      ? snapshots.slice(-30).map(s => s.stripe?.activeSubscriptions || 0)
      : [];

  // Get growth rates from Stripe API response (calculated from actual subscription data)
  // MRR growth rate: (net_new_mrr / previous_mrr) * 100
  const mrrChange = stripeExtended?.revenueGrowthRate ?? undefined;

  // Subscriber growth rate: (net_new_subscribers / previous_subscribers) * 100
  const subscriberChange = stripeExtended?.subscriberGrowthRate ?? undefined;

  // Get combined metrics for selected app or all apps
  const currentMetrics = selectedMetrics || (Object.values(metrics)[0] as AppMetrics | null);

  const handleOpenPanel = (type: DetailPanelType, rect?: CardRect) => {
    setDetailPanel({ isOpen: true, type, originRect: rect || null });
  };

  const handleClosePanel = () => {
    setDetailPanel(prev => ({ ...prev, isOpen: false }));
    // Clear the type after animation completes
    setTimeout(() => {
      setDetailPanel({ isOpen: false, type: null, originRect: null });
    }, 300);
  };


  // Get dynamic greeting based on time, day, and metrics
  const getGreeting = () => {
    const now = new Date();
    const hour = now.getHours();
    const day = now.getDay(); // 0 = Sunday, 1 = Monday, etc.
    const random = Math.random();

    // Data-driven check
    const isGrowing = totalMRR > 0;

    // Special day overrides (always show these)
    if (day === 1) return "New week, new opportunities"; // Monday
    if (day === 5) return "Let's close the week strong"; // Friday

    // Late night (10pm - 6am)
    if (hour >= 22 || hour < 6) {
      return "Burning the midnight oil";
    }

    // Morning (6am - 12pm)
    if (hour < 12) {
      if (random < 0.10 && isGrowing) return "Your MRR is trending up";
      if (random < 0.25) return "Let's make today count";
      return "Good morning";
    }

    // Afternoon (12pm - 6pm)
    if (hour < 18) {
      if (random < 0.10 && isGrowing) return "Another strong month";
      if (random < 0.25) return "Here's your midday pulse";
      return "Good afternoon";
    }

    // Evening (6pm - 10pm)
    if (random < 0.10 && isGrowing) return "Your projects are thriving";
    if (random < 0.25) return "Wrapping up strong";
    return "Good evening";
  };

  // Get contextual subtitle based on time of day
  const getSubtitle = () => {
    const hour = new Date().getHours();
    const projectCount = settings.apps.length;

    // Late night
    if (hour >= 22 || hour < 6) {
      return "The grind never stops.";
    }

    // Morning (6am - 12pm)
    if (hour < 12) {
      return "Here's your starting point for today.";
    }

    // Afternoon (12pm - 6pm)
    if (hour < 18) {
      return "Here's your progress so far.";
    }

    // Evening (6pm - 10pm) — show quick stats recap
    return `${projectCount} project${projectCount !== 1 ? 's' : ''} · ${displayTotalUsers.toLocaleString()} users · $${displayMRR.toLocaleString()} MRR`;
  };

  // Sync grid layout when settings are loaded
  useEffect(() => {
    if (settings.dashboardLayout && settings.dashboardLayout.length > 0) {
      setGridLayout(settings.dashboardLayout);
    }
  }, [settings.dashboardLayout]);

  // Handle layout changes - save to settings
  const handleLayoutChange = useCallback((newLayout: GridLayoutItem[]) => {
    setGridLayout(newLayout);
    // Persist layout to settings
    const newSettings = { ...settings, dashboardLayout: newLayout };
    setSettings(newSettings);
    saveSettingsToStore(newSettings);
  }, [settings]);

  // Reset layout to default
  const handleResetLayout = useCallback(() => {
    setGridLayout(DEFAULT_LAYOUT);
    const newSettings = { ...settings, dashboardLayout: DEFAULT_LAYOUT };
    setSettings(newSettings);
    saveSettingsToStore(newSettings);
  }, [settings]);

  // Create widget map for DashboardGrid
  const widgetMap = useMemo(() => ({
    // Stat cards
    'stat-mrr': (
      <StatCard
        label="Monthly Revenue"
        value={`$${displayMRR.toLocaleString()}`}
        change={mrrChange !== undefined ? `${Math.abs(mrrChange).toFixed(1)}%` : undefined}
        changeType={mrrChange !== undefined ? (mrrChange >= 0 ? 'up' : 'down') : 'up'}
        icon="revenue"
        onExpand={handleOpenPanel}
        expandType="mrr"
        isLoading={isLoading}
      />
    ),
    'stat-users': (
      <StatCard
        label="Total Users"
        value={displayTotalUsers > 0 ? displayTotalUsers.toLocaleString() : displayPayingUsers.toLocaleString()}
        change={displayTotalUsers > 0
          ? (effectiveMetrics?.supabase?.newUsers7d ? `+${effectiveMetrics.supabase.newUsers7d} this week` : undefined)
          : (subscriberChange !== undefined ? `${Math.abs(subscriberChange).toFixed(1)}%` : undefined)}
        changeType="up"
        icon="users"
        onExpand={handleOpenPanel}
        expandType="subscribers"
        isLoading={isLoading}
      />
    ),
    'stat-subscribers': (
      <StatCard
        label="Paying Users"
        value={displayPayingUsers.toLocaleString()}
        change={subscriberChange !== undefined ? `${Math.abs(subscriberChange).toFixed(1)}%` : undefined}
        changeType={subscriberChange !== undefined ? (subscriberChange >= 0 ? 'up' : 'down') : 'up'}
        icon="subscriptions"
        onExpand={handleOpenPanel}
        expandType="subscribers"
        isLoading={isLoading}
      />
    ),
    'stat-churn': (
      <StatCard
        label="Churn Rate"
        value={`${displayChurn.toFixed(1)}%`}
        change={undefined}
        changeType="down"
        icon="churn"
        onExpand={handleOpenPanel}
        expandType="churn"
        isLoading={isLoading}
      />
    ),
    // Charts
    'chart-revenue': (
      <MiniChart
        title="Revenue"
        data={revenueChartData}
        color={tokens.colors.accent}
        type="line"
        onClick={() => handleOpenPanel('mrr')}
      />
    ),
    'chart-subscribers': (
      <MiniChart
        title="Users"
        data={subscriberChartData}
        color={tokens.colors.success}
        type="bar"
        onClick={() => handleOpenPanel('growth')}
      />
    ),
    'chart-activity': (
      <MiniChart
        title="Activity"
        data={currentMetrics?.stripeEvents?.slice(-12).map(() => 1) || []}
        color="#8b5cf6"
        type="bar"
        onClick={() => handleOpenPanel('stripe-events')}
      />
    ),
    // Calendar
    'calendar': (
      <MiniCalendar
        events={calendarEvents.length > 0 ? calendarEvents : currentMetrics?.calendarEvents}
        onViewAll={() => handleOpenPanel('calendar')}
      />
    ),
    // Activity Feed
    'activity-feed': (
      <ActivityFeed
        events={currentMetrics?.stripeEvents || []}
        deployments={(currentMetrics?.vercel as import('./types').VercelMetricsExtended)?.deployments || []}
        onViewAll={() => handleOpenPanel('stripe-events')}
      />
    ),
    // Gmail Inbox
    'gmail-inbox': (
      <GmailInboxWidget
        messages={gmailData?.messages || []}
        unreadCount={gmailData?.metrics?.unreadCount || 0}
        isLoading={isLoading}
        onViewAll={() => handleOpenPanel('gmail')}
      />
    ),
    // GitHub Activity
    'github-activity': (
      <GitHubActivityWidget
        metrics={githubData || undefined}
        isLoading={isLoading}
        onViewAll={() => handleOpenPanel('github')}
      />
    ),
    // Add Widget placeholder
    'add-widget': (
      <AddWidgetCard onClick={() => setShowWidgetPicker(true)} />
    ),
  }), [
    displayMRR, mrrChange, displayTotalUsers, displayPayingUsers, subscriberChange,
    displayChurn, isLoading, effectiveMetrics, revenueChartData, subscriberChartData,
    currentMetrics, calendarEvents, gmailData, githubData, tokens.colors,
    handleOpenPanel
  ]);

  return (
    <div
      style={{
        height: '100vh',
        background: tokens.colors.bg,
        fontFamily: tokens.fonts.sans,
        color: tokens.colors.text,
        display: 'flex',
        overflow: 'hidden',
        transition: 'background 0.2s ease, color 0.2s ease',
      }}
    >
      {/* Sidebar */}
      <Sidebar
        apps={settings.apps}
        selectedAppId={selectedAppId}
        onSelectApp={setSelectedAppId}
        onSettingsClick={() => setShowSettings(true)}
        activeNav={activeNav}
        onNavChange={setActiveNav}
        totalMRR={displayMRR}
        mrrChange={mrrChange}
        onAddProject={() => setShowAddProjectModal(true)}
        onDeleteApp={handleDeleteApp}
      />

      {/* Main Content */}
      <main style={{ flex: 1, padding: '32px 40px', overflow: 'auto' }}>
        {/* Overview Page */}
        {(activeNav === 'overview' || activeNav === 'project') && (
          <>
            {/* Header */}
            <header
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '32px',
              }}
            >
              <div>
                <h1
                  style={{
                    fontSize: '24px',
                    fontWeight: 600,
                    marginBottom: '4px',
                    letterSpacing: '-0.02em',
                  }}
                >
                  {selectedApp ? selectedApp.name : `${getGreeting()}`}
                </h1>
                <p style={{ color: tokens.colors.textMuted, fontSize: '14px' }}>
                  {hasApps
                    ? selectedApp
                      ? `${displayTotalUsers.toLocaleString()} users`
                      : getSubtitle()
                    : 'Add an app to get started'}
                </p>
              </div>

              <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                {/* Edit Layout toggle button */}
                {hasApps && (
                  <button
                    onClick={() => {
                      if (isEditMode) {
                        // Exiting edit mode - layout is already saved via onLayoutChange
                        setIsEditMode(false);
                      } else {
                        setIsEditMode(true);
                      }
                    }}
                    style={{
                      padding: '10px 16px',
                      borderRadius: tokens.radius.sm,
                      border: `1px solid ${isEditMode ? tokens.colors.accent : tokens.colors.border}`,
                      background: isEditMode ? `${tokens.colors.accent}15` : 'transparent',
                      color: isEditMode ? tokens.colors.accent : tokens.colors.textMuted,
                      fontSize: '13px',
                      fontWeight: 500,
                      cursor: 'pointer',
                      fontFamily: 'inherit',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                    }}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="3" width="7" height="7" />
                      <rect x="14" y="3" width="7" height="7" />
                      <rect x="14" y="14" width="7" height="7" />
                      <rect x="3" y="14" width="7" height="7" />
                    </svg>
                    {isEditMode ? 'Done Editing' : 'Edit Layout'}
                  </button>
                )}
                <button
                  onClick={refreshMetrics}
                  disabled={isRefreshing || !hasApps}
                  className={isRefreshing ? 'pulse-glow' : ''}
                  style={{
                    padding: '10px 16px',
                    borderRadius: tokens.radius.sm,
                    border: `1px solid ${isRefreshing ? tokens.colors.accent : tokens.colors.border}`,
                    background: isRefreshing ? `${tokens.colors.accent}15` : 'transparent',
                    color: isRefreshing ? tokens.colors.accent : tokens.colors.textMuted,
                    fontSize: '13px',
                    fontWeight: 500,
                    cursor: isRefreshing || !hasApps ? 'not-allowed' : 'pointer',
                    fontFamily: 'inherit',
                    opacity: !hasApps ? 0.5 : 1,
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    transition: 'all 0.3s ease',
                  }}
                >
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className={isRefreshing ? 'spin' : ''}
                    style={{
                      transition: 'transform 0.3s ease',
                    }}
                  >
                    <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
                    <path d="M21 3v5h-5" />
                  </svg>
                  {isRefreshing ? 'Syncing...' : 'Refresh'}
                </button>
                {selectedApp ? (
                  <button
                    onClick={() => {
                      setActiveNav('settings');
                    }}
                    style={{
                      padding: '10px 16px',
                      borderRadius: tokens.radius.sm,
                      border: `1px solid ${tokens.colors.border}`,
                      background: 'transparent',
                      color: tokens.colors.textMuted,
                      fontSize: '13px',
                      fontWeight: 500,
                      cursor: 'pointer',
                      fontFamily: 'inherit',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                    }}
                  >
                    <SettingsIcon size={14} /> Settings
                  </button>
                ) : (
                  <button
                    onClick={() => setShowAddProjectModal(true)}
                    style={{
                      padding: '10px 20px',
                      borderRadius: tokens.radius.sm,
                      border: 'none',
                      background: tokens.colors.accent,
                      color: 'white',
                      fontSize: '13px',
                      fontWeight: 500,
                      cursor: 'pointer',
                      fontFamily: 'inherit',
                    }}
                  >
                    + Add Project
                  </button>
                )}
              </div>
            </header>

            {/* Platform Tabs - show when a project is selected with multiple platforms */}
            {selectedApp && selectedApp.platforms && selectedApp.platforms.length > 0 && (
              <PlatformTabs
                platforms={selectedApp.platforms}
                activeTab={activePlatformTab}
                onTabChange={setActivePlatformTab}
                integrationCounts={{
                  overview: selectedApp.integrations.length,
                  ...Object.fromEntries(
                    selectedApp.platforms.map(p => [
                      p,
                      selectedApp.integrations.filter(i => i.platform === p || !i.platform).length
                    ])
                  ) as Record<Platform, number>
                }}
              />
            )}

            {!hasApps ? (
              /* Empty State */
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  height: 'calc(100vh - 200px)',
                  textAlign: 'center',
                }}
              >
                <div
                  style={{
                    width: '80px',
                    height: '80px',
                    borderRadius: tokens.radius.xl,
                    background: tokens.colors.bgCard,
                    border: `1px solid ${tokens.colors.border}`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    marginBottom: '24px',
                  }}
                >
                  <AnalyticsIcon size={32} />
                </div>
                <h2 style={{ fontSize: '20px', fontWeight: 600, marginBottom: '8px' }}>
                  Add your first project
                </h2>
                <p
                  style={{
                    color: tokens.colors.textMuted,
                    marginBottom: '24px',
                    maxWidth: '300px',
                  }}
                >
                  Connect your integrations to start tracking revenue, subscribers, and more.
                </p>
                <button
                  onClick={() => setShowAddProjectModal(true)}
                  style={{
                    padding: '12px 24px',
                    borderRadius: tokens.radius.sm,
                    border: 'none',
                    background: tokens.colors.accent,
                    color: 'white',
                    fontSize: '14px',
                    fontWeight: 500,
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                  }}
                >
                  + Add Project
                </button>
              </div>
            ) : (
              /* Dashboard Grid - always use grid, edit mode controls drag/resize */
              <DashboardGrid
                layout={gridLayout}
                onLayoutChange={handleLayoutChange}
                widgetMap={widgetMap}
                isEditMode={isEditMode}
              />
            )}
          </>
        )}

        {/* Analytics Page */}
        {activeNav === 'analytics' && (
          <AnalyticsPage apps={settings.apps} metrics={metrics} />
        )}

        {/* Calendar Page */}
        {activeNav === 'calendar' && (
          <CalendarPage
            apps={settings.apps}
            events={Object.fromEntries(
              settings.apps.map(app => [
                app.id,
                metrics[app.id]?.calendarEvents || []
              ])
            )}
            googleCalendarEvents={calendarEvents}
          />
        )}

        {/* Settings Page (inline) */}
        {activeNav === 'settings' && (
          <Settings
            apps={settings.apps}
            onSave={saveSettings}
            onClose={() => {
              setActiveNav('overview');
              refreshMetrics();
            }}
            inline
          />
        )}
      </main>

      {/* Settings Modal */}
      {showSettings && (
        <Settings
          apps={settings.apps}
          onSave={saveSettings}
          onClose={closeSettings}
        />
      )}

      {/* Add Project Modal */}
      <AddProjectModal
        isOpen={showAddProjectModal}
        onClose={() => setShowAddProjectModal(false)}
        onComplete={(newApp) => {
          const updatedSettings = {
            ...settings,
            apps: [...settings.apps, newApp],
          };
          setSettings(updatedSettings);
          saveSettingsToStore(updatedSettings);
          setSelectedAppId(newApp.id);
          setActiveNav('overview');
        }}
      />

      {/* Widget Picker Modal */}
      <WidgetPicker
        isOpen={showWidgetPicker}
        onClose={() => setShowWidgetPicker(false)}
        onAdd={(widgetType) => {
          // Map widget type to grid widget ID
          const widgetIdMap: Record<WidgetType, string> = {
            'stat-mrr': 'stat-mrr',
            'stat-subscribers': 'stat-subscribers',
            'stat-churn': 'stat-churn',
            'stat-arpu': 'stat-arpu',
            'stat-arr': 'stat-arr',
            'stat-ltv': 'stat-ltv',
            'chart-revenue': 'chart-revenue',
            'chart-subscribers': 'chart-subscribers',
            'chart-activity': 'chart-activity',
            'chart-churn': 'chart-churn',
            'calendar': 'calendar',
            'activity-feed': 'activity-feed',
            'stat-gmail-unread': 'gmail-inbox',
            'gmail-inbox': 'gmail-inbox',
            'stat-github-stars': 'github-activity',
            'github-activity': 'github-activity',
            'stat-analytics-dau': 'stat-analytics-dau',
            'stat-analytics-mau': 'stat-analytics-mau',
            'stat-analytics-wau': 'stat-analytics-wau',
          };
          const widgetId = widgetIdMap[widgetType] || widgetType;
          const newLayout = addWidgetToLayout(gridLayout, widgetId);
          handleLayoutChange(newLayout);
          setShowWidgetPicker(false);
        }}
        existingWidgets={
          // Get widget types from current grid layout
          gridLayout.map(item => item.i as WidgetType)
        }
        appIntegrations={[
          // Regular integrations from the app
          ...(selectedApp?.integrations || []),
          // Add virtual Gmail integration if Google Calendar is connected (they share OAuth)
          ...(selectedApp?.googleCalendar?.enabled ? [{
            type: 'gmail' as const,
            enabled: true,
            apiKey: selectedApp.googleCalendar.accessToken,
          }] : []),
        ]}
        // NEW: Context and settings update props
        context={activeNav === 'overview' ? 'overview' : 'project'}
        currentApp={selectedApp || undefined}
        allApps={settings.apps}
        onUpdateSettings={async (apps) => {
          const newSettings = { ...settings, apps };
          setSettings(newSettings);
          await saveSettingsToStore(newSettings);
        }}
      />

      {/* Delete Confirmation Dialog */}
      {deleteConfirm.isOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.5)',
            backdropFilter: 'blur(4px)',
            zIndex: 200,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
          onClick={() => setDeleteConfirm({ isOpen: false, appId: null, appName: '' })}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: tokens.colors.bgElevated,
              border: `1px solid ${tokens.colors.border}`,
              borderRadius: tokens.radius.lg,
              padding: '24px',
              maxWidth: '400px',
              width: '90%',
              boxShadow: '0 20px 40px rgba(0, 0, 0, 0.3)',
            }}
          >
            <div style={{ marginBottom: '16px' }}>
              <h3 style={{ fontSize: '18px', fontWeight: 600, marginBottom: '8px' }}>
                Delete Project
              </h3>
              <p style={{ color: tokens.colors.textMuted, fontSize: '14px' }}>
                Are you sure you want to delete <strong style={{ color: tokens.colors.text }}>{deleteConfirm.appName}</strong>? This action cannot be undone.
              </p>
            </div>
            <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
              <button
                onClick={() => setDeleteConfirm({ isOpen: false, appId: null, appName: '' })}
                style={{
                  padding: '10px 20px',
                  borderRadius: tokens.radius.sm,
                  border: `1px solid ${tokens.colors.border}`,
                  background: 'transparent',
                  color: tokens.colors.textMuted,
                  fontSize: '13px',
                  fontWeight: 500,
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                }}
              >
                Cancel
              </button>
              <button
                onClick={confirmDeleteApp}
                style={{
                  padding: '10px 20px',
                  borderRadius: tokens.radius.sm,
                  border: 'none',
                  background: tokens.colors.danger,
                  color: 'white',
                  fontSize: '13px',
                  fontWeight: 500,
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                }}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Detail Panel */}
      <DetailPanel
        isOpen={detailPanel.isOpen}
        type={detailPanel.type}
        metrics={currentMetrics}
        historicalData={snapshots}
        onClose={handleClosePanel}
        originRect={detailPanel.originRect}
        gmailMessages={gmailData?.messages}
        gmailUnreadCount={gmailData?.metrics?.unreadCount}
        githubMetrics={githubData || undefined}
      />
    </div>
  );
}

function Dashboard() {
  return (
    <ThemeProvider>
      <DashboardContent />
    </ThemeProvider>
  );
}

export default Dashboard;
