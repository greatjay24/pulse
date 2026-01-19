import { useTheme } from '../contexts/ThemeContext';

interface MiniChartProps {
  title: string;
  data: number[];
  color?: string;
  type?: 'line' | 'bar';
  onClick?: () => void;
}

export function MiniChart({ title, data, color, type = 'line', onClick }: MiniChartProps) {
  const { tokens } = useTheme();
  const chartColor = color || tokens.colors.accent;

  // Handle empty data
  const safeData = data.length > 0 ? data : [0];
  const maxVal = Math.max(...safeData);
  const minVal = Math.min(...safeData);
  const range = maxVal - minVal || 1;

  return (
    <div
      onClick={onClick}
      style={{
        background: tokens.colors.bgCard,
        border: `1px solid ${tokens.colors.border}`,
        borderRadius: tokens.radius.lg,
        padding: '24px',
        backdropFilter: 'blur(20px)',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        cursor: onClick ? 'pointer' : 'default',
        transition: 'all 0.2s ease',
      }}
      onMouseEnter={(e) => {
        if (onClick) {
          e.currentTarget.style.background = tokens.colors.bgCardHover;
          e.currentTarget.style.borderColor = tokens.colors.borderHover;
        }
      }}
      onMouseLeave={(e) => {
        if (onClick) {
          e.currentTarget.style.background = tokens.colors.bgCard;
          e.currentTarget.style.borderColor = tokens.colors.border;
        }
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '20px',
        }}
      >
        <span
          style={{
            color: tokens.colors.text,
            fontSize: '14px',
            fontWeight: 500,
          }}
        >
          {title}
        </span>
        <span
          style={{
            color: tokens.colors.textMuted,
            fontSize: '12px',
            padding: '4px 8px',
            background: tokens.colors.bgCardHover,
            borderRadius: '6px',
          }}
        >
          Last 30 days
        </span>
      </div>

      {/* Chart */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'flex-end',
          gap: type === 'bar' ? '4px' : '2px',
          paddingTop: '8px',
          minHeight: 0,
        }}
      >
        {type === 'bar' ? (
          safeData.map((val, i) => (
            <div
              key={i}
              style={{
                flex: 1,
                height: `${((val - minVal) / range) * 100}%`,
                minHeight: '4px',
                background: `linear-gradient(to top, ${chartColor}, ${chartColor}88)`,
                borderRadius: '3px 3px 0 0',
                opacity: 0.8 + (i / safeData.length) * 0.2,
              }}
            />
          ))
        ) : (
          <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" style={{ overflow: 'visible' }}>
            <defs>
              <linearGradient id={`gradient-${title.replace(/\s/g, '-')}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={chartColor} stopOpacity="0.3" />
                <stop offset="100%" stopColor={chartColor} stopOpacity="0" />
              </linearGradient>
            </defs>
            {/* Area fill */}
            <path
              d={`M 0 ${100 - ((safeData[0] - minVal) / range) * 85} ${safeData
                .map((val, i) => `L ${(i / Math.max(safeData.length - 1, 1)) * 100} ${100 - ((val - minVal) / range) * 85}`)
                .join(' ')} L 100 100 L 0 100 Z`}
              fill={`url(#gradient-${title.replace(/\s/g, '-')})`}
            />
            {/* Line */}
            <path
              d={`M 0 ${100 - ((safeData[0] - minVal) / range) * 85} ${safeData
                .map((val, i) => `L ${(i / Math.max(safeData.length - 1, 1)) * 100} ${100 - ((val - minVal) / range) * 85}`)
                .join(' ')}`}
              fill="none"
              stroke={chartColor}
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          </svg>
        )}
      </div>
    </div>
  );
}
