import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useTheme } from '../contexts/ThemeContext';
import { LiveSnapshot, Transcript } from '../types';
import { PULSE_TARGET, askLead } from '../utils/command';
import { briefKindOf, briefMe, summaryOf } from '../utils/voice';
import { StrokeIcon } from './Icons';

// The listening panel: its own small window (index.html#listen), opened by the global hotkey,
// ⌘K's mic or the Pulse thread's Talk. It transcribes on-device (pulse-listen) and sends the
// text to Pulse when the owner pauses or presses Enter. Esc drops it. The words stay editable,
// so a slip can be fixed, or typed (Wispr Flow dictation works here too).
// The main window reads Pulse's reply aloud; this panel shows its summary line.

type Phase = 'starting' | 'listening' | 'typing' | 'sending' | 'waiting' | 'reply' | 'error';

type ListenEvent =
  | { type: 'ready' }
  | { type: 'level'; value: number }
  | { type: 'partial'; text: string }
  | { type: 'final'; text: string }
  | { type: 'error'; message: string }
  | { type: 'end' };

const REPLY_POLL_MS = 1000;
const HIDE_AFTER_REPLY_MS = 15_000;

export function ListenPanel() {
  const { tokens } = useTheme();
  const c = tokens.colors;
  const [phase, setPhase] = useState<Phase>('starting');
  const [text, setText] = useState('');
  const [level, setLevel] = useState(0);
  const [note, setNote] = useState<string | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [hover, setHover] = useState(false);
  const phaseRef = useRef<Phase>('starting');
  phaseRef.current = phase;
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const hide = () => invoke('hide_listen_panel').catch(() => {});

  const send = useCallback(async (said: string) => {
    const message = said.trim();
    if (!message) {
      setNote("Didn't catch anything.");
      setPhase('error');
      return;
    }
    setPhase('sending');
    try {
      const kind = briefKindOf(message);
      const r = kind ? await briefMe(kind) : await askLead(PULSE_TARGET, message);
      setRunId(r.run_id);
      setNote(kind ? 'Pulse is writing your brief…' : 'Pulse is on it…');
      setPhase('waiting');
    } catch (e) {
      setNote(String(e instanceof Error ? e.message : e));
      setPhase('error');
    }
  }, []);

  const start = useCallback(() => {
    setText('');
    setLevel(0);
    setNote(null);
    setRunId(null);
    setPhase('starting');
    invoke('start_listening').catch((e) => {
      setNote(String(e));
      setPhase('error');
    });
  }, []);

  // Each open of the panel starts a fresh listen.
  useEffect(() => {
    start();
    const offOpen = listen('pulse://listen-open', () => start());
    const offEvents = listen<ListenEvent>('pulse://listen', (e) => {
      const ev = e.payload;
      if (phaseRef.current === 'typing') return;
      if (ev.type === 'ready') setPhase('listening');
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
    return () => {
      offOpen.then((u) => u());
      offEvents.then((u) => u());
    };
  }, [start, send]);

  // The reply: poll the run until it ends, then show its summary line.
  useEffect(() => {
    if (phase !== 'waiting' || !runId) return;
    let alive = true;
    const tick = async () => {
      try {
        const live: LiveSnapshot = JSON.parse(await invoke<string>('read_live'));
        const run = live.runs.find((r) => r.run_id === runId);
        if (run && run.state !== 'running' && run.state !== 'queued' && run.state !== 'idle') {
          const t: Transcript = JSON.parse(await invoke<string>('read_transcript', { runId }));
          const last = [...t.lines].reverse().find((l) => l.t === 'result');
          const reply = last && last.t === 'result' ? last.result : run.result ?? '';
          if (!alive) return;
          setNote(summaryOf(reply) || (run.state === 'finished' ? 'Done.' : 'It stopped before answering.'));
          setPhase('reply');
          return;
        }
        if (run && alive) setNote(`Pulse: ${run.step}`);
      } catch {
        // keep polling; the live file appears within a second or two
      }
      if (alive) timer = setTimeout(tick, REPLY_POLL_MS);
    };
    let timer = setTimeout(tick, REPLY_POLL_MS);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [phase, runId]);

  useEffect(() => {
    if (phase !== 'reply' || hover) return;
    const t = setTimeout(hide, HIDE_AFTER_REPLY_MS);
    return () => clearTimeout(t);
  }, [phase, hover]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        hide();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const label: Record<Phase, string> = {
    starting: 'Starting the microphone…',
    listening: 'Listening. Pause or press Enter to send.',
    typing: 'Type, or dictate. Enter sends.',
    sending: 'Sending to Pulse…',
    waiting: note ?? 'Pulse is on it…',
    reply: 'Pulse',
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
        <div style={{ flex: 1, overflowY: 'auto', fontSize: '15px', lineHeight: 1.5 }}>{note}</div>
      ) : (
        <textarea
          ref={inputRef}
          value={text}
          placeholder={listening ? 'Say what you need…' : 'Ask Pulse anything'}
          onChange={(e) => {
            if (phaseRef.current === 'listening' || phaseRef.current === 'starting') invoke('cancel_listening').catch(() => {});
            setPhase('typing');
            setText(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              if (phase === 'listening') invoke('stop_listening').catch(() => {});
              else if (phase === 'typing' || phase === 'error') send(text);
            }
          }}
          style={{ flex: 1, resize: 'none', background: 'transparent', border: 'none', outline: 'none', padding: 0, color: c.text, fontFamily: 'inherit', fontSize: '17px', lineHeight: 1.45 }}
        />
      )}
      <div style={{ display: 'flex', gap: '14px', fontSize: tokens.type.micro, color: c.textDim }}>
        {phase === 'reply' && runId ? (
          <>
            <button onClick={() => invoke('open_run_in_main', { runId }).then(hide).catch(() => {})} style={{ background: 'none', border: 'none', padding: 0, color: c.accent, cursor: 'pointer', fontFamily: 'inherit', fontSize: 'inherit' }}>
              Open in Pulse
            </button>
            <button onClick={start} style={{ background: 'none', border: 'none', padding: 0, color: c.accent, cursor: 'pointer', fontFamily: 'inherit', fontSize: 'inherit' }}>
              Ask something else
            </button>
          </>
        ) : (
          <>
            <span>Enter sends</span>
            <span>Esc cancels</span>
            <span style={{ marginLeft: 'auto' }}>On-device speech · nothing leaves this Mac but the text</span>
          </>
        )}
      </div>
    </div>
  );
}
