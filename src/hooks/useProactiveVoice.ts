import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { LiveSnapshot, Transcript } from '../types';
import { IS_TAURI } from '../utils/orgSource';
import { loadVoice, speak, stopSpeaking, summaryOf } from '../utils/voice';
import {
  BATCH_MS,
  CalendarRow,
  Interrupt,
  NotifyRow,
  PrepRow,
  briefOpening,
  dedupeCalendar,
  draftFor,
  interruptFor,
  isFresh,
  isQuiet,
  localDay,
  meetingInterrupt,
  prepOffer,
  preppedIds,
  sentenceFor,
} from '../utils/proactive';

// Roo speaks first. Every minute: read what the watcher told the owner (watch/notify.jsonl) and the
// calendar cache, turn what needs him into one short sentence, and say it when allowed:
// Proactive voice on, not muted, outside quiet hours, no call (mic in use), screen unlocked,
// nothing else being read, and at most once per 10 minutes. A notification goes with it; its
// click (or the menu bar's "Roo said") opens the Roo thread with a ready-to-send message.
// The morning brief's opening is spoken once a day, before noon, when Roo is open.
// Meeting prep (~/portfolio/bin/meeting_prep.py): when a brief is due (10 minutes before; 8pm the
// night before for meetings before 9am) Roo asks "your meeting with X is in 10 minutes. Want a quick
// brief?" outside quiet hours too; saying it waits for no call and an unmuted voice, the notification
// always shows. Its click says the two-sentence brief and opens the thread. Every minute Roo writes
// watch/desktop.json (open, and which briefs it offered); without it the watcher uses Telegram.

const TICK_MS = 60 * 1000;
const SEEN_KEY = 'pulse-proactive-seen';
const SEEN_LIMIT = 400;
const LAST_KEY = 'pulse-proactive-last'; // when the last interrupt was spoken
const BRIEF_KEY = 'pulse-proactive-brief'; // the day the morning brief was spoken
const MUTE_KEY = 'pulse-voice-muted-until';
const MUTE_MS = 60 * 60 * 1000;
const SAID_SHOWN_MS = 30 * 60 * 1000; // "Roo said" stays in the menu bar this long
const BRIEF_BEFORE_HOUR = 12;
const PREP_OFFERED_KEY = 'pulse-prep-offered';
const PREP_OFFERED_LIMIT = 60;
export const PROACTIVE_TEST_EVENT = 'pulse-proactive-test'; // Settings' "Try it"

function get(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function put(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // not persisted: worst case Roo repeats itself after a restart
  }
}

function loadSeen(): string[] | null {
  try {
    const v = JSON.parse(get(SEEN_KEY) ?? 'null');
    return Array.isArray(v) ? v.filter((k) => typeof k === 'string') : null;
  } catch {
    return null;
  }
}

interface Status {
  speaking: boolean;
  mic_in_use: boolean | null;
  screen_locked: boolean | null;
}

export interface Said {
  id: string;
  text: string;
  draft: string;
  at: number;
  brief?: string; // meeting prep: said when the owner opens it
}

function loadOffered(): string[] {
  try {
    const v = JSON.parse(get(PREP_OFFERED_KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((k) => typeof k === 'string') : [];
  } catch {
    return [];
  }
}

export function useProactiveVoice({
  live,
  frontDoor,
  names,
  ownerName,
  onOpen,
  realOrg = true,
}: {
  realOrg?: boolean; // the demo org never tells the watcher Roo is open
  live: LiveSnapshot | null;
  frontDoor: string | null;
  names: Record<string, string>;
  ownerName: string | null; // how Roo addresses the owner ("Sam, ...")
  onOpen: (draft: string) => void;
}) {
  const [mutedUntil, setMutedUntil] = useState<number>(() => Number(get(MUTE_KEY)) || 0);
  const [said, setSaid] = useState<Said | null>(null);
  const [, setClock] = useState(0); // re-render when the mute or "Roo said" lapses
  const pending = useRef<Interrupt[]>([]);
  const recent = useRef<Said[]>([]);
  const busy = useRef(false);
  const liveRef = useRef(live);
  liveRef.current = live;
  const namesRef = useRef(names);
  namesRef.current = names;
  const ownerRef = useRef(ownerName);
  ownerRef.current = ownerName;
  const onOpenRef = useRef(onOpen);
  onOpenRef.current = onOpen;
  const mutedRef = useRef(mutedUntil);
  mutedRef.current = mutedUntil;

  // May Roo speak right now?
  const allowed = useCallback(async (): Promise<boolean> => {
    const v = loadVoice();
    if (!v.proactive || Date.now() < mutedRef.current || isQuiet(new Date(), v.quietStart, v.quietEnd)) return false;
    const s = await invoke<Status>('proactive_status');
    return !s.speaking && s.mic_in_use !== true && s.screen_locked !== true;
  }, []);

  const morningBrief = useCallback(async () => {
    const now = new Date();
    const today = localDay(now);
    if (!frontDoor || get(BRIEF_KEY) === today || now.getHours() >= BRIEF_BEFORE_HOUR) return;
    const runs = (liveRef.current?.runs ?? []).filter(
      (r) => r.agent === frontDoor && r.trigger === 'brief' && /morning/i.test(r.doing) && r.state === 'finished' && r.ok !== false && localDay(new Date(r.started)) === today,
    );
    const run = runs[runs.length - 1];
    if (!run) return;
    // Asked for from Roo or by voice: the reply was already read aloud as it finished.
    if (run.source !== 'schedule') {
      put(BRIEF_KEY, today);
      return;
    }
    if (!(await allowed())) return;
    let text = run.result ?? '';
    try {
      const t: Transcript = JSON.parse(await invoke<string>('read_transcript', { runId: run.run_id }));
      const last = [...t.lines].reverse().find((l) => l.t === 'result');
      if (last && last.t === 'result') text = last.result;
    } catch {
      // the live record's result will do
    }
    const opening = briefOpening(summaryOf(text));
    put(BRIEF_KEY, today);
    if (opening) await speak(opening, true);
  }, [frontDoor, allowed]);

  const tick = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      const now = Date.now();
      const [rows, cal, prep] = await Promise.all([
        invoke<NotifyRow[]>('read_watch_notify').catch(() => [] as NotifyRow[]),
        invoke<CalendarRow[]>('read_watch_calendar').catch(() => [] as CalendarRow[]),
        realOrg ? invoke<PrepRow[]>('read_meeting_prep').catch(() => [] as PrepRow[]) : Promise.resolve([] as PrepRow[]),
      ]);
      const covered = preppedIds(prep);
      const found: Interrupt[] = [];
      for (const r of rows) {
        const it = r && typeof r.id === 'string' ? interruptFor(r, namesRef.current) : null;
        if (it) found.push(it);
      }
      for (const e of dedupeCalendar(cal.filter((c) => c && typeof c.id === 'string' && !covered.has(c.id)))) {
        const it = meetingInterrupt(e, now);
        if (it) found.push(it);
      }
      // The first read only records what is there, so opening Roo never replays the backlog.
      const seen = loadSeen();
      const ids = rows.map((r) => r?.id).filter((k): k is string => typeof k === 'string');
      if (seen === null) {
        put(SEEN_KEY, JSON.stringify([...ids, ...found.map((f) => f.id)].slice(-SEEN_LIMIT)));
      } else {
        const known = new Set(seen);
        const fresh = found.filter((f) => !known.has(f.id) && isFresh(f, now) && !pending.current.some((p) => p.id === f.id));
        const newIds = [...ids, ...found.map((f) => f.id)].filter((k) => !known.has(k));
        if (newIds.length) put(SEEN_KEY, JSON.stringify([...seen, ...newIds].slice(-SEEN_LIMIT)));
        pending.current.push(...fresh);
      }

      await morningBrief();

      // Meeting prep first: one offer a minute at most, then tell the watcher Roo is here.
      if (realOrg) {
        const offered = loadOffered();
        const known = new Set(offered);
        let offeredNow = false;
        for (const r of prep) {
          const o = prepOffer(r, now, known, ownerRef.current);
          if (!o) continue;
          const st = await invoke<Status>('proactive_status');
          if (st.screen_locked === true) break; // away from the desk: the watcher sends it to Telegram
          offered.push(o.tag);
          put(PREP_OFFERED_KEY, JSON.stringify(offered.slice(-PREP_OFFERED_LIMIT)));
          const s: Said = { id: o.tag, text: o.text, draft: o.draft, brief: o.spoken, at: now };
          recent.current = [...recent.current.slice(-9), s];
          setSaid(s);
          if (loadVoice().proactive && Date.now() >= mutedRef.current && !st.speaking && st.mic_in_use !== true) {
            put(LAST_KEY, String(now));
            await speak(o.text, true);
          }
          await invoke('proactive_notify', { title: 'Roo', body: o.text, id: o.tag });
          offeredNow = true;
          break;
        }
        await invoke('desktop_heartbeat', { prepOffered: offered.slice(-PREP_OFFERED_LIMIT) }).catch(() => {});
        if (offeredNow) return;
      }

      pending.current = pending.current.filter((p) => isFresh(p, now));
      const last = Number(get(LAST_KEY)) || 0;
      if (pending.current.length === 0 || now - last < BATCH_MS || !(await allowed())) return;
      const batch = pending.current;
      pending.current = [];
      const text = sentenceFor(batch, ownerRef.current);
      const s: Said = { id: batch[0].id, text, draft: draftFor(batch), at: now };
      put(LAST_KEY, String(now));
      recent.current = [...recent.current.slice(-9), s];
      setSaid(s);
      await speak(text, true);
      await invoke('proactive_notify', { title: 'Roo', body: text, id: s.id });
    } catch (e) {
      console.error('Proactive voice:', e);
    } finally {
      busy.current = false;
    }
  }, [allowed, morningBrief, realOrg]);

  useEffect(() => {
    if (!IS_TAURI) return;
    const first = setTimeout(tick, 5000); // after the first reads settle
    const every = setInterval(tick, TICK_MS);
    return () => {
      clearTimeout(first);
      clearInterval(every);
    };
  }, [tick]);

  // The brief can finish between ticks while Roo is open.
  const briefKey = (live?.runs ?? []).filter((r) => r.trigger === 'brief').map((r) => `${r.run_id}:${r.state}`).join('|');
  useEffect(() => {
    if (IS_TAURI && briefKey) tick();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [briefKey]);

  // The menu bar: mute for an hour (or unmute), and open what Roo just said.
  useEffect(() => {
    if (!IS_TAURI) return;
    const offMute = listen('pulse://voice-mute', () => {
      const next = Date.now() < mutedRef.current ? 0 : Date.now() + MUTE_MS;
      put(MUTE_KEY, String(next));
      setMutedUntil(next);
      if (next) stopSpeaking().catch(() => {});
    });
    const offOpen = listen<string>('pulse://proactive-open', (e) => {
      const list = recent.current;
      const hit = e.payload === 'last' ? list[list.length - 1] : list.find((s) => s.id === e.payload);
      if (!hit) return;
      onOpenRef.current(hit.draft);
      if (hit.brief) speak(hit.brief, true).catch(() => {}); // asked for: said even in quiet hours
    });
    return () => {
      offMute.then((u) => u());
      offOpen.then((u) => u());
    };
  }, []);

  // Settings' "Try it": the whole path (voice, notification, its click) with a sample, ungated.
  useEffect(() => {
    if (!IS_TAURI) return;
    const onTest = () => {
      const s: Said = {
        id: `test-${Date.now()}`,
        text: sentenceFor([{ id: 'test', at: Date.now(), clause: 'Northwind replied about the proposal', ask: 'Want me to draft a response?', draft: '' }], ownerRef.current),
        draft: "This is a test of Roo's proactive voice: nothing came in. Reply \"ok\" and I'll confirm I heard it.",
        at: Date.now(),
      };
      recent.current = [...recent.current.slice(-9), s];
      setSaid(s);
      speak(s.text, true)
        .then(() => invoke('proactive_notify', { title: 'Roo', body: s.text, id: s.id }))
        .catch((e) => console.error('Proactive voice test:', e));
    };
    window.addEventListener(PROACTIVE_TEST_EVENT, onTest);
    return () => window.removeEventListener(PROACTIVE_TEST_EVENT, onTest);
  }, []);

  // Re-render when the mute or the menu bar's "Roo said" lapses.
  const now = Date.now();
  const lapses = [mutedUntil, said ? said.at + SAID_SHOWN_MS : 0].filter((t) => t > now);
  const nextLapse = lapses.length ? Math.min(...lapses) : 0;
  useEffect(() => {
    if (!nextLapse) return;
    const t = setTimeout(() => setClock((n) => n + 1), nextLapse - Date.now() + 500);
    return () => clearTimeout(t);
  }, [nextLapse]);

  return {
    muted: now < mutedUntil,
    said: said && now - said.at < SAID_SHOWN_MS ? (ownerName ? said.text.replace(`${ownerName}, `, '') : said.text) : null,
  };
}
