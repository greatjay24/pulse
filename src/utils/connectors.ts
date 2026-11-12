// Pure helpers for the Connectors page (tested in tests/connectors.test.ts).

export interface ConnectStepLike {
  label?: string;
  terminal?: string[];
  url?: string;
}

// Show enough to tell accounts apart, not the whole address: "ja•••@example.com", "acm•••".
export function maskAccount(account: string): string {
  const a = account.trim();
  const at = a.indexOf('@');
  if (at > 0) return `${a.slice(0, Math.min(2, at))}•••${a.slice(at)}`;
  return a.length <= 4 ? a : `${a.slice(0, 3)}•••`;
}

// A connection's `connect` as a list of usable steps (one object or a list; empty ones dropped).
export function connectSteps<T extends ConnectStepLike>(connect: T | T[] | undefined): T[] {
  const list = Array.isArray(connect) ? connect : connect ? [connect] : [];
  return list.filter((s) => (s.terminal && s.terminal.length > 0) || !!s.url);
}
