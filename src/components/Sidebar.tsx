import { useState } from 'react';
import { useTheme } from '../contexts/ThemeContext';
import { App } from '../types';
import { Icon } from './Icons';

interface SidebarProps {
  apps: App[];
  selectedAppId: string | null;
  onSelectApp: (appId: string | null) => void;
  onSettingsClick: () => void;
  activeNav: string;
  onNavChange: (nav: string) => void;
  totalMRR: number;
  mrrChange?: number; // Percentage change from last period
  onAddProject: () => void;
  onDeleteApp?: (appId: string) => void;
}

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
}: {
  icon: string;
  label: string;
  isActive: boolean;
  onClick: () => void;
  indent?: boolean;
  domain?: string;
}) {
  const { tokens } = useTheme();

  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        padding: indent ? '8px 12px 8px 20px' : '10px 12px',
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
      {label}
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

export function Sidebar({
  apps,
  selectedAppId,
  onSelectApp,
  onSettingsClick: _onSettingsClick,
  activeNav,
  onNavChange,
  totalMRR,
  mrrChange,
  onAddProject,
  onDeleteApp,
}: SidebarProps) {
  void _onSettingsClick; // Keep for future use
  const { tokens } = useTheme();

  return (
    <aside
      style={{
        width: '240px',
        borderRight: `1px solid ${tokens.colors.border}`,
        padding: '24px 16px',
        display: 'flex',
        flexDirection: 'column',
        background: tokens.colors.bgElevated,
        flexShrink: 0,
        transition: 'background 0.2s ease',
      }}
    >
      {/* Logo */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          padding: '8px 12px',
          marginBottom: '24px',
        }}
      >
        <div
          style={{
            width: '32px',
            height: '32px',
            borderRadius: '10px',
            background: '#000000',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
          }}
        >
          <svg width="20" height="20" viewBox="0 0 512 512" fill="none">
            <path d="M80 280 L160 280 L192 160 L224 400 L256 200 L288 340 L320 256 L432 256"
                  stroke="white" strokeWidth="24" strokeLinecap="square" strokeLinejoin="miter" fill="none"/>
          </svg>
        </div>
        <span style={{ fontWeight: 600, fontSize: '15px', color: tokens.colors.text }}>Pulse</span>
      </div>

      {/* Main Nav */}
      <nav style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
        <NavButton
          icon="home"
          label="Overview"
          isActive={activeNav === 'overview'}
          onClick={() => {
            onNavChange('overview');
            onSelectApp(null);
          }}
        />
        <NavButton
          icon="analytics"
          label="Analytics"
          isActive={activeNav === 'analytics'}
          onClick={() => onNavChange('analytics')}
        />
        <NavButton
          icon="calendar"
          label="Calendar"
          isActive={activeNav === 'calendar'}
          onClick={() => onNavChange('calendar')}
        />

        <NavDivider label="Projects" />

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
      </nav>

      {/* Settings at Bottom */}
      <div style={{ marginTop: 'auto' }}>
        <NavButton
          icon="settings"
          label="Settings"
          isActive={activeNav === 'settings'}
          onClick={() => {
            onNavChange('settings');
          }}
        />

        {/* Total MRR Card */}
        <div
          style={{
            padding: '16px',
            background: tokens.colors.bgCard,
            borderRadius: tokens.radius.md,
            border: `1px solid ${tokens.colors.border}`,
            marginTop: '16px',
          }}
        >
          <div style={{ fontSize: '12px', color: tokens.colors.textMuted, marginBottom: '8px' }}>
            Total MRR
          </div>
          <div
            style={{
              fontSize: '24px',
              fontWeight: 600,
              fontFamily: tokens.fonts.mono,
              letterSpacing: '-0.02em',
              color: tokens.colors.text,
            }}
          >
            ${totalMRR.toLocaleString()}
          </div>
          {mrrChange !== undefined && mrrChange !== 0 && (
            <div style={{
              fontSize: '12px',
              color: mrrChange >= 0 ? tokens.colors.success : tokens.colors.danger,
              marginTop: '4px'
            }}>
              {mrrChange >= 0 ? '↑' : '↓'} {Math.abs(mrrChange).toFixed(1)}% this month
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}
