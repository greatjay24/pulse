import { useState } from 'react';
import { useTheme } from '../contexts/ThemeContext';
import { PortfolioSnapshot } from '../types';
import { ConnectStep, Connection, ConnectionStatus } from '../types/ops';
import { checkConnections, startConnect, useConnections } from '../hooks/useOps';
import { Card, Notice, PageHeader, SectionHeading } from './BoardUI';
import { Icon } from './Icons';
import { connectSteps, maskAccount } from '../utils/connectors';

// Connectors: one card per service the agents use, like Claude's connector settings. Each
// card says whether it's connected, as which account (masked), when Roo last checked, and
// offers Connect / Reconnect when the service has a sign-in flow Roo can start. Services
// without one show their manual steps instead. Data: ~/portfolio/connections.json, plus the
// Chrome profiles in portfolio.json's `browsers`. No secret ever reaches this page.

const STATUS_LABEL: Record<ConnectionStatus, string> = {
  connected: 'Connected',
  'needs-auth': 'Needs sign-in',
  'not-set-up': 'Not set up',
};
const STATUS_ORDER: Record<ConnectionStatus, number> = { 'needs-auth': 0, 'not-set-up': 1, connected: 2 };

const when = (iso?: string) =>
  iso ? new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : null;

const steps = (conn: Connection) => connectSteps(conn.connect);

const stepText = (s: ConnectStep) => (s.url ? s.url : (s.terminal ?? []).join(' '));

function Dot({ status }: { status: ConnectionStatus }) {
  const { tokens } = useTheme();
  const c = tokens.colors;
  const color = status === 'connected' ? c.success : status === 'needs-auth' ? c.warning : c.textDim;
  return <span aria-hidden style={{ width: 9, height: 9, borderRadius: '50%', background: status === 'not-set-up' ? 'transparent' : color, border: `2px solid ${color}`, flexShrink: 0, display: 'inline-block' }} />;
}

function useConnect() {
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ id: string; text: string; error?: boolean } | null>(null);
  const run = async (id: string, step: number) => {
    setBusy(`${id}:${step}`);
    setMessage(null);
    try {
      const text = await startConnect(id, step);
      if (text) setMessage({ id, text });
    } catch (e) {
      setMessage({ id, text: String(e), error: true });
    } finally {
      setBusy(null);
    }
  };
  return { busy, message, run };
}

function ConnectorCard({ conn, active, onSelect, onConnect, busy }: {
  conn: Connection; active: boolean; onSelect: () => void; onConnect: (step: number) => void; busy: boolean;
}) {
  const { tokens } = useTheme();
  const c = tokens.colors;
  const list = steps(conn);
  const checked = when(conn.checked_at);
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(); } }}
      aria-pressed={active}
      style={{
        cursor: 'pointer', color: c.text, background: active ? c.bgCardHover : c.bgCard,
        border: `1px solid ${active ? c.accent : c.border}`, borderRadius: tokens.radius.md,
        padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: '6px', minWidth: 0,
      }}
    >
      <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <Dot status={conn.status} />
        <span style={{ fontWeight: 600, fontSize: tokens.type.body, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{conn.name}</span>
      </span>
      <span style={{ fontSize: tokens.type.micro, color: c.textMuted }}>
        {STATUS_LABEL[conn.status]}{conn.account ? ` · ${maskAccount(conn.account)}` : ''}
      </span>
      <span style={{ fontSize: tokens.type.micro, color: c.textDim }}>{checked ? `Checked ${checked}` : 'Not checked yet'}</span>
      <div style={{ marginTop: '4px' }}>
        {list.length > 0 ? (
          <button
            className="btn btn-secondary"
            disabled={busy}
            onClick={(e) => { e.stopPropagation(); onConnect(0); }}
            style={{ padding: '5px 12px', fontSize: tokens.type.micro }}
          >
            {busy ? 'Opening…' : conn.status === 'connected' ? 'Reconnect' : 'Connect'}
          </button>
        ) : (
          <span style={{ fontSize: tokens.type.micro, color: c.textDim }}>{conn.status === 'connected' ? 'Steps in details' : 'Manual setup: see steps'}</span>
        )}
      </div>
    </div>
  );
}

function Panel({ conn, names, onConnect, busy, message }: {
  conn: Connection; names: (id: string) => string; onConnect: (step: number) => void; busy: string | null;
  message: { id: string; text: string; error?: boolean } | null;
}) {
  const { tokens } = useTheme();
  const c = tokens.colors;
  const list = steps(conn);
  const row = (label: string, value: string) => (
    <div style={{ display: 'flex', gap: '12px', fontSize: tokens.type.small, lineHeight: 1.55 }}>
      <span style={{ color: c.textDim, width: '110px', flexShrink: 0 }}>{label}</span>
      <span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>{value}</span>
    </div>
  );
  return (
    <Card>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '14px' }}>
        <Dot status={conn.status} />
        <span style={{ fontSize: '19px', fontWeight: 600 }}>{conn.name}</span>
        <span style={{ fontSize: tokens.type.small, color: c.textMuted }}>{STATUS_LABEL[conn.status]}</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '16px' }}>
        {conn.account && row('Account', maskAccount(conn.account))}
        {row('For', conn.for)}
        {conn.entities.length > 0 && row('Used by', conn.entities.map(names).join(', '))}
        {row('Agents reach it', conn.access)}
        {conn.mode && row('Access', conn.mode)}
        {row('Last check', [conn.status_detail, when(conn.checked_at) && `(${when(conn.checked_at)})`].filter(Boolean).join(' ') || 'Not checked yet')}
      </div>
      {list.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '16px' }}>
          {list.map((s, i) => (
            <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <div>
                <button className="btn btn-primary" disabled={busy === `${conn.id}:${i}`} onClick={() => onConnect(i)} style={{ fontSize: tokens.type.small }}>
                  {busy === `${conn.id}:${i}` ? 'Opening…' : s.label ?? (conn.status === 'connected' ? 'Reconnect' : 'Connect')}
                </button>
              </div>
              <code style={{ fontFamily: tokens.fonts.mono, fontSize: tokens.type.micro, color: c.textDim, overflowWrap: 'anywhere' }}>
                {s.url ? 'Opens ' : 'Runs in Terminal: '}{stepText(s)}
              </code>
            </div>
          ))}
        </div>
      )}
      {message && message.id === conn.id && (
        <div style={{ marginBottom: '14px', fontSize: tokens.type.small, color: message.error ? c.danger : c.textMuted }}>{message.text}</div>
      )}
      {conn.connect_steps.length > 0 && (
        <>
          <div style={{ fontSize: tokens.type.small, fontWeight: 600, marginBottom: '8px' }}>{list.length > 0 ? 'Or by hand' : 'How to connect'}</div>
          <ol style={{ paddingLeft: '20px', display: 'flex', flexDirection: 'column', gap: '6px', fontSize: tokens.type.small, lineHeight: 1.55 }}>
            {conn.connect_steps.map((s, i) => <li key={i}>{s}</li>)}
          </ol>
        </>
      )}
      {conn.notes && <div style={{ marginTop: '14px', fontSize: tokens.type.small, color: c.textMuted, lineHeight: 1.55 }}>{conn.notes}</div>}
      {conn.sources && conn.sources.length > 0 && (
        <div style={{ marginTop: '12px', fontSize: tokens.type.micro, color: c.textDim, overflowWrap: 'anywhere' }}>
          Sources: {conn.sources.join(' · ')}
        </div>
      )}
    </Card>
  );
}

// Chrome profiles from portfolio.json `browsers`: which business uses which profile. Roo can't
// see whether the Claude extension is paired, so these show the steps, not a fake status.
function BrowserProfiles({ snapshot }: { snapshot: PortfolioSnapshot | null }) {
  const { tokens } = useTheme();
  const c = tokens.colors;
  const browsers = snapshot?.registry?.browsers ?? {};
  const entities = snapshot?.registry?.entities ?? [];
  const keys = Object.keys(browsers);
  if (keys.length === 0) return null;
  return (
    <section>
      <SectionHeading note="One Chrome profile per business, each signed in to that business's accounts">Chrome profiles</SectionHeading>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '10px' }}>
        {keys.map((k) => {
          const b = browsers[k];
          const users = entities.filter((e) => e.browser === k).map((e) => e.name);
          const paired = typeof b.deviceId === 'string' && b.deviceId.length > 0;
          return (
            <div key={k} style={{ background: c.bgCard, border: `1px solid ${c.border}`, borderRadius: tokens.radius.md, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: '6px', minWidth: 0 }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Dot status={paired ? 'connected' : 'not-set-up'} />
                <span style={{ fontWeight: 600, fontSize: tokens.type.body }}>{b.name ?? k}</span>
              </span>
              <span style={{ fontSize: tokens.type.micro, color: c.textMuted }}>{paired ? 'Saved in Roo' : 'Not saved yet'}</span>
              {users.length > 0 && <span style={{ fontSize: tokens.type.micro, color: c.textDim }}>Used by {users.join(', ')}</span>}
            </div>
          );
        })}
      </div>
      <ol style={{ marginTop: '12px', paddingLeft: '20px', display: 'flex', flexDirection: 'column', gap: '4px', fontSize: tokens.type.small, color: c.textMuted, lineHeight: 1.55 }}>
        <li>Open Chrome with the profile for that business and sign in to its accounts there.</li>
        <li>Install the Claude in Chrome extension in that profile and sign in to it.</li>
        <li>Ask Roo to save the profile. Agents then pick it by its saved id, so you never pair again.</li>
      </ol>
    </section>
  );
}

// Every system the businesses run on, whether agents can reach it, and how to connect the rest.
export function ConnectionsPage({ snapshot }: { snapshot: PortfolioSnapshot | null }) {
  const { tokens } = useTheme();
  const { data, error, refresh } = useConnections();
  const { busy, message, run } = useConnect();
  const [selected, setSelected] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState<string | null>(null);
  const systems = [...(data?.systems ?? [])].sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status]);
  const categories = [...new Set(systems.map((s) => s.category))];
  const current = systems.find((s) => s.id === selected) ?? systems.find((s) => s.status !== 'connected') ?? systems[0];
  const entities = snapshot?.registry?.entities ?? [];
  const names = (id: string) => entities.find((e) => e.id === id)?.name ?? id;
  const counts = { connected: 0, 'needs-auth': 0, 'not-set-up': 0 } as Record<ConnectionStatus, number>;
  systems.forEach((s) => counts[s.status]++);

  const recheck = async () => {
    setChecking(true);
    setCheckError(null);
    try {
      await checkConnections();
      await refresh();
    } catch (e) {
      setCheckError(String(e));
    } finally {
      setChecking(false);
    }
  };

  const connect = (conn: Connection, step: number) => {
    setSelected(conn.id);
    run(conn.id, step);
  };

  return (
    <div style={{ maxWidth: '1180px', margin: '0 auto' }}>
      <PageHeader
        title="Connectors"
        subtitle={
          <span style={{ color: tokens.colors.textMuted, fontSize: tokens.type.small }}>
            {counts.connected} connected · {counts['needs-auth']} need sign-in · {counts['not-set-up']} not set up
            {data?.checked_at && ` · checked ${when(data.checked_at)}`}
          </span>
        }
        right={
          <button className="btn btn-secondary" onClick={recheck} disabled={checking} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Icon name="refresh" size={14} color="currentColor" /> {checking ? 'Checking…' : 'Check again'}
          </button>
        }
      />
      {error && <Notice>{error === 'missing' ? 'No ~/portfolio/connections.json yet. Click Check again to create a starter one.' : `Could not read connections: ${error}`}</Notice>}
      {checkError && <Notice>Check failed: {checkError}</Notice>}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.3fr) minmax(0, 1fr)', gap: '28px', alignItems: 'start' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          {categories.map((cat) => (
            <section key={cat}>
              <SectionHeading>{cat}</SectionHeading>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '10px' }}>
                {systems.filter((s) => s.category === cat).map((s) => (
                  <ConnectorCard
                    key={s.id}
                    conn={s}
                    active={current?.id === s.id}
                    onSelect={() => setSelected(s.id)}
                    onConnect={(step) => connect(s, step)}
                    busy={busy?.startsWith(`${s.id}:`) ?? false}
                  />
                ))}
              </div>
            </section>
          ))}
          <BrowserProfiles snapshot={snapshot} />
        </div>
        <div style={{ position: 'sticky', top: 0 }}>
          {current && <Panel conn={current} names={names} onConnect={(step) => connect(current, step)} busy={busy} message={message} />}
        </div>
      </div>
    </div>
  );
}
