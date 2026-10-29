import { createContext, useContext, useState, useEffect, ReactNode } from 'react';

// Type: a serif for titles (classical, like a film's title card), a calm sans for reading,
// and mono only where characters must line up (branches, commands). System faces, so
// nothing is fetched.
const SYSTEM_SANS = "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Helvetica Neue', sans-serif";
const SYSTEM_SERIF = "ui-serif, 'New York', 'Iowan Old Style', Charter, Georgia, serif";
const SYSTEM_MONO = "ui-monospace, 'SF Mono', 'JetBrains Mono', Menlo, monospace";

export const fontOptions = {
  editorial: {
    display: SYSTEM_SERIF,
    sans: SYSTEM_SANS,
    mono: SYSTEM_MONO,
    label: 'Editorial',
  },
  inter: {
    display: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
    sans: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
    mono: "'JetBrains Mono', 'SF Mono', monospace",
    label: 'Inter',
  },
  'space-grotesk': {
    display: "'Space Grotesk', -apple-system, BlinkMacSystemFont, sans-serif",
    sans: "'Space Grotesk', -apple-system, BlinkMacSystemFont, sans-serif",
    mono: "'Space Mono', 'JetBrains Mono', monospace",
    label: 'Space Grotesk',
  },
  jetbrains: {
    display: "'JetBrains Mono', 'SF Mono', monospace",
    sans: "'JetBrains Mono', 'SF Mono', monospace",
    mono: "'JetBrains Mono', 'SF Mono', monospace",
    label: 'JetBrains Mono',
  },
};

// What a preset defines per mode; the muted/glow tints are derived from these.
interface Palette {
  bg: string;
  bgElevated: string;
  bgCard: string;
  bgCardHover: string;
  border: string;
  borderHover: string;
  text: string;
  textMuted: string;
  textDim: string;
  accent: string; // chrome: selection, links, emphasis
  chart: string; // data marks (money bars), kept apart from status colors
  success: string;
  warning: string;
  danger: string;
}

export interface ThemeColors extends Palette {
  accentGlow: string;
  accentInk: string; // text on an accent fill
  chartTrack: string; // the unfilled part of a bar
  successMuted: string;
  warningMuted: string;
  dangerMuted: string;
}

// Presets after the films in the owner's taste guide (the owner's taste guide):
// two or three specific colors doing the work, or rich black and white. Never pure white
// on pure black: text is warm and slightly off, so long reading is easy on the eye.
export const presets: Record<string, { label: string; note: string; dark: Palette; light: Palette }> = {
  'paris-texas': {
    label: 'Paris, Texas',
    note: 'Red sweater against teal sky',
    dark: {
      bg: '#0e1819', bgElevated: '#122022', bgCard: '#152527', bgCardHover: '#1a2d30',
      border: 'rgba(214, 236, 230, 0.09)', borderHover: 'rgba(214, 236, 230, 0.18)',
      text: '#f1e9de', textMuted: 'rgba(241, 233, 222, 0.74)', textDim: 'rgba(241, 233, 222, 0.52)',
      accent: '#e5503f', chart: '#5fbcb0', success: '#6cc08f', warning: '#e7b04f', danger: '#f0715f',
    },
    light: {
      bg: '#f4ede2', bgElevated: '#ece2d3', bgCard: '#fbf7f0', bgCardHover: '#fffbf5',
      border: 'rgba(70, 45, 25, 0.12)', borderHover: 'rgba(70, 45, 25, 0.24)',
      text: '#221b16', textMuted: 'rgba(34, 27, 22, 0.74)', textDim: 'rgba(34, 27, 22, 0.55)',
      accent: '#b3291c', chart: '#1d7870', success: '#2f7d50', warning: '#9a5f0c', danger: '#b8321f',
    },
  },
  'wings-of-desire': {
    label: 'Wings of Desire',
    note: 'Rich black and white',
    dark: {
      bg: '#0d0d0c', bgElevated: '#141413', bgCard: '#181817', bgCardHover: '#1f1f1d',
      border: 'rgba(236, 234, 226, 0.09)', borderHover: 'rgba(236, 234, 226, 0.2)',
      text: '#ecebe4', textMuted: 'rgba(236, 235, 228, 0.72)', textDim: 'rgba(236, 235, 228, 0.5)',
      accent: '#ecebe4', chart: '#cfcdc4', success: '#8fbf98', warning: '#dcb56c', danger: '#e58070',
    },
    light: {
      bg: '#f1f0eb', bgElevated: '#e8e6e0', bgCard: '#fbfaf7', bgCardHover: '#ffffff',
      border: 'rgba(20, 20, 18, 0.12)', borderHover: 'rgba(20, 20, 18, 0.26)',
      text: '#151513', textMuted: 'rgba(21, 21, 19, 0.74)', textDim: 'rgba(21, 21, 19, 0.55)',
      accent: '#151513', chart: '#2f2f2c', success: '#2f7a46', warning: '#94600e', danger: '#b3352a',
    },
  },
  moonlight: {
    label: 'Moonlight',
    note: 'Teal and pink, deep night',
    dark: {
      bg: '#0a1517', bgElevated: '#0f1c1f', bgCard: '#122326', bgCardHover: '#172b2f',
      border: 'rgba(206, 236, 232, 0.09)', borderHover: 'rgba(206, 236, 232, 0.18)',
      text: '#edf2ee', textMuted: 'rgba(237, 242, 238, 0.74)', textDim: 'rgba(237, 242, 238, 0.52)',
      accent: '#ef84ab', chart: '#5ecbc2', success: '#6cc59b', warning: '#f0c254', danger: '#f27466',
    },
    light: {
      bg: '#edf3f0', bgElevated: '#e1ebe7', bgCard: '#fafdfb', bgCardHover: '#ffffff',
      border: 'rgba(16, 40, 38, 0.12)', borderHover: 'rgba(16, 40, 38, 0.24)',
      text: '#10201f', textMuted: 'rgba(16, 32, 31, 0.74)', textDim: 'rgba(16, 32, 31, 0.55)',
      accent: '#b8285f', chart: '#127670', success: '#2c7a4e', warning: '#946010', danger: '#b5352a',
    },
  },
  'days-of-heaven': {
    label: 'Days of Heaven',
    note: 'Magic hour on the prairie',
    dark: {
      bg: '#15110c', bgElevated: '#1b1611', bgCard: '#201a14', bgCardHover: '#272018',
      border: 'rgba(243, 226, 200, 0.09)', borderHover: 'rgba(243, 226, 200, 0.18)',
      text: '#f4e9d7', textMuted: 'rgba(244, 233, 215, 0.74)', textDim: 'rgba(244, 233, 215, 0.52)',
      accent: '#e8a64c', chart: '#e8a64c', success: '#94c27e', warning: '#f28c4e', danger: '#ec6552',
    },
    light: {
      bg: '#f5ecdb', bgElevated: '#ede0c9', bgCard: '#fdf8ee', bgCardHover: '#fffcf5',
      border: 'rgba(80, 55, 20, 0.13)', borderHover: 'rgba(80, 55, 20, 0.26)',
      text: '#2a2117', textMuted: 'rgba(42, 33, 23, 0.74)', textDim: 'rgba(42, 33, 23, 0.55)',
      accent: '#9c5813', chart: '#a8641c', success: '#45763a', warning: '#b0501a', danger: '#b1372a',
    },
  },
  chungking: {
    label: 'Chungking Express',
    note: 'Lime and orange title cards',
    dark: {
      bg: '#0f110c', bgElevated: '#141710', bgCard: '#181c13', bgCardHover: '#1e2318',
      border: 'rgba(232, 240, 210, 0.09)', borderHover: 'rgba(232, 240, 210, 0.18)',
      text: '#eef0e3', textMuted: 'rgba(238, 240, 227, 0.74)', textDim: 'rgba(238, 240, 227, 0.52)',
      accent: '#c8e03c', chart: '#c8e03c', success: '#5fc3a2', warning: '#f39b3d', danger: '#f0645c',
    },
    light: {
      bg: '#f2f3e9', bgElevated: '#e7e9da', bgCard: '#fcfdf6', bgCardHover: '#ffffff',
      border: 'rgba(30, 36, 14, 0.12)', borderHover: 'rgba(30, 36, 14, 0.24)',
      text: '#17190f', textMuted: 'rgba(23, 25, 15, 0.74)', textDim: 'rgba(23, 25, 15, 0.55)',
      accent: '#c94f17', chart: '#4c7414', success: '#2b7a4b', warning: '#9a6110', danger: '#b4312a',
    },
  },
  'mood-for-love': {
    label: 'In the Mood for Love',
    note: 'Crimson and gold in shadow',
    dark: {
      bg: '#170c0d', bgElevated: '#1d1012', bgCard: '#231416', bgCardHover: '#2b191b',
      border: 'rgba(242, 218, 210, 0.09)', borderHover: 'rgba(242, 218, 210, 0.18)',
      text: '#f3e5dd', textMuted: 'rgba(243, 229, 221, 0.74)', textDim: 'rgba(243, 229, 221, 0.52)',
      accent: '#df4d58', chart: '#e5c07f', success: '#86bf8e', warning: '#f0954a', danger: '#ff7a72',
    },
    light: {
      bg: '#f6ece6', bgElevated: '#eedfd6', bgCard: '#fffaf6', bgCardHover: '#ffffff',
      border: 'rgba(70, 20, 25, 0.12)', borderHover: 'rgba(70, 20, 25, 0.24)',
      text: '#2a1416', textMuted: 'rgba(42, 20, 22, 0.74)', textDim: 'rgba(42, 20, 22, 0.55)',
      accent: '#9b1d2a', chart: '#8c5a18', success: '#3a7748', warning: '#a6581a', danger: '#b02a2a',
    },
  },
};

export type PresetId = keyof typeof presets;
const DEFAULT_PRESET: PresetId = 'paris-texas';

function hexToRgb(hex: string): [number, number, number] | null {
  const m = hex.trim().match(/^#?([0-9a-f]{6})$/i);
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function withAlpha(hex: string, alpha: number): string {
  const rgb = hexToRgb(hex);
  return rgb ? `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})` : hex;
}

// Dark ink on light fills, light ink on dark ones (WCAG relative luminance).
export function inkOn(hex: string): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return '#ffffff';
  const [r, g, b] = rgb.map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.4 ? '#111111' : '#ffffff';
}

export const isHexColor = (v: string | null | undefined): v is string => !!v && !!hexToRgb(v);

function buildColors(p: Palette, mode: 'dark' | 'light', accentOverride: string | null): ThemeColors {
  const accent = accentOverride ?? p.accent;
  const tint = mode === 'dark' ? 0.16 : 0.11;
  return {
    ...p,
    accent,
    accentGlow: withAlpha(accent, tint),
    accentInk: inkOn(accent),
    chartTrack: withAlpha(p.chart, mode === 'dark' ? 0.14 : 0.12),
    successMuted: withAlpha(p.success, tint),
    warningMuted: withAlpha(p.warning, tint),
    dangerMuted: withAlpha(p.danger, tint),
  };
}

// Base design tokens
export const baseTokens = {
  radius: {
    sm: '8px',
    md: '12px',
    lg: '16px',
    xl: '20px',
  },
};

// One type scale for the board, dashboards and Today. Nothing readable goes below 12px.
export const typeScale = {
  hero: '56px', // the one number a view leads with
  title: '34px', // page titles (display face)
  heading: '22px', // section headings (display face)
  lead: '17px', // headlines under a title
  body: '15px',
  small: '13px',
  micro: '12px',
};

// Get system theme preference
const getSystemTheme = (): 'dark' | 'light' => {
  if (typeof window !== 'undefined' && window.matchMedia) {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return 'dark';
};

export type ThemeMode = 'light' | 'dark' | 'system';
export type FontChoice = keyof typeof fontOptions;

interface ThemeTokens {
  colors: ThemeColors;
  fonts: typeof fontOptions.editorial;
  radius: typeof baseTokens.radius;
  type: typeof typeScale;
}

interface ThemeContextValue {
  tokens: ThemeTokens;
  themeMode: ThemeMode;
  setThemeMode: (mode: ThemeMode) => void;
  fontChoice: FontChoice;
  setFontChoice: (font: FontChoice) => void;
  preset: PresetId;
  setPreset: (preset: PresetId) => void;
  customAccent: string | null;
  setCustomAccent: (hex: string | null) => void;
  resolvedTheme: 'dark' | 'light';
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}

// Appearance lives in localStorage, like the theme mode always has. Every read is guarded
// so a blocked store falls back to the defaults instead of breaking the app.
function stored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function store(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // not persisted; the choice still applies for this session
  }
}

// CSS variables for index.css (buttons, inputs, scrollbars), so they follow the theme too.
const CSS_VARS: [string, keyof ThemeColors][] = [
  ['--bg', 'bg'], ['--bg-elevated', 'bgElevated'], ['--bg-card', 'bgCard'], ['--bg-card-hover', 'bgCardHover'],
  ['--border', 'border'], ['--border-hover', 'borderHover'], ['--text', 'text'], ['--text-muted', 'textMuted'],
  ['--text-dim', 'textDim'], ['--accent', 'accent'], ['--accent-glow', 'accentGlow'], ['--accent-ink', 'accentInk'],
  ['--success', 'success'], ['--success-muted', 'successMuted'], ['--warning', 'warning'],
  ['--warning-muted', 'warningMuted'], ['--danger', 'danger'], ['--danger-muted', 'dangerMuted'],
];

interface ThemeProviderProps {
  children: ReactNode;
}

export function ThemeProvider({ children }: ThemeProviderProps) {
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => (stored('pulse-theme') as ThemeMode) || 'system');

  // A new key: the old 'pulse-font' was saved as all-monospace by default, which this
  // redesign replaces. Mono is still one click away in Settings.
  const [fontChoice, setFontChoice] = useState<FontChoice>(() => {
    const saved = stored('pulse-type') as FontChoice | null;
    return saved && saved in fontOptions ? saved : 'editorial';
  });

  const [preset, setPreset] = useState<PresetId>(() => {
    const saved = stored('pulse-preset');
    return saved && saved in presets ? saved : DEFAULT_PRESET;
  });

  const [customAccent, setCustomAccent] = useState<string | null>(() => {
    const saved = stored('pulse-accent');
    return isHexColor(saved) ? saved : null;
  });

  const [resolvedTheme, setResolvedTheme] = useState<'dark' | 'light'>(getSystemTheme());

  // Handle theme mode changes
  useEffect(() => {
    if (themeMode === 'system') {
      const updateTheme = () => setResolvedTheme(getSystemTheme());
      updateTheme();

      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      mediaQuery.addEventListener('change', updateTheme);
      return () => mediaQuery.removeEventListener('change', updateTheme);
    } else {
      setResolvedTheme(themeMode);
    }
  }, [themeMode]);

  // Persist preferences
  useEffect(() => store('pulse-theme', themeMode), [themeMode]);
  useEffect(() => store('pulse-type', fontChoice), [fontChoice]);
  useEffect(() => store('pulse-preset', preset), [preset]);
  useEffect(() => store('pulse-accent', customAccent), [customAccent]);

  // Build tokens
  const tokens: ThemeTokens = {
    colors: buildColors(presets[preset][resolvedTheme], resolvedTheme, customAccent),
    fonts: fontOptions[fontChoice],
    radius: baseTokens.radius,
    type: typeScale,
  };

  useEffect(() => {
    const root = document.documentElement.style;
    for (const [name, key] of CSS_VARS) root.setProperty(name, tokens.colors[key]);
    root.setProperty('--font-sans', tokens.fonts.sans);
    root.setProperty('color-scheme', resolvedTheme);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preset, resolvedTheme, customAccent, fontChoice]);

  return (
    <ThemeContext.Provider value={{
      tokens,
      themeMode,
      setThemeMode,
      fontChoice,
      setFontChoice,
      preset,
      setPreset,
      customAccent,
      setCustomAccent,
      resolvedTheme,
    }}>
      {children}
    </ThemeContext.Provider>
  );
}
