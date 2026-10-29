import { useTheme } from '../contexts/ThemeContext';
import { MoneyFinance, PortfolioEntity, PortfolioSnapshot, TrackerSnapshot } from '../types';
import { formatUsd } from '../utils/tracker';
import { MERCURY_CMD, SOURCE_LABEL, balanceOf, onFileSince, payoutWeeksOf, projectsOf, sumFinance, trailingWeeks, weekOnFile, weeksOf } from '../utils/finance';
import { seriesColor } from '../utils/seriesColor';
import { BalanceLine, ValuesTable, WeekColumns } from './MoneyCharts';
import { moneySources } from '../utils/sources';
import { Icon } from './Icons';
import { BoardEntity, boardEntities } from './OrgBoard';
import { Card, CommandLine, DataStamps, EntityLogos, EntityMark, Notice, PageHeader, SectionHeading } from './BoardUI';
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

const WEEKS = 13;

function Panel({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  const { tokens } = useTheme();
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', marginBottom: '12px' }}>
        <span style={{ fontSize: tokens.type.small, fontWeight: 600, color: tokens.colors.text, whiteSpace: 'nowrap' }}>{title}</span>
        {note && <span style={{ fontSize: tokens.type.micro, color: tokens.colors.textDim }}>{note}</span>}
      </div>
      {children}
    </div>
  );
}

// One business, three charts in its own color: cash in by week, Stripe payouts by week, and
// the bank balance once a bank with history (Mercury) is connected.
function BusinessWeeks({ item, finance, entities, bankOn, since }: { item: BoardEntity; finance: MoneyFinance; entities: PortfolioEntity[]; bankOn: boolean; since: number | null }) {
  const { tokens, resolvedTheme } = useTheme();
  const c = tokens.colors;
  const color = seriesColor(item.entity.color, c.bgCard, resolvedTheme, c.chart);
  const keys = trailingWeeks(WEEKS, new Date());
  const cash = weeksOf(projectsOf(item.entity.id, finance, entities));
  const payouts = payoutWeeksOf(item.entity.id, finance, entities);
  const projects = item.entity.tracker_projects ?? [];
  const hasStripe = finance.stripe_accounts.some((a) => a.ok && projects.includes(a.project)) || payouts.size > 0;
  const bank = balanceOf(item.entity.id, finance, entities);
  const fmtWeek = (k: string) => new Date(`${k}T00:00`).toLocaleDateString([], { month: 'short', day: 'numeric' });
  const cashBars = keys.map((k) => {
    const w = cash.get(k);
    const detail = w && w.byChannel.size > 1 ? [...w.byChannel.entries()].map(([ch, v]) => `${SOURCE_LABEL[ch]} ${formatUsd(v)}`).join(' · ') : undefined;
    return { key: k, value: w?.total ?? 0, known: weekOnFile(k, since), detail };
  });
  // Payouts come from Stripe alone, so only Stripe's window says which weeks are known.
  const stripe = finance.coverage.find((s) => s.source === 'stripe' && s.ok && s.collected_at && s.window_days);
  const stripeSince = stripe ? (stripe.collected_at as number) - (stripe.window_days as number) * 86400 : null;
  const payoutBars = keys.map((k) => ({ key: k, value: payouts.get(k) ?? 0, known: weekOnFile(k, stripeSince) }));
  const total = cashBars.reduce((s, b) => s + b.value, 0);

  return (
    <Card>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '20px' }}>
        <EntityMark entity={item.entity} logos={item.logos} size={24} />
        <span style={{ fontFamily: tokens.fonts.display, fontSize: '18px', fontWeight: 500, flex: 1, minWidth: 0 }}>{item.entity.name}</span>
        <span style={{ fontSize: tokens.type.small, color: c.textMuted }}>{formatUsd(total)} in {WEEKS} weeks</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '28px' }}>
        <Panel title="Cash in by week" note="all sources, each dollar once">
          <WeekColumns weeks={cashBars} color={color} label={`${item.entity.name}: cash in by week`} />
          <ValuesTable caption="Cash in by week" rows={cashBars.map((b) => [fmtWeek(b.key), b.known ? formatUsd(b.value) : 'not on file'])} />
        </Panel>
        {hasStripe && (
          <Panel title="Stripe payouts by week" note="to the bank, by arrival">
            <WeekColumns weeks={payoutBars} color={color} label={`${item.entity.name}: Stripe payouts by week`} />
            <ValuesTable caption="Stripe payouts by week" rows={payoutBars.map((b) => [fmtWeek(b.key), b.known ? formatUsd(b.value) : 'not on file'])} />
          </Panel>
        )}
        {bank.series.length > 1 ? (
          <Panel title="Bank balance" note={`${bank.accounts.length === 1 ? bank.accounts[0].name : `${bank.accounts.length} accounts`}, end of day`}>
            <BalanceLine points={bank.series} color={color} label={`${item.entity.name}: bank balance`} />
            <ValuesTable caption="Bank balance, end of each week" rows={bank.series.filter((_, i, a) => (a.length - 1 - i) % 7 === 0).map(([d, v]) => [fmtWeek(d), formatUsd(v)])} />
          </Panel>
        ) : (
          bankOn &&
          bank.accounts.length === 0 && (
            <Panel title="Bank balance">
              <div style={{ fontSize: tokens.type.small, color: c.textDim, lineHeight: 1.5 }}>No bank account is tagged with this business. Map it in money.json "bank_projects", or connect its Mercury token.</div>
            </Panel>
          )
        )}
      </div>
    </Card>
  );
}

interface MoneyViewProps {
  snapshot: PortfolioSnapshot | null;
  tracker: TrackerSnapshot | null;
  trackerError: string | null;
  trackerAbsent?: boolean; // no tracker installed: money has no source
  onOpenFinance: (id: string) => void;
}

// Cash in across the portfolio, then each business's slice; a card opens its Finance tab.
export function MoneyView({ snapshot, tracker, trackerError, trackerAbsent = false, onOpenFinance }: MoneyViewProps) {
  const { tokens } = useTheme();
  const now = Date.now();
  const ok = tracker && !tracker.error ? tracker : null;
  const problem = trackerError ?? tracker?.error ?? null;
  const items = boardEntities(snapshot, tracker);
  const entities = snapshot?.registry?.entities ?? [];
  const logos = new Map(items.filter((i) => i.logos).map((i) => [i.entity.id, i.logos as EntityLogos]));
  const bankOn = !!ok?.money.finance.coverage.some((c) => c.source === 'bank' && c.ok);
  const since = ok ? onFileSince(ok.money.finance) : null;

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
      {trackerAbsent && (
        <Notice tone="quiet">Money comes from an optional tracker that collects payments, and none is set up on this Mac. The leads still report cash in their status metrics on the Board.</Notice>
      )}
      {!ok && !problem && !trackerAbsent && <Notice tone="quiet">Reading ~/project-tracker…</Notice>}
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
          {ok.money.configured && (
            <section style={{ marginTop: '48px' }}>
              <SectionHeading note={`last ${WEEKS} weeks · each business in its own color · hover for exact values`}>By week</SectionHeading>
              {!bankOn && (
                <div style={{ marginBottom: '16px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <span style={{ fontSize: tokens.type.small, color: tokens.colors.textMuted }}>Balance trends appear once a bank is connected. For Mercury, one read-only token per business:</span>
                  <CommandLine command={MERCURY_CMD} />
                </div>
              )}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                {rows
                  .filter((r) => r.d90 > 0 || balanceOf(r.item.entity.id, ok.money.finance, entities).accounts.length > 0 || payoutWeeksOf(r.item.entity.id, ok.money.finance, entities).size > 0)
                  .map((r) => (
                    <BusinessWeeks key={r.item.entity.id} item={r.item} finance={ok.money.finance} entities={entities} bankOn={bankOn} since={since} />
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
