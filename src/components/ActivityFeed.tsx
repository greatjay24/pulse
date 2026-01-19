import React from 'react';
import { useTheme } from '../contexts/ThemeContext';
import { StripeEvent, ActivityEvent, ActivityType, Deployment } from '../types';

interface ActivityFeedProps {
  events?: StripeEvent[];
  activityEvents?: ActivityEvent[];
  deployments?: Deployment[];
  isLoading?: boolean;
  onViewAll?: () => void;
}

// Color mappings for activity types
const typeColors: Record<string, { bg: string; text: string }> = {
  payment: { bg: 'rgba(34, 197, 94, 0.15)', text: '#22c55e' },
  payment_failed: { bg: 'rgba(239, 68, 68, 0.15)', text: '#ef4444' },
  subscription_created: { bg: 'rgba(99, 102, 241, 0.15)', text: '#6366f1' },
  subscription_cancelled: { bg: 'rgba(245, 158, 11, 0.15)', text: '#f59e0b' },
  subscription_upgraded: { bg: 'rgba(34, 197, 94, 0.15)', text: '#22c55e' },
  subscription_downgraded: { bg: 'rgba(245, 158, 11, 0.15)', text: '#f59e0b' },
  refund: { bg: 'rgba(249, 115, 22, 0.15)', text: '#f97316' },
  payout: { bg: 'rgba(6, 182, 212, 0.15)', text: '#06b6d4' },
  user_signup: { bg: 'rgba(59, 130, 246, 0.15)', text: '#3b82f6' },
  user_deleted: { bg: 'rgba(239, 68, 68, 0.15)', text: '#ef4444' },
  deployment_success: { bg: 'rgba(34, 197, 94, 0.15)', text: '#22c55e' },
  deployment_failed: { bg: 'rgba(239, 68, 68, 0.15)', text: '#ef4444' },
  milestone_mrr: { bg: 'rgba(234, 179, 8, 0.15)', text: '#eab308' },
  milestone_users: { bg: 'rgba(168, 85, 247, 0.15)', text: '#a855f7' },
  milestone_subscribers: { bg: 'rgba(236, 72, 153, 0.15)', text: '#ec4899' },
  default: { bg: 'rgba(107, 114, 128, 0.15)', text: '#6b7280' },
};

// Icons for each activity type
const TypeIcons: Record<string, React.ReactNode> = {
  payment: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
      <path d="M13.976 9.15c-2.172-.806-3.356-1.426-3.356-2.409 0-.831.683-1.305 1.901-1.305 2.227 0 4.515.858 6.09 1.631l.89-5.494C18.252.975 15.697 0 12.165 0 9.667 0 7.589.654 6.104 1.872 4.56 3.147 3.757 4.992 3.757 7.218c0 4.039 2.467 5.76 6.476 7.219 2.585.92 3.445 1.574 3.445 2.583 0 .98-.84 1.545-2.354 1.545-1.875 0-4.965-.921-6.99-2.109l-.9 5.555C5.175 22.99 8.385 24 11.714 24c2.641 0 4.843-.624 6.328-1.813 1.664-1.305 2.525-3.236 2.525-5.732 0-4.128-2.524-5.851-6.591-7.305z"/>
    </svg>
  ),
  payment_failed: (
    <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  ),
  subscription_created: (
    <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <line x1="19" y1="8" x2="19" y2="14" />
      <line x1="22" y1="11" x2="16" y2="11" />
    </svg>
  ),
  subscription_cancelled: (
    <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <line x1="17" y1="11" x2="22" y2="11" />
    </svg>
  ),
  refund: (
    <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
    </svg>
  ),
  payout: (
    <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" />
    </svg>
  ),
  user_signup: (
    <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
    </svg>
  ),
  user_deleted: (
    <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <line x1="17" y1="11" x2="22" y2="11" />
    </svg>
  ),
  deployment_success: (
    <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="16 16 12 12 8 16" />
      <line x1="12" y1="12" x2="12" y2="21" />
      <path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3" />
    </svg>
  ),
  deployment_failed: (
    <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <line x1="15" y1="9" x2="9" y2="15" />
      <line x1="9" y1="9" x2="15" y2="15" />
    </svg>
  ),
  milestone_mrr: (
    <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
    </svg>
  ),
  milestone_users: (
    <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
    </svg>
  ),
  milestone_subscribers: (
    <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z" />
    </svg>
  ),
  default: (
    <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  ),
};

// Auth provider icons
const ProviderIcons: Record<string, React.ReactNode> = {
  google: (
    <svg width="12" height="12" viewBox="0 0 24 24">
      <path fill="#4285f4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
      <path fill="#34a853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
      <path fill="#fbbc05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
      <path fill="#ea4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
    </svg>
  ),
  github: (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/>
    </svg>
  ),
  apple: (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
      <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"/>
    </svg>
  ),
  email: <span style={{ fontSize: '10px', fontWeight: 600 }}>@</span>,
};

function formatEventTime(timestamp: number): string {
  const date = new Date(timestamp * 1000);
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

function formatAmount(amount: number): string {
  const value = amount / 100;
  return `$${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// Convert Stripe events to unified format
function convertStripeEvent(event: StripeEvent): ActivityEvent {
  let type: ActivityType = 'payment';
  let isPositive = true;

  switch (event.type) {
    case 'invoice.paid':
    case 'charge.succeeded':
      type = 'payment';
      isPositive = true;
      break;
    case 'invoice.payment_failed':
    case 'charge.failed':
      type = 'payment_failed';
      isPositive = false;
      break;
    case 'customer.subscription.created':
    case 'subscription.created':
      type = 'subscription_created';
      isPositive = true;
      break;
    case 'customer.subscription.deleted':
    case 'subscription.deleted':
      type = 'subscription_cancelled';
      isPositive = false;
      break;
    case 'payout.paid':
      type = 'payout';
      isPositive = true;
      break;
  }

  return {
    id: event.id,
    source: 'stripe',
    type,
    timestamp: event.created,
    title: event.description,
    amount: event.amount,
    currency: event.currency,
    email: event.customerEmail,
    planName: event.planName,
    isPositive,
  };
}

// Convert Vercel deployment to activity event
function convertDeployment(deployment: Deployment): ActivityEvent {
  const isSuccess = deployment.state === 'READY';
  return {
    id: deployment.id,
    source: 'vercel',
    type: isSuccess ? 'deployment_success' : 'deployment_failed',
    timestamp: Math.floor(new Date(deployment.createdAt).getTime() / 1000),
    title: isSuccess ? 'Deployment successful' : 'Deployment failed',
    description: deployment.name,
    deploymentUrl: deployment.url,
    isPositive: isSuccess,
  };
}

export function ActivityFeed({ events = [], activityEvents = [], deployments = [], isLoading = false, onViewAll }: ActivityFeedProps) {
  const { tokens } = useTheme();

  // Combine all events into unified format
  const allEvents: ActivityEvent[] = [
    ...activityEvents,
    ...events.map(convertStripeEvent),
    ...deployments.slice(0, 5).map(convertDeployment),
  ].sort((a, b) => b.timestamp - a.timestamp);

  const displayEvents = allEvents.slice(0, 6);
  const hasMore = allEvents.length > 6;

  const containerStyle: React.CSSProperties = {
    background: tokens.colors.bgCard,
    border: `1px solid ${tokens.colors.border}`,
    borderRadius: tokens.radius.lg,
    padding: '20px',
    backdropFilter: 'blur(20px)',
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    cursor: onViewAll ? 'pointer' : 'default',
    transition: 'all 0.2s ease',
  };

  if (isLoading) {
    return (
      <div style={containerStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <span style={{ fontWeight: 500, fontSize: '14px', color: tokens.colors.text }}>Recent Activity</span>
        </div>
        <div style={{ flex: 1 }}>
          {[1, 2, 3, 4].map((i) => (
            <div key={i} style={{ display: 'flex', gap: '12px', padding: '12px 0', borderBottom: `1px solid ${tokens.colors.border}` }}>
              <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: tokens.colors.bgCardHover }} />
              <div style={{ flex: 1 }}>
                <div style={{ height: '14px', width: '120px', background: tokens.colors.bgCardHover, borderRadius: '4px', marginBottom: '8px' }} />
                <div style={{ height: '12px', width: '180px', background: tokens.colors.bgCardHover, borderRadius: '4px', opacity: 0.5 }} />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (allEvents.length === 0) {
    return (
      <div
        style={containerStyle}
        onClick={onViewAll}
        onMouseEnter={(e) => {
          if (onViewAll) {
            e.currentTarget.style.background = tokens.colors.bgCardHover;
            e.currentTarget.style.borderColor = tokens.colors.borderHover;
          }
        }}
        onMouseLeave={(e) => {
          if (onViewAll) {
            e.currentTarget.style.background = tokens.colors.bgCard;
            e.currentTarget.style.borderColor = tokens.colors.border;
          }
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <span style={{ fontWeight: 500, fontSize: '14px', color: tokens.colors.text }}>Recent Activity</span>
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
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={tokens.colors.textDim} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
              <path d="M13.73 21a2 2 0 0 1-3.46 0" />
            </svg>
          </div>
          <p style={{ fontSize: '13px', color: tokens.colors.textMuted, marginBottom: '4px' }}>No recent activity</p>
          <p style={{ fontSize: '12px', color: tokens.colors.textDim }}>Events will appear here</p>
        </div>
      </div>
    );
  }

  return (
    <div
      style={containerStyle}
      onClick={onViewAll}
      onMouseEnter={(e) => {
        if (onViewAll) {
          e.currentTarget.style.background = tokens.colors.bgCardHover;
          e.currentTarget.style.borderColor = tokens.colors.borderHover;
        }
      }}
      onMouseLeave={(e) => {
        if (onViewAll) {
          e.currentTarget.style.background = tokens.colors.bgCard;
          e.currentTarget.style.borderColor = tokens.colors.border;
        }
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <span style={{ fontWeight: 500, fontSize: '14px', color: tokens.colors.text }}>Recent Activity</span>
        <span style={{ fontSize: '12px', color: tokens.colors.textDim }}>{allEvents.length} events</span>
      </div>

      <div style={{ flex: 1, overflow: 'auto' }}>
        {displayEvents.map((event, index) => {
          const colors = typeColors[event.type] || typeColors.default;
          const icon = TypeIcons[event.type] || TypeIcons.default;

          return (
            <div
              key={event.id}
              style={{
                display: 'flex',
                gap: '12px',
                padding: '12px 0',
                borderBottom: index < displayEvents.length - 1 ? `1px solid ${tokens.colors.border}` : undefined,
              }}
            >
              <div
                style={{
                  width: '32px',
                  height: '32px',
                  borderRadius: '8px',
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
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px' }}>
                  <div style={{ color: tokens.colors.text, fontSize: '13px', lineHeight: 1.4, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {event.title}
                  </div>
                  <span style={{ fontSize: '11px', color: tokens.colors.textDim, whiteSpace: 'nowrap' }}>
                    {formatEventTime(event.timestamp)}
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '4px' }}>
                  {event.amount && (
                    <span style={{ fontSize: '13px', fontWeight: 500, color: event.isPositive !== false ? '#22c55e' : '#ef4444' }}>
                      {event.isPositive !== false ? '+' : '-'}{formatAmount(event.amount)}
                    </span>
                  )}
                  {event.type === 'user_signup' && event.authProvider && (
                    <span style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px', color: tokens.colors.textDim }}>
                      {ProviderIcons[event.authProvider]}
                      <span style={{ textTransform: 'capitalize' }}>{event.authProvider}</span>
                    </span>
                  )}
                  {event.description && event.source === 'vercel' && (
                    <span style={{ fontSize: '11px', color: tokens.colors.textDim, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {event.description}
                    </span>
                  )}
                  {event.planName && (
                    <span style={{ fontSize: '11px', color: tokens.colors.textDim }}>
                      {event.planName}
                    </span>
                  )}
                  {event.milestoneValue !== undefined && (
                    <span style={{ fontSize: '13px', color: '#eab308', fontWeight: 500 }}>
                      {event.type === 'milestone_mrr' ? `$${event.milestoneValue.toLocaleString()} MRR` :
                       event.type === 'milestone_users' ? `${event.milestoneValue.toLocaleString()} users` :
                       `${event.milestoneValue.toLocaleString()} subscribers`}
                    </span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {hasMore && onViewAll && (
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
            View all {allEvents.length} events
          </button>
        </div>
      )}
    </div>
  );
}
