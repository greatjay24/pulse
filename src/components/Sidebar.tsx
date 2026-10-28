import { useState } from 'react';
import { useTheme } from '../contexts/ThemeContext';
import { App } from '../types';
import { Icon } from './Icons';

interface SidebarProps {
  apps: App[];
  selectedAppId: string | null;
  onSelectApp: (appId: string | null) => void;
  activeNav: string;
  onNavChange: (nav: string) => void;
  totalMRR: number;
  mrrChange?: number; // Percentage change from last period
  onAddProject: () => void;
  onDeleteApp?: (appId: string) => void;
  saasMetrics: boolean; // the original SaaS pages, behind a toggle in Settings
  decisions: number | null; // decisions waiting on the owner, shown beside Today
  compact: boolean; // narrow window: an icon rail
}

// The main nav, in order of importance.
const MAIN_NAV: { id: string; label: string; icon: string }[] = [
  { id: 'today', label: 'Today', icon: 'today' },
  { id: 'board', label: 'Board', icon: 'board' },
  // Activity (decision outcomes and agent runs) goes here once it lands: { id: 'activity', label: 'Activity', icon: 'activity' }
  { id: 'money', label: 'Money', icon: 'wallet' },
];

// Helper to get favicon URL from domain
function getFaviconUrl(domain: string): string {
  // Use Google's favicon service - provides high quality favicons
  return `https://www.google.com/s2/favicons?domain=${domain}&sz=64`;
}

// Nav button component
function NavButton({
  icon,
  label,
  isActive,
  onClick,
  indent = false,
  domain,
  badge,
  compact = false,
}: {
  icon: string;
  label: string;
  isActive: boolean;
  onClick: () => void;
  indent?: boolean;
  domain?: string;
  badge?: number | null;
  compact?: boolean;
}) {
  const { tokens } = useTheme();

  return (
    <button
      onClick={onClick}
      title={compact ? label : undefined}
      aria-label={label}
      aria-current={isActive ? 'page' : undefined}
      style={{
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        justifyContent: compact ? 'center' : 'flex-start',
        gap: '10px',
        padding: compact ? '10px 0' : indent ? '8px 12px 8px 20px' : '10px 12px',
        border: 'none',
        borderRadius: tokens.radius.sm,
        background: isActive ? tokens.colors.bgCard : 'transparent',
        color: isActive ? tokens.colors.text : tokens.colors.textMuted,
        fontSize: indent ? '13px' : '14px',
        fontWeight: 500,
        cursor: 'pointer',
        transition: 'all 0.15s ease',
        textAlign: 'left',
        fontFamily: 'inherit',
        width: '100%',
      }}
    >
      {domain ? (
        <img
          src={getFaviconUrl(domain)}
          alt=""
          style={{
            width: '18px',
            height: '18px',
            borderRadius: '4px',
            objectFit: 'contain',
          }}
          onError={(e) => {
            // Fallback to icon if favicon fails to load
            e.currentTarget.style.display = 'none';
            const fallback = e.currentTarget.nextElementSibling as HTMLElement;
            if (fallback) fallback.style.display = 'flex';
          }}
        />
      ) : null}
      <span
        style={{
          width: '20px',
          display: domain ? 'none' : 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Icon name={icon} size={16} color={isActive ? tokens.colors.text : tokens.colors.textMuted} />
      </span>
      {!compact && <span style={{ flex: 1 }}>{label}</span>}
      {badge ? (
        <span
          style={
            compact
              ? { position: 'absolute', top: '3px', right: '6px', minWidth: '16px', height: '16px', padding: '0 4px', borderRadius: '8px', background: tokens.colors.accent, color: tokens.colors.accentInk, fontSize: '10px', fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' }
              : { fontSize: tokens.type.micro, fontWeight: 600, color: tokens.colors.textMuted, fontVariantNumeric: 'tabular-nums' }
          }
        >
          {badge}
        </span>
      ) : null}
    </button>
  );
}

// Nav divider component
function NavDivider({ label }: { label: string }) {
  const { tokens } = useTheme();

  return (
    <div
      style={{
        padding: '16px 12px 8px',
        fontSize: '11px',
        fontWeight: 600,
        color: tokens.colors.textDim,
        textTransform: 'uppercase',
        letterSpacing: '0.08em',
        borderTop: `1px solid ${tokens.colors.border}`,
        marginTop: '8px',
      }}
    >
      {label}
    </div>
  );
}

// Project nav button with delete on hover
function ProjectNavButton({
  icon,
  label,
  isActive,
  onClick,
  domain,
  onDelete,
}: {
  icon: string;
  label: string;
  isActive: boolean;
  onClick: () => void;
  domain?: string;
  onDelete?: () => void;
}) {
  const { tokens } = useTheme();
  const [isHovered, setIsHovered] = useState(false);

  return (
    <div
      style={{ position: 'relative' }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <button
        onClick={onClick}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          padding: '8px 12px 8px 20px',
          paddingRight: isHovered && onDelete ? '36px' : '12px',
          border: 'none',
          borderRadius: tokens.radius.sm,
          background: isActive ? tokens.colors.bgCard : 'transparent',
          color: isActive ? tokens.colors.text : tokens.colors.textMuted,
          fontSize: '13px',
          fontWeight: 500,
          cursor: 'pointer',
          transition: 'all 0.15s ease',
          textAlign: 'left',
          fontFamily: 'inherit',
          width: '100%',
        }}
      >
        {domain ? (
          <img
            src={getFaviconUrl(domain)}
            alt=""
            style={{
              width: '18px',
              height: '18px',
              borderRadius: '4px',
              objectFit: 'contain',
            }}
            onError={(e) => {
              e.currentTarget.style.display = 'none';
              e.currentTarget.nextElementSibling?.removeAttribute('style');
            }}
          />
        ) : null}
        <span
          style={{
            width: '20px',
            display: domain ? 'none' : 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Icon name={icon} size={16} color={isActive ? tokens.colors.text : tokens.colors.textMuted} />
        </span>
        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {label}
        </span>
      </button>
      {isHovered && onDelete && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          title="Delete project"
          style={{
            position: 'absolute',
            right: '8px',
            top: '50%',
            transform: 'translateY(-50%)',
            width: '22px',
            height: '22px',
            borderRadius: '4px',
            border: 'none',
            background: 'transparent',
            color: tokens.colors.textDim,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '14px',
            transition: 'all 0.15s ease',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = tokens.colors.dangerMuted;
            e.currentTarget.style.color = tokens.colors.danger;
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent';
            e.currentTarget.style.color = tokens.colors.textDim;
          }}
        >
          ×
        </button>
      )}
    </div>
  );
}

// Add project button
function AddProjectButton({ onClick }: { onClick: () => void }) {
  const { tokens } = useTheme();

  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        padding: '8px 12px 8px 20px',
        border: `1px dashed ${tokens.colors.border}`,
        borderRadius: tokens.radius.sm,
        background: 'transparent',
        color: tokens.colors.textDim,
        fontSize: '13px',
        fontWeight: 500,
        cursor: 'pointer',
        transition: 'all 0.15s ease',
        textAlign: 'left',
        fontFamily: 'inherit',
        width: '100%',
        marginTop: '4px',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = tokens.colors.borderHover;
        e.currentTarget.style.color = tokens.colors.textMuted;
        e.currentTarget.style.background = tokens.colors.bgCard;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = tokens.colors.border;
        e.currentTarget.style.color = tokens.colors.textDim;
        e.currentTarget.style.background = 'transparent';
      }}
    >
      <span style={{ width: '20px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Icon name="plus" size={14} color={tokens.colors.textDim} />
      </span>
      Add Project
    </button>
  );
}

// Pulse's mark: the app icon in miniature (icon-concepts/concept6-signal.svg).
export function PulseMark({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="100 100 824 824" aria-hidden style={{ flexShrink: 0, display: 'block' }}>
      <rect x="100" y="100" width="824" height="824" rx="185" fill="#171716" />
      <path d="M218 548 H386 L438 392 L518 680 L582 468 L618 548 H728" fill="none" stroke="#ecebe4" strokeWidth="52" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="778" cy="548" r="42" fill="#e5503f" />
    </svg>
  );
}

export function Sidebar({
  apps,
  selectedAppId,
  onSelectApp,
  activeNav,
  onNavChange,
  totalMRR,
  mrrChange,
  onAddProject,
  onDeleteApp,
  saasMetrics,
  decisions,
  compact,
}: SidebarProps) {
  const { tokens } = useTheme();

  return (
    <aside
      style={{
        width: compact ? '68px' : '232px',
        borderRight: `1px solid ${tokens.colors.border}`,
        padding: compact ? '20px 10px' : '24px 16px',
        display: 'flex',
        flexDirection: 'column',
        background: tokens.colors.bgElevated,
        flexShrink: 0,
        overflowY: 'auto',
        transition: 'background 0.2s ease',
      }}
    >
      {/* Logo */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: compact ? 'center' : 'flex-start',
          gap: '10px',
          padding: compact ? '4px 0' : '4px 12px',
          marginBottom: '28px',
        }}
      >
        <PulseMark size={28} />
        {!compact && <span style={{ fontFamily: tokens.fonts.display, fontWeight: 500, fontSize: '20px', letterSpacing: '-0.01em', color: tokens.colors.text }}>Pulse</span>}
      </div>

      {/* Main Nav */}
      <nav style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
        {MAIN_NAV.map((item) => (
          <NavButton
            key={item.id}
            icon={item.icon}
            label={item.label}
            isActive={activeNav === item.id}
            onClick={() => onNavChange(item.id)}
            badge={item.id === 'today' ? decisions : undefined}
            compact={compact}
          />
        ))}

        {saasMetrics && !compact && (
          <>
            <NavDivider label="SaaS metrics" />
            <NavButton
              icon="home"
              label="Overview"
              isActive={activeNav === 'overview'}
              onClick={() => {
                onNavChange('overview');
                onSelectApp(null);
              }}
            />
            <NavButton icon="analytics" label="Analytics" isActive={activeNav === 'analytics'} onClick={() => onNavChange('analytics')} />
            <NavButton icon="calendar" label="Calendar" isActive={activeNav === 'calendar'} onClick={() => onNavChange('calendar')} />
            {apps.map((app) => (
              <ProjectNavButton
                key={app.id}
                icon="widget"
                label={app.name}
                isActive={selectedAppId === app.id}
                onClick={() => {
                  onSelectApp(app.id);
                  onNavChange('project');
                }}
                domain={app.domain}
                onDelete={onDeleteApp ? () => onDeleteApp(app.id) : undefined}
              />
            ))}
            <AddProjectButton onClick={onAddProject} />
          </>
        )}
      </nav>

      {/* Settings at Bottom */}
      <div style={{ marginTop: 'auto', paddingTop: '16px' }}>
        <NavButton
          icon="settings"
          label="Settings"
          isActive={activeNav === 'settings'}
          onClick={() => onNavChange('settings')}
          compact={compact}
        />

        {saasMetrics && !compact && (
          <div
            style={{
              padding: '16px',
              background: tokens.colors.bgCard,
              borderRadius: tokens.radius.md,
              border: `1px solid ${tokens.colors.border}`,
              marginTop: '16px',
            }}
          >
            <div style={{ fontSize: '12px', color: tokens.colors.textMuted, marginBottom: '8px' }}>Total MRR</div>
            <div style={{ fontSize: '24px', fontWeight: 600, letterSpacing: '-0.02em', color: tokens.colors.text, fontVariantNumeric: 'tabular-nums' }}>
              ${totalMRR.toLocaleString()}
            </div>
            {mrrChange !== undefined && mrrChange !== 0 && (
              <div style={{ fontSize: '12px', color: mrrChange >= 0 ? tokens.colors.success : tokens.colors.danger, marginTop: '4px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                <Icon name={mrrChange >= 0 ? 'arrow-up' : 'arrow-down'} size={12} color="currentColor" /> {Math.abs(mrrChange).toFixed(1)}% this month
              </div>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}
