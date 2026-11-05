// Voice text and choices, kept free of imports so node's test runner can load it (tests/voice.test.ts).

// Which voice reads aloud: macOS `say` (default: the system voice, which can be a Siri voice) or
// Roo's own British voices (Kokoro, on this Mac).
export type VoiceEngine = 'british-1' | 'british-2' | 'mac';
export const DEFAULT_ENGINE: VoiceEngine = 'mac';
export const ROO_VOICES: { engine: VoiceEngine; label: string }[] = [
  { engine: 'british-1', label: 'Roo British 1' },
  { engine: 'british-2', label: 'Roo British 2' },
];

export function engineOf(v: unknown): VoiceEngine {
  return v === 'british-1' || v === 'british-2' || v === 'mac' ? v : DEFAULT_ENGINE;
}

// The Settings select holds both: "roo:british-1", "mac:" (system voice), "mac:Samantha".
export function choiceValue(engine: VoiceEngine, voice: string | null): string {
  return engine === 'mac' ? `mac:${voice ?? ''}` : `roo:${engine}`;
}

export function parseChoice(value: string): { engine: VoiceEngine; voice?: string | null } {
  if (value.startsWith('mac:')) return { engine: 'mac', voice: value.slice(4) || null };
  return { engine: engineOf(value.replace(/^roo:/, '')) };
}

const INLINE = (t: string) =>
  t
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[*_~>|]/g, '');

// Text fit for the ear: no markdown, links, code or bullets.
export function speakable(text: string): string {
  return INLINE(text.replace(/```[\s\S]*?```/g, ' ').replace(/^\s*(#{1,6}|[-*•]|\d+\.)\s+/gm, ''))
    .replace(/\s+/g, ' ')
    .trim();
}

export const SUMMARY_MAX = 600;

// The summary line: the reply's first paragraph (the front door writes its one-sentence answer,
// or a brief's spoken sentences, there), clipped to what's quick to hear.
export function summaryOf(text: string): string {
  const first = (text ?? '').trim().split(/\n\s*\n|\n---/)[0] ?? '';
  const spoken = speakable(first);
  return spoken.length > SUMMARY_MAX ? spoken.slice(0, SUMMARY_MAX).replace(/\s+\S*$/, '') + '.' : spoken;
}

// Spoken replies (summary mode) stop after this many sentences: the ear wants the answer, and the
// rest is on screen. The brief, written to be heard, is read whole (maxSentences = Infinity).
export const SPOKEN_SENTENCES = 2;

// The first n sentences of already-speakable text.
export function firstSentences(text: string, n: number): string {
  if (!Number.isFinite(n)) return text;
  const parts = text.split(/(?<=[.!?…]["')\]]?)\s+(?=\S)/);
  return parts.slice(0, Math.max(1, n)).join(' ');
}

// A sentence end with more text after it.
const BOUNDARY = /[.!?…]["')\]]?\s+(?=\S)/g;

// A reply streaming in as markdown, turned into speakable pieces as soon as each sentence is
// complete (Roo's voice starts on the first one). push() returns what's newly ready to speak;
// end() returns the rest. With full = false only the first paragraph is spoken (the summary).
export class SpokenStream {
  private line = ''; // the current, unfinished line
  private sent = 0; // how much of it has been spoken
  private fence = false;
  private spoken = 0;
  private finished = false;
  private started = false;
  private full: boolean;
  private maxSentences: number;
  private sentences = 0;

  constructor(full: boolean, maxSentences = Infinity) {
    this.full = full;
    this.maxSentences = full ? Infinity : maxSentences;
  }

  push(chunk: string): string {
    if (this.finished) return '';
    this.line += chunk;
    let out = '';
    let nl: number;
    while (!this.finished && (nl = this.line.indexOf('\n')) >= 0) {
      out += this.completeLine(this.line.slice(0, nl));
      this.line = this.line.slice(nl + 1);
      this.sent = 0;
    }
    if (!this.finished && !this.fence && !this.line.trimStart().startsWith('```')) {
      let cut = -1;
      for (const m of this.line.matchAll(BOUNDARY)) if (m.index! + m[0].length > this.sent) cut = m.index! + m[0].length;
      if (cut > this.sent) {
        out += this.piece(this.line.slice(this.sent, cut), this.sent === 0);
        this.sent = cut;
      }
    }
    return out;
  }

  end(): string {
    if (this.finished) return '';
    const out = this.fence ? '' : this.piece(this.line.slice(this.sent), this.sent === 0);
    this.finished = true;
    return out.trim();
  }

  private completeLine(raw: string): string {
    const t = raw.trim();
    if (t.startsWith('```')) {
      this.fence = !this.fence;
      return '';
    }
    if (this.fence) return '';
    if (!t || t === '---') {
      if (!this.full && this.started) this.finished = true;
      return '';
    }
    return this.piece(raw.slice(this.sent), this.sent === 0);
  }

  private piece(raw: string, lineStart: boolean): string {
    let t = (lineStart ? raw.replace(/^\s*(#{1,6}|[-*•]|\d+\.)\s+/, '') : raw);
    t = INLINE(t).replace(/\s+/g, ' ').trim();
    if (!t) return '';
    this.started = true;
    if (!this.full && this.spoken + t.length > SUMMARY_MAX) {
      t = t.slice(0, Math.max(0, SUMMARY_MAX - this.spoken)).replace(/\s+\S*$/, '') + '.';
      this.finished = true;
    }
    if (Number.isFinite(this.maxSentences)) {
      const parts = t.split(/(?<=[.!?…]["')\]]?)\s+(?=\S)/);
      const room = this.maxSentences - this.sentences;
      const ends = /[.!?…]["')\]]?$/.test(t) ? parts.length : parts.length - 1; // sentences finished in t
      if (ends >= room) {
        t = parts.slice(0, room).join(' ');
        this.finished = true;
      }
      this.sentences += Math.min(ends, room);
    }
    this.spoken += t.length + 1;
    return t + ' ';
  }
}
