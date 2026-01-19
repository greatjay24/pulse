import { useTheme } from '../contexts/ThemeContext';
import { Platform } from '../types';
import { PLATFORM_INFO } from '../utils/platforms';
import { Icon } from './Icons';

interface PlatformTabsProps {
  platforms: Platform[];
  activeTab: 'overview' | Platform;
  onTabChange: (tab: 'overview' | Platform) => void;
  integrationCounts?: Record<Platform | 'overview', number>;
}

export function PlatformTabs({ platforms, activeTab, onTabChange, integrationCounts }: PlatformTabsProps) {
  const { tokens } = useTheme();

  // Always show Overview first, then platform-specific tabs
  const tabs: Array<{ id: 'overview' | Platform; label: string; icon: string }> = [
    { id: 'overview', label: 'Overview', icon: 'home' },
    ...platforms.map(platform => ({
      id: platform,
      label: PLATFORM_INFO[platform].label,
      icon: PLATFORM_INFO[platform].icon,
    })),
  ];

  return (
    <div
      style={{
        display: 'flex',
        gap: '4px',
        padding: '4px',
        background: tokens.colors.bgCard,
        borderRadius: tokens.radius.lg,
        border: `1px solid ${tokens.colors.border}`,
        marginBottom: '24px',
      }}
    >
      {tabs.map((tab) => {
        const isActive = activeTab === tab.id;
        const count = integrationCounts?.[tab.id];

        return (
          <button
            key={tab.id}
            onClick={() => onTabChange(tab.id)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '10px 16px',
              fontSize: '13px',
              fontWeight: 500,
              color: isActive ? tokens.colors.text : tokens.colors.textMuted,
              background: isActive ? tokens.colors.bgElevated : 'transparent',
              border: 'none',
              borderRadius: tokens.radius.md,
              cursor: 'pointer',
              fontFamily: 'inherit',
              transition: 'all 0.15s ease',
              boxShadow: isActive ? `0 1px 3px rgba(0, 0, 0, 0.1)` : 'none',
            }}
            onMouseEnter={(e) => {
              if (!isActive) {
                e.currentTarget.style.background = tokens.colors.bgCardHover;
              }
            }}
            onMouseLeave={(e) => {
              if (!isActive) {
                e.currentTarget.style.background = 'transparent';
              }
            }}
          >
            <Icon
              name={tab.icon}
              size={14}
              color={isActive ? tokens.colors.text : tokens.colors.textMuted}
            />
            {tab.label}
            {count !== undefined && count > 0 && (
              <span
                style={{
                  padding: '2px 6px',
                  fontSize: '10px',
                  fontWeight: 600,
                  background: isActive ? tokens.colors.accentGlow : tokens.colors.bgCardHover,
                  color: isActive ? tokens.colors.accent : tokens.colors.textDim,
                  borderRadius: '10px',
                }}
              >
                {count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
