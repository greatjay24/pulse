import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTheme } from '../../contexts/ThemeContext';
import { DetailPanelType, AppMetrics, StripeMetricsExtended, MetricSnapshot, GmailMessage, GmailLabel, GitHubMetrics } from '../../types';
import { MetricHistory } from './MetricHistory';
import { RevenueBreakdown } from './RevenueBreakdown';
import { MrrBridge } from './MrrBridge';
import { CardRect } from '../StatCard';
import { Icon, CloseIcon, DownloadIcon } from '../Icons';

interface DetailPanelProps {
  isOpen: boolean;
  type: DetailPanelType;
  metrics: AppMetrics | null;
  historicalData?: MetricSnapshot[];
  onClose: () => void;
  originRect?: CardRect | null;
  // Additional data for Gmail and GitHub panels
  gmailMessages?: GmailMessage[];
  gmailUnreadCount?: number;
  githubMetrics?: GitHubMetrics;
}

const panelTitles: Record<Exclude<DetailPanelType, null>, string> = {
  mrr: 'Monthly Recurring Revenue',
  subscribers: 'Subscriber Analytics',
  churn: 'Churn Analysis',
  growth: 'Growth Metrics',
  'revenue-breakdown': 'Revenue by Plan',
  'stripe-events': 'Recent Activity',
  calendar: 'Calendar Events',
  gmail: 'Gmail Inbox',
  github: 'GitHub Activity',
};

const panelIcons: Record<Exclude<DetailPanelType, null>, string> = {
  mrr: 'revenue',
  subscribers: 'users',
  churn: 'churn',
  growth: 'trending-up',
  'revenue-breakdown': 'analytics',
  'stripe-events': 'activity',
  calendar: 'calendar',
  gmail: 'mail',
  github: 'github',
};

export function DetailPanel({ isOpen, type, metrics, historicalData, onClose, originRect, gmailMessages, gmailUnreadCount, githubMetrics }: DetailPanelProps) {
  const { tokens } = useTheme();

  if (!type) return null;

  const stripeMetrics = metrics?.stripe as StripeMetricsExtended | undefined;

  // Calculate the modal's final dimensions
  const modalWidth = Math.min(700, window.innerWidth * 0.9);
  const modalHeight = Math.min(window.innerHeight * 0.85, 600);

  // Calculate center position
  const centerX = window.innerWidth / 2;
  const centerY = window.innerHeight / 2;

  // Calculate origin position (center of the card)
  const originX = originRect ? originRect.x + originRect.width / 2 : centerX;
  const originY = originRect ? originRect.y + originRect.height / 2 : centerY;

  // Scale factor from card to modal
  const scaleX = originRect ? originRect.width / modalWidth : 0.8;
  const scaleY = originRect ? originRect.height / modalHeight : 0.8;

  const renderContent = () => {
    switch (type) {
      case 'mrr':
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
              <MetricBox
                label="Current MRR"
                value={`$${(stripeMetrics?.mrr || 0).toLocaleString()}`}
                subtext="Monthly recurring revenue"
                tokens={tokens}
              />
              <MetricBox
                label="ARR"
                value={`$${(stripeMetrics?.arr || 0).toLocaleString()}`}
                subtext="Annual recurring revenue"
                tokens={tokens}
              />
              <MetricBox
                label="Net New MRR"
                value={`$${(stripeMetrics?.netNewMrr || 0).toLocaleString()}`}
                subtext="This month"
                highlight={stripeMetrics?.netNewMrr ? stripeMetrics.netNewMrr > 0 : false}
                tokens={tokens}
              />
              <MetricBox
                label="Growth Rate"
                value={`${(stripeMetrics?.revenueGrowthRate || 0).toFixed(1)}%`}
                subtext="Month over month"
                tokens={tokens}
              />
            </div>
            <MetricHistory
              title="Revenue Trend"
              data={historicalData}
              dailyRevenue={stripeMetrics?.dailyRevenue}
              dataKey="stripe.mrr"
              color="#818cf8"
            />
            {stripeMetrics?.mrrBridge && (
              <MrrBridge bridge={stripeMetrics.mrrBridge} />
            )}
          </div>
        );

      case 'subscribers':
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
              <MetricBox
                label="Active Subscribers"
                value={(stripeMetrics?.activeSubscriptions || 0).toLocaleString()}
                subtext="Current total"
                tokens={tokens}
              />
              <MetricBox
                label="New (30d)"
                value={`+${(stripeMetrics?.newSubscribers30d || 0).toLocaleString()}`}
                subtext="New subscriptions"
                highlight
                tokens={tokens}
              />
              <MetricBox
                label="Churned (30d)"
                value={`-${(stripeMetrics?.churnedSubscribers30d || 0).toLocaleString()}`}
                subtext="Lost subscriptions"
                negative
                tokens={tokens}
              />
              <MetricBox
                label="ARPU"
                value={`$${(stripeMetrics?.arpu || 0).toFixed(2)}`}
                subtext="Avg revenue per user"
                tokens={tokens}
              />
            </div>
            <MetricHistory
              title="Subscriber Growth"
              data={historicalData}
              dataKey="stripe.activeSubscriptions"
              color="#34d399"
            />
          </div>
        );

      case 'churn':
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
              <MetricBox
                label="Churn Rate"
                value={`${(stripeMetrics?.churnRate || 0).toFixed(1)}%`}
                subtext="Monthly"
                negative={stripeMetrics?.churnRate ? stripeMetrics.churnRate > 5 : false}
                tokens={tokens}
              />
              <MetricBox
                label="Churned MRR"
                value={`$${(stripeMetrics?.churnedMrr || 0).toLocaleString()}`}
                subtext="Lost revenue (30d)"
                negative
                tokens={tokens}
              />
              <MetricBox
                label="LTV Estimate"
                value={`$${(stripeMetrics?.ltvEstimate || 0).toLocaleString()}`}
                subtext="Customer lifetime value"
                tokens={tokens}
              />
              <MetricBox
                label="Trial Conversion"
                value={`${(stripeMetrics?.trialConversionRate || 0).toFixed(1)}%`}
                subtext="Trial to paid"
                tokens={tokens}
              />
            </div>
            <MetricHistory
              title="Churn Rate Trend"
              data={historicalData}
              dataKey="stripe.churnRate"
              color="#f87171"
            />
          </div>
        );

      case 'growth':
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
              <MetricBox
                label="New MRR"
                value={`$${(stripeMetrics?.newMrr || 0).toLocaleString()}`}
                subtext="From new customers"
                highlight
                tokens={tokens}
              />
              <MetricBox
                label="Expansion MRR"
                value={`$${(stripeMetrics?.expansionMrr || 0).toLocaleString()}`}
                subtext="Upgrades"
                highlight
                tokens={tokens}
              />
              <MetricBox
                label="Revenue Growth"
                value={`${(stripeMetrics?.revenueGrowthRate || 0).toFixed(1)}%`}
                subtext="Month over month"
                tokens={tokens}
              />
              <MetricBox
                label="Net New MRR"
                value={`$${(stripeMetrics?.netNewMrr || 0).toLocaleString()}`}
                subtext="Total growth"
                highlight={stripeMetrics?.netNewMrr ? stripeMetrics.netNewMrr > 0 : false}
                tokens={tokens}
              />
            </div>
          </div>
        );

      case 'revenue-breakdown':
        return (
          <RevenueBreakdown
            plans={stripeMetrics?.revenueByPlan || []}
            totalMrr={stripeMetrics?.mrr || 0}
          />
        );

      case 'stripe-events':
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {metrics?.stripeEvents?.length ? (
              metrics.stripeEvents.map((event) => (
                <div
                  key={event.id}
                  style={{
                    padding: '16px',
                    background: tokens.colors.bgCard,
                    borderRadius: tokens.radius.md,
                    border: `1px solid ${tokens.colors.border}`,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                    <span style={{ fontSize: '14px', fontWeight: 500, color: tokens.colors.text }}>{formatEventType(event.type)}</span>
                    <span style={{ fontSize: '12px', color: tokens.colors.textMuted }}>
                      {formatEventTime(event.created)}
                    </span>
                  </div>
                  <p style={{ fontSize: '13px', color: tokens.colors.textMuted }}>{event.description}</p>
                  {event.amount && (
                    <p style={{ fontSize: '13px', color: tokens.colors.success, marginTop: '8px' }}>
                      ${(event.amount / 100).toFixed(2)} {event.currency?.toUpperCase()}
                    </p>
                  )}
                </div>
              ))
            ) : (
              <div style={{ textAlign: 'center', padding: '32px', color: tokens.colors.textMuted }}>
                No recent events
              </div>
            )}
          </div>
        );

      case 'calendar':
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {metrics?.calendarEvents?.length ? (
              metrics.calendarEvents.map((event) => (
                <div
                  key={event.id}
                  style={{
                    padding: '16px',
                    background: tokens.colors.bgCard,
                    borderRadius: tokens.radius.md,
                    border: `1px solid ${tokens.colors.border}`,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                    <span style={{ fontSize: '14px', fontWeight: 500, color: tokens.colors.text }}>{event.title}</span>
                    <span
                      style={{
                        fontSize: '11px',
                        padding: '4px 8px',
                        borderRadius: '12px',
                        background: `${event.color || '#6366f1'}20`,
                        color: event.color || '#6366f1',
                      }}
                    >
                      {event.source}
                    </span>
                  </div>
                  <p style={{ fontSize: '12px', color: tokens.colors.textMuted }}>
                    {new Date(event.startTime).toLocaleString()}
                  </p>
                </div>
              ))
            ) : (
              <div style={{ textAlign: 'center', padding: '32px', color: tokens.colors.textMuted }}>
                No upcoming events
              </div>
            )}
          </div>
        );

      case 'gmail':
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {/* Summary */}
            {gmailUnreadCount !== undefined && gmailUnreadCount > 0 && (
              <div style={{
                padding: '16px',
                background: 'rgba(239, 68, 68, 0.1)',
                borderRadius: tokens.radius.md,
                border: '1px solid rgba(239, 68, 68, 0.2)',
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
              }}>
                <div style={{
                  width: '40px',
                  height: '40px',
                  borderRadius: '50%',
                  background: '#ef4444',
                  color: '#fff',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontWeight: 600,
                  fontSize: '14px',
                }}>
                  {gmailUnreadCount}
                </div>
                <div>
                  <p style={{ fontSize: '14px', fontWeight: 500, color: tokens.colors.text }}>Unread Messages</p>
                  <p style={{ fontSize: '12px', color: tokens.colors.textMuted }}>Across all labels</p>
                </div>
              </div>
            )}
            {/* Email list */}
            {gmailMessages?.length ? (
              gmailMessages.map((message) => (
                <div
                  key={message.id}
                  style={{
                    padding: '16px',
                    background: tokens.colors.bgCard,
                    borderRadius: tokens.radius.md,
                    border: `1px solid ${message.isUnread ? tokens.colors.accent : tokens.colors.border}`,
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                  }}
                >
                  <div style={{ display: 'flex', gap: '12px' }}>
                    {/* Avatar */}
                    <div
                      style={{
                        width: '40px',
                        height: '40px',
                        borderRadius: '50%',
                        background: message.isUnread
                          ? 'linear-gradient(135deg, #6366f1, #8b5cf6)'
                          : tokens.colors.bgCardHover,
                        color: message.isUnread ? '#fff' : tokens.colors.textMuted,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                        fontSize: '14px',
                        fontWeight: 600,
                      }}
                    >
                      {getEmailInitials(message.fromName, message.from)}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px', marginBottom: '4px' }}>
                        <span style={{
                          fontSize: '14px',
                          fontWeight: message.isUnread ? 600 : 400,
                          color: tokens.colors.text,
                        }}>
                          {message.fromName || message.from.split('@')[0]}
                        </span>
                        <span style={{ fontSize: '12px', color: tokens.colors.textMuted, whiteSpace: 'nowrap' }}>
                          {formatGmailTime(message.date)}
                        </span>
                      </div>
                      <p style={{
                        fontSize: '14px',
                        fontWeight: message.isUnread ? 500 : 400,
                        color: message.isUnread ? tokens.colors.text : tokens.colors.textMuted,
                        marginBottom: '6px',
                      }}>
                        {message.subject || '(no subject)'}
                      </p>
                      <p style={{
                        fontSize: '13px',
                        color: tokens.colors.textDim,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}>
                        {message.snippet}
                      </p>
                      {/* Labels */}
                      {message.labels && message.labels.length > 0 && (
                        <div style={{ display: 'flex', gap: '6px', marginTop: '8px', flexWrap: 'wrap' }}>
                          {getDisplayLabels(message.labels).slice(0, 3).map((label) => {
                            const colors = getLabelColor(label);
                            const displayName = label.name.replace('CATEGORY_', '').toLowerCase();
                            return (
                              <span
                                key={label.id || label.name}
                                style={{
                                  fontSize: '11px',
                                  fontWeight: 500,
                                  color: colors.text,
                                  background: colors.bg,
                                  padding: '2px 8px',
                                  borderRadius: '4px',
                                  textTransform: 'capitalize',
                                }}
                              >
                                {displayName}
                              </span>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <div style={{ textAlign: 'center', padding: '32px', color: tokens.colors.textMuted }}>
                <p style={{ fontSize: '48px', marginBottom: '12px' }}>📭</p>
                <p>Inbox Zero! Well done.</p>
              </div>
            )}
          </div>
        );

      case 'github':
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {/* Stats Grid */}
            {githubMetrics && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '12px' }}>
                <MetricBox
                  label="Stars"
                  value={githubMetrics.totalStars.toLocaleString()}
                  subtext="Total"
                  tokens={tokens}
                />
                <MetricBox
                  label="Forks"
                  value={githubMetrics.totalForks.toLocaleString()}
                  subtext="Total"
                  tokens={tokens}
                />
                <MetricBox
                  label="Open Issues"
                  value={githubMetrics.openIssues.toLocaleString()}
                  subtext="Across repos"
                  tokens={tokens}
                />
                <MetricBox
                  label="Open PRs"
                  value={githubMetrics.openPRs.toLocaleString()}
                  subtext="Awaiting review"
                  tokens={tokens}
                />
              </div>
            )}

            {/* Notifications */}
            {githubMetrics?.notifications && githubMetrics.notifications.length > 0 && (
              <div>
                <h3 style={{ fontSize: '14px', fontWeight: 500, color: tokens.colors.text, marginBottom: '12px' }}>
                  Notifications ({githubMetrics.notifications.filter(n => n.unread).length} unread)
                </h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {githubMetrics.notifications.slice(0, 10).map((notification) => (
                    <div
                      key={notification.id}
                      style={{
                        padding: '12px 16px',
                        background: tokens.colors.bgCard,
                        borderRadius: tokens.radius.md,
                        border: `1px solid ${notification.unread ? tokens.colors.accent : tokens.colors.border}`,
                        display: 'flex',
                        gap: '12px',
                        alignItems: 'flex-start',
                      }}
                    >
                      <div style={{
                        width: '28px',
                        height: '28px',
                        borderRadius: '6px',
                        background: notification.unread ? `${tokens.colors.accent}20` : tokens.colors.bgCardHover,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                      }}>
                        {getGitHubIcon(notification.type, tokens)}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{
                          fontSize: '13px',
                          fontWeight: notification.unread ? 500 : 400,
                          color: tokens.colors.text,
                          marginBottom: '2px',
                        }}>
                          {notification.title}
                        </p>
                        <p style={{ fontSize: '12px', color: tokens.colors.textMuted }}>
                          {notification.repoName} · {notification.reason}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Recent Activity */}
            {githubMetrics?.recentActivity && githubMetrics.recentActivity.length > 0 && (
              <div>
                <h3 style={{ fontSize: '14px', fontWeight: 500, color: tokens.colors.text, marginBottom: '12px' }}>
                  Recent Activity
                </h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {githubMetrics.recentActivity.slice(0, 10).map((activity) => (
                    <div
                      key={activity.id}
                      style={{
                        padding: '12px 16px',
                        background: tokens.colors.bgCard,
                        borderRadius: tokens.radius.md,
                        border: `1px solid ${tokens.colors.border}`,
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '4px' }}>
                        <span style={{ fontSize: '12px', color: tokens.colors.textMuted }}>{activity.repoName}</span>
                        <span style={{ fontSize: '11px', color: tokens.colors.textDim }}>{formatGitHubTime(activity.timestamp)}</span>
                      </div>
                      <p style={{ fontSize: '13px', color: tokens.colors.text }}>{activity.description}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Empty state */}
            {(!githubMetrics?.notifications?.length && !githubMetrics?.recentActivity?.length) && (
              <div style={{ textAlign: 'center', padding: '32px', color: tokens.colors.textMuted }}>
                No GitHub activity found
              </div>
            )}
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            style={{
              position: 'fixed',
              inset: 0,
              background: 'rgba(0, 0, 0, 0.7)',
              backdropFilter: 'blur(8px)',
              zIndex: 100,
            }}
          />

          {/* Modal */}
          <motion.div
            initial={{
              opacity: 0,
              x: originX - centerX,
              y: originY - centerY,
              scaleX: scaleX,
              scaleY: scaleY,
            }}
            animate={{
              opacity: 1,
              x: 0,
              y: 0,
              scaleX: 1,
              scaleY: 1,
            }}
            exit={{
              opacity: 0,
              x: originX - centerX,
              y: originY - centerY,
              scaleX: scaleX,
              scaleY: scaleY,
            }}
            transition={{
              type: 'spring',
              damping: 30,
              stiffness: 350,
              mass: 0.8,
            }}
            style={{
              position: 'fixed',
              top: '50%',
              left: '50%',
              marginLeft: -modalWidth / 2,
              marginTop: -modalHeight / 2,
              width: modalWidth,
              height: modalHeight,
              background: tokens.colors.bgElevated,
              border: `1px solid ${tokens.colors.border}`,
              borderRadius: tokens.radius.xl,
              zIndex: 101,
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
              transformOrigin: 'center center',
            }}
          >
            {/* Header */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '24px 28px',
                borderBottom: `1px solid ${tokens.colors.border}`,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                <div
                  style={{
                    width: '40px',
                    height: '40px',
                    borderRadius: tokens.radius.md,
                    background: tokens.colors.bgCard,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '18px',
                    color: tokens.colors.textMuted,
                  }}
                >
                  <Icon name={panelIcons[type]} size={20} />
                </div>
                <div>
                  <h2 style={{ fontSize: '18px', fontWeight: 600, color: tokens.colors.text }}>
                    {panelTitles[type]}
                  </h2>
                  <p style={{ fontSize: '13px', color: tokens.colors.textMuted, marginTop: '2px' }}>
                    Detailed analytics and trends
                  </p>
                </div>
              </div>
              <button
                onClick={onClose}
                style={{
                  width: '36px',
                  height: '36px',
                  borderRadius: tokens.radius.sm,
                  background: tokens.colors.bgCard,
                  border: 'none',
                  color: tokens.colors.textMuted,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '18px',
                  fontFamily: 'inherit',
                  transition: 'all 0.15s ease',
                }}
              >
                <CloseIcon size={16} />
              </button>
            </div>

            {/* Content */}
            <div
              style={{
                flex: 1,
                overflow: 'auto',
                padding: '28px',
              }}
            >
              {renderContent()}
            </div>

            {/* Footer */}
            <div
              style={{
                padding: '16px 28px',
                borderTop: `1px solid ${tokens.colors.border}`,
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <span style={{ fontSize: '12px', color: tokens.colors.textDim }}>
                Last updated: Just now
              </span>
              <button
                style={{
                  padding: '10px 20px',
                  borderRadius: tokens.radius.sm,
                  background: tokens.colors.bgCard,
                  border: `1px solid ${tokens.colors.border}`,
                  color: tokens.colors.textMuted,
                  fontSize: '13px',
                  fontWeight: 500,
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  transition: 'all 0.15s ease',
                }}
              >
                <DownloadIcon size={14} /> Export Data
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

// Helper component for metric boxes
interface MetricBoxProps {
  label: string;
  value: string;
  subtext: string;
  highlight?: boolean;
  negative?: boolean;
  tokens: any;
}

function MetricBox({ label, value, subtext, highlight, negative, tokens }: MetricBoxProps) {
  return (
    <div
      style={{
        padding: '20px',
        background: tokens.colors.bgCard,
        borderRadius: tokens.radius.md,
        border: `1px solid ${tokens.colors.border}`,
      }}
    >
      <p style={{ fontSize: '12px', color: tokens.colors.textMuted, marginBottom: '8px' }}>{label}</p>
      <p
        style={{
          fontSize: '24px',
          fontWeight: 600,
          color: highlight ? tokens.colors.success : negative ? tokens.colors.danger : tokens.colors.text,
          fontFamily: tokens.fonts.mono,
        }}
      >
        {value}
      </p>
      <p style={{ fontSize: '12px', color: tokens.colors.textDim, marginTop: '8px' }}>{subtext}</p>
    </div>
  );
}

// Helper functions
function formatEventType(type: string): string {
  const typeMap: Record<string, string> = {
    'subscription.created': 'New Subscription',
    'subscription.updated': 'Subscription Updated',
    'subscription.deleted': 'Subscription Cancelled',
    'invoice.paid': 'Invoice Paid',
    'invoice.payment_failed': 'Payment Failed',
    'customer.created': 'New Customer',
    'charge.succeeded': 'Payment Succeeded',
    'charge.failed': 'Payment Failed',
    'payout.paid': 'Payout Completed',
  };
  return typeMap[type] || type.replace(/\./g, ' ').replace(/\b\w/g, l => l.toUpperCase());
}

function formatEventTime(timestamp: number): string {
  const date = new Date(timestamp * 1000);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString();
}

// Gmail helper functions
function getEmailInitials(name: string | undefined, email: string): string {
  if (name) {
    const parts = name.split(' ');
    if (parts.length >= 2) {
      return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
    }
    return name.substring(0, 2).toUpperCase();
  }
  return email.substring(0, 2).toUpperCase();
}

function formatGmailTime(timestamp: number): string {
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

function getLabelColor(label: GmailLabel): { bg: string; text: string } {
  if (label.type === 'system') {
    switch (label.name) {
      case 'IMPORTANT':
        return { bg: 'rgba(234, 179, 8, 0.15)', text: '#eab308' };
      case 'STARRED':
        return { bg: 'rgba(234, 179, 8, 0.2)', text: '#eab308' };
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
  if (label.color) {
    return { bg: `${label.color}20`, text: label.color };
  }
  return { bg: 'rgba(99, 102, 241, 0.15)', text: '#6366f1' };
}

function getDisplayLabels(labels: GmailLabel[]): GmailLabel[] {
  const hiddenLabels = ['INBOX', 'UNREAD', 'SENT', 'DRAFT', 'SPAM', 'TRASH', 'CHAT', 'CATEGORY_PERSONAL'];
  return labels.filter(l => !hiddenLabels.includes(l.id || l.name));
}

// GitHub helper functions
function formatGitHubTime(timestamp: string): string {
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

function getGitHubIcon(type: string, tokens: any): React.ReactElement {
  switch (type) {
    case 'PullRequest':
      return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={tokens.colors.accent} strokeWidth="2">
          <circle cx="18" cy="18" r="3" />
          <circle cx="6" cy="6" r="3" />
          <path d="M6 9v6a3 3 0 0 0 3 3h6" />
          <line x1="18" y1="9" x2="18" y2="15" />
        </svg>
      );
    case 'Issue':
      return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={tokens.colors.success} strokeWidth="2">
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
      );
    case 'Release':
      return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#eab308" strokeWidth="2">
          <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
        </svg>
      );
    default:
      return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={tokens.colors.textMuted} strokeWidth="2">
          <circle cx="12" cy="12" r="10" />
        </svg>
      );
  }
}
