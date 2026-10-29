import { useTheme } from '../contexts/ThemeContext';
import { MoneySourceId, PortfolioEntity, TrackerMoney } from '../types';
import { UNASSIGNED, formatUsd } from '../utils/tracker';
import {
  CONNECT_CMD,
  SOURCE_LABEL,
  formatDay,
  onFileSince,
  projectsOf,
  sumFinance,
  trailingMonths,
  windowDays,
} from '../utils/finance';
import { BarList, Figure, MonthColumns } from './MoneyCharts';
import { Card, CommandLine, EntityLogos, EntityMark, SectionHeading } from './BoardUI';
import { HealthMark } from './Icons';

const DAY = 86400;

// Connection state of each money source, as quiet chips.
export function SourceChips({ money }: { money: TrackerMoney }) {
  const { tokens } = useTheme();
  const now = Date.now() / 1000;
  return (
    <span style={{ display: 'inline-flex', gap: '8px', flexWrap: 'wrap' }}>
      {money.finance.coverage.map((c) => {
        const age = c.ok && c.collected_at ? (now - c.collected_at) / 3600 : null;
        const state = !c.ok ? 'not connected' : age === null ? 'connected' : age < 1 ? 'updated just now' : age < 48 ? `updated ${Math.floor(age)}h ago` : `updated ${Math.floor(age / 24)}d ago`;
        return (
          <span
            key={c.source}
            title={c.ok ? undefined : c.reason ?? 'not connected'}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              padding: '3px 10px',
              borderRadius: '999px',
              border: `1px solid ${tokens.colors.border}`,
              fontSize: tokens.type.micro,
              color: c.ok ? tokens.colors.textMuted : tokens.colors.textDim,
              whiteSpace: 'nowrap',
            }}
          >
            <HealthMark health={c.ok ? 'green' : undefined} size={8} color={c.ok ? tokens.colors.success : tokens.colors.textDim} />
            {SOURCE_LABEL[c.source as MoneySourceId]} · {state}
          </span>
        );
      })}
    </span>
  );
}

// Plain words on how far back the numbers reach, so 90 days and the year never overstate.
export function CoverageNote({ money }: { money: TrackerMoney }) {
  const { tokens } = useTheme();
  const since = onFileSince(money.finance);
  const days = windowDays(money.finance);
  if (since === null) return null;
  return (
    <p style={{ fontSize: tokens.type.micro, color: tokens.colors.textDim, lineHeight: 1.55 }}>
      Cash in counts each payment once across Stripe, the bank and payment emails (the same rules as the brief).
      {days !== null && ` The collectors keep ${days} days, so money before ${formatDay(since)} is not on file yet.`}
    </p>
  );
}

interface MoneyBandProps {
  money: TrackerMoney;
  entities: PortfolioEntity[];
  logos: Map<string, EntityLogos>;
  onOpenEntity: (id: string) => void;
}

// The Money page's lead: cash in over 30 and 90 days, who it came in for, and the year.
export function MoneyBand({ money, entities, logos, onOpenEntity }: MoneyBandProps) {
  const { tokens } = useTheme();
  const finance = money.finance;
  const now = Date.now() / 1000;

  if (!money.configured) {
    return (
      <Card style={{ marginBottom: '40px' }}>
        <SectionHeading right={<SourceChips money={money} />}>Cash in</SectionHeading>
        <p style={{ fontSize: tokens.type.body, color: tokens.colors.textMuted, marginBottom: '16px', maxWidth: '640px', lineHeight: 1.55 }}>
          No money source is connected, so there is nothing to count yet. Connect Stripe per project and your bank once:
        </p>
        <div style={{ display: 'grid', gap: '8px', maxWidth: '640px' }}>
          <CommandLine command={`${CONNECT_CMD} stripe <project>`} />
          <CommandLine command={`${CONNECT_CMD} simplefin`} />
        </div>
      </Card>
    );
  }

  const all = sumFinance(finance.projects);
  const since = onFileSince(finance);
  const short90 = since !== null && since > now - 90 * DAY;
  const months = trailingMonths(12, new Date());

  const rows = entities
    .map((e) => ({ entity: e, slice: sumFinance(projectsOf(e.id, finance, entities)) }))
    .filter((r) => r.slice.d30 > 0)
    .sort((a, b) => b.slice.d30 - a.slice.d30);
  const unassigned = sumFinance(projectsOf(UNASSIGNED, finance, entities));
  const quiet = entities.filter((e) => !rows.some((r) => r.entity.id === e.id));

  return (
    <Card style={{ marginBottom: '40px' }} padding="28px 30px">
      <SectionHeading note="all businesses" right={<SourceChips money={money} />}>Cash in</SectionHeading>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
          gap: '36px',
          alignItems: 'start',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '28px' }}>
          <Figure
            hero
            label="Last 30 days"
            value={formatUsd(money.totals.d30)}
            sub={`${money.counts.d30} ${money.counts.d30 === 1 ? 'payment' : 'payments'} · ${formatUsd(money.totals.d7)} in the last 7 days`}
          />
          <Figure
            label="Last 90 days"
            value={formatUsd(all.d90)}
            sub={short90 && since !== null ? `Only on file since ${formatDay(since)}` : undefined}
          />
          {(money.mrr_total > 0 || money.failed_30d > 0 || money.refunds_30d > 0) && (
            <div style={{ fontSize: tokens.type.small, color: tokens.colors.textMuted, lineHeight: 1.6 }}>
              {money.mrr_total > 0 && <div>Stripe MRR {formatUsd(money.mrr_total)}</div>}
              {money.failed_30d > 0 && <div style={{ color: tokens.colors.warning }}>{money.failed_30d} failed {money.failed_30d === 1 ? 'payment' : 'payments'} in 30 days</div>}
              {money.refunds_30d > 0 && <div>{formatUsd(money.refunds_30d)} refunded in 30 days</div>}
            </div>
          )}
        </div>

        <div>
          <div style={{ fontSize: tokens.type.small, color: tokens.colors.textMuted, marginBottom: '16px' }}>By entity · 30 days</div>
          <BarList
            emptyText="Nothing came in over the last 30 days."
            rows={[
              ...rows.map((r) => ({
                key: r.entity.id,
                label: (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '10px' }}>
                    <EntityMark entity={r.entity} logos={logos.get(r.entity.id) ?? null} size={20} />
                    {r.entity.name}
                  </span>
                ),
                value: r.slice.d30,
                onClick: () => onOpenEntity(r.entity.id),
              })),
              ...(unassigned.d30 > 0
                ? [{ key: UNASSIGNED, label: 'Unassigned', value: unassigned.d30, sub: 'Not tagged to a tracker project yet' }]
                : []),
            ]}
          />
          {quiet.length > 0 && (rows.length > 0 || unassigned.d30 > 0) && (
            <div style={{ fontSize: tokens.type.micro, color: tokens.colors.textDim, marginTop: '16px', lineHeight: 1.5 }}>
              Nothing attributed: {quiet.map((e) => e.name).join(', ')}
            </div>
          )}
        </div>

        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: tokens.type.small, color: tokens.colors.textMuted, marginBottom: '16px' }}>Last 12 months</div>
          <MonthColumns months={months} values={all.months} since={since} />
        </div>
      </div>
      <div style={{ marginTop: '24px', paddingTop: '18px', borderTop: `1px solid ${tokens.colors.border}` }}>
        <CoverageNote money={money} />
      </div>
    </Card>
  );
}
