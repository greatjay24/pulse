import { useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { LiveSnapshot, Transcript } from '../types';
import { IS_TAURI } from '../utils/orgSource';
import { DEFAULT_HOTKEY, applyHotkey, loadVoice, speakReply } from '../utils/voice';

// Mounted once in the main window (which stays alive while hidden): reads the front door's
// replies aloud as they finish, and applies the listening hotkey chosen in Settings.
// Replies to Telegram messages and scheduled runs stay quiet: the owner isn't at the Mac.
const QUIET_SOURCES = new Set(['telegram', 'schedule']);

export function useVoice(live: LiveSnapshot | null, frontDoor: string | null) {
  const seen = useRef<Map<string, string>>(new Map()); // run id -> last state seen

  useEffect(() => {
    if (!IS_TAURI) return;
    const hotkey = loadVoice().hotkey;
    if (hotkey !== DEFAULT_HOTKEY) applyHotkey(hotkey).catch(() => {});
  }, []);

  useEffect(() => {
    if (!IS_TAURI || !live || !frontDoor) return;
    for (const r of live.runs) {
      if (r.agent !== frontDoor || r.kind !== 'chat') continue;
      const before = seen.current.get(r.run_id);
      seen.current.set(r.run_id, r.state);
      // Only a reply seen working in this session: never a backlog read at startup.
      const wasWorking = before === 'running' || before === 'queued';
      if (!wasWorking || r.state !== 'finished' || QUIET_SOURCES.has(r.source ?? '')) continue;
      invoke<string>('read_transcript', { runId: r.run_id })
        .then((json) => {
          const t: Transcript = JSON.parse(json);
          const last = [...t.lines].reverse().find((l) => l.t === 'result');
          speakReply(last && last.t === 'result' ? last.result : r.result ?? '');
        })
        .catch(() => speakReply(r.result ?? ''));
    }
  }, [live, frontDoor]);
}
