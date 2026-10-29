import { EntityLane, EntityStatus, Health } from '../types';

export const STANDARD_LANES = ['sales', 'marketing', 'delivery', 'finance', 'admin'] as const;

// A report older than this is flagged; directors write nightly, so 36h means a missed run.
export const STALE_AFTER_HOURS = 36;

export function hoursSince(iso: string | undefined, now: number): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return (now - t) / 3_600_000;
}

export function formatAge(hours: number | null): string {
  if (hours === null) return 'update time unknown';
  if (hours < 1) return 'updated just now';
  if (hours < 48) return `updated ${Math.floor(hours)}h ago`;
  return `updated ${Math.floor(hours / 24)}d ago`;
}

export function isStale(hours: number | null): boolean {
  return hours === null || hours > STALE_AFTER_HOURS;
}

export function healthColor(health: Health | undefined, colors: { success: string; warning: string; danger: string; textDim: string }): string {
  switch (health) {
    case 'green': return colors.success;
    case 'yellow': return colors.warning;
    case 'red': return colors.danger;
    default: return colors.textDim;
  }
}

// Directors use the five standard lanes; some (Personal) report their own. Show the
// standard ones in order when any are present, then any extra lanes as written.
export function orderedLanes(lanes: Record<string, EntityLane> | undefined): [string, EntityLane | null][] {
  const entries = Object.entries(lanes ?? {});
  const extras = entries.filter(([k]) => !(STANDARD_LANES as readonly string[]).includes(k));
  const hasStandard = entries.length > extras.length;
  const standard: [string, EntityLane | null][] = hasStandard
    ? STANDARD_LANES.map((k) => [k, lanes?.[k] ?? null])
    : [];
  return [...standard, ...extras];
}

export function decisionCount(status: EntityStatus | null): number {
  return status?.decisions?.length ?? 0;
}

export function titleCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// The first "## " section of WEEK.md, which the chief of staff reserves for the three moves.
// Prefers a heading that mentions "moves" in case the page opens with something else.
export function firstWeekSection(markdown: string | null): { title: string; lines: string[] } | null {
  if (!markdown) return null;
  const sections: { title: string; lines: string[] }[] = [];
  let current: { title: string; lines: string[] } | null = null;
  for (const raw of markdown.split('\n')) {
    const heading = raw.match(/^##\s+(.*)$/);
    if (heading) {
      current = { title: heading[1].trim(), lines: [] };
      sections.push(current);
    } else if (current && raw.trim()) {
      current.lines.push(raw.trim());
    }
  }
  return sections.find((s) => /moves/i.test(s.title)) ?? sections[0] ?? null;
}

// Strips the markdown we expect in WEEK.md lines (list markers, bold, links) to plain text.
export function plainMarkdownLine(line: string): { text: string; numbered: boolean; bullet: boolean } {
  const numbered = /^\d+[.)]\s+/.test(line);
  const bullet = /^[-*]\s+/.test(line);
  const text = line
    .replace(/^\d+[.)]\s+/, '')
    .replace(/^[-*]\s+/, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\[(.+?)\]\((.+?)\)/g, '$1')
    .replace(/`(.+?)`/g, '$1');
  return { text, numbered, bullet };
}
