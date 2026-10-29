import { ReactNode } from 'react';
import { useTheme } from '../contexts/ThemeContext';
import { MoneySourceId, PortfolioEntity, TrackerMoney } from '../types';
import { formatUsd } from '../utils/tracker';
import {
  CONNECT_CMD,
  SOURCE_LABEL,
  formatDay,
  onFileSince,
  projectsOf,
  sourceOk,
  sumFinance,
  trailingMonths,
} from '../utils/finance';
import { titleCase } from '../utils/portfolio';
import { BarList, Figure, MonthColumns } from './MoneyCharts';
import { Card, CommandLine, SectionHeading } from './BoardUI';
import { CoverageNote, SourceChips } from './MoneyBand';

const DAY = 86400;
const PAYERS_SHOWN = 8;
const SOURCES: MoneySourceId[] = ['stripe', 'bank', 'email'];

function Quiet({ children }: { children: ReactNode }) {
  const { tokens } = useTheme();
  return <p style={{ fontSize: tokens.type.small, color: tokens.colors.textDim, lineHeight: 1.55 }}>{children}</p>;
}

function Small({ children }: { children: ReactNode }) {
  const { tokens } = useTheme();
  return <div style={{ fontSize: tokens.type.small, color: tokens.colors.textMuted, marginBottom: '16px' }}>{children}</div>;
}

// What a source that isn't connected needs: the exact command, nothing invented.
function ConnectHint({ source, project }: { source: MoneySourceId; project: string }) {
  const { tokens } = useTheme();
  if (source === 'email') {
    return <Quiet>Payment emails ride on the inboxes connected with connect_email.py; none are being read right now.</Quiet>;
  }
  return (
    <div style={{ display: 'grid', gap: '8px' }}>
      <span style={{ fontSize: tokens.type.small, color: tokens.colors.textMuted }}>
        {source === 'stripe' ? 'Stripe is not connected for this entity.' : 'The bank is not connected.'}
      </span>
      <CommandLine command={source === 'stripe' ? `${CONNECT_CMD} stripe ${project}` : `${CONNECT_CMD} simplefin`} />
    </div>
  );
}

interface EntityFinanceProps {
  entity: PortfolioEntity;
  entities: PortfolioEntity[];
  money: TrackerMoney;
}

// One entity's money: monthly cash in, by source, top payers, repeat vs one-off, Stripe
// subscriptions and bank balances. Everything comes from the tracker's collectors through
// the Rust port of money.py; a source that isn't connected says how to connect it.
export function EntityFinance({ entity, entities, money }: EntityFinanceProps) {
  const { tokens } = useTheme();
  const c = tokens.colors;
  const finance = money.finance;
  const projectIds = entity.tracker_projects ?? [];
  const primary = projectIds[0] ?? entity.id;
  const slice = sumFinance(projectsOf(entity.id, finance, entities));
  const since = onFileSince(finance);
  const now = Date.now() / 1000;
  const short90 = since !== null && since > now - 90 * DAY;
  const stripe = finance.stripe_accounts.filter((a) => projectIds.includes(a.project));
  const stripeLive = stripe.filter((a) => a.ok);
  const mrr = stripeLive.reduce((s, a) => s + a.mrr, 0);
  const subs = stripeLive.reduce((s, a) => s + a.active, 0);
  const bankAccounts = finance.bank_accounts.filter((a) => a.project && projectIds.includes(a.project));
  const bankOk = sourceOk(money, 'bank');
  const payersShown = slice.payers.slice(0, PAYERS_SHOWN);
  const withPayer = slice.repeat + slice.oneOff;

  if (!money.configured) {
    return (
      <Card>
        <SectionHeading right={<SourceChips money={money} />}>Finance</SectionHeading>
        <p style={{ fontSize: tokens.type.body, color: c.textMuted, marginBottom: '16px', lineHeight: 1.55 }}>
          No money source is connected yet, so there is nothing to break down.
        </p>
        <div style={{ display: 'grid', gap: '20px', maxWidth: '640px' }}>
          <ConnectHint source="stripe" project={primary} />
          <ConnectHint source="bank" project={primary} />
        </div>
      </Card>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <Card padding="28px 30px">
        <SectionHeading note="cash in" right={<SourceChips money={money} />}>Finance</SectionHeading>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '32px' }}>
          <Figure hero label="Last 30 days" value={formatUsd(slice.d30)} />
          <Figure
            label="Last 90 days"
            value={formatUsd(slice.d90)}
            sub={short90 && since !== null ? `Only on file since ${formatDay(since)}` : undefined}
          />
          <Figure
            label="Stripe MRR"
            value={stripeLive.length ? formatUsd(mrr) : '—'}
            sub={stripeLive.length ? `${subs} active ${subs === 1 ? 'subscription' : 'subscriptions'}` : 'Stripe not connected here'}
          />
        </div>
      </Card>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))', gap: '24px', alignItems: 'start' }}>
        <Card>
          <SectionHeading>Monthly</SectionHeading>
          <Small>Cash in, last 12 months</Small>
          <MonthColumns months={trailingMonths(12, new Date())} values={slice.months} since={since} />
          <div style={{ marginTop: '18px' }}>
            <Quiet>
              Money out is not shown: the bank collector keeps deposits only
              {bankOk ? '.' : ', and the bank is not connected.'}
            </Quiet>
          </div>
        </Card>

        <Card>
          <SectionHeading note="last 90 days">By source</SectionHeading>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '22px' }}>
            {SOURCES.map((source) => {
              const connected = source === 'stripe' ? stripeLive.length > 0 : sourceOk(money, source);
              if (!connected) {
                return (
                  <div key={source} style={{ display: 'flex', alignItems: 'baseline', gap: '12px' }}>
                    <span style={{ flex: 1, fontSize: tokens.type.body }}>{SOURCE_LABEL[source]}</span>
                    <span style={{ fontSize: tokens.type.small, color: c.textDim }}>not connected</span>
                  </div>
                );
              }
              const total = slice.byChannel.find(([ch]) => ch === source)?.[1] ?? 0;
              return (
                <BarList
                  key={source}
                  max={Math.max(...slice.byChannel.map(([, v]) => v), 0)}
                  rows={[{
                    key: source,
                    label: SOURCE_LABEL[source],
                    value: total,
                    sub: total > 0 ? railsFor(source, slice.byRail) : 'Nothing counted from this source',
                  }]}
                />
              );
            })}
          </div>
        </Card>

        <Card>
          <SectionHeading note="last 90 days">Top payers</SectionHeading>
          <BarList
            emptyText="No named payers in the last 90 days."
            rows={payersShown.map((p) => ({
              key: p.name,
              label: p.name,
              value: p.total,
              sub: p.payments > 1 ? `${p.payments} payments · repeat` : '1 payment',
            }))}
          />
          {slice.payers.length > PAYERS_SHOWN && (
            <div style={{ marginTop: '14px' }}><Quiet>{slice.payers.length - PAYERS_SHOWN} more payers not shown.</Quiet></div>
          )}
          {slice.noPayer > 0 && (
            <div style={{ marginTop: '14px' }}>
              <Quiet>{formatUsd(slice.noPayer)} came in with no payer name (payouts and deposits).</Quiet>
            </div>
          )}
        </Card>

        <Card>
          <SectionHeading note="last 90 days">Repeat vs one-off</SectionHeading>
          {withPayer > 0 ? (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px', marginBottom: '18px' }}>
                <Figure label="Repeat payers" value={formatUsd(slice.repeat)} sub={`${Math.round((100 * slice.repeat) / withPayer)}% of named`} />
                <Figure label="One-off" value={formatUsd(slice.oneOff)} sub={`${Math.round((100 * slice.oneOff) / withPayer)}% of named`} />
              </div>
              <div style={{ display: 'flex', height: '10px', gap: '2px', borderRadius: '4px', overflow: 'hidden', marginBottom: '14px' }}>
                {slice.repeat > 0 && <div style={{ flex: slice.repeat, background: c.chart }} />}
                {slice.oneOff > 0 && <div style={{ flex: slice.oneOff, background: c.chartTrack }} />}
              </div>
            </>
          ) : (
            <div style={{ marginBottom: '14px' }}><Quiet>No named payers in the last 90 days.</Quiet></div>
          )}
          <Quiet>
            Repeat means the same payer paid more than once in the window. Stripe subscriptions show as MRR above.
          </Quiet>
        </Card>

        <Card>
          <SectionHeading>Stripe</SectionHeading>
          {stripe.length === 0 ? (
            <ConnectHint source="stripe" project={primary} />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {stripe.map((a) => (
                <div key={a.project} style={{ display: 'flex', gap: '12px', alignItems: 'baseline', fontSize: tokens.type.body }}>
                  <span style={{ flex: 1 }}>{titleCase(a.project)}</span>
                  {a.ok ? (
                    <span style={{ color: c.textMuted, fontVariantNumeric: 'tabular-nums' }}>
                      {a.active} active · <span style={{ color: c.text, fontWeight: 600 }}>{formatUsd(a.mrr)}</span> MRR
                    </span>
                  ) : (
                    <span style={{ color: c.warning, fontSize: tokens.type.small }}>{a.error ?? 'not reading'}</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card>
          <SectionHeading>Bank</SectionHeading>
          {!bankOk ? (
            <ConnectHint source="bank" project={primary} />
          ) : bankAccounts.length === 0 ? (
            <Quiet>
              No bank account is mapped to this entity. Map one under "bank_projects" in ~/project-tracker/money.json.
            </Quiet>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {bankAccounts.map((a, i) => (
                <div key={i} style={{ display: 'flex', gap: '12px', alignItems: 'baseline', fontSize: tokens.type.body }}>
                  <span style={{ flex: 1 }}>{[a.org, a.name].filter(Boolean).join(' ')}</span>
                  <span style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                    {a.balance === null ? '—' : a.currency === 'usd' ? formatUsd(a.balance) : `${a.balance.toLocaleString()} ${a.currency.toUpperCase()}`}
                  </span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <CoverageNote money={money} />
    </div>
  );
}

// Rails behind a channel total, e.g. payment emails: "Venmo $240 · Zelle $95".
function railsFor(source: MoneySourceId, byRail: [MoneySourceId, string, number][]): string | undefined {
  const rails = byRail.filter(([ch]) => ch === source);
  if (source === 'stripe' || rails.length === 0) return undefined;
  return rails.map(([, r, v]) => `${titleCase(r)} ${formatUsd(v)}`).join(' · ');
}
