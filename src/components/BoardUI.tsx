import { CSSProperties, ReactNode, useState } from 'react';
import { inkOn, isHexColor, useTheme } from '../contexts/ThemeContext';
import { Health, PortfolioEntity } from '../types';
import { formatAge, hoursSince, isStale } from '../utils/portfolio';

// Shared pieces for the board, entity dashboards and Today: one card, one label style,
// one way to show health, so the three views read as one system.

const HEALTH: Record<Health | 'none', { label: string; mark: string }> = {
  green: { label: 'On track', mark: '●' },
  yellow: { label: 'Watch', mark: '▲' },
  red: { label: 'At risk', mark: '■' },
  none: { label: 'No report', mark: '○' },
};

// Health as a tinted pill with a shape and a word, so it never depends on color alone.
export function HealthBadge({ health, large = false }: { health: Health | undefined; large?: boolean }) {
  const { tokens } = useTheme();
  const c = tokens.colors;
  const key = health ?? 'none';
  const [fg, bg] =
    key === 'green' ? [c.success, c.successMuted] : key === 'yellow' ? [c.warning, c.warningMuted] : key === 'red' ? [c.danger, c.dangerMuted] : [c.textMuted, 'transparent'];
  return (
    <span
      title={health ? `Health: ${HEALTH[key].label}` : 'No status report yet'}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
        padding: large ? '5px 12px' : '3px 10px',
        borderRadius: '999px',
        background: bg,
        border: key === 'none' ? `1px solid ${c.border}` : '1px solid transparent',
        color: fg,
        fontSize: large ? tokens.type.small : tokens.type.micro,
        fontWeight: 600,
        whiteSpace: 'nowrap',
        flexShrink: 0,
      }}
    >
      <span aria-hidden style={{ fontSize: '0.75em', lineHeight: 1 }}>{HEALTH[key].mark}</span>
      {HEALTH[key].label}
    </span>
  );
}

export function SectionLabel({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  const { tokens } = useTheme();
  return (
    <div
      style={{
        fontSize: tokens.type.micro,
        fontWeight: 600,
        color: tokens.colors.textMuted,
        textTransform: 'uppercase',
        letterSpacing: '0.09em',
        marginBottom: '14px',
        ...style,
      }}
    >
      {children}
    </div>
  );
}

// A section title in the display face, with an optional quiet note beside it.
export function SectionHeading({ children, note, right }: { children: ReactNode; note?: ReactNode; right?: ReactNode }) {
  const { tokens } = useTheme();
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: '12px', marginBottom: '16px', flexWrap: 'wrap' }}>
      <h2 style={{ fontFamily: tokens.fonts.display, fontSize: tokens.type.heading, fontWeight: 500, letterSpacing: '-0.01em' }}>
        {children}
      </h2>
      {note && <span style={{ fontSize: tokens.type.small, color: tokens.colors.textDim }}>{note}</span>}
      {right && <span style={{ marginLeft: 'auto' }}>{right}</span>}
    </div>
  );
}

export function Card({ children, style, padding = '24px 26px' }: { children: ReactNode; style?: CSSProperties; padding?: string }) {
  const { tokens } = useTheme();
  return (
    <div
      style={{
        padding,
        background: tokens.colors.bgCard,
        border: `1px solid ${tokens.colors.border}`,
        borderRadius: tokens.radius.lg,
        minWidth: 0,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

export function StageBadge({ stage }: { stage: string | undefined }) {
  const { tokens } = useTheme();
  if (!stage || stage === 'active') return null;
  return (
    <span
      style={{
        fontSize: tokens.type.micro,
        padding: '3px 10px',
        borderRadius: '999px',
        border: `1px solid ${tokens.colors.border}`,
        color: tokens.colors.textMuted,
        whiteSpace: 'nowrap',
      }}
    >
      {stage}
    </span>
  );
}

export function AgeLabel({ updated, now }: { updated: string | undefined; now: number }) {
  const { tokens } = useTheme();
  const hours = hoursSince(updated, now);
  const stale = isStale(hours);
  return (
    <span
      title={updated ?? undefined}
      style={{ fontSize: tokens.type.micro, color: stale ? tokens.colors.warning : tokens.colors.textDim }}
    >
      {stale ? `stale · ${formatAge(hours)}` : formatAge(hours)}
    </span>
  );
}

export interface EntityLogos {
  logo: string | null;
  logo_dark: string | null;
}

// The entity's logo for the current theme, or its initial on its own color. A light-mode
// logo is never put on a dark theme (or the reverse), since a black mark on near-black vanishes.
export function EntityMark({ entity, logos, size = 40 }: { entity: PortfolioEntity; logos: EntityLogos | null; size?: number }) {
  const { tokens, resolvedTheme } = useTheme();
  const [broken, setBroken] = useState<string | null>(null);
  const src = resolvedTheme === 'dark' ? logos?.logo_dark : logos?.logo;
  if (src && src !== broken) {
    return (
      <img
        src={src}
        alt={`${entity.name} logo`}
        onError={() => setBroken(src)}
        style={{ width: size, height: size, objectFit: 'contain', flexShrink: 0, display: 'block' }}
      />
    );
  }
  const color = isHexColor(entity.color) ? entity.color : tokens.colors.chart;
  return (
    <span
      aria-hidden
      title={entity.name}
      style={{
        width: size,
        height: size,
        borderRadius: Math.round(size * 0.26),
        background: color,
        color: inkOn(color),
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: tokens.fonts.display,
        fontSize: Math.round(size * 0.5),
        fontWeight: 600,
        flexShrink: 0,
        lineHeight: 1,
      }}
    >
      {entity.name.trim().charAt(0).toUpperCase()}
    </span>
  );
}

export function Notice({ children, tone = 'warning' }: { children: ReactNode; tone?: 'warning' | 'quiet' }) {
  const { tokens } = useTheme();
  const warning = tone === 'warning';
  return (
    <div
      style={{
        padding: '14px 18px',
        borderRadius: tokens.radius.md,
        background: warning ? tokens.colors.warningMuted : tokens.colors.bgCard,
        border: warning ? 'none' : `1px solid ${tokens.colors.border}`,
        color: warning ? tokens.colors.warning : tokens.colors.textMuted,
        fontSize: tokens.type.small,
        lineHeight: 1.55,
      }}
    >
      {children}
    </div>
  );
}

// A shell command the owner can run, with a working copy button.
export function CommandLine({ command }: { command: string }) {
  const { tokens } = useTheme();
  const [copied, setCopied] = useState<'yes' | 'failed' | null>(null);
  const copy = () => {
    navigator.clipboard
      .writeText(command)
      .then(() => setCopied('yes'))
      .catch(() => setCopied('failed'))
      .finally(() => setTimeout(() => setCopied(null), 1600));
  };
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        padding: '8px 8px 8px 12px',
        borderRadius: tokens.radius.sm,
        background: tokens.colors.bgElevated,
        border: `1px solid ${tokens.colors.border}`,
        minWidth: 0,
      }}
    >
      <code
        style={{
          flex: 1,
          minWidth: 0,
          fontFamily: tokens.fonts.mono,
          fontSize: tokens.type.micro,
          color: tokens.colors.text,
          whiteSpace: 'nowrap',
          overflowX: 'auto',
        }}
      >
        {command}
      </code>
      <button
        className="btn btn-secondary"
        onClick={copy}
        style={{ padding: '5px 10px', fontSize: tokens.type.micro, flexShrink: 0 }}
      >
        {copied === 'yes' ? 'Copied' : copied === 'failed' ? 'Copy failed' : 'Copy'}
      </button>
    </div>
  );
}

export function PageHeader({ title, subtitle, right }: { title: ReactNode; subtitle?: ReactNode; right?: ReactNode }) {
  const { tokens } = useTheme();
  return (
    <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: '16px', marginBottom: '32px', flexWrap: 'wrap' }}>
      <div>
        <h1 style={{ fontFamily: tokens.fonts.display, fontSize: tokens.type.title, fontWeight: 500, letterSpacing: '-0.015em', lineHeight: 1.1 }}>
          {title}
        </h1>
        {subtitle && <p style={{ fontSize: tokens.type.small, color: tokens.colors.textMuted, marginTop: '8px' }}>{subtitle}</p>}
      </div>
      {right}
    </header>
  );
}
