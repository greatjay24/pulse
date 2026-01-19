import { createContext, useContext, useState, useEffect, ReactNode } from 'react';

// Font options
export const fontOptions = {
  inter: {
    sans: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
    mono: "'JetBrains Mono', 'SF Mono', monospace",
    label: 'Inter',
  },
  'space-grotesk': {
    sans: "'Space Grotesk', -apple-system, BlinkMacSystemFont, sans-serif",
    mono: "'Space Mono', 'JetBrains Mono', monospace",
    label: 'Space Grotesk',
  },
  jetbrains: {
    sans: "'JetBrains Mono', 'SF Mono', monospace",
    mono: "'JetBrains Mono', 'SF Mono', monospace",
    label: 'JetBrains Mono',
  },
};

// Theme color palettes
export const themes = {
  dark: {
    bg: '#0a0a0b',
    bgElevated: '#111113',
    bgCard: 'rgba(255, 255, 255, 0.03)',
    bgCardHover: 'rgba(255, 255, 255, 0.05)',
    border: 'rgba(255, 255, 255, 0.06)',
    borderHover: 'rgba(255, 255, 255, 0.1)',
    text: '#fafafa',
    textMuted: 'rgba(255, 255, 255, 0.5)',
    textDim: 'rgba(255, 255, 255, 0.3)',
    accent: '#3b82f6',
    accentGlow: 'rgba(59, 130, 246, 0.15)',
    success: '#22c55e',
    successMuted: 'rgba(34, 197, 94, 0.15)',
    warning: '#f59e0b',
    warningMuted: 'rgba(245, 158, 11, 0.15)',
    danger: '#ef4444',
    dangerMuted: 'rgba(239, 68, 68, 0.15)',
  },
  light: {
    bg: '#ffffff',
    bgElevated: '#f8f9fa',
    bgCard: 'rgba(0, 0, 0, 0.02)',
    bgCardHover: 'rgba(0, 0, 0, 0.04)',
    border: 'rgba(0, 0, 0, 0.08)',
    borderHover: 'rgba(0, 0, 0, 0.15)',
    text: '#0a0a0b',
    textMuted: 'rgba(0, 0, 0, 0.6)',
    textDim: 'rgba(0, 0, 0, 0.4)',
    accent: '#2563eb',
    accentGlow: 'rgba(37, 99, 235, 0.1)',
    success: '#16a34a',
    successMuted: 'rgba(22, 163, 74, 0.1)',
    warning: '#d97706',
    warningMuted: 'rgba(217, 119, 6, 0.1)',
    danger: '#dc2626',
    dangerMuted: 'rgba(220, 38, 38, 0.1)',
  },
};

// Base design tokens
export const baseTokens = {
  radius: {
    sm: '8px',
    md: '12px',
    lg: '16px',
    xl: '20px',
  },
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
  colors: typeof themes.dark;
  fonts: typeof fontOptions.inter;
  radius: typeof baseTokens.radius;
}

interface ThemeContextValue {
  tokens: ThemeTokens;
  themeMode: ThemeMode;
  setThemeMode: (mode: ThemeMode) => void;
  fontChoice: FontChoice;
  setFontChoice: (font: FontChoice) => void;
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

interface ThemeProviderProps {
  children: ReactNode;
}

export function ThemeProvider({ children }: ThemeProviderProps) {
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => {
    if (typeof window !== 'undefined') {
      return (localStorage.getItem('pulse-theme') as ThemeMode) || 'system';
    }
    return 'system';
  });

  const [fontChoice, setFontChoice] = useState<FontChoice>(() => {
    if (typeof window !== 'undefined') {
      return (localStorage.getItem('pulse-font') as FontChoice) || 'jetbrains';
    }
    return 'jetbrains';
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
  useEffect(() => {
    localStorage.setItem('pulse-theme', themeMode);
  }, [themeMode]);

  useEffect(() => {
    localStorage.setItem('pulse-font', fontChoice);
  }, [fontChoice]);

  // Build tokens
  const tokens: ThemeTokens = {
    colors: themes[resolvedTheme],
    fonts: fontOptions[fontChoice],
    radius: baseTokens.radius,
  };

  return (
    <ThemeContext.Provider value={{
      tokens,
      themeMode,
      setThemeMode,
      fontChoice,
      setFontChoice,
      resolvedTheme,
    }}>
      {children}
    </ThemeContext.Provider>
  );
}
