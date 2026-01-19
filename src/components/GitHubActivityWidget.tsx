import React, { useState } from 'react';
import { useTheme } from '../contexts/ThemeContext';
import { GitHubMetrics } from '../types';

interface GitHubActivityWidgetProps {
  metrics?: GitHubMetrics;
  isLoading?: boolean;
  onViewAll?: () => void;
}

type TabType = 'notifications' | 'activity' | 'repos';

// Event type colors
const eventColors: Record<string, { bg: string; text: string }> = {
  push: { bg: 'rgba(34, 197, 94, 0.15)', text: '#22c55e' },
  pr: { bg: 'rgba(168, 85, 247, 0.15)', text: '#a855f7' },
  issue: { bg: 'rgba(59, 130, 246, 0.15)', text: '#3b82f6' },
  star: { bg: 'rgba(234, 179, 8, 0.15)', text: '#eab308' },
  fork: { bg: 'rgba(99, 102, 241, 0.15)', text: '#6366f1' },
  release: { bg: 'rgba(236, 72, 153, 0.15)', text: '#ec4899' },
  comment: { bg: 'rgba(6, 182, 212, 0.15)', text: '#06b6d4' },
  default: { bg: 'rgba(107, 114, 128, 0.15)', text: '#6b7280' },
};

// Notification type colors
const notificationColors: Record<string, { bg: string; text: string }> = {
  Issue: { bg: 'rgba(34, 197, 94, 0.15)', text: '#22c55e' },
  PullRequest: { bg: 'rgba(168, 85, 247, 0.15)', text: '#a855f7' },
  Release: { bg: 'rgba(236, 72, 153, 0.15)', text: '#ec4899' },
  Discussion: { bg: 'rgba(59, 130, 246, 0.15)', text: '#3b82f6' },
  Commit: { bg: 'rgba(99, 102, 241, 0.15)', text: '#6366f1' },
};

// Icons for event types
const EventIcons: Record<string, React.ReactNode> = {
  push: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="19" x2="12" y2="5" />
      <polyline points="5 12 12 5 19 12" />
    </svg>
  ),
  pr: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="18" cy="18" r="3" />
      <circle cx="6" cy="6" r="3" />
      <path d="M13 6h3a2 2 0 0 1 2 2v7" />
      <line x1="6" y1="9" x2="6" y2="21" />
    </svg>
  ),
  issue: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  ),
  star: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
    </svg>
  ),
  fork: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="18" r="3" />
      <circle cx="6" cy="6" r="3" />
      <circle cx="18" cy="6" r="3" />
      <path d="M18 9v1a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V9" />
      <line x1="12" y1="12" x2="12" y2="15" />
    </svg>
  ),
  release: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
      <line x1="7" y1="7" x2="7.01" y2="7" />
    </svg>
  ),
  comment: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  ),
};

function formatTime(timestamp: string): string {
  const date = new Date(timestamp);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString();
}

export function GitHubActivityWidget({ metrics, isLoading = false, onViewAll }: GitHubActivityWidgetProps) {
  const { tokens } = useTheme();
  const [activeTab, setActiveTab] = useState<TabType>('notifications');

  const containerStyle: React.CSSProperties = {
    background: 'transparent',
    padding: '16px',
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
  };

  const GitHubIcon = (
    <svg width="16" height="16" viewBox="0 0 24 24" fill={tokens.colors.text}>
      <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/>
    </svg>
  );

  if (isLoading) {
    return (
      <div style={containerStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {GitHubIcon}
            <span style={{ fontWeight: 500, fontSize: '14px', color: tokens.colors.text }}>GitHub</span>
          </div>
        </div>
        <div style={{ flex: 1 }}>
          {[1, 2, 3, 4].map((i) => (
            <div key={i} style={{ display: 'flex', gap: '12px', padding: '12px 0', borderBottom: `1px solid ${tokens.colors.border}` }}>
              <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: tokens.colors.bgCardHover }} />
              <div style={{ flex: 1 }}>
                <div style={{ height: '14px', width: '160px', background: tokens.colors.bgCardHover, borderRadius: '4px', marginBottom: '8px' }} />
                <div style={{ height: '12px', width: '100px', background: tokens.colors.bgCardHover, borderRadius: '4px', opacity: 0.5 }} />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  const notifications = metrics?.notifications || [];
  const activity = metrics?.recentActivity || [];
  const repos = metrics?.repos || [];

  const unreadNotifications = notifications.filter(n => n.unread).length;

  // Empty state
  if (!metrics || (notifications.length === 0 && activity.length === 0 && repos.length === 0)) {
    return (
      <div style={containerStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {GitHubIcon}
            <span style={{ fontWeight: 500, fontSize: '14px', color: tokens.colors.text }}>GitHub</span>
          </div>
        </div>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center' }}>
          <div style={{
            width: '48px',
            height: '48px',
            borderRadius: '12px',
            background: tokens.colors.bgCardHover,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: '12px',
          }}>
            {GitHubIcon}
          </div>
          <p style={{ fontSize: '13px', color: tokens.colors.textMuted, marginBottom: '4px' }}>No GitHub data</p>
          <p style={{ fontSize: '12px', color: tokens.colors.textDim }}>Connect your GitHub account in Settings</p>
        </div>
      </div>
    );
  }

  // Stats row
  const StatsRow = () => (
    <div style={{
      display: 'flex',
      gap: '16px',
      padding: '12px',
      background: tokens.colors.bgCardHover,
      borderRadius: '8px',
      marginBottom: '16px',
    }}>
      <div style={{ flex: 1, textAlign: 'center' }}>
        <div style={{ fontSize: '18px', fontWeight: 600, color: tokens.colors.text }}>
          {metrics?.totalStars?.toLocaleString() || 0}
        </div>
        <div style={{ fontSize: '11px', color: tokens.colors.textDim }}>Stars</div>
      </div>
      <div style={{ flex: 1, textAlign: 'center' }}>
        <div style={{ fontSize: '18px', fontWeight: 600, color: tokens.colors.text }}>
          {metrics?.totalForks?.toLocaleString() || 0}
        </div>
        <div style={{ fontSize: '11px', color: tokens.colors.textDim }}>Forks</div>
      </div>
      <div style={{ flex: 1, textAlign: 'center' }}>
        <div style={{ fontSize: '18px', fontWeight: 600, color: tokens.colors.text }}>
          {metrics?.openIssues?.toLocaleString() || 0}
        </div>
        <div style={{ fontSize: '11px', color: tokens.colors.textDim }}>Issues</div>
      </div>
    </div>
  );

  // Tab buttons
  const TabButton = ({ tab, label, count }: { tab: TabType; label: string; count?: number }) => (
    <button
      onClick={() => setActiveTab(tab)}
      style={{
        padding: '6px 12px',
        fontSize: '12px',
        fontWeight: activeTab === tab ? 600 : 400,
        color: activeTab === tab ? tokens.colors.text : tokens.colors.textMuted,
        background: activeTab === tab ? tokens.colors.bgCardHover : 'transparent',
        border: 'none',
        borderRadius: '6px',
        cursor: 'pointer',
        fontFamily: 'inherit',
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
      }}
    >
      {label}
      {count !== undefined && count > 0 && (
        <span style={{
          fontSize: '10px',
          fontWeight: 600,
          color: '#fff',
          background: tab === 'notifications' && count > 0 ? '#ef4444' : tokens.colors.textDim,
          padding: '1px 5px',
          borderRadius: '8px',
        }}>
          {count}
        </span>
      )}
    </button>
  );

  return (
    <div style={containerStyle}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {GitHubIcon}
          <span style={{ fontWeight: 500, fontSize: '14px', color: tokens.colors.text }}>GitHub</span>
        </div>
      </div>

      {/* Stats */}
      <StatsRow />

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '4px', marginBottom: '12px' }}>
        <TabButton tab="notifications" label="Notifications" count={unreadNotifications} />
        <TabButton tab="activity" label="Activity" />
        <TabButton tab="repos" label="Repos" count={repos.length} />
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflow: 'auto' }}>
        {activeTab === 'notifications' && (
          <>
            {notifications.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '24px', color: tokens.colors.textDim }}>
                No notifications
              </div>
            ) : (
              notifications.slice(0, 5).map((notif, index) => {
                const colors = notificationColors[notif.type] || eventColors.default;
                return (
                  <div
                    key={notif.id}
                    style={{
                      display: 'flex',
                      gap: '12px',
                      padding: '10px 0',
                      borderBottom: index < Math.min(notifications.length, 5) - 1 ? `1px solid ${tokens.colors.border}` : undefined,
                      opacity: notif.unread ? 1 : 0.7,
                    }}
                  >
                    <div
                      style={{
                        width: '28px',
                        height: '28px',
                        borderRadius: '6px',
                        background: colors.bg,
                        color: colors.text,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                        fontSize: '10px',
                        fontWeight: 600,
                      }}
                    >
                      {notif.type === 'PullRequest' ? 'PR' : notif.type.charAt(0)}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{
                        fontSize: '12px',
                        fontWeight: notif.unread ? 600 : 400,
                        color: tokens.colors.text,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}>
                        {notif.title}
                      </div>
                      <div style={{
                        fontSize: '11px',
                        color: tokens.colors.textDim,
                        marginTop: '2px',
                        display: 'flex',
                        gap: '6px',
                      }}>
                        <span>{notif.repoName}</span>
                        <span>·</span>
                        <span>{formatTime(notif.updatedAt)}</span>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </>
        )}

        {activeTab === 'activity' && (
          <>
            {activity.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '24px', color: tokens.colors.textDim }}>
                No recent activity
              </div>
            ) : (
              activity.slice(0, 5).map((event, index) => {
                const colors = eventColors[event.type] || eventColors.default;
                const icon = EventIcons[event.type] || EventIcons.comment;
                return (
                  <div
                    key={event.id}
                    style={{
                      display: 'flex',
                      gap: '12px',
                      padding: '10px 0',
                      borderBottom: index < Math.min(activity.length, 5) - 1 ? `1px solid ${tokens.colors.border}` : undefined,
                    }}
                  >
                    <div
                      style={{
                        width: '28px',
                        height: '28px',
                        borderRadius: '6px',
                        background: colors.bg,
                        color: colors.text,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                      }}
                    >
                      {icon}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{
                        fontSize: '12px',
                        color: tokens.colors.text,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}>
                        {event.description}
                      </div>
                      <div style={{
                        fontSize: '11px',
                        color: tokens.colors.textDim,
                        marginTop: '2px',
                        display: 'flex',
                        gap: '6px',
                      }}>
                        <span>{event.repoName}</span>
                        <span>·</span>
                        <span>{formatTime(event.timestamp)}</span>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </>
        )}

        {activeTab === 'repos' && (
          <>
            {repos.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '24px', color: tokens.colors.textDim }}>
                No repositories configured
              </div>
            ) : (
              repos.slice(0, 5).map((repo, index) => (
                <div
                  key={repo.fullName}
                  style={{
                    padding: '10px 0',
                    borderBottom: index < Math.min(repos.length, 5) - 1 ? `1px solid ${tokens.colors.border}` : undefined,
                  }}
                >
                  <div style={{
                    fontSize: '12px',
                    fontWeight: 500,
                    color: tokens.colors.text,
                    marginBottom: '6px',
                  }}>
                    {repo.fullName}
                  </div>
                  <div style={{ display: 'flex', gap: '12px', fontSize: '11px', color: tokens.colors.textDim }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                      </svg>
                      {repo.stars.toLocaleString()}
                    </span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="12" cy="18" r="3" />
                        <circle cx="6" cy="6" r="3" />
                        <circle cx="18" cy="6" r="3" />
                        <path d="M18 9v1a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V9" />
                        <line x1="12" y1="12" x2="12" y2="15" />
                      </svg>
                      {repo.forks.toLocaleString()}
                    </span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="12" cy="12" r="10" />
                        <line x1="12" y1="8" x2="12" y2="12" />
                        <line x1="12" y1="16" x2="12.01" y2="16" />
                      </svg>
                      {repo.openIssues.toLocaleString()}
                    </span>
                  </div>
                </div>
              ))
            )}
          </>
        )}
      </div>

      {onViewAll && (
        <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: `1px solid ${tokens.colors.border}` }}>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onViewAll();
            }}
            style={{
              background: 'none',
              border: 'none',
              color: tokens.colors.accent,
              fontSize: '13px',
              cursor: 'pointer',
              fontFamily: 'inherit',
              padding: 0,
            }}
          >
            View on GitHub
          </button>
        </div>
      )}
    </div>
  );
}
