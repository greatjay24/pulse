import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useTheme } from '../contexts/ThemeContext';
import { PULSE_TARGET, askLead } from '../utils/command';
import { ListenSettings, helperArgs, listeningHint, loadListen, onHotkey } from '../utils/listen';
import { REPLY_EVENT, ReplyEvent, newTurnId } from '../utils/reply';
import { HOTKEYS, briefKindOf, briefMe, loadVoice, stopSpeaking, summaryOf } from '../utils/voice';
import { StrokeIcon } from './Icons';

// The listening panel: its own small window (index.html#listen), opened by the global hotkey,
// ⌘K's mic or the Roo thread's Talk. It transcribes on-device (pulse-listen). By default it's
// press to send: the hotkey starts it, the hotkey again (or Enter) sends, and pauses never cut
// the owner off. Settings also offer hold to talk and send when I pause (utils/listen.ts).
// Esc drops it (and silences Roo). The words stay editable, so a slip can be fixed, or typed.
//
// Sending tries Roo's quick lane first (Rust quick.rs: a tool-less model over a snapshot of the
// owner's files), which streams its answer here in a second or two; work, or anything the
// snapshot can't answer, goes to full Roo (ask_lead) as before. Both lanes push the reply on
// `pulse://roo-reply`; the main window reads it aloud as it streams (hooks/useReplyVoice.ts).

type Phase = 'starting' | 'listening' | 'typing' | 'sending' | 'waiting' | 'reply' | 'error';

type ListenEvent =
  | { type: 'ready' }
  | { type: 'level'; value: number }
  | { type: 'partial'; text: string }
  | { type: 'final'; text: string }
  | { type: 'error'; message: string }
  | { type: 'end' };

const HIDE_AFTER_REPLY_MS = 15_000;

function hotkeyLabel(): string {
  const key = loadVoice().hotkey;
  return HOTKEYS.find((h) => h.value === key)?.label ?? key;
}

export function ListenPanel() {
  const { tokens } = useTheme();
  const c = tokens.colors;
  const [phase, setPhase] = useState<Phase>('starting');
  const [text, setText] = useState('');
  const [level, setLevel] = useState(0);
  const [note, setNote] = useState<string | null>(null);
  const [reply, setReply] = useState('');
  const [runId, setRunId] = useState<string | null>(null);
  const [hover, setHover] = useState(false);
  const [settings, setSettings] = useState<ListenSettings>(loadListen);
  const [hotkey, setHotkey] = useState(hotkeyLabel);
  const phaseRef = useRef<Phase>('starting');
  phaseRef.current = phase;
  const textRef = useRef('');
  textRef.current = text;
  const settingsRef = useRef(settings);
  const openedAt = useRef(0);
  const turn = useRef<{ id: string; message: string; lane: 'fast' | 'full' } | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // A quick-lane answer still being written is dropped; a full run keeps going (and is read
  // aloud when it finishes, as before).
  const dropTurn = () => {
    const t = turn.current;
    if (t?.lane === 'fast') invoke('cancel_reply', { id: t.id }).catch(() => {});
    turn.current = null;
  };

  const hide = () => {
    dropTurn();
    invoke('hide_listen_panel').catch(() => {});
  };

  const fail = (e: unknown) => {
    setNote(String(e instanceof Error ? e.message : e));
    setPhase('error');
  };

  // Full Roo: start the run, then follow it on pulse://roo-reply.
  const toFullRoo = useCallback(async (id: string, message: string) => {
    turn.current = { id, message, lane: 'full' };
    try {
      const r = await askLead(PULSE_TARGET, message);
      if (turn.current?.id !== id) return;
      setRunId(r.run_id);
      setNote(r.queued ? 'Queued behind the reply Roo is writing…' : 'Roo is on it…');
      setPhase('waiting');
      await invoke('watch_reply', { id, runId: r.run_id });
    } catch (e) {
      if (turn.current?.id === id) fail(e);
    }
  }, []);

  const send = useCallback(
    async (said: string) => {
      const message = said.trim();
      if (!message) {
        setNote("Didn't catch anything.");
        setPhase('error');
        return;
      }
      setPhase('sending');
      setReply('');
      const id = newTurnId();
      try {
        const kind = briefKindOf(message);
        if (kind) {
          turn.current = { id, message, lane: 'full' };
          const r = await briefMe(kind);
          setRunId(r.run_id);
          setNote('Roo is writing your brief…');
          setPhase('waiting');
          await invoke('watch_reply', { id, runId: r.run_id });
          return;
        }
        turn.current = { id, message, lane: 'fast' };
        const lane = await invoke<'fast' | 'full'>('ask_quick', { id, message });
        if (turn.current?.id !== id) return;
        if (lane === 'full') return toFullRoo(id, message);
        setNote('Roo…');
        setPhase('waiting');
      } catch (e) {
        if (turn.current?.id === id) fail(e);
      }
    },
    [toFullRoo],
  );

  const start = useCallback(() => {
    dropTurn();
    const s = loadListen();
    settingsRef.current = s;
    setSettings(s);
    setHotkey(hotkeyLabel());
    openedAt.current = Date.now();
    setText('');
    setReply('');
    setLevel(0);
    setNote(null);
    setRunId(null);
    setPhase('starting');
    invoke('start_listening', helperArgs(s)).catch(fail);
  }, []);

  // Press to send (or hold to talk): the hotkey again sends, stops, or starts over.
  const sendNow = useCallback(() => {
    if (phaseRef.current === 'typing') send(textRef.current);
    else invoke('stop_listening').catch(() => {}); // the helper answers with its final transcript
  }, [send]);

  // Each open of the panel starts a fresh listen.
  useEffect(() => {
    start();
    const offOpen = listen('pulse://listen-open', () => start());
    const offHotkey = listen<'pressed' | 'released'>('pulse://listen-hotkey', (e) => {
      const act = onHotkey(settingsRef.current, e.payload, phaseRef.current, Date.now() - openedAt.current);
      if (act === 'send') sendNow();
      else if (act === 'restart') start();
    });
    const offEvents = listen<ListenEvent>('pulse://listen', (e) => {
      const ev = e.payload;
      if (phaseRef.current === 'typing') return;
      if (ev.type === 'ready') setPhase((p) => (p === 'starting' ? 'listening' : p));
      else if (ev.type === 'level') setLevel(ev.value);
      else if (ev.type === 'partial') setText(ev.text);
      else if (ev.type === 'final') {
        setText(ev.text);
        if (phaseRef.current === 'listening' || phaseRef.current === 'starting') send(ev.text);
      } else if (ev.type === 'error') {
        setNote(ev.message);
        setPhase('typing'); // the box still works: type, or dictate with another tool
      }
    });
    // The reply, pushed as it's written.
    const offReply = listen<ReplyEvent>(REPLY_EVENT, (e) => {
      const ev = e.payload;
      const t = turn.current;
      if (!t || ev.id !== t.id) return;
      if (ev.lane === 'fast') {
        if (ev.type === 'delta' && ev.text) {
          setReply((r) => r + ev.text);
          setPhase('reply');
        } else if (ev.type === 'done') {
          setReply(ev.text ?? '');
          setRunId(ev.run_id ?? null);
          setPhase('reply');
        } else if (ev.type === 'handoff' || ev.type === 'error') {
          setReply('');
          setNote('Roo is on it…');
          setPhase('waiting');
          toFullRoo(t.id, t.message);
        }
      } else if (ev.type === 'step' && ev.text) {
        setNote(`Roo: ${ev.text}`);
      } else if (ev.type === 'delta' && ev.text) {
        setNote(`Roo: ${summaryOf(ev.text)}`);
      } else if (ev.type === 'done') {
        setReply(summaryOf(ev.text ?? '') || (ev.ok ? 'Done.' : 'It stopped before answering.'));
        setPhase('reply');
      }
    });
    return () => {
      offOpen.then((u) => u());
      offHotkey.then((u) => u());
      offEvents.then((u) => u());
      offReply.then((u) => u());
    };
  }, [start, send, sendNow, toFullRoo]);

  useEffect(() => {
    if (phase !== 'reply' || hover) return;
    const t = setTimeout(hide, HIDE_AFTER_REPLY_MS);
    return () => clearTimeout(t);
  }, [phase, hover, reply]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        stopSpeaking().catch(() => {});
        hide();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const label: Record<Phase, string> = {
    starting: 'Starting the microphone…',
    listening: listeningHint(settings, hotkey),
    typing: 'Type, or dictate. Enter sends.',
    sending: 'Sending to Roo…',
    waiting: note ?? 'Roo is on it…',
    reply: phase === 'reply' && turn.current?.lane === 'fast' ? 'Roo · quick answer' : 'Roo',
    error: note ?? 'Something went wrong.',
  };
  const listening = phase === 'listening' || phase === 'starting';

  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{ height: '100vh', boxSizing: 'border-box', background: c.bgElevated, color: c.text, fontFamily: tokens.fonts.sans, border: `1px solid ${c.borderHover}`, padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: '10px' }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        <span
          aria-hidden
          style={{ width: 30, height: 30, borderRadius: '50%', display: 'grid', placeItems: 'center', background: listening ? c.accent : c.bgCard, transform: `scale(${1 + (listening ? level * 0.35 : 0)})`, transition: 'transform 0.1s, background 0.2s' }}
        >
          <StrokeIcon name="mic" size={15} color={listening ? c.accentInk : c.textMuted} />
        </span>
        <span style={{ fontSize: tokens.type.small, color: phase === 'error' ? c.danger : c.textMuted, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label[phase]}</span>
        <button onClick={hide} aria-label="Close" style={{ background: 'none', border: 'none', color: c.textDim, cursor: 'pointer', fontSize: tokens.type.small, fontFamily: 'inherit' }}>
          Esc
        </button>
      </div>
      {phase === 'reply' ? (
        <div style={{ flex: 1, overflowY: 'auto', fontSize: '15px', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{reply}</div>
      ) : (
        <textarea
          ref={inputRef}
          value={text}
          placeholder={listening ? 'Say what you need…' : 'Ask Roo anything'}
          onChange={(e) => {
            if (phaseRef.current === 'listening' || phaseRef.current === 'starting') invoke('cancel_listening').catch(() => {});
            setPhase('typing');
            setText(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              if (phase === 'listening' || phase === 'starting') invoke('stop_listening').catch(() => {});
              else if (phase === 'typing' || phase === 'error') send(text);
            }
          }}
          style={{ flex: 1, resize: 'none', background: 'transparent', border: 'none', outline: 'none', padding: 0, color: c.text, fontFamily: 'inherit', fontSize: '17px', lineHeight: 1.45 }}
        />
      )}
      <div style={{ display: 'flex', gap: '14px', fontSize: tokens.type.micro, color: c.textDim }}>
        {phase === 'reply' ? (
          <>
            {runId && <button onClick={() => invoke('open_run_in_main', { runId }).then(hide).catch(() => {})} style={{ background: 'none', border: 'none', padding: 0, color: c.accent, cursor: 'pointer', fontFamily: 'inherit', fontSize: 'inherit' }}>
              Open in Roo
            </button>}
            <button onClick={start} style={{ background: 'none', border: 'none', padding: 0, color: c.accent, cursor: 'pointer', fontFamily: 'inherit', fontSize: 'inherit' }}>
              Ask something else
            </button>
          </>
        ) : (
          <>
            <span>{settings.mode === 'hold' ? `Let go of ${hotkey} or Enter sends` : settings.mode === 'press' ? `${hotkey} or Enter sends` : 'Pause or Enter sends'}</span>
            <span>Esc cancels</span>
            <span style={{ marginLeft: 'auto' }}>On-device speech · nothing leaves this Mac but the text</span>
          </>
        )}
      </div>
    </div>
  );
}
