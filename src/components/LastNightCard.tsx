import { useTheme } from '../contexts/ThemeContext';
import { PortfolioSnapshot } from '../types';
import { useOrgActivity } from '../hooks/useOrgActivity';
import { formatSecs, leadOwners, plainSummary, shifts, usage, usageLine } from '../utils/activity';
import { Card, SectionLabel } from './BoardUI';

// The latest scheduled shift at a glance: who ran, whether it worked, what it cost, and each
// lead's first line. Sits on Today; `onOpen` goes to the Activity page.
export function LastNightCard({ snapshot, onOpen }: { snapshot: PortfolioSnapshot | null; onOpen?: () => void }) {
  const { tokens } = useTheme();
  const c = tokens.colors;
  const { activity } = useOrgActivity();
  const last = shifts(activity).find((s) => s.runs.length > 0);
  if (!activity) return null;
  const entities = snapshot?.registry?.entities ?? [];
  const owners = leadOwners(entities);

  if (!last) {
    return (
      <Card>
        <SectionLabel>Last night</SectionLabel>
        <div style={{ fontSize: tokens.type.body, color: c.textDim }}>No shift has run yet. Leads run at 5:30am.</div>
      </Card>
    );
  }

  const used = usageLine(usage(last.runs.map((r) => ({ cost: r.cost_usd, tokens: r.tokens }))), false);
  const failed = last.runs.filter((r) => !r.ok);
  const longest = Math.max(...last.runs.map((r) => r.secs ?? 0));
  const drafts = (activity.drafts ?? []).filter((d) => {
    const t = Date.parse(d.date);
    return !Number.isNaN(t) && t >= last.at - 12 * 3_600_000;
  }).length;
  const at = new Date(last.at);
  const when = at.toLocaleDateString([], { weekday: 'short' }) + ' ' + at.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

  return (
    <Card>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '10px' }}>
        <SectionLabel style={{ marginBottom: 0 }}>Last night · {when}</SectionLabel>
        <span style={{ flex: 1 }} />
        {onOpen && (
          <button className="btn btn-secondary" onClick={onOpen} style={{ padding: '6px 12px' }}>
            Activity →
          </button>
        )}
      </div>
      <div style={{ fontSize: '20px', fontWeight: 600, margin: '12px 0 4px', letterSpacing: '-0.01em' }}>
        {last.runs.length} {last.runs.length === 1 ? 'lead' : 'leads'} ran
        {failed.length > 0 ? <span style={{ color: c.danger }}>, {failed.length} failed</span> : ', all OK'}
      </div>
      <div style={{ fontSize: tokens.type.small, color: c.textDim, marginBottom: '14px' }}>
        {used && `${used} · `}longest {formatSecs(longest)}
        {drafts > 0 && ` · ${drafts} sales ${drafts === 1 ? 'draft' : 'drafts'} written`}
      </div>
      <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {last.runs.map((r, i) => {
          const entity = entities.find((e) => e.id === owners.get(r.agent));
          return (
            <li key={i} style={{ fontSize: tokens.type.small, lineHeight: 1.5, display: 'flex', gap: '8px' }}>
              <span aria-hidden style={{ color: r.ok ? c.success : c.danger, flexShrink: 0 }}>{r.ok ? '●' : '■'}</span>
              <span style={{ minWidth: 0, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                <span style={{ fontWeight: 600 }}>{entity?.name ?? r.agent}</span>{' '}
                <span style={{ color: c.textMuted }}>{plainSummary(r.result, 180)}</span>
              </span>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
