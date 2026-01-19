import { useRef } from 'react';
import { useTheme } from '../contexts/ThemeContext';
import { DetailPanelType } from '../types';
import { Icon, ArrowUpIcon, ArrowDownIcon } from './Icons';

export interface CardRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface StatCardProps {
  label: string;
  value: string;
  change?: string;
  changeType?: 'up' | 'down';
  icon: string;
  onExpand?: (type: DetailPanelType, rect: CardRect) => void;
  expandType?: DetailPanelType;
  isLoading?: boolean;
}

export function StatCard({
  label,
  value,
  change,
  changeType,
  icon,
  onExpand,
  expandType,
  isLoading = false,
}: StatCardProps) {
  const { tokens } = useTheme();
  const cardRef = useRef<HTMLDivElement>(null);

  const handleClick = () => {
    if (onExpand && expandType && cardRef.current) {
      const rect = cardRef.current.getBoundingClientRect();
      onExpand(expandType, {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
      });
    }
  };

  if (isLoading) {
    return (
      <div
        style={{
          background: tokens.colors.bgCard,
          border: `1px solid ${tokens.colors.border}`,
          borderRadius: tokens.radius.lg,
          padding: '24px',
          backdropFilter: 'blur(20px)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '16px' }}>
          <div
            style={{
              width: '80px',
              height: '14px',
              background: tokens.colors.bgCardHover,
              borderRadius: '4px',
            }}
          />
          <div
            style={{
              width: '32px',
              height: '32px',
              background: tokens.colors.bgCardHover,
              borderRadius: tokens.radius.sm,
            }}
          />
        </div>
        <div
          style={{
            width: '120px',
            height: '32px',
            background: tokens.colors.bgCardHover,
            borderRadius: '4px',
            marginBottom: '8px',
          }}
        />
        <div
          style={{
            width: '60px',
            height: '14px',
            background: tokens.colors.bgCardHover,
            borderRadius: '4px',
          }}
        />
      </div>
    );
  }

  return (
    <div
      ref={cardRef}
      style={{
        background: tokens.colors.bgCard,
        border: `1px solid ${tokens.colors.border}`,
        borderRadius: tokens.radius.lg,
        padding: '24px',
        backdropFilter: 'blur(20px)',
        transition: 'all 0.2s ease',
        cursor: onExpand && expandType ? 'pointer' : 'default',
        height: '100%',
      }}
      onClick={handleClick}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = tokens.colors.bgCardHover;
        e.currentTarget.style.borderColor = tokens.colors.borderHover;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = tokens.colors.bgCard;
        e.currentTarget.style.borderColor = tokens.colors.border;
      }}
    >
      {/* Header - Label and Icon */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          marginBottom: '16px',
        }}
      >
        <span
          style={{
            color: tokens.colors.textMuted,
            fontSize: '13px',
            fontWeight: 500,
            letterSpacing: '0.01em',
          }}
        >
          {label}
        </span>
        <div
          style={{
            width: '32px',
            height: '32px',
            borderRadius: tokens.radius.sm,
            background: tokens.colors.bgCardHover,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Icon name={icon} size={16} />
        </div>
      </div>

      {/* Value */}
      <div
        style={{
          fontSize: '32px',
          fontWeight: 600,
          color: tokens.colors.text,
          fontFamily: tokens.fonts.sans,
          letterSpacing: '-0.02em',
          marginBottom: '8px',
        }}
      >
        {value}
      </div>

      {/* Change indicator */}
      {change && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            fontSize: '13px',
          }}
        >
          <span
            style={{
              color: changeType === 'up' ? tokens.colors.success : tokens.colors.warning,
              fontWeight: 500,
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
            }}
          >
            {changeType === 'up' ? <ArrowUpIcon size={12} /> : <ArrowDownIcon size={12} />}
            {change}
          </span>
          <span style={{ color: tokens.colors.textDim }}>vs last month</span>
        </div>
      )}
    </div>
  );
}
