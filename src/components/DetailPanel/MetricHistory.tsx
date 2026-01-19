import { useState } from 'react';
import { XAxis, YAxis, Tooltip, ResponsiveContainer, Area, AreaChart } from 'recharts';
import { MetricSnapshot, DailyRevenue } from '../../types';
import { format, parseISO, subMonths, subYears } from 'date-fns';
import { useTheme } from '../../contexts/ThemeContext';

// Time interval options
type TimeInterval = '1M' | '3M' | '6M' | '1Y' | '2Y' | '5Y' | '10Y' | 'ALL';

const intervalOptions: { label: string; value: TimeInterval }[] = [
  { label: '1M', value: '1M' },
  { label: '3M', value: '3M' },
  { label: '6M', value: '6M' },
  { label: '1Y', value: '1Y' },
  { label: '2Y', value: '2Y' },
  { label: '5Y', value: '5Y' },
  { label: '10Y', value: '10Y' },
  { label: 'ALL', value: 'ALL' },
];

interface MetricHistoryProps {
  title: string;
  data?: MetricSnapshot[];
  dailyRevenue?: DailyRevenue[]; // Real daily revenue from Stripe API
  dataKey: string;
  color: string;
}

// Get the cutoff date based on interval
function getIntervalCutoffDate(interval: TimeInterval): Date {
  const now = new Date();
  switch (interval) {
    case '1M': return subMonths(now, 1);
    case '3M': return subMonths(now, 3);
    case '6M': return subMonths(now, 6);
    case '1Y': return subYears(now, 1);
    case '2Y': return subYears(now, 2);
    case '5Y': return subYears(now, 5);
    case '10Y': return subYears(now, 10);
    case 'ALL': return new Date(0); // Beginning of time
    default: return subMonths(now, 1);
  }
}

// Generate array of dates for the selected interval (from cutoff to today)
function generateDateRange(interval: TimeInterval): string[] {
  const dates: string[] = [];
  const now = new Date();
  const cutoff = getIntervalCutoffDate(interval);

  // For ALL interval with no real cutoff, default to 1 year
  const startDate = interval === 'ALL' ? subYears(now, 1) : cutoff;

  // Generate dates from start to now
  let current = new Date(startDate);
  while (current <= now) {
    dates.push(current.toISOString().split('T')[0]);
    current.setDate(current.getDate() + 1);
  }

  return dates;
}

export function MetricHistory({ title, data, dailyRevenue, dataKey, color }: MetricHistoryProps) {
  const { tokens } = useTheme();
  const [selectedInterval, setSelectedInterval] = useState<TimeInterval>('1M');

  // Use real daily revenue data if available (for revenue charts), otherwise use historical snapshots
  const chartData = (() => {
    // Generate the full date range for the selected interval, filled with zeros
    const fullDateRange = generateDateRange(selectedInterval);

    // If we have real daily revenue data and this is a revenue-related chart, use it
    if (dailyRevenue && dailyRevenue.length > 0 && dataKey.includes('mrr')) {
      // Create a map of existing data by date
      const dataMap = new Map<string, number>();
      dailyRevenue.forEach((day) => {
        dataMap.set(day.date, day.revenue);
      });

      // Fill in the full date range with real data where available, zeros otherwise
      return fullDateRange.map((date) => ({
        date,
        value: dataMap.get(date) || 0,
      }));
    }

    // Otherwise, use historical snapshot data
    if (data && data.length > 0) {
      // Create a map of existing data by date
      const dataMap = new Map<string, number>();
      data.forEach((snapshot) => {
        const keys = dataKey.split('.');
        let value: any = snapshot;
        for (const key of keys) {
          value = value?.[key];
        }
        dataMap.set(snapshot.date, value || 0);
      });

      // Fill in the full date range with real data where available, zeros otherwise
      return fullDateRange.map((date) => ({
        date,
        value: dataMap.get(date) || 0,
      }));
    }

    // Fallback to placeholder data (all zeros)
    return fullDateRange.map((date) => ({ date, value: 0 }));
  })();

  // Format X-axis based on interval and data range
  const getXAxisFormat = (date: string) => {
    const parsed = parseISO(date);
    // For short intervals or limited data, show day
    if (chartData.length <= 31) {
      return format(parsed, 'MMM d');
    } else if (chartData.length <= 90) {
      return format(parsed, 'MMM d');
    } else if (chartData.length <= 365) {
      return format(parsed, 'MMM');
    } else {
      return format(parsed, 'MMM yyyy');
    }
  };

  // Calculate tick interval based on data length to avoid crowded labels
  const getTickInterval = () => {
    const dataLength = chartData.length;
    if (dataLength <= 7) return 0; // Show all ticks
    if (dataLength <= 14) return 1; // Every other tick
    if (dataLength <= 31) return Math.floor(dataLength / 6) - 1; // ~6 ticks
    if (dataLength <= 90) return Math.floor(dataLength / 6) - 1; // ~6 ticks
    if (dataLength <= 365) return Math.floor(dataLength / 8) - 1; // ~8 ticks
    return Math.floor(dataLength / 10) - 1; // ~10 ticks for very long ranges
  };

  return (
    <div
      style={{
        background: tokens.colors.bgCard,
        borderRadius: tokens.radius.lg,
        border: `1px solid ${tokens.colors.border}`,
        padding: '16px',
      }}
    >
      {/* Header with title and interval toggle */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '16px',
        }}
      >
        <h4 style={{ fontSize: '14px', fontWeight: 500, color: tokens.colors.text }}>{title}</h4>

        {/* Interval Toggle */}
        <div
          style={{
            display: 'flex',
            gap: '4px',
            background: tokens.colors.bgElevated,
            borderRadius: tokens.radius.sm,
            padding: '4px',
          }}
        >
          {intervalOptions.map((option) => (
            <button
              key={option.value}
              onClick={() => setSelectedInterval(option.value)}
              style={{
                padding: '4px 10px',
                borderRadius: '4px',
                border: 'none',
                background: selectedInterval === option.value ? tokens.colors.accent : 'transparent',
                color: selectedInterval === option.value ? '#fff' : tokens.colors.textMuted,
                fontSize: '11px',
                fontWeight: 500,
                cursor: 'pointer',
                fontFamily: 'inherit',
                transition: 'all 0.15s ease',
              }}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {/* Chart */}
      <div style={{ height: '192px' }}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartData} margin={{ top: 5, right: 5, left: 0, bottom: 5 }}>
            <defs>
              <linearGradient id={`gradient-${dataKey}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity={0.3} />
                <stop offset="100%" stopColor={color} stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis
              dataKey="date"
              tickFormatter={getXAxisFormat}
              tick={{ fill: tokens.colors.textMuted, fontSize: 10 }}
              axisLine={false}
              tickLine={false}
              interval={getTickInterval()}
            />
            <YAxis
              tick={{ fill: tokens.colors.textMuted, fontSize: 10 }}
              axisLine={false}
              tickLine={false}
              tickFormatter={(value) => formatYAxisValue(value)}
              width={50}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: tokens.colors.bgElevated,
                border: `1px solid ${tokens.colors.border}`,
                borderRadius: '8px',
                fontSize: '12px',
              }}
              labelFormatter={(date) => format(parseISO(date as string), 'MMM d, yyyy')}
              formatter={(value: number | undefined) => [formatTooltipValue(value ?? 0), 'Value']}
            />
            <Area
              type="monotone"
              dataKey="value"
              stroke={color}
              strokeWidth={2}
              fill={`url(#gradient-${dataKey})`}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function formatYAxisValue(value: number): string {
  if (value >= 1000000) return `$${(value / 1000000).toFixed(1)}M`;
  if (value >= 1000) return `$${(value / 1000).toFixed(0)}K`;
  return `$${value}`;
}

function formatTooltipValue(value: number): string {
  return `$${value.toLocaleString()}`
}
