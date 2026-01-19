import { useState, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { GoogleCalendarConfig } from '../types';

// Check if running in Tauri
const IS_TAURI = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

export type OAuthStatus = 'idle' | 'connecting' | 'success' | 'error';

interface UseGoogleOAuthReturn {
  status: OAuthStatus;
  error: string | null;
  connect: () => Promise<GoogleCalendarConfig | null>;
  reset: () => void;
}

/**
 * Hook for handling Google OAuth flow (Calendar + Gmail)
 * Extracted from Settings.tsx for reuse in WidgetPicker
 */
export function useGoogleOAuth(): UseGoogleOAuthReturn {
  const [status, setStatus] = useState<OAuthStatus>('idle');
  const [error, setError] = useState<string | null>(null);

  const connect = useCallback(async (): Promise<GoogleCalendarConfig | null> => {
    if (!IS_TAURI) {
      setStatus('error');
      setError('Google connection only works in the desktop app');
      return null;
    }

    setStatus('connecting');
    setError(null);

    try {
      // This opens the browser, waits for OAuth callback, and returns tokens
      const tokenResponse = await invoke<string>('start_google_oauth');
      const tokens = JSON.parse(tokenResponse);

      const config: GoogleCalendarConfig = {
        enabled: true,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        calendarIds: ['primary'],
      };

      setStatus('success');
      return config;
    } catch (err) {
      setStatus('error');
      setError(`Failed to connect: ${err}`);
      return null;
    }
  }, []);

  const reset = useCallback(() => {
    setStatus('idle');
    setError(null);
  }, []);

  return { status, error, connect, reset };
}
