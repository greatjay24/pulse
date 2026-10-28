import { useTheme } from '../contexts/ThemeContext';
import { PortfolioSnapshot, TrackerSnapshot } from '../types';
import { formatUsd } from '../utils/tracker';
import { projectsOf, sumFinance } from '../utils/finance';
import { moneySources } from '../utils/sources';
import { Icon } from './Icons';
import { BoardEntity, boardEntities } from './OrgBoard';
import { Card, DataStamps, EntityLogos, EntityMark, Notice, PageHeader, SectionHeading } from './BoardUI';
import { MoneyBand } from './MoneyBand';

function BusinessMoney({ item, d30, d90, mrr, onOpen }: { item: BoardEntity; d30: number; d90: number; mrr: number | null; onOpen: () => void }) {
  const { tokens } = useTheme();
  const c = tokens.colors;
  const figure = (label: string, value: string, dim = false) => (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: '20px', fontWeight: 600, letterSpacing: '-0.01em', color: dim ? c.textDim : c.text, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
      <div style={{ fontSize: tokens.type.micro, color: c.textDim, marginTop: '4px' }}>{label}</div>
    </div>
  );
  return (
    <button
      onClick={onOpen}
      onMouseEnter={(e) => (e.currentTarget.style.borderColor = c.borderHover)}
      onMouseLeave={(e) => (e.currentTarget.style.borderColor = c.border)}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '18px',
        padding: '20px 22px',
        textAlign: 'left',
        fontFamily: 'inherit',
        color: c.text,
        background: c.bgCard,
        border: `1px solid ${c.border}`,
        borderRadius: tokens.radius.lg,
        cursor: 'pointer',
        transition: 'border-color 0.15s ease',
        minWidth: 0,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', width: '100%' }}>
        <EntityMark entity={item.entity} logos={item.logos} size={28} />
        <span style={{ fontFamily: tokens.fonts.display, fontSize: '19px', fontWeight: 500, flex: 1, minWidth: 0 }}>{item.entity.name}</span>
        <Icon name="arrow-right" size={14} color={c.textDim} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '12px', width: '100%' }}>
        {figure('30 days', formatUsd(d30), d30 === 0)}
        {figure('90 days', formatUsd(d90), d90 === 0)}
        {figure('Stripe MRR', mrr === null ? '—' : formatUsd(mrr), mrr === null)}
      </div>
    </button>
  );
}

interface MoneyViewProps {
  snapshot: PortfolioSnapshot | null;
  tracker: TrackerSnapshot | null;
  trackerError: string | null;
  onOpenFinance: (id: string) => void;
}

// Cash in across the portfolio, then each business's slice; a card opens its Finance tab.
export function MoneyView({ snapshot, tracker, trackerError, onOpenFinance }: MoneyViewProps) {
  const { tokens } = useTheme();
  const now = Date.now();
  const ok = tracker && !tracker.error ? tracker : null;
  const problem = trackerError ?? tracker?.error ?? null;
  const items = boardEntities(snapshot, tracker);
  const entities = snapshot?.registry?.entities ?? [];
  const logos = new Map(items.filter((i) => i.logos).map((i) => [i.entity.id, i.logos as EntityLogos]));

  const rows = ok
    ? items
        .map((item) => {
          const slice = sumFinance(projectsOf(item.entity.id, ok.money.finance, entities));
          const projects = item.entity.tracker_projects ?? [];
          const stripe = ok.money.finance.stripe_accounts.filter((a) => a.ok && projects.includes(a.project));
          return { item, d30: slice.d30, d90: slice.d90, mrr: stripe.length ? stripe.reduce((s, a) => s + a.mrr, 0) : null };
        })
        .sort((a, b) => b.d90 - a.d90 || b.d30 - a.d30)
    : [];

  return (
    <div style={{ maxWidth: '1400px', margin: '0 auto' }}>
      <PageHeader
        title="Money"
        subtitle={ok ? <DataStamps sources={moneySources(ok)} now={now} /> : undefined}
      />
      {problem && <Notice>Money not shown: {problem}</Notice>}
      {!ok && !problem && <Notice tone="quiet">Reading ~/project-tracker…</Notice>}
      {ok && snapshot?.registry && (
        <>
          <MoneyBand money={ok.money} entities={entities} logos={logos} onOpenEntity={onOpenFinance} />
          {ok.money.configured && (
            <section>
              <SectionHeading note="cash in by business · opens its Finance tab">By business</SectionHeading>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '16px' }}>
                {rows.map((r) => (
                  <BusinessMoney key={r.item.entity.id} {...r} onOpen={() => onOpenFinance(r.item.entity.id)} />
                ))}
              </div>
            </section>
          )}
        </>
      )}
      {ok && !snapshot?.registry && (
        <Card>
          <span style={{ fontSize: tokens.type.body, color: tokens.colors.textMuted }}>~/portfolio has not been read, so money can't be split by business.</span>
        </Card>
      )}
    </div>
  );
}
