import { useTheme } from '../contexts/ThemeContext';
import { StripeEvent, Deployment } from '../types';

// Legacy interface for backward compatibility
interface ActivityItemProps {
  type: 'signup' | 'payment' | 'milestone' | 'alert' | 'subscription' | 'churn' | 'deployment';
  message: string;
  time: string;
  project?: string;
  amount?: string;
  isPositive?: boolean;
  provider?: string;
}

// Icon colors by activity type
const typeColors: Record<string, { bg: string; text: string }> = {
  signup: { bg: 'rgba(59, 130, 246, 0.15)', text: '#3b82f6' },
  payment: { bg: 'rgba(34, 197, 94, 0.15)', text: '#22c55e' },
  milestone: { bg: 'rgba(234, 179, 8, 0.15)', text: '#eab308' },
  alert: { bg: 'rgba(239, 68, 68, 0.15)', text: '#ef4444' },
  subscription: { bg: 'rgba(99, 102, 241, 0.15)', text: '#6366f1' },
  churn: { bg: 'rgba(251, 146, 60, 0.15)', text: '#fb923c' },
  deployment: { bg: 'rgba(34, 197, 94, 0.15)', text: '#22c55e' },
  deployment_failed: { bg: 'rgba(239, 68, 68, 0.15)', text: '#ef4444' },
  user_deleted: { bg: 'rgba(239, 68, 68, 0.15)', text: '#ef4444' },
};

// SVG icons for each type
const TypeIcons: Record<string, React.ReactNode> = {
  signup: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <line x1="19" y1="8" x2="19" y2="14" />
      <line x1="22" y1="11" x2="16" y2="11" />
    </svg>
  ),
  payment: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
      <path d="M13.976 9.15c-2.172-.806-3.356-1.426-3.356-2.409 0-.831.683-1.305 1.901-1.305 2.227 0 4.515.858 6.09 1.631l.89-5.494C18.252.975 15.697 0 12.165 0 9.667 0 7.589.654 6.104 1.872 4.56 3.147 3.757 4.992 3.757 7.218c0 4.039 2.467 5.76 6.476 7.219 2.585.92 3.445 1.574 3.445 2.583 0 .98-.84 1.545-2.354 1.545-1.875 0-4.965-.921-6.99-2.109l-.9 5.555C5.175 22.99 8.385 24 11.714 24c2.641 0 4.843-.624 6.328-1.813 1.664-1.305 2.525-3.236 2.525-5.732 0-4.128-2.524-5.851-6.591-7.305z"/>
    </svg>
  ),
  milestone: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2L2 7l10 5 10-5-10-5Z" />
      <path d="M2 17l10 5 10-5" />
      <path d="M2 12l10 5 10-5" />
    </svg>
  ),
  alert: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  ),
  subscription: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  ),
  churn: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <line x1="17" y1="11" x2="22" y2="11" />
    </svg>
  ),
  deployment: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="16 16 12 12 8 16" />
      <line x1="12" y1="12" x2="12" y2="21" />
      <path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3" />
    </svg>
  ),
  deployment_failed: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <line x1="15" y1="9" x2="9" y2="15" />
      <line x1="9" y1="9" x2="15" y2="15" />
    </svg>
  ),
  user_deleted: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <line x1="17" y1="11" x2="22" y2="11" />
    </svg>
  ),
};

// Auth provider mini icons
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

export function ActivityItem({ type, message, time, project, amount, isPositive, provider }: ActivityItemProps) {
  const { tokens } = useTheme();
  const colors = typeColors[type] || typeColors.signup;
  const icon = TypeIcons[type] || TypeIcons.signup;

  return (
    <div
      style={{
        display: 'flex',
        gap: '12px',
        padding: '12px 0',
        borderBottom: `1px solid ${tokens.colors.border}`,
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
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            gap: '8px',
          }}
        >
          <div
            style={{
              color: tokens.colors.text,
              fontSize: '13px',
              lineHeight: 1.4,
              flex: 1,
            }}
          >
            {message}
          </div>
          <span
            style={{
              fontSize: '11px',
              color: tokens.colors.textDim,
              whiteSpace: 'nowrap',
            }}
          >
            {time}
          </span>
        </div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            marginTop: '4px',
          }}
        >
          {amount && (
            <span
              style={{
                fontSize: '13px',
                fontWeight: 500,
                color: isPositive !== false ? '#22c55e' : '#ef4444',
              }}
            >
              {isPositive !== false ? '+' : '-'}{amount}
            </span>
          )}
          {provider && (
            <span
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                fontSize: '11px',
                color: tokens.colors.textDim,
              }}
            >
              {ProviderIcons[provider.toLowerCase()]}
              <span style={{ textTransform: 'capitalize' }}>{provider}</span>
            </span>
          )}
          {project && (
            <span style={{ fontSize: '11px', color: tokens.colors.textDim }}>
              {project}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

// Activity Feed container component
interface ActivityFeedProps {
  activities: ActivityItemProps[];
  onViewAll?: () => void;
}

export function ActivityFeedCard({ activities, onViewAll }: ActivityFeedProps) {
  const { tokens } = useTheme();

  return (
    <div
      onClick={onViewAll}
      style={{
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
      }}
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
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '16px',
        }}
      >
        <span style={{ fontWeight: 500, fontSize: '14px', color: tokens.colors.text }}>
          Recent Activity
        </span>
        {activities.length > 0 && (
          <span style={{ fontSize: '12px', color: tokens.colors.textDim }}>
            {activities.length} events
          </span>
        )}
      </div>

      <div style={{ flex: 1, overflow: 'auto' }}>
        {activities.length === 0 ? (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              height: '100%',
              textAlign: 'center',
              padding: '20px',
            }}
          >
            <div
              style={{
                width: '48px',
                height: '48px',
                borderRadius: '12px',
                background: tokens.colors.bgCardHover,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: '12px',
              }}
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={tokens.colors.textDim} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                <path d="M13.73 21a2 2 0 0 1-3.46 0" />
              </svg>
            </div>
            <p style={{ fontSize: '13px', color: tokens.colors.textMuted, marginBottom: '4px' }}>
              No recent activity
            </p>
            <p style={{ fontSize: '12px', color: tokens.colors.textDim }}>
              Events will appear here
            </p>
          </div>
        ) : (
          activities.slice(0, 6).map((activity, i) => (
            <ActivityItem key={i} {...activity} />
          ))
        )}
      </div>

      {activities.length > 6 && onViewAll && (
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
            View all {activities.length} events
          </button>
        </div>
      )}
    </div>
  );
}

// Helper to convert Stripe events to activity items
export function stripeEventToActivity(event: StripeEvent): ActivityItemProps {
  let type: ActivityItemProps['type'] = 'payment';
  let message = event.description;
  let isPositive = true;

  switch (event.type) {
    case 'invoice.paid':
    case 'charge.succeeded':
      type = 'payment';
      isPositive = true;
      break;
    case 'invoice.payment_failed':
    case 'charge.failed':
      type = 'alert';
      isPositive = false;
      break;
    case 'customer.subscription.created':
    case 'subscription.created':
      type = 'subscription';
      isPositive = true;
      break;
    case 'customer.subscription.deleted':
    case 'subscription.deleted':
      type = 'churn';
      isPositive = false;
      break;
  }

  const time = formatRelativeTime(event.created);
  const amount = event.amount ? `$${(event.amount / 100).toFixed(2)}` : undefined;

  return { type, message, time, amount, isPositive };
}

// Helper to convert Vercel deployments to activity items
export function deploymentToActivity(deployment: Deployment): ActivityItemProps {
  const isSuccess = deployment.state === 'READY';
  return {
    type: isSuccess ? 'deployment' : 'deployment' as any,
    message: isSuccess ? 'Deployment successful' : 'Deployment failed',
    time: formatRelativeTime(Math.floor(new Date(deployment.createdAt).getTime() / 1000)),
    project: deployment.name,
    isPositive: isSuccess,
  };
}

// Format relative time from unix timestamp
function formatRelativeTime(timestamp: number): string {
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
