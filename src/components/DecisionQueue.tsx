import { useState } from 'react';
import { useTheme } from '../contexts/ThemeContext';
import { QueuedDecision, decisionKey } from '../utils/today';
import { EntityMark, HealthBadge } from './BoardUI';
import { Icon } from './Icons';
import { DecisionControls } from './DecisionCard';

const SHOWN = 6;

// One ask in the queue: whose it is, the ask (two lines at most) and the lead's
// recommendation, then Approve / Reject / Discuss. The full decision, with its reasoning,
// is on the entity's Overview (click the ask).
function QueueRow({ q, onOpen }: { q: QueuedDecision; onOpen: () => void }) {
  const { tokens } = useTheme();
  const c = tokens.colors;
  const { item, decision: d } = q;
  return (
    <div>
    <button
      onClick={onOpen}
      title={`Open ${item.entity.name}`}
      onMouseEnter={(e) => (e.currentTarget.style.background = c.bgCardHover)}
      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
      style={{
        display: 'grid',
        gridTemplateColumns: '28px minmax(0, 1fr) auto',
        gap: '14px',
        alignItems: 'start',
        width: '100%',
        padding: '14px 16px',
        textAlign: 'left',
        fontFamily: 'inherit',
        color: c.text,
        background: 'transparent',
        border: 'none',
        borderRadius: tokens.radius.sm,
        cursor: 'pointer',
        transition: 'background 0.15s ease',
      }}
    >
      <EntityMark entity={item.entity} logos={item.logos} size={28} />
      <span style={{ minWidth: 0 }}>
        <span
          style={{
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
            fontSize: tokens.type.body,
            fontWeight: 600,
            lineHeight: 1.45,
          }}
        >
          {d.ask}
        </span>
        {d.recommend && (
          <span
            title={d.recommend}
            style={{
              display: '-webkit-box',
              WebkitLineClamp: 1,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
              fontSize: tokens.type.small,
              lineHeight: 1.5,
              color: c.textMuted,
              marginTop: '3px',
            }}
          >
            <span style={{ color: c.accent, fontWeight: 600 }}>Recommend </span>
            {d.recommend}
          </span>
        )}
        <span style={{ display: 'flex', gap: '10px', marginTop: '6px', fontSize: tokens.type.micro, color: c.textDim, flexWrap: 'wrap' }}>
          <span>{item.entity.name}</span>
          {d.gate && <span>· {d.gate}</span>}
          {d.due && <span style={{ color: c.warning }}>· due {d.due}</span>}
        </span>
      </span>
      <span style={{ marginTop: '3px', opacity: 0.6 }}>
        <Icon name="arrow-right" size={14} color={c.textDim} />
      </span>
    </button>
    <div style={{ padding: '0 16px 14px 58px' }}>
      <DecisionControls entity={item.entity} decision={d} />
    </div>
    </div>
  );
}

// Every report decision waiting on the owner, riskiest business first.
export function DecisionQueue({ queue, onOpenEntity }: { queue: QueuedDecision[]; onOpenEntity: (id: string) => void }) {
  const { tokens } = useTheme();
  const c = tokens.colors;
  const [showAll, setShowAll] = useState(false);
  if (queue.length === 0) {
    return <div style={{ fontSize: tokens.type.body, color: c.textMuted }}>No decisions waiting on you.</div>;
  }
  const shown = showAll ? queue : queue.slice(0, SHOWN);
  // Group consecutive rows by entity health so the color reads once per run, not per row.
  let lastHealth: string | undefined | null = null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', padding: '6px', background: c.bgCard, border: `1px solid ${c.border}`, borderRadius: tokens.radius.md }}>
      {shown.map((q) => {
        const health = q.item.status?.health;
        const header = health !== lastHealth;
        lastHealth = health;
        return (
          <div key={decisionKey(q)}>
            {header && (
              <div style={{ padding: '10px 16px 2px' }}>
                <HealthBadge health={health} />
              </div>
            )}
            <QueueRow q={q} onOpen={() => onOpenEntity(q.item.entity.id)} />
          </div>
        );
      })}
      {queue.length > SHOWN && (
        <button className="btn btn-secondary" onClick={() => setShowAll(!showAll)} style={{ alignSelf: 'flex-start', margin: '8px 16px 10px' }}>
          {showAll ? 'Show fewer' : `Show all ${queue.length}`}
        </button>
      )}
    </div>
  );
}
