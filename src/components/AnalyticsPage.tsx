import { useState } from 'react';
import { useTheme } from '../contexts/ThemeContext';
import { App, AppMetrics } from '../types';
import { Icon } from './Icons';

interface AnalyticsPageProps {
  apps: App[];
  metrics: Record<string, AppMetrics | null>;
}

// Get default color for a project based on index
function getDefaultColor(index: number): string {
  const colors = ['#8b5cf6', '#3b82f6', '#22c55e', '#f97316', '#ec4899', '#06b6d4', '#ef4444', '#eab308'];
  return colors[index % colors.length];
}

type MetricType = 'revenue' | 'users' | 'churn' | 'growth';

export function AnalyticsPage({ apps, metrics }: AnalyticsPageProps) {
  const { tokens } = useTheme();
  const [selectedMetric, setSelectedMetric] = useState<MetricType>('revenue');
  const [timeRange, setTimeRange] = useState<'7d' | '30d' | '90d'>('30d');

  // Calculate total metrics
  const totals = {
    mrr: apps.reduce((sum, app) => sum + (metrics[app.id]?.stripe?.mrr || 0), 0),
    users: apps.reduce((sum, app) => sum + (metrics[app.id]?.stripe?.activeSubscriptions || 0), 0),
    churn: apps.length > 0
      ? apps.reduce((sum, app) => sum + (metrics[app.id]?.stripe?.churnRate || 0), 0) / apps.length
      : 0,
  };

  // Get metrics for each app with color
  const appMetrics = apps.map((app, index) => {
    const appData = metrics[app.id];
    const color = app.color || getDefaultColor(index);

    return {
      id: app.id,
      name: app.name,
      color,
      domain: app.domain,
      mrr: appData?.stripe?.mrr || 0,
      users: appData?.stripe?.activeSubscriptions || 0,
      churn: appData?.stripe?.churnRate || 0,
      revenue30d: appData?.stripe?.revenue30d || 0,
      hasData: !!appData,
    };
  });

  // Sample data for charts (per project)
  const generateChartData = (baseValue: number) => {
    return Array.from({ length: 12 }, (_, i) => {
      const variance = 0.2;
      return Math.round(baseValue * (1 + (Math.random() - 0.5) * variance) * (1 + i * 0.05));
    });
  };

  const metricOptions: { id: MetricType; label: string; icon: string }[] = [
    { id: 'revenue', label: 'Revenue', icon: 'revenue' },
    { id: 'users', label: 'Users', icon: 'users' },
    { id: 'churn', label: 'Churn Rate', icon: 'churn' },
    { id: 'growth', label: 'Growth', icon: 'trending-up' },
  ];

  // Render legend
  const renderLegend = () => (
    <div
      style={{
        background: tokens.colors.bgCard,
        border: `1px solid ${tokens.colors.border}`,
        borderRadius: tokens.radius.lg,
        padding: '20px',
        marginBottom: '24px',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <h3 style={{ fontSize: '14px', fontWeight: 600, color: tokens.colors.text }}>
          Projects
        </h3>
        <div style={{ display: 'flex', gap: '8px' }}>
          {(['7d', '30d', '90d'] as const).map((range) => (
            <button
              key={range}
              onClick={() => setTimeRange(range)}
              style={{
                padding: '6px 12px',
                borderRadius: tokens.radius.sm,
                border: `1px solid ${timeRange === range ? tokens.colors.accent : tokens.colors.border}`,
                background: timeRange === range ? tokens.colors.accentGlow : 'transparent',
                color: timeRange === range ? tokens.colors.accent : tokens.colors.textMuted,
                fontSize: '12px',
                fontWeight: 500,
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              {range === '7d' ? '7 Days' : range === '30d' ? '30 Days' : '90 Days'}
            </button>
          ))}
        </div>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px' }}>
        {appMetrics.map((app) => (
          <div
            key={app.id}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              opacity: app.hasData ? 1 : 0.4,
            }}
          >
            <div
              style={{
                width: '12px',
                height: '12px',
                borderRadius: '3px',
                background: app.hasData ? app.color : tokens.colors.textDim,
              }}
            />
            <span style={{ fontSize: '13px', color: app.hasData ? tokens.colors.text : tokens.colors.textDim }}>
              {app.name}
            </span>
            {!app.hasData && (
              <span style={{ fontSize: '11px', color: tokens.colors.textDim }}>
                (no data)
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );

  // Render metric selector
  const renderMetricSelector = () => (
    <div style={{ display: 'flex', gap: '12px', marginBottom: '24px' }}>
      {metricOptions.map((option) => (
        <button
          key={option.id}
          onClick={() => setSelectedMetric(option.id)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '12px 20px',
            borderRadius: tokens.radius.md,
            border: `1px solid ${selectedMetric === option.id ? tokens.colors.accent : tokens.colors.border}`,
            background: selectedMetric === option.id ? tokens.colors.accentGlow : tokens.colors.bgCard,
            color: selectedMetric === option.id ? tokens.colors.text : tokens.colors.textMuted,
            fontSize: '14px',
            fontWeight: 500,
            cursor: 'pointer',
            fontFamily: 'inherit',
            transition: 'all 0.15s ease',
          }}
        >
          <span style={{ opacity: 0.7, display: 'flex', alignItems: 'center' }}>
            <Icon name={option.icon} size={14} />
          </span>
          {option.label}
        </button>
      ))}
    </div>
  );

  // Render combined chart with all projects
  const renderCombinedChart = () => {
    const maxValue = Math.max(...appMetrics.map(a => a.mrr || 1000));

    return (
      <div
        style={{
          background: tokens.colors.bgCard,
          border: `1px solid ${tokens.colors.border}`,
          borderRadius: tokens.radius.lg,
          padding: '24px',
          marginBottom: '24px',
        }}
      >
        <h3 style={{ fontSize: '16px', fontWeight: 600, marginBottom: '20px' }}>
          {selectedMetric === 'revenue' ? 'Revenue Trend' :
           selectedMetric === 'users' ? 'User Growth' :
           selectedMetric === 'churn' ? 'Churn Rate Trend' : 'Growth Rate'}
        </h3>

        <div style={{ height: '300px', position: 'relative' }}>
          {/* Y-axis labels */}
          <div
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              bottom: 30,
              width: '60px',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
            }}
          >
            {[100, 75, 50, 25, 0].map((pct) => (
              <span key={pct} style={{ fontSize: '11px', color: tokens.colors.textDim }}>
                {selectedMetric === 'revenue' ? `$${Math.round(maxValue * pct / 100 / 1000)}k` :
                 selectedMetric === 'churn' ? `${(5 * pct / 100).toFixed(1)}%` :
                 Math.round(maxValue * pct / 100)}
              </span>
            ))}
          </div>

          {/* Chart area */}
          <div style={{ marginLeft: '70px', height: '270px', position: 'relative' }}>
            {/* Grid lines */}
            {[0, 25, 50, 75, 100].map((pct) => (
              <div
                key={pct}
                style={{
                  position: 'absolute',
                  left: 0,
                  right: 0,
                  top: `${100 - pct}%`,
                  borderTop: `1px solid ${tokens.colors.border}`,
                  opacity: 0.5,
                }}
              />
            ))}

            {/* Lines for each project */}
            <svg width="100%" height="100%" style={{ position: 'absolute', top: 0, left: 0 }}>
              {appMetrics.filter(a => a.hasData).map((app) => {
                const data = generateChartData(
                  selectedMetric === 'revenue' ? app.mrr :
                  selectedMetric === 'users' ? app.users :
                  selectedMetric === 'churn' ? app.churn * 100 :
                  app.mrr * 0.1
                );
                const max = selectedMetric === 'churn' ? 5 : maxValue;

                const points = data.map((val, i) => {
                  const x = (i / (data.length - 1)) * 100;
                  const y = 100 - (val / max) * 100;
                  return `${x}%,${y}%`;
                }).join(' ');

                return (
                  <polyline
                    key={app.id}
                    points={points}
                    fill="none"
                    stroke={app.color}
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    vectorEffect="non-scaling-stroke"
                  />
                );
              })}
            </svg>

            {/* X-axis labels */}
            <div
              style={{
                position: 'absolute',
                bottom: -25,
                left: 0,
                right: 0,
                display: 'flex',
                justifyContent: 'space-between',
              }}
            >
              {['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'].map((month) => (
                <span key={month} style={{ fontSize: '11px', color: tokens.colors.textDim }}>
                  {month}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  };

  // Render project breakdown cards
  const renderProjectBreakdown = () => (
    <div>
      <h3 style={{ fontSize: '16px', fontWeight: 600, marginBottom: '16px' }}>
        Project Breakdown
      </h3>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '16px' }}>
        {appMetrics.map((app) => (
          <div
            key={app.id}
            style={{
              background: tokens.colors.bgCard,
              border: `1px solid ${tokens.colors.border}`,
              borderRadius: tokens.radius.lg,
              padding: '20px',
              borderTop: `3px solid ${app.color}`,
              opacity: app.hasData ? 1 : 0.6,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' }}>
              {app.domain && (
                <img
                  src={`https://www.google.com/s2/favicons?domain=${app.domain}&sz=64`}
                  alt=""
                  style={{ width: '20px', height: '20px', borderRadius: '4px' }}
                />
              )}
              <h4 style={{ fontSize: '14px', fontWeight: 600, color: tokens.colors.text }}>
                {app.name}
              </h4>
            </div>

            {app.hasData ? (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                <div>
                  <div style={{ fontSize: '11px', color: tokens.colors.textDim, marginBottom: '4px' }}>MRR</div>
                  <div style={{ fontSize: '18px', fontWeight: 600, color: tokens.colors.text }}>
                    ${app.mrr.toLocaleString()}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: '11px', color: tokens.colors.textDim, marginBottom: '4px' }}>Users</div>
                  <div style={{ fontSize: '18px', fontWeight: 600, color: tokens.colors.text }}>
                    {app.users.toLocaleString()}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: '11px', color: tokens.colors.textDim, marginBottom: '4px' }}>Churn</div>
                  <div style={{ fontSize: '18px', fontWeight: 600, color: tokens.colors.text }}>
                    {app.churn.toFixed(1)}%
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: '11px', color: tokens.colors.textDim, marginBottom: '4px' }}>Revenue (30d)</div>
                  <div style={{ fontSize: '18px', fontWeight: 600, color: tokens.colors.text }}>
                    ${app.revenue30d.toLocaleString()}
                  </div>
                </div>
              </div>
            ) : (
              <div style={{ color: tokens.colors.textDim, fontSize: '13px', textAlign: 'center', padding: '20px' }}>
                No data available
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );

  // Render totals bar
  const renderTotalsBar = () => (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(3, 1fr)',
        gap: '16px',
        marginBottom: '24px',
      }}
    >
      <div
        style={{
          background: tokens.colors.bgCard,
          border: `1px solid ${tokens.colors.border}`,
          borderRadius: tokens.radius.lg,
          padding: '20px',
        }}
      >
        <div style={{ fontSize: '12px', color: tokens.colors.textMuted, marginBottom: '8px' }}>
          Total MRR
        </div>
        <div style={{ fontSize: '28px', fontWeight: 600, color: tokens.colors.text }}>
          ${totals.mrr.toLocaleString()}
        </div>
      </div>
      <div
        style={{
          background: tokens.colors.bgCard,
          border: `1px solid ${tokens.colors.border}`,
          borderRadius: tokens.radius.lg,
          padding: '20px',
        }}
      >
        <div style={{ fontSize: '12px', color: tokens.colors.textMuted, marginBottom: '8px' }}>
          Total Users
        </div>
        <div style={{ fontSize: '28px', fontWeight: 600, color: tokens.colors.text }}>
          {totals.users.toLocaleString()}
        </div>
      </div>
      <div
        style={{
          background: tokens.colors.bgCard,
          border: `1px solid ${tokens.colors.border}`,
          borderRadius: tokens.radius.lg,
          padding: '20px',
        }}
      >
        <div style={{ fontSize: '12px', color: tokens.colors.textMuted, marginBottom: '8px' }}>
          Avg Churn Rate
        </div>
        <div style={{ fontSize: '28px', fontWeight: 600, color: tokens.colors.text }}>
          {totals.churn.toFixed(1)}%
        </div>
      </div>
    </div>
  );

  return (
    <div>
      <div style={{ marginBottom: '32px' }}>
        <h1 style={{ fontSize: '24px', fontWeight: 600, marginBottom: '4px' }}>Analytics</h1>
        <p style={{ color: tokens.colors.textMuted, fontSize: '14px' }}>
          Deep dive into your metrics across all projects.
        </p>
      </div>

      {renderLegend()}
      {renderTotalsBar()}
      {renderMetricSelector()}
      {renderCombinedChart()}
      {renderProjectBreakdown()}
    </div>
  );
}
