import { CSSProperties } from 'react';
import { useTheme } from '../contexts/ThemeContext';
import { GmailMessage, GmailLabel } from '../types';

interface GmailInboxWidgetProps {
  messages: GmailMessage[];
  unreadCount: number;
  isLoading?: boolean;
  onViewAll?: () => void;
}

function formatEmailTime(timestamp: number): string {
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

function getInitials(name: string | undefined, email: string): string {
  if (name) {
    const parts = name.split(' ');
    if (parts.length >= 2) {
      return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
    }
    return name.substring(0, 2).toUpperCase();
  }
  return email.substring(0, 2).toUpperCase();
}

// Gmail label colors - map Gmail's background colors to our display colors
function getLabelColor(label: GmailLabel): { bg: string; text: string } {
  // System labels get predefined colors
  if (label.type === 'system') {
    switch (label.name) {
      case 'IMPORTANT':
        return { bg: 'rgba(234, 179, 8, 0.15)', text: '#eab308' };
      case 'STARRED':
        return { bg: 'rgba(234, 179, 8, 0.2)', text: '#eab308' };
      case 'CATEGORY_PERSONAL':
        return { bg: 'rgba(59, 130, 246, 0.15)', text: '#3b82f6' };
      case 'CATEGORY_SOCIAL':
        return { bg: 'rgba(239, 68, 68, 0.15)', text: '#ef4444' };
      case 'CATEGORY_PROMOTIONS':
        return { bg: 'rgba(34, 197, 94, 0.15)', text: '#22c55e' };
      case 'CATEGORY_UPDATES':
        return { bg: 'rgba(168, 85, 247, 0.15)', text: '#a855f7' };
      case 'CATEGORY_FORUMS':
        return { bg: 'rgba(6, 182, 212, 0.15)', text: '#06b6d4' };
      default:
        return { bg: 'rgba(107, 114, 128, 0.15)', text: '#6b7280' };
    }
  }

  // User labels - use Gmail's color if available, otherwise default
  if (label.color) {
    return { bg: `${label.color}20`, text: label.color };
  }

  return { bg: 'rgba(99, 102, 241, 0.15)', text: '#6366f1' };
}

// Filter out system labels that aren't useful to display
function getDisplayLabels(labels: GmailLabel[]): GmailLabel[] {
  const hiddenLabels = ['INBOX', 'UNREAD', 'SENT', 'DRAFT', 'SPAM', 'TRASH', 'CHAT', 'CATEGORY_PERSONAL'];
  return labels.filter(l => !hiddenLabels.includes(l.id || l.name));
}

const DISPLAY_COUNT = 4;

export function GmailInboxWidget({ messages = [], unreadCount = 0, isLoading = false, onViewAll }: GmailInboxWidgetProps) {
  const { tokens } = useTheme();

  const displayCount = DISPLAY_COUNT;
  const hasMore = messages.length > DISPLAY_COUNT;

  const containerStyle: CSSProperties = {
    background: 'transparent',
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    padding: '16px',
  };

  if (isLoading) {
    return (
      <div style={containerStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={tokens.colors.text} strokeWidth="2">
              <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
              <polyline points="22,6 12,13 2,6" />
            </svg>
            <span style={{ fontWeight: 500, fontSize: '14px', color: tokens.colors.text }}>Gmail</span>
          </div>
        </div>
        <div>
          {[1, 2, 3].map((i) => (
            <div key={i} style={{ display: 'flex', gap: '10px', padding: '10px 0', borderBottom: i < 3 ? `1px solid ${tokens.colors.border}` : undefined }}>
              <div style={{ width: '32px', height: '32px', borderRadius: '50%', background: tokens.colors.bgCardHover }} />
              <div style={{ flex: 1 }}>
                <div style={{ height: '12px', width: '120px', background: tokens.colors.bgCardHover, borderRadius: '4px', marginBottom: '6px' }} />
                <div style={{ height: '10px', width: '180px', background: tokens.colors.bgCardHover, borderRadius: '4px', opacity: 0.5 }} />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (messages.length === 0) {
    return (
      <div style={containerStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={tokens.colors.text} strokeWidth="2">
              <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
              <polyline points="22,6 12,13 2,6" />
            </svg>
            <span style={{ fontWeight: 500, fontSize: '14px', color: tokens.colors.text }}>Gmail</span>
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: '20px 0' }}>
          <div style={{
            width: '40px',
            height: '40px',
            borderRadius: '10px',
            background: tokens.colors.bgCardHover,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: '10px',
          }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={tokens.colors.textDim} strokeWidth="1.5">
              <path d="M22 12h-6l-2 3h-4l-2-3H2" />
              <path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
            </svg>
          </div>
          <p style={{ fontSize: '12px', color: tokens.colors.textMuted, margin: 0 }}>Inbox Zero!</p>
        </div>
      </div>
    );
  }

  return (
    <div style={containerStyle}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={tokens.colors.text} strokeWidth="2">
            <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
            <polyline points="22,6 12,13 2,6" />
          </svg>
          <span style={{ fontWeight: 500, fontSize: '14px', color: tokens.colors.text }}>Gmail</span>
        </div>
        {unreadCount > 0 && (
          <span style={{
            fontSize: '10px',
            fontWeight: 600,
            color: '#ef4444',
            background: 'rgba(239, 68, 68, 0.15)',
            padding: '2px 6px',
            borderRadius: '8px',
          }}>
            {unreadCount} unread
          </span>
        )}
      </div>

      {/* Email List */}
      <div>
        {messages.slice(0, displayCount).map((message, index) => {
          const displayLabels = getDisplayLabels(message.labels || []);

          return (
            <div
              key={message.id}
              style={{
                display: 'flex',
                gap: '10px',
                padding: '10px 0',
                borderBottom: index < displayCount - 1 ? `1px solid ${tokens.colors.border}` : undefined,
              }}
            >
              {/* Avatar */}
              <div
                style={{
                  width: '32px',
                  height: '32px',
                  borderRadius: '50%',
                  background: message.isUnread
                    ? 'linear-gradient(135deg, #6366f1, #8b5cf6)'
                    : tokens.colors.bgCardHover,
                  color: message.isUnread ? '#fff' : tokens.colors.textMuted,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                  fontSize: '11px',
                  fontWeight: 600,
                }}
              >
                {getInitials(message.fromName, message.from)}
              </div>

              <div style={{ flex: 1, minWidth: 0 }}>
                {/* Header: Sender and time */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px' }}>
                  <span style={{
                    fontSize: '12px',
                    fontWeight: message.isUnread ? 600 : 400,
                    color: tokens.colors.text,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}>
                    {message.fromName || message.from.split('@')[0]}
                  </span>
                  <span style={{ fontSize: '10px', color: tokens.colors.textDim, whiteSpace: 'nowrap' }}>
                    {formatEmailTime(message.date)}
                  </span>
                </div>

                {/* Subject */}
                <div style={{
                  fontSize: '11px',
                  fontWeight: message.isUnread ? 500 : 400,
                  color: message.isUnread ? tokens.colors.text : tokens.colors.textMuted,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  marginTop: '2px',
                }}>
                  {message.subject || '(no subject)'}
                </div>

                {/* Labels - only show first 2 in compact mode */}
                {displayLabels.length > 0 && (
                  <div style={{ display: 'flex', gap: '3px', marginTop: '4px', flexWrap: 'wrap' }}>
                    {displayLabels.slice(0, 2).map((label) => {
                      const colors = getLabelColor(label);
                      const displayName = label.name.replace('CATEGORY_', '').toLowerCase();
                      return (
                        <span
                          key={label.id || label.name}
                          style={{
                            fontSize: '9px',
                            fontWeight: 500,
                            color: colors.text,
                            background: colors.bg,
                            padding: '1px 5px',
                            borderRadius: '3px',
                            textTransform: 'capitalize',
                          }}
                        >
                          {displayName}
                        </span>
                      );
                    })}
                    {displayLabels.length > 2 && (
                      <span style={{ fontSize: '9px', color: tokens.colors.textDim }}>
                        +{displayLabels.length - 2}
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* View All Button */}
      {hasMore && onViewAll && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onViewAll();
          }}
          style={{
            background: 'none',
            border: 'none',
            color: tokens.colors.accent,
            fontSize: '12px',
            cursor: 'pointer',
            fontFamily: 'inherit',
            padding: '8px 0 0 0',
            marginTop: 'auto',
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
          }}
        >
          <svg width="12" height="12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
          </svg>
          View all ({messages.length})
        </button>
      )}
    </div>
  );
}
