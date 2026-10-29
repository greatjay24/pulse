import { useTheme } from '../contexts/ThemeContext';
import { EntityDecision, PortfolioEntity } from '../types';
import { useOrgActivity } from '../hooks/useOrgActivity';
import { DecisionView, actRuns, decisionId, recentlyAnswered, rowsFor, viewOf } from '../utils/decisions';
import { Card, SectionHeading } from './BoardUI';
import { DecisionActions } from './DecisionActions';
import { DecisionStatus, DecisionThread } from './DecisionThread';

function GatePill({ gate }: { gate: string }) {
  const { tokens } = useTheme();
  return (
    <span style={{ fontSize: tokens.type.micro, padding: '3px 10px', borderRadius: '999px', border: `1px solid ${tokens.colors.border}`, color: tokens.colors.textMuted }}>
      {gate}
    </span>
  );
}

// One decision with its answer buttons, status and thread. `entity` adds a name above the
// ask (for lists that span entities); `compact` drops the why for the shorter Today list.
export function DecisionCard({ entity, decision, view, showEntity = false, compact = false, onOpenEntity }: {
  entity: PortfolioEntity;
  decision: EntityDecision;
  view: DecisionView;
  showEntity?: boolean;
  compact?: boolean;
  onOpenEntity?: (id: string) => void;
}) {
  const { tokens } = useTheme();
  const c = tokens.colors;
  const answered = view.state === 'done' || view.state === 'rejected';
  return (
    <Card padding={compact ? '16px 20px' : '20px 24px'} style={answered ? { opacity: 0.8 } : undefined}>
      {showEntity && (
        <button
          onClick={() => onOpenEntity?.(entity.id)}
          disabled={!onOpenEntity}
          style={{ background: 'none', border: 'none', padding: 0, marginBottom: '6px', fontFamily: 'inherit', fontSize: tokens.type.micro, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: c.textMuted, cursor: onOpenEntity ? 'pointer' : 'default' }}
        >
          {entity.name}
        </button>
      )}
      <div style={{ display: 'flex', gap: '12px', alignItems: 'baseline', flexWrap: 'wrap' }}>
        <span style={{ fontSize: compact ? '16px' : '17px', fontWeight: 600, flex: 1, minWidth: '240px', lineHeight: 1.4 }}>{decision.ask}</span>
        {decision.due && <span style={{ fontSize: tokens.type.small, color: c.warning }}>due {decision.due}</span>}
        {decision.gate && <GatePill gate={decision.gate} />}
      </div>
      {decision.recommend && (
        <div style={{ fontSize: compact ? tokens.type.small : tokens.type.body, lineHeight: 1.55, marginTop: '8px', maxWidth: '80ch' }}>
          <span style={{ color: c.accent, fontWeight: 600 }}>Recommend </span>
          {decision.recommend}
        </div>
      )}
      {!compact && decision.why && <div style={{ fontSize: tokens.type.small, lineHeight: 1.55, color: c.textMuted, marginTop: '6px', maxWidth: '80ch' }}>{decision.why}</div>}
      {!compact && decision.on_approve && view.state === 'pending' && (
        <div style={{ fontSize: tokens.type.small, lineHeight: 1.55, color: c.textDim, marginTop: '6px', maxWidth: '80ch' }}>
          <span style={{ fontWeight: 600 }}>On approve </span>
          {decision.on_approve}
        </div>
      )}
      <DecisionStatus view={view} lead={entity.lead} />
      <DecisionThread view={view} lead={entity.lead} />
      <DecisionActions entityId={entity.id} lead={entity.lead} decision={decision} view={view} compact={compact} />
    </Card>
  );
}

// An entity's decisions: the open ones with their buttons, then what was answered this week
// (the lead removes a decision from status.json once it's done or rejected).
export function EntityDecisions({ entity, decisions }: { entity: PortfolioEntity; decisions: EntityDecision[] }) {
  const { tokens } = useTheme();
  const { activity } = useOrgActivity();
  const rows = rowsFor(activity, entity.id);
  const runs = actRuns(activity);
  const answered = recentlyAnswered(entity.id, decisions, activity, Date.now());
  const waiting = decisions.filter((d) => viewOf(decisionId(d), rows, runs, entity.id).state === 'pending').length;

  return (
    <section>
      <SectionHeading note={`${waiting} waiting on you`}>Decisions</SectionHeading>
      {decisions.length === 0 && answered.length === 0 ? (
        <div style={{ fontSize: tokens.type.small, color: tokens.colors.textDim }}>Nothing waiting on you.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {decisions.map((d) => (
            <DecisionCard key={decisionId(d)} entity={entity} decision={d} view={viewOf(decisionId(d), rows, runs, entity.id)} />
          ))}
          {answered.map((a) => (
            <DecisionCard key={a.id} entity={entity} decision={{ id: a.id, ask: a.ask, recommend: a.recommend }} view={a.view} />
          ))}
        </div>
      )}
    </section>
  );
}

// Status, thread and answer buttons for one decision, for lists that draw their own row
// (Today's queue). Reads the shared activity store, so it needs no props beyond the item.
export function DecisionControls({ entity, decision }: { entity: PortfolioEntity; decision: EntityDecision }) {
  const { activity } = useOrgActivity();
  const view = viewOf(decisionId(decision), rowsFor(activity, entity.id), actRuns(activity), entity.id);
  return (
    <>
      <DecisionStatus view={view} lead={entity.lead} />
      <DecisionThread view={view} lead={entity.lead} />
      <DecisionActions entityId={entity.id} lead={entity.lead} decision={decision} view={view} compact />
    </>
  );
}
