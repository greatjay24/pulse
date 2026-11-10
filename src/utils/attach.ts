// Pictures in the listening panel: what counts as asking Roo to look at the screen, and the
// question an image goes with when nothing was said. Kept free of imports so node's test runner
// can load it (tests/attach.test.ts). The images themselves live in Rust (src-tauri/src/attach.rs).

export interface Attachment {
  path: string; // in Roo's attachments folder
  thumb: string; // data: URL for the chip
  screen?: boolean; // a capture of the screen, not a pasted or dropped picture
}

const SCREEN = '(?:my |the |this |your )?(?:screen|monitor)';
const SCREEN_ASKS: RegExp[] = [
  // "look at my screen", "can you see my screen", "check the screen", "read my screen"
  new RegExp(`\\b(?:look(?:ing)? at|see|check|read|scan|view|glance at)\\s+(?:what'?s on\\s+)?${SCREEN}\\b`),
  // "what's on my screen", "what is on the screen", "help me with what's on my screen"
  new RegExp(`\\bwhat(?:'?s| is| am i looking at| do you see)\\b.*\\bon\\s+${SCREEN}\\b`),
  // "what am I looking at", "what do you see"
  /\bwhat am i looking at\b/,
  /\bwhat (?:do|can) you see\b/,
  // "take a screenshot", "grab my screen", "screenshot this"
  /\b(?:take|grab|capture|get)\s+(?:a\s+)?(?:screenshot|screen ?shot|screen ?grab|capture of (?:my |the )?screen)\b/,
  /\bscreenshot (?:this|that|it)\b/,
  /\b(?:grab|capture) (?:my |the )?screen\b/,
  // "explain this screen", "help me with this screen"
  new RegExp(`\\b(?:explain|describe|summari[sz]e|help me with|help with)\\s+(?:what'?s on\\s+)?${SCREEN}\\b`),
];

function normal(text: string): string {
  return text
    .toLowerCase()
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[^a-z0-9' ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// True when the words ask Roo to look at the screen ("look at my screen", "what's on my
// screen", "take a screenshot"): the panel captures it before sending.
export function wantsScreen(text: string): boolean {
  const t = normal(text);
  return t.length > 0 && t.length <= 400 && SCREEN_ASKS.some((r) => r.test(t));
}

// The question when the owner attached a picture and said nothing.
export function defaultQuestion(a: Attachment): string {
  return a.screen ? "What's on my screen?" : "What's in this image?";
}

// Rust's capture_screen error when Screen Recording is off (attach.rs SCREEN_PERMISSION).
export function isScreenPermissionError(e: unknown): boolean {
  return String(e instanceof Error ? e.message : e).includes('Screen Recording');
}

// The first image among pasted clipboard items, if any.
export function imageFile(items: ArrayLike<{ kind: string; type: string; getAsFile(): File | null }>): File | null {
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (it.kind === 'file' && it.type.startsWith('image/')) return it.getAsFile();
  }
  return null;
}
