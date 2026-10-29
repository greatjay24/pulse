import { useState } from 'react';
import { useTheme } from '../contexts/ThemeContext';
import { PortfolioSnapshot } from '../types';
import { Connection, ConnectionStatus } from '../types/ops';
import { checkConnections, useConnections } from '../hooks/useOps';
import { Card, Notice, PageHeader, SectionHeading } from './BoardUI';
import { Icon } from './Icons';

const STATUS_LABEL: Record<ConnectionStatus, string> = {
  connected: 'Connected',
  'needs-auth': 'Needs sign-in',
  'not-set-up': 'Not set up',
};
const STATUS_ORDER: Record<ConnectionStatus, number> = { 'needs-auth': 0, 'not-set-up': 1, connected: 2 };

function Dot({ status }: { status: ConnectionStatus }) {
  const { tokens } = useTheme();
  const c = tokens.colors;
  const color = status === 'connected' ? c.success : status === 'needs-auth' ? c.warning : c.textDim;
  return <span aria-hidden style={{ width: 9, height: 9, borderRadius: '50%', background: status === 'not-set-up' ? 'transparent' : color, border: `2px solid ${color}`, flexShrink: 0, display: 'inline-block' }} />;
}

function Tile({ conn, active, onClick }: { conn: Connection; active: boolean; onClick: () => void }) {
  const { tokens } = useTheme();
  const c = tokens.colors;
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      style={{
        textAlign: 'left', fontFamily: 'inherit', cursor: 'pointer', color: c.text,
        background: active ? c.bgCardHover : c.bgCard, border: `1px solid ${active ? c.accent : c.border}`,
        borderRadius: tokens.radius.md, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: '6px', minWidth: 0,
      }}
    >
      <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <Dot status={conn.status} />
        <span style={{ fontWeight: 600, fontSize: tokens.type.body, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{conn.name}</span>
      </span>
      <span style={{ fontSize: tokens.type.micro, color: c.textDim }}>{STATUS_LABEL[conn.status]}{conn.mode ? ` · ${conn.mode}` : ''}</span>
    </button>
  );
}

// How to connect one system: what it's for, who uses it, how agents reach it, the steps.
function Panel({ conn, names }: { conn: Connection; names: (id: string) => string }) {
  const { tokens } = useTheme();
  const c = tokens.colors;
  const row = (label: string, value: string) => (
    <div style={{ display: 'flex', gap: '12px', fontSize: tokens.type.small, lineHeight: 1.55 }}>
      <span style={{ color: c.textDim, width: '110px', flexShrink: 0 }}>{label}</span>
      <span style={{ minWidth: 0 }}>{value}</span>
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
        {row('For', conn.for)}
        {conn.entities.length > 0 && row('Used by', conn.entities.map(names).join(', '))}
        {row('Agents reach it', conn.access)}
        {conn.mode && row('Access', conn.mode)}
        {conn.status_detail && row('Last check', conn.status_detail + (conn.checked_at ? ` (${new Date(conn.checked_at).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })})` : ''))}
      </div>
      {conn.status !== 'connected' && conn.connect_steps.length > 0 && (
        <>
          <div style={{ fontSize: tokens.type.small, fontWeight: 600, marginBottom: '8px' }}>How to connect</div>
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

// Every system the businesses run on, whether agents can reach it, and how to connect the rest.
export function ConnectionsPage({ snapshot }: { snapshot: PortfolioSnapshot | null }) {
  const { tokens } = useTheme();
  const { data, error, refresh } = useConnections();
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

  return (
    <div style={{ maxWidth: '1180px', margin: '0 auto' }}>
      <PageHeader
        title="Connections"
        subtitle={
          <span style={{ color: tokens.colors.textMuted, fontSize: tokens.type.small }}>
            {counts.connected} connected · {counts['needs-auth']} need sign-in · {counts['not-set-up']} not set up
            {data?.checked_at && ` · checked ${new Date(data.checked_at).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`}
          </span>
        }
        right={
          <button className="btn btn-secondary" onClick={recheck} disabled={checking} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Icon name="refresh" size={14} color="currentColor" /> {checking ? 'Checking…' : 'Check again'}
          </button>
        }
      />
      {error && <Notice>{error === 'missing' ? 'No ~/portfolio/connections.json yet.' : `Could not read connections: ${error}`}</Notice>}
      {checkError && <Notice>Check failed: {checkError}</Notice>}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.2fr) minmax(0, 1fr)', gap: '28px', alignItems: 'start' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          {categories.map((cat) => (
            <section key={cat}>
              <SectionHeading>{cat}</SectionHeading>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: '10px' }}>
                {systems.filter((s) => s.category === cat).map((s) => (
                  <Tile key={s.id} conn={s} active={current?.id === s.id} onClick={() => setSelected(s.id)} />
                ))}
              </div>
            </section>
          ))}
        </div>
        <div style={{ position: 'sticky', top: 0 }}>{current && <Panel conn={current} names={names} />}</div>
      </div>
    </div>
  );
}
