import { useTheme } from '../contexts/ThemeContext';

interface IconProps {
  size?: number;
  color?: string;
}

// Revenue/Dollar icon
export function RevenueIcon({ size = 18, color }: IconProps) {
  const { tokens } = useTheme();
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color || tokens.colors.textMuted} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="1" x2="12" y2="23" />
      <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
    </svg>
  );
}

// Users icon
export function UsersIcon({ size = 18, color }: IconProps) {
  const { tokens } = useTheme();
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color || tokens.colors.textMuted} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

// Subscriptions/Refresh icon
export function SubscriptionsIcon({ size = 18, color }: IconProps) {
  const { tokens } = useTheme();
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color || tokens.colors.textMuted} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
      <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
      <path d="M16 21h5v-5" />
    </svg>
  );
}

// Churn/TrendingDown icon
export function ChurnIcon({ size = 18, color }: IconProps) {
  const { tokens } = useTheme();
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color || tokens.colors.textMuted} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="23 18 13.5 8.5 8.5 13.5 1 6" />
      <polyline points="17 18 23 18 23 12" />
    </svg>
  );
}

// Chart/Analytics icon
export function AnalyticsIcon({ size = 18, color }: IconProps) {
  const { tokens } = useTheme();
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color || tokens.colors.textMuted} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="20" x2="18" y2="10" />
      <line x1="12" y1="20" x2="12" y2="4" />
      <line x1="6" y1="20" x2="6" y2="14" />
    </svg>
  );
}

// Calendar icon
export function CalendarIcon({ size = 18, color }: IconProps) {
  const { tokens } = useTheme();
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color || tokens.colors.textMuted} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  );
}

// Settings/Gear icon
export function SettingsIcon({ size = 18, color }: IconProps) {
  const { tokens } = useTheme();
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color || tokens.colors.textMuted} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

// Plus icon
export function PlusIcon({ size = 18, color }: IconProps) {
  const { tokens } = useTheme();
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color || tokens.colors.textMuted} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

// Home/Overview icon
export function HomeIcon({ size = 18, color }: IconProps) {
  const { tokens } = useTheme();
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color || tokens.colors.textMuted} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <polyline points="9 22 9 12 15 12 15 22" />
    </svg>
  );
}

// Pulse/Activity icon (for logo)
export function PulseIcon({ size = 18, color }: IconProps) {
  const { tokens } = useTheme();
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color || tokens.colors.accent} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
    </svg>
  );
}

// Refresh icon
export function RefreshIcon({ size = 18, color }: IconProps) {
  const { tokens } = useTheme();
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color || tokens.colors.textMuted} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="23 4 23 10 17 10" />
      <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
    </svg>
  );
}

// Arrow up icon
export function ArrowUpIcon({ size = 12, color }: IconProps) {
  const { tokens } = useTheme();
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color || tokens.colors.success} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="18 15 12 9 6 15" />
    </svg>
  );
}

// Arrow down icon
export function ArrowDownIcon({ size = 12, color }: IconProps) {
  const { tokens } = useTheme();
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color || tokens.colors.danger} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

// Activity/Feed icon
export function ActivityIcon({ size = 18, color }: IconProps) {
  const { tokens } = useTheme();
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color || tokens.colors.textMuted} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}

// Widget/Grid icon
export function WidgetIcon({ size = 18, color }: IconProps) {
  const { tokens } = useTheme();
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color || tokens.colors.textMuted} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7" />
      <rect x="14" y="3" width="7" height="7" />
      <rect x="14" y="14" width="7" height="7" />
      <rect x="3" y="14" width="7" height="7" />
    </svg>
  );
}

// Trash/Delete icon
export function TrashIcon({ size = 18, color }: IconProps) {
  const { tokens } = useTheme();
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color || tokens.colors.textMuted} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </svg>
  );
}

// Check icon
export function CheckIcon({ size = 18, color }: IconProps) {
  const { tokens } = useTheme();
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color || tokens.colors.success} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

// X/Close icon
export function CloseIcon({ size = 18, color }: IconProps) {
  const { tokens } = useTheme();
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color || tokens.colors.textMuted} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

// Credit Card icon
export function CreditCardIcon({ size = 18, color }: IconProps) {
  const { tokens } = useTheme();
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color || tokens.colors.textMuted} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="1" y="4" width="22" height="16" rx="2" ry="2" />
      <line x1="1" y1="10" x2="23" y2="10" />
    </svg>
  );
}

// Single User icon
export function UserIcon({ size = 18, color }: IconProps) {
  const { tokens } = useTheme();
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color || tokens.colors.textMuted} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

// Target/Milestone icon
export function TargetIcon({ size = 18, color }: IconProps) {
  const { tokens } = useTheme();
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color || tokens.colors.textMuted} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <circle cx="12" cy="12" r="6" />
      <circle cx="12" cy="12" r="2" />
    </svg>
  );
}

// Alert/Warning icon
export function AlertIcon({ size = 18, color }: IconProps) {
  const { tokens } = useTheme();
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color || tokens.colors.warning} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}

// Mobile/Smartphone icon
export function MobileIcon({ size = 18, color }: IconProps) {
  const { tokens } = useTheme();
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color || tokens.colors.textMuted} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="5" y="2" width="14" height="20" rx="2" ry="2" />
      <line x1="12" y1="18" x2="12.01" y2="18" />
    </svg>
  );
}

// Mail/Email icon
export function MailIcon({ size = 18, color }: IconProps) {
  const { tokens } = useTheme();
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color || tokens.colors.textMuted} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
      <polyline points="22,6 12,13 2,6" />
    </svg>
  );
}

// Lock icon
export function LockIcon({ size = 18, color }: IconProps) {
  const { tokens } = useTheme();
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color || tokens.colors.textMuted} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}

// Rocket icon
export function RocketIcon({ size = 18, color }: IconProps) {
  const { tokens } = useTheme();
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color || tokens.colors.textMuted} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z" />
      <path d="M12 15l-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z" />
      <path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0" />
      <path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5" />
    </svg>
  );
}

// Globe icon
export function GlobeIcon({ size = 18, color }: IconProps) {
  const { tokens } = useTheme();
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color || tokens.colors.textMuted} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <line x1="2" y1="12" x2="22" y2="12" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  );
}

// Server icon
export function ServerIcon({ size = 18, color }: IconProps) {
  const { tokens } = useTheme();
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color || tokens.colors.textMuted} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="2" width="20" height="8" rx="2" ry="2" />
      <rect x="2" y="14" width="20" height="8" rx="2" ry="2" />
      <line x1="6" y1="6" x2="6.01" y2="6" />
      <line x1="6" y1="18" x2="6.01" y2="18" />
    </svg>
  );
}

// Database icon
export function DatabaseIcon({ size = 18, color }: IconProps) {
  const { tokens } = useTheme();
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color || tokens.colors.textMuted} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <ellipse cx="12" cy="5" rx="9" ry="3" />
      <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
      <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
    </svg>
  );
}

// Cloud icon
export function CloudIcon({ size = 18, color }: IconProps) {
  const { tokens } = useTheme();
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color || tokens.colors.textMuted} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z" />
    </svg>
  );
}

// Sun icon
export function SunIcon({ size = 18, color }: IconProps) {
  const { tokens } = useTheme();
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color || tokens.colors.textMuted} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="5" />
      <line x1="12" y1="1" x2="12" y2="3" />
      <line x1="12" y1="21" x2="12" y2="23" />
      <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
      <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
      <line x1="1" y1="12" x2="3" y2="12" />
      <line x1="21" y1="12" x2="23" y2="12" />
      <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
      <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
    </svg>
  );
}

// Moon icon
export function MoonIcon({ size = 18, color }: IconProps) {
  const { tokens } = useTheme();
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color || tokens.colors.textMuted} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}

// Download icon
export function DownloadIcon({ size = 18, color }: IconProps) {
  const { tokens } = useTheme();
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color || tokens.colors.textMuted} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}

// External link / Arrow right icon
export function ExternalLinkIcon({ size = 18, color }: IconProps) {
  const { tokens } = useTheme();
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color || tokens.colors.textMuted} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <polyline points="15 3 21 3 21 9" />
      <line x1="10" y1="14" x2="21" y2="3" />
    </svg>
  );
}

// Triangle (Vercel) icon
export function TriangleIcon({ size = 18, color }: IconProps) {
  const { tokens } = useTheme();
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={color || tokens.colors.textMuted} stroke="none">
      <path d="M12 2L2 22h20L12 2z" />
    </svg>
  );
}

// Diamond (Linear) icon
export function DiamondIcon({ size = 18, color }: IconProps) {
  const { tokens } = useTheme();
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color || tokens.colors.textMuted} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2l10 10-10 10L2 12 12 2z" />
    </svg>
  );
}

// Trending up icon
export function TrendingUpIcon({ size = 18, color }: IconProps) {
  const { tokens } = useTheme();
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color || tokens.colors.success} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
      <polyline points="17 6 23 6 23 12" />
    </svg>
  );
}

// Eye icon
export function EyeIcon({ size = 18, color }: IconProps) {
  const { tokens } = useTheme();
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color || tokens.colors.textMuted} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

// Helper to render icon by name
export function Icon({ name, size = 18, color }: { name: string; size?: number; color?: string }) {
  switch (name) {
    case 'revenue': return <RevenueIcon size={size} color={color} />;
    case 'users': return <UsersIcon size={size} color={color} />;
    case 'user': return <UserIcon size={size} color={color} />;
    case 'subscriptions': return <SubscriptionsIcon size={size} color={color} />;
    case 'churn': return <ChurnIcon size={size} color={color} />;
    case 'analytics': return <AnalyticsIcon size={size} color={color} />;
    case 'calendar': return <CalendarIcon size={size} color={color} />;
    case 'settings': return <SettingsIcon size={size} color={color} />;
    case 'plus': return <PlusIcon size={size} color={color} />;
    case 'home': return <HomeIcon size={size} color={color} />;
    case 'pulse': return <PulseIcon size={size} color={color} />;
    case 'refresh': return <RefreshIcon size={size} color={color} />;
    case 'arrow-up': return <ArrowUpIcon size={size} color={color} />;
    case 'arrow-down': return <ArrowDownIcon size={size} color={color} />;
    case 'activity': return <ActivityIcon size={size} color={color} />;
    case 'widget': return <WidgetIcon size={size} color={color} />;
    case 'trash': return <TrashIcon size={size} color={color} />;
    case 'check': return <CheckIcon size={size} color={color} />;
    case 'close': return <CloseIcon size={size} color={color} />;
    case 'credit-card': return <CreditCardIcon size={size} color={color} />;
    case 'target': return <TargetIcon size={size} color={color} />;
    case 'alert': return <AlertIcon size={size} color={color} />;
    case 'mobile': return <MobileIcon size={size} color={color} />;
    case 'mail': return <MailIcon size={size} color={color} />;
    case 'lock': return <LockIcon size={size} color={color} />;
    case 'rocket': return <RocketIcon size={size} color={color} />;
    case 'globe': return <GlobeIcon size={size} color={color} />;
    case 'server': return <ServerIcon size={size} color={color} />;
    case 'database': return <DatabaseIcon size={size} color={color} />;
    case 'cloud': return <CloudIcon size={size} color={color} />;
    case 'sun': return <SunIcon size={size} color={color} />;
    case 'moon': return <MoonIcon size={size} color={color} />;
    case 'download': return <DownloadIcon size={size} color={color} />;
    case 'external-link': return <ExternalLinkIcon size={size} color={color} />;
    case 'triangle': return <TriangleIcon size={size} color={color} />;
    case 'diamond': return <DiamondIcon size={size} color={color} />;
    case 'trending-up': return <TrendingUpIcon size={size} color={color} />;
    case 'eye': return <EyeIcon size={size} color={color} />;
    default: return null;
  }
}
