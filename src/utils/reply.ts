// Roo's replies as they are written: Rust (quick.rs) pushes them on one event for both lanes.
// fast: the quick lane (tool-less Haiku over a snapshot of the owner's files), token by token.
// full: a full Roo run started with ask_lead, followed in its transcript (each message, then the result).
export const REPLY_EVENT = 'pulse://roo-reply';

export interface ReplyEvent {
  id: string; // the turn, made up by whoever asked
  lane: 'fast' | 'full';
  type: 'start' | 'delta' | 'sentence' | 'step' | 'handoff' | 'done' | 'error';
  text?: string;
  ok?: boolean;
  run_id?: string; // full: from start; fast: on done (its transcript)
}

export function newTurnId(): string {
  return `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

// Full runs whose reply is read aloud from the stream (hooks/useReplyVoice.ts), so useVoice
// doesn't read them again when their live file says finished. Per window; both hooks live in
// the main window.
export const streamedRuns = new Set<string>();
