import { ConnectionsDoc, GoalsSnapshot, OutboxSnapshot } from '../types/ops';

// The demo org's Outbox, goals and connections. Fictional, like the rest of demoOrg.ts.

const DAY = 86_400_000;
const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();
const date = (daysFromNow: number) => new Date(Date.now() + daysFromNow * DAY).toISOString().slice(0, 10);

export function demoOutbox(): OutboxSnapshot {
  const base = { cc: [], references: [], thread: null, draft: { saved: true, error: null }, error: null };
  return {
    key: 'demo0000demo0000',
    errors: [],
    read_at: new Date().toISOString(),
    items: [
      {
        content: 'demo-1',
        item: {
          ...base, id: 'demo-acme-menu-photos', entity: 'acme', account: 'studio', to: ['rosa@example.com'],
          subject: 'Re: New menu photos', in_reply_to: 'demo-1@example.com', references: ['demo-1@example.com'],
          body: 'Hi Rosa,\n\nThe new menu photos are live on the preview link. If the pasta shot works for you, we can publish Thursday.\n\nThanks,\nSam',
          why: 'Rosa asked on Monday when the photos would be up; the preview went live last night.',
          created_by: 'acme-lead', created_at: iso(5 * 3_600_000), status: 'pending',
        },
      },
      {
        content: 'demo-2',
        item: {
          ...base, id: 'demo-northwind-invoice-follow-up', entity: 'northwind', account: 'supply', to: ['ap@example.org'],
          subject: 'Invoice 1042: quick check', in_reply_to: null,
          body: 'Hello,\n\nChecking that invoice 1042 (sent October 2) reached you. Happy to resend it if that helps.\n\nBest,\nSam',
          why: 'Invoice is 27 days old with no payment; the lead suggests a friendly nudge before net-30.',
          created_by: 'northwind-lead', created_at: iso(9 * 3_600_000), status: 'pending',
        },
      },
      {
        content: 'demo-3',
        item: {
          ...base, id: 'demo-globex-roof-reply', entity: 'globex', account: 'personal', to: ['quotes@example.net'],
          subject: 'Re: Roof repair quote', in_reply_to: 'demo-3@example.net',
          body: 'Thanks for the quote. We would like to go ahead with the two-week start. Can you send the contract?\n\nSam',
          why: 'You approved the middle quote in Pulse; this tells the roofer.',
          created_by: 'globex-lead', created_at: iso(2 * DAY), status: 'sent', sent_at: iso(DAY),
        },
      },
    ],
  };
}

export function demoGoals(): GoalsSnapshot {
  return {
    read_at: new Date().toISOString(),
    entities: [
      {
        entity: 'acme', error: null,
        goals: { goals: [
          { id: 'acme-monthly-revenue', title: 'Reach steady monthly revenue', metric: 'Cash in, last 30 days', target: 12000, unit: 'USD', by: date(60), current: 7400, baseline: 3000, start: date(-30), source: 'stripe', owner_note: '' },
          { id: 'acme-retainers', title: 'Sign two retainers', metric: 'Active retainers', target: 2, unit: 'clients', by: date(45), current: 0, baseline: 0, start: date(-45), source: 'manual', owner_note: '', proposed: true },
        ] },
      },
      {
        entity: 'northwind', error: null,
        goals: { goals: [
          { id: 'northwind-receivables', title: 'Get receivables under $5k', metric: 'Open invoices', target: 5000, unit: 'USD', by: date(30), current: 11800, baseline: 14000, start: date(-20), source: 'manual', owner_note: '', direction: 'down', at_risk: true, lead_note: 'Two invoices past 30 days.' },
        ] },
      },
      {
        entity: 'globex', error: null,
        goals: { goals: [
          { id: 'globex-rent-roll', title: 'Grow the rent roll', metric: 'Rent in, last 30 days', target: 6000, unit: 'USD', by: date(120), current: 4800, baseline: 4200, start: date(-60), source: 'bank', owner_note: '' },
        ] },
      },
      {
        entity: 'initech', error: null,
        goals: { goals: [
          { id: 'initech-waitlist', title: 'Build the launch waitlist', metric: 'Waitlist signups', target: null, unit: 'signups', by: null, current: 140, source: 'manual', owner_note: '', proposed: true, lead_note: 'Target not set yet.' },
        ] },
      },
    ],
  };
}

export function demoConnections(): ConnectionsDoc {
  const now = new Date().toISOString();
  return {
    checked_at: now,
    systems: [
      { id: 'gmail', name: 'Gmail', category: 'Communication', for: 'Read threads, write drafts, one-click send from the Outbox', entities: ['acme', 'northwind', 'personal'], access: 'IMAP (read-only) + SMTP on your click', mode: 'read + draft', status: 'connected', status_detail: '3 accounts reading', checked_at: now, connect_steps: [] },
      { id: 'github', name: 'GitHub', category: 'Engineering', for: 'Branches, PRs, CI', entities: ['acme'], access: 'gh CLI', status: 'connected', checked_at: now, connect_steps: [] },
      { id: 'stripe', name: 'Stripe', category: 'Money', for: 'Revenue, payouts, subscriptions', entities: ['acme'], access: 'Restricted read-only key', mode: 'read-only', status: 'needs-auth', status_detail: 'key not stored', checked_at: now, connect_steps: ['Create a restricted key with read access to Charges, Payouts and Subscriptions.', 'Store it with the money connector.'] },
      { id: 'accounting', name: 'Accounting', category: 'Money', for: 'P&L, invoices, AR aging', entities: ['northwind'], access: 'Vendor MCP server', mode: 'read-only', status: 'not-set-up', checked_at: now, connect_steps: ['Pick the accounting system.', 'Connect its MCP server read-only.'] },
    ],
  };
}
