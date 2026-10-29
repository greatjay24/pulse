import { useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useTheme } from '../contexts/ThemeContext';
import { PortfolioSnapshot, Transcript, TranscriptLine, TranscriptSummary } from '../types';
import { useOrgActivity } from '../hooks/useOrgActivity';
import { useLive } from '../hooks/useLive';
import { ConvItem, ORG_THREAD, Thread, buildThreads, threadOfRun, verbOf } from '../utils/conversations';
import { elapsed, kindLabel, ms, stateLabel } from '../utils/live';
import { formatCost, formatSecs } from '../utils/activity';
import { firstUrl } from '../utils/decisions';
import { openExternal } from '../utils/tracker';
import { EntityMark, Notice, PageHeader } from './BoardUI';
import { LiveDot } from './WorkingNow';
import { Icon } from './Icons';

const IS_TAURI = typeof window !== 'undefined' && !!(window as any).__TAURI_INTERNALS__;
const INDEX_POLL_MS = 15_000;
const LIVE_TRANSCRIPT_MS = 2_000;
const AUTO_OPEN_RUNS = 6; // the newest runs in a thread show their conversation at once

type RunItem = Extract<ConvItem, { type: 'run' }>;

export interface ConversationFocus {
  runId?: string;
  entity?: string;
  nonce: number; // a repeat click on the same run still scrolls to it
}

function when(atMs: number): string {
  if (!atMs) return '';
  const d = new Date(atMs);
  const today = new Date().toDateString() === d.toDateString();
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return today ? time : `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })}, ${time}`;
}

// list_transcripts, re-read every 15s and whenever a live run appears or ends.
function useTranscriptIndex(liveKey: string) {
  const [index, setIndex] = useState<TranscriptSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!IS_TAURI) return;
    let alive = true;
    const load = () =>
      invoke<string>('list_transcripts')
        .then((json) => alive && (setIndex(JSON.parse(json)), setError(null)))
        .catch((e) => alive && setError(String(e)));
    load();
    const t = setInterval(load, INDEX_POLL_MS);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [liveKey]);
  return { index, error };
}

// Finished transcripts never change, so they are read once per session of the app.
const finishedCache = new Map<string, Transcript>();

function useTranscript(runId: string | null, open: boolean, running: boolean) {
  const [t, setT] = useState<Transcript | null>(runId ? finishedCache.get(runId) ?? null : null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!runId || !open || !IS_TAURI) return;
    if (!running && finishedCache.has(runId)) {
      setT(finishedCache.get(runId)!);
      return;
    }
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const load = () =>
      invoke<string>('read_transcript', { runId })
        .then((json) => {
          if (!alive) return;
          const parsed: Transcript = JSON.parse(json);
          if (!running) finishedCache.set(runId, parsed);
          setT(parsed);
          setError(null);
        })
        .catch((e) => alive && setError(String(e)))
        .finally(() => {
          if (alive && running) timer = setTimeout(load, LIVE_TRANSCRIPT_MS);
        });
    load();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [runId, open, running]);
  return { transcript: t, error };
}

function Bubble({ mine, label, at, children }: { mine: boolean; label: string; at?: number; children: React.ReactNode }) {
  const { tokens } = useTheme();
  const c = tokens.colors;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: mine ? 'flex-end' : 'flex-start' }}>
      <div style={{ fontSize: tokens.type.micro, color: c.textDim, margin: '0 4px 4px' }}>
        <span style={{ fontWeight: 600, color: mine ? c.text : c.accent }}>{label}</span>
        {at ? ` · ${when(at)}` : ''}
      </div>
      <div
        style={{
          maxWidth: '72ch',
          padding: '10px 14px',
          borderRadius: tokens.radius.md,
          background: mine ? c.accentGlow : c.bgCard,
          border: `1px solid ${mine ? 'transparent' : c.border}`,
          fontSize: '14px',
          lineHeight: 1.55,
          whiteSpace: 'pre-wrap',
          overflowWrap: 'anywhere',
        }}
      >
        {children}
      </div>
    </div>
  );
}

function LinkOut({ text }: { text?: string }) {
  const { tokens } = useTheme();
  const link = firstUrl(text);
  if (!link) return null;
  return (
    <button
      onClick={() => openExternal(link)}
      style={{ display: 'block', marginTop: '6px', background: 'none', border: 'none', padding: 0, color: tokens.colors.accent, fontFamily: 'inherit', fontSize: tokens.type.small, cursor: 'pointer' }}
    >
      Open {link.replace(/^https?:\/\//, '').slice(0, 60)} ↗
    </button>
  );
}

// Consecutive tool calls fold into one line; open, each is a one-line summary.
function Steps({ lines }: { lines: Extract<TranscriptLine, { t: 'tool' | 'error' }>[] }) {
  const { tokens } = useTheme();
  const c = tokens.colors;
  const [open, setOpen] = useState(false);
  const errors = lines.filter((l) => l.t === 'error').length;
  const tools = lines.filter((l): l is Extract<TranscriptLine, { t: 'tool' }> => l.t === 'tool');
  const glance = tools.slice(-2).map((l) => l.summary).join(' · ');
  return (
    <div style={{ fontSize: tokens.type.small, color: c.textMuted, paddingLeft: '4px' }}>
      <button
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'none', border: 'none', padding: '2px 0', color: 'inherit', fontFamily: 'inherit', fontSize: 'inherit', cursor: 'pointer', textAlign: 'left', minWidth: 0, maxWidth: '100%' }}
      >
        <span style={{ display: 'inline-block', transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s', color: c.textDim }}>▸</span>
        <span style={{ whiteSpace: 'nowrap' }}>
          {tools.length} {tools.length === 1 ? 'step' : 'steps'}
          {errors > 0 && <span style={{ color: c.danger }}> · {errors} failed</span>}
        </span>
        {!open && glance && <span style={{ color: c.textDim, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>· {glance}</span>}
      </button>
      {open && (
        <div style={{ margin: '4px 0 2px 18px', display: 'flex', flexDirection: 'column', gap: '3px', fontFamily: tokens.fonts.mono, fontSize: tokens.type.micro }}>
          {lines.map((l, i) =>
            l.t === 'tool' ? (
              <div key={i} style={{ color: l.sub ? c.textDim : c.textMuted, paddingLeft: l.sub ? '14px' : 0, overflowWrap: 'anywhere' }}>{l.summary}</div>
            ) : (
              <div key={i} style={{ color: c.danger, overflowWrap: 'anywhere' }}>✕ {l.text.slice(0, 240)}</div>
            ),
          )}
        </div>
      )}
    </div>
  );
}

function Brief({ prompt }: { prompt: string }) {
  const { tokens } = useTheme();
  const c = tokens.colors;
  const [open, setOpen] = useState(false);
  if (!prompt) return null;
  return (
    <div style={{ fontSize: tokens.type.small, color: c.textMuted }}>
      <button
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        style={{ background: 'none', border: 'none', padding: 0, color: c.textDim, fontFamily: 'inherit', fontSize: 'inherit', cursor: 'pointer' }}
      >
        {open ? '▾' : '▸'} The brief it was given
      </button>
      {open && <div style={{ marginTop: '6px', padding: '10px 12px', borderLeft: `2px solid ${c.border}`, whiteSpace: 'pre-wrap', lineHeight: 1.55 }}>{prompt}</div>}
    </div>
  );
}

// A transcript as chat: the owner's turns right, the agent's words left, tool calls folded.
function TranscriptView({ lines, agent }: { lines: TranscriptLine[]; agent: string }) {
  const blocks: React.ReactNode[] = [];
  let steps: Extract<TranscriptLine, { t: 'tool' | 'error' }>[] = [];
  const flush = () => {
    if (steps.length) blocks.push(<Steps key={`s${blocks.length}`} lines={steps} />);
    steps = [];
  };
  for (const l of lines) {
    if (l.t === 'tool' || l.t === 'error') {
      steps.push(l);
      continue;
    }
    flush();
    if (l.t === 'start') blocks.push(<Brief key={`b${blocks.length}`} prompt={l.prompt} />);
    else if (l.t === 'user') blocks.push(<Bubble key={`u${blocks.length}`} mine label="You" at={ms(l.at)}>{l.text}</Bubble>);
    else if (l.t === 'text') blocks.push(<Bubble key={`t${blocks.length}`} mine={false} label={l.sub ? `${agent} · subagent` : agent} at={ms(l.at)}>{l.text}</Bubble>);
  }
  flush();
  return <>{blocks}</>;
}

function RunFooter({ item }: { item: RunItem }) {
  const { tokens } = useTheme();
  const c = tokens.colors;
  const live = item.live;
  if (live && (live.state === 'running' || live.state === 'idle')) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: tokens.type.small, color: live.state === 'running' ? c.accent : c.textDim }}>
        <LiveDot color={live.state === 'running' ? c.accent : c.textDim} pulsing={live.state === 'running'} />
        {live.state === 'running' ? live.step : 'Waiting for you'} · {elapsed(ms(live.started), Date.now())}
      </div>
    );
  }
  const stopped = live?.state === 'stopped';
  const failed = stopped || item.ok === false;
  const parts = [
    stopped ? 'Stopped unexpectedly' : item.ok === false ? 'Failed' : item.ok ? 'Finished' : null,
    item.secs ? formatSecs(item.secs) : null,
    item.cost ? formatCost(item.cost) : null,
  ].filter(Boolean);
  if (!parts.length) return null;
  return <div style={{ fontSize: tokens.type.micro, color: failed ? c.danger : c.textDim }}>{parts.join(' · ')}</div>;
}

function RunBlock({ item, open: initiallyOpen, focused }: { item: RunItem; open: boolean; focused: boolean }) {
  const { tokens } = useTheme();
  const c = tokens.colors;
  const [open, setOpen] = useState(initiallyOpen || focused);
  useEffect(() => {
    if (focused) setOpen(true);
  }, [focused]);
  const running = item.live?.state === 'running' || item.live?.state === 'idle';
  const { transcript, error } = useTranscript(item.runId, open, running);
  const lines = transcript?.lines ?? [];
  const hasResultText = lines.some((l) => l.t === 'text');
  return (
    <div
      id={item.runId ? `run-${item.runId}` : undefined}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
        padding: '14px 16px',
        borderRadius: tokens.radius.md,
        border: `1px solid ${focused ? c.accent : c.border}`,
        background: c.bgElevated,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '10px', flexWrap: 'wrap' }}>
        <span style={{ fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: running ? c.accent : c.textDim }}>
          {kindLabel(item.kind)}
        </span>
        <span style={{ fontSize: '15px', fontWeight: 500 }}>{item.doing}</span>
        <span style={{ fontSize: tokens.type.micro, color: c.textDim }}>
          {item.agent} · {when(item.at)}
          {item.live && item.live.state !== 'finished' && item.live.state !== 'failed' && ` · ${stateLabel(item.live)}`}
        </span>
        {item.runId && !initiallyOpen && !running && (
          <button
            onClick={() => setOpen(!open)}
            style={{ marginLeft: 'auto', background: 'none', border: 'none', padding: 0, color: c.accent, fontFamily: 'inherit', fontSize: tokens.type.small, cursor: 'pointer' }}
          >
            {open ? 'Hide conversation' : 'Show conversation'}
          </button>
        )}
      </div>
      {open && item.runId && (
        <>
          {error && <div style={{ fontSize: tokens.type.small, color: c.textDim }}>Transcript not readable: {error}</div>}
          {!transcript && !error && <div style={{ fontSize: tokens.type.small, color: c.textDim }}>Reading the transcript…</div>}
          {transcript?.truncated && <div style={{ fontSize: tokens.type.micro, color: c.textDim }}>Long run: showing its latest part.</div>}
          <TranscriptView lines={lines} agent={item.agent} />
        </>
      )}
      {/* Runs from before transcripts, or folded ones: the lead's closing summary. */}
      {(!item.runId || !open || (!hasResultText && transcript)) && item.result && (
        <Bubble mine={false} label={item.agent}>{item.result}</Bubble>
      )}
      <RunFooter item={item} />
    </div>
  );
}

function DecisionBubble({ item, lead }: { item: Extract<ConvItem, { type: 'owner' | 'lead' }>; lead: string }) {
  const { tokens } = useTheme();
  const mine = item.type === 'owner';
  return (
    <Bubble mine={mine} label={mine ? 'You' : lead} at={item.at}>
      <span style={{ fontWeight: 600 }}>{verbOf(item.row.action)}:</span> {item.ask}
      {item.row.note && <div style={{ marginTop: '6px', color: tokens.colors.textMuted }}>{item.row.note}</div>}
      {item.type === 'lead' && <LinkOut text={item.row.note} />}
    </Bubble>
  );
}

function ThreadList({ threads, selected, snapshot, onSelect }: { threads: Thread[]; selected: string | null; snapshot: PortfolioSnapshot | null; onSelect: (id: string) => void }) {
  const { tokens } = useTheme();
  const c = tokens.colors;
  return (
    <nav aria-label="Threads" style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
      {threads.map((t) => {
        const entity = snapshot?.registry?.entities.find((e) => e.id === t.id);
        const report = snapshot?.entities.find((e) => e.id === t.id);
        const active = t.id === selected;
        return (
          <button
            key={t.id}
            onClick={() => onSelect(t.id)}
            aria-current={active}
            style={{
              display: 'flex',
              gap: '10px',
              alignItems: 'flex-start',
              padding: '10px 12px',
              textAlign: 'left',
              background: active ? c.bgCardHover : 'transparent',
              border: `1px solid ${active ? c.border : 'transparent'}`,
              borderRadius: tokens.radius.md,
              color: c.text,
              fontFamily: 'inherit',
              cursor: 'pointer',
              minWidth: 0,
            }}
          >
            {entity ? (
              <EntityMark entity={entity} logos={report ? { logo: report.logo, logo_dark: report.logo_dark } : null} size={26} />
            ) : (
              <span style={{ width: 26, height: 26, borderRadius: 7, background: c.bgElevated, flexShrink: 0 }} aria-hidden />
            )}
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ fontWeight: 600, fontSize: '14px' }}>{t.name}</span>
                {t.working && <LiveDot color={c.accent} pulsing />}
                <span style={{ marginLeft: 'auto', fontSize: tokens.type.micro, color: c.textDim, whiteSpace: 'nowrap' }}>{when(t.latest)}</span>
              </span>
              <span style={{ display: 'block', fontSize: tokens.type.micro, color: c.textMuted, marginTop: '2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {t.preview}
              </span>
            </span>
          </button>
        );
      })}
    </nav>
  );
}

// Read-only: what the owner and each lead said, decision by decision and run by run. Answers
// still go through the decision cards (act.py); nothing here writes.
export function ConversationsPage({ snapshot, focus }: { snapshot: PortfolioSnapshot | null; focus: ConversationFocus | null }) {
  const { tokens } = useTheme();
  const c = tokens.colors;
  const { activity, error: activityError } = useOrgActivity();
  const { live, liveError } = useLive();
  const liveKey = (live?.runs ?? []).map((r) => `${r.run_id}:${r.state}`).join('|');
  const { index, error: indexError } = useTranscriptIndex(liveKey);
  const threads = useMemo(() => buildThreads(snapshot, activity, index, live), [snapshot, activity, index, live]);
  const [selected, setSelected] = useState<string | null>(null);
  const [focusedRun, setFocusedRun] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // A focus (from Activity, Working now or the menu bar) picks the run's thread and scrolls to it.
  const handled = useRef<number | null>(null);
  useEffect(() => {
    if (!focus || handled.current === focus.nonce) return;
    const thread = focus.runId ? threadOfRun(threads, focus.runId) : threads.find((t) => t.id === (focus.entity ?? ORG_THREAD));
    if (!thread) return; // not read yet; try again when the index arrives
    handled.current = focus.nonce;
    setSelected(thread.id);
    setFocusedRun(focus.runId ?? null);
  }, [focus, threads]);

  const current = threads.find((t) => t.id === selected) ?? threads[0] ?? null;

  useEffect(() => {
    const target = focusedRun ? document.getElementById(`run-${focusedRun}`) : bottomRef.current;
    target?.scrollIntoView({ block: focusedRun ? 'center' : 'end' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id, focusedRun]);

  const runItems = current?.items.filter((i): i is RunItem => i.type === 'run') ?? [];
  const autoOpen = new Set(runItems.slice(-AUTO_OPEN_RUNS).map((i) => i.key));
  const problems = [activityError, liveError, indexError].filter(Boolean);

  return (
    <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
      <PageHeader title="Conversations" subtitle="What you and each lead said: your answers, their replies, and every run's transcript. Read-only." />
      {problems.length > 0 && <Notice>{problems.join(' · ')}</Notice>}
      {threads.length === 0 && !problems.length && <div style={{ color: c.textMuted, marginTop: '20px' }}>No conversations recorded yet.</div>}
      {current && (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(220px, 280px) 1fr', gap: '28px', marginTop: '20px', alignItems: 'start' }}>
          <div style={{ position: 'sticky', top: 0 }}>
            <ThreadList
              threads={threads}
              selected={current.id}
              snapshot={snapshot}
              onSelect={(id) => {
                setSelected(id);
                setFocusedRun(null);
              }}
            />
          </div>
          <section style={{ display: 'flex', flexDirection: 'column', gap: '16px', minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '10px' }}>
              <h2 style={{ fontFamily: tokens.fonts.display, fontSize: tokens.type.heading, fontWeight: 500 }}>{current.name}</h2>
              {current.lead && <span style={{ fontSize: tokens.type.small, color: c.textDim }}>{current.lead}</span>}
            </div>
            {current.items.map((it) =>
              it.type === 'run' ? (
                <RunBlock key={it.key} item={it} open={autoOpen.has(it.key)} focused={!!it.runId && it.runId === focusedRun} />
              ) : (
                <DecisionBubble key={it.key} item={it} lead={current.lead ?? 'Lead'} />
              ),
            )}
            <div ref={bottomRef} />
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: tokens.type.micro, color: c.textDim }}>
              <Icon name="chat" size={12} color={c.textDim} /> Answer decisions from Today or the entity page; the lead's reply lands here.
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
