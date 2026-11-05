import { useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';
import { IS_TAURI } from '../utils/orgSource';
import { REPLY_EVENT, ReplyEvent, isBriefTurn, streamedRuns } from '../utils/reply';
import { ReplyStream, speakReplyStream } from '../utils/voice';

// Mounted once in the main window: reads Roo's replies from the listening panel aloud as they
// stream (utils/reply.ts). The quick lane is spoken token by token, so the first sentence
// starts while the rest is still being written; a full run is spoken when its result lands.
export function useReplyVoice() {
  useEffect(() => {
    if (!IS_TAURI) return;
    const streams = new Map<string, Promise<ReplyStream | null>>();
    const begin = (id: string) => {
      const s = speakReplyStream(isBriefTurn(id) ? Infinity : undefined).catch(() => null);
      streams.set(id, s);
      return s;
    };
    const off = listen<ReplyEvent>(REPLY_EVENT, ({ payload: e }) => {
      if (e.type === 'start') {
        if (e.lane === 'full' && e.run_id) streamedRuns.add(e.run_id);
        if (e.lane === 'fast') begin(e.id);
        return;
      }
      if (e.lane === 'fast' && e.type === 'delta' && e.text) {
        const text = e.text;
        streams.get(e.id)?.then((s) => s?.push(text));
      } else if (e.type === 'done') {
        const s = e.lane === 'full' ? begin(e.id) : streams.get(e.id);
        const text = e.text ?? '';
        if (e.lane === 'full' && text) s?.then((x) => x?.push(text));
        s?.then((x) => x?.end());
        streams.delete(e.id);
      } else if (e.type === 'handoff' || e.type === 'error') {
        // nothing was pushed: ending speaks nothing; full Roo's answer comes on a new turn
        streams.get(e.id)?.then((x) => x?.end());
        streams.delete(e.id);
      }
    });
    return () => {
      off.then((u) => u());
    };
  }, []);
}
