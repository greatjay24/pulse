import {
  ActivitySnapshot,
  EntityStatus,
  LiveRun,
  LiveSnapshot,
  PortfolioRegistry,
  PortfolioSnapshot,
  ProjectFinance,
  TrackerSnapshot,
  Transcript,
  TranscriptLine,
  TranscriptSummary,
} from '../types';

// A fictional org for "Try the demo": the owner (Sam), three businesses, a personal side and one
// venture. Everything is built relative to the moment the demo opens, so it always reads as
// today. Bundled with the app: the demo never reads or writes a file.

const NOW = Date.now();
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const iso = (agoMs: number) => new Date(NOW - agoMs).toISOString();
const secsAgo = (agoMs: number) => Math.round((NOW - agoMs) / 1000);
const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const dayOffset = (days: number) => ymd(new Date(NOW + days * DAY));

// Last night's shift ran at 5:30 local: today if it's past 5:30, otherwise yesterday.
const shift = (() => {
  const d = new Date(NOW);
  d.setHours(5, 30, 0, 0);
  if (d.getTime() > NOW) d.setDate(d.getDate() - 1);
  return d;
})();
const SHIFT_AGO = NOW - shift.getTime();
const shiftStamp = `${ymd(shift)}_0530`;
const runId = (agent: string, tag: string) => `${ymd(shift).replace(/-/g, '')}-0530${pad(0)}-${agent}-${tag}`;

// ------------------------------------------------------------------
// The registry and each lead's report
// ------------------------------------------------------------------

const registry: PortfolioRegistry & Record<string, unknown> = {
  owner: { name: 'Sam' },
  groups: [
    { id: 'companies', name: 'Operating companies' },
    { id: 'family', name: 'Family' },
    { id: 'personal', name: 'Personal' },
  ],
  entities: [
    { id: 'acme', name: 'Acme Studio', group: 'companies', parent: null, path: 'companies/acme', lead: 'acme-lead', schedule: 'nightly', tracker_projects: ['acme'], color: '#7C3AED' },
    { id: 'northwind', name: 'Northwind Supply', group: 'companies', parent: null, path: 'companies/northwind', lead: 'northwind-lead', schedule: 'nightly', tracker_projects: ['northwind'], color: '#0E7490' },
    { id: 'globex', name: 'Globex Rentals', group: 'family', parent: null, path: 'family/globex', lead: 'globex-lead', schedule: 'nightly', tracker_projects: ['globex'], color: '#B45309' },
    { id: 'personal', name: 'Personal', group: 'personal', parent: null, path: 'personal', lead: 'personal-lead', schedule: 'nightly', tracker_projects: ['personal'], color: '#4A5A78' },
    { id: 'initech', name: 'Initech Labs', group: 'personal', parent: 'personal', path: 'personal/ventures/initech', lead: 'initech-lead', schedule: 'on-call', tracker_projects: ['initech'], color: '#15803D' },
  ],
  managers: ['sales-manager', 'marketing-manager', 'delivery-manager', 'finance-manager', 'admin-manager'],
  chief_of_staff: { lead: 'chief-of-staff', schedule: 'weekly', output: 'WEEK.md' },
};

const lanes = (sales: string, marketing: string, delivery: string, finance: string, admin: string) => ({
  sales: { status: sales, next: '' },
  marketing: { status: marketing, next: '' },
  delivery: { status: delivery, next: '' },
  finance: { status: finance, next: '' },
  admin: { status: admin, next: '' },
});

const statuses: EntityStatus[] = [
  {
    entity: 'acme', name: 'Acme Studio', group: 'companies', parent: null, stage: 'active', updated: iso(SHIFT_AGO - 6 * MIN),
    health: 'green', health_why: 'Commitments current; two invoices paid this week',
    headline: 'Brand studio for local food and drink businesses. Booked through January; the retainer offer went out yesterday.',
    metrics: [
      { label: 'Cash in (30d)', value: '$18,400', trend: 'up', source: 'stripe' },
      { label: 'Active clients', value: '4', trend: 'flat', source: 'brief' },
      { label: 'Proposals out', value: '2', trend: 'up', source: 'ledger' },
    ],
    lanes: {
      ...lanes('Two proposals out, one renewal due', 'Case study for the bakery rebrand drafted', 'Menu redesign in review; site launch Friday', 'Two invoices paid, none overdue', 'Contracts current'),
      sales: { status: 'Two proposals out, one renewal due', next: 'Follow up with the coffee roaster on Thursday' },
    },
    decisions: [],
    waiting_on: [{ who: 'Bluebird Bakery', what: 'final logo pick', since: dayOffset(-2) }],
    risks: [],
    next: ['Ship the Bluebird site on Friday', 'Draft the roaster follow-up', 'Publish the bakery case study after sign-off'],
    done: [
      { what: 'Drafted the retainer offer for Bluebird Bakery (in Drafts)', link: null, date: dayOffset(-1) },
      { what: 'Opened a PR for the menu page fixes', link: 'https://github.com/example/acme-site/pull/42', date: dayOffset(0) },
    ],
  },
  {
    entity: 'northwind', name: 'Northwind Supply', group: 'companies', parent: null, stage: 'active', updated: iso(SHIFT_AGO - 9 * MIN),
    health: 'yellow', health_why: 'A decision is due within 14 days: the January price change',
    headline: 'Wholesale coffee and tea for cafes. Margins are squeezed by bean costs; the price change needs a call this month.',
    metrics: [
      { label: 'Cash in (30d)', value: '$9,250', trend: 'down', source: 'stripe' },
      { label: 'Wholesale accounts', value: '23', trend: 'up', source: 'brief' },
      { label: 'Gross margin', value: '31%', trend: 'down', source: 'finance' },
    ],
    lanes: lanes('Three cafe leads this week, one tasting booked', 'Holiday blend page drafted', 'Two late shipments resolved', 'Bean costs up 9% since August', 'Food license renews in March'),
    decisions: [
      {
        id: 'northwind-price-change', ask: 'Raise wholesale prices on January 1?', recommend: 'Yes: 6%, with 30 days’ notice',
        why: 'Bean costs are up 9% since August. 6% keeps margin above 30% and stays under the two nearest competitors.',
        gate: 'money', due: dayOffset(10),
        on_approve: 'Draft the notice email to all 23 accounts and update the price sheet on a branch.',
      },
    ],
    waiting_on: [{ who: 'Harbor Cafe', what: 'signed wholesale agreement', since: dayOffset(-4) }],
    risks: [{ what: 'Green bean contract renews; quote expected higher', date: dayOffset(21), severity: 'medium' }],
    next: ['Decide the January price change', 'Run the Harbor Cafe tasting', 'Draft the holiday blend launch email'],
    done: [{ what: 'Researched three cafe leads with sources', link: null, date: dayOffset(0) }],
  },
  {
    entity: 'globex', name: 'Globex Rentals', group: 'family', parent: null, stage: 'active', updated: iso(SHIFT_AGO - 4 * MIN),
    health: 'red', health_why: 'A tenant has waited 9 days on a roof leak repair',
    headline: 'The family’s two rental duplexes. Fully leased; the roof repair at Elm Street is overdue.',
    metrics: [
      { label: 'Rent in (30d)', value: '$4,800', trend: 'flat', source: 'bank' },
      { label: 'Occupancy', value: '4 / 4', trend: 'flat', source: 'brief' },
    ],
    lanes: lanes('', 'Listing photos refreshed for spring', 'Roof repair quotes in: three', 'Rent all received this month', 'Insurance renewal in 6 weeks'),
    decisions: [
      {
        id: 'globex-roof-quote', ask: 'Which roof repair quote should we take?', recommend: 'The middle quote: starts within two weeks',
        why: 'The cheapest roofer can’t start for six weeks and the tenant has waited nine days already. The middle quote includes a 5-year warranty.',
        gate: 'money', due: dayOffset(2),
        on_approve: 'Draft the acceptance email to the roofer and a note to the tenant with the start date.',
      },
    ],
    waiting_on: [{ who: 'Unit 2B tenant', what: 'roof leak fixed', since: dayOffset(-9) }],
    risks: [{ what: 'Leak could damage the ceiling if it rains before the repair', date: dayOffset(3), severity: 'high' }],
    next: ['Approve a roof quote', 'Tell the tenant the start date', 'Renew the insurance policy'],
    done: [{ what: 'Collected three roof repair quotes', link: null, date: dayOffset(-1) }],
  },
  {
    entity: 'personal', name: 'Personal', group: 'personal', parent: null, stage: 'active', updated: iso(SHIFT_AGO - 3 * MIN),
    health: 'green', health_why: 'Nothing urgent unowned; Initech is moving toward launch',
    headline: 'Personal site, side projects and the Initech venture. Focus stays on the businesses this month.',
    metrics: [{ label: 'Side projects', value: '3 active', trend: 'flat', source: 'brief' }],
    lanes: lanes('', 'Two newsletter issues drafted', 'Personal site refresh on a preview', '', 'Passport renewal in April'),
    decisions: [],
    waiting_on: [],
    risks: [],
    next: ['Review the site refresh preview', 'Archive the two idle experiments'],
    done: [{ what: 'Refreshed the personal site on a preview deploy', link: 'https://example.com/preview', date: dayOffset(-2) }],
  },
  {
    entity: 'initech', name: 'Initech Labs', group: 'personal', parent: 'personal', stage: 'pending', updated: iso(SHIFT_AGO - 2 * MIN),
    health: 'yellow', health_why: 'Launch name still undecided; the waitlist page is blocked on it',
    headline: 'A small scheduling app for dog walkers. Prototype works; the waitlist page waits on a name.',
    metrics: [{ label: 'Waitlist', value: '38', trend: 'up', source: 'site' }],
    lanes: lanes('', 'Waitlist page drafted', 'Prototype on TestFlight', '', 'Not incorporated'),
    decisions: [
      {
        id: 'initech-launch-name', ask: 'Pick the launch name', recommend: 'Walkly',
        why: 'Short, the .app domain is available, and it tested best with the waitlist in a 3-way poll (21 of 38).',
        gate: 'taste', due: null,
        on_approve: 'Update the waitlist page and app strings on a branch and open a PR with a preview.',
      },
    ],
    waiting_on: [],
    risks: [],
    next: ['Pick the name', 'Ship the waitlist page'],
    done: [],
  },
];

const WEEK = `# Week of ${ymd(new Date(NOW - ((new Date(NOW).getDay() + 6) % 7) * DAY))}

## Your three moves this week
1. **Approve a roof quote for Elm Street** (5 min). A tenant has waited 9 days.
2. **Decide the Northwind price change** (15 min). Notice has to go out by the 1st.
3. **Pick the Initech launch name** (5 min). The waitlist page is ready otherwise.

## Decisions
- Globex: which roof quote. Recommend the middle one.
- Northwind: raise prices 6% on January 1. Recommend yes.
- Initech: launch name. Recommend Walkly.

## Waiting on others
- Bluebird Bakery: final logo pick (2 days)
- Harbor Cafe: signed agreement (4 days)

## Drop or defer
- The two idle side projects: archive, don't touch.

## Org health
Last week 3 items reached you; the agents handled 41.
`;

function portfolio(): PortfolioSnapshot {
  return {
    registry,
    registry_error: null,
    setup_needed: false,
    entities: statuses.map((status) => ({ id: status.entity, status, error: null, logo: null, logo_dark: null, logo_error: null })),
    week: WEEK,
    read_at: new Date().toISOString(),
  };
}

// ------------------------------------------------------------------
// Runs, transcripts and the live team
// ------------------------------------------------------------------

const RUN_ACME = runId('acme-lead', 'a1c3');
const RUN_GLOBEX = runId('globex-lead', 'b7e2');
const RUN_ACT = `${ymd(new Date(NOW - DAY)).replace(/-/g, '')}-142210-acme-lead-c4d9`;
const RUN_SESSION = 'session-demo-7f3e9a10';
const RUN_TEAM = `${ymd(new Date(NOW)).replace(/-/g, '')}-live-northwind-lead-e5f1`;
const TEAM_AGO = 4 * MIN;

const transcripts: Record<string, TranscriptLine[]> = {
  [RUN_ACME]: [
    { t: 'start', at: iso(SHIFT_AGO), run_id: RUN_ACME, kind: 'nightly', entity: 'acme', agent: 'acme-lead', doing: 'Night shift for Acme Studio', prompt: 'NIGHTLY run for Acme Studio (companies/acme). Follow the Nightly run section of OPERATING.md.' },
    { t: 'tool', at: iso(SHIFT_AGO - 20_000), name: 'Read', summary: 'Reading companies/acme/BRIEF.md' },
    { t: 'tool', at: iso(SHIFT_AGO - 35_000), name: 'Read', summary: 'Reading companies/acme/decisions.jsonl' },
    { t: 'text', at: iso(SHIFT_AGO - 50_000), text: 'Two invoices were paid since yesterday and Bluebird still owes the logo pick. Nothing passes a gate tonight, so I’ll fix the menu page bug and refresh the report.' },
    { t: 'tool', at: iso(SHIFT_AGO - 2 * MIN), name: 'Bash', summary: 'Running: git -C ~/code/acme-site checkout -b fix/menu-prices' },
    { t: 'tool', at: iso(SHIFT_AGO - 3 * MIN), name: 'Edit', summary: 'Editing ~/code/acme-site/src/menu.tsx' },
    { t: 'tool', at: iso(SHIFT_AGO - 4 * MIN), name: 'Bash', summary: 'Opening a pull request' },
    { t: 'tool', at: iso(SHIFT_AGO - 5 * MIN), name: 'Write', summary: 'Writing companies/acme/status.json' },
    { t: 'result', at: iso(SHIFT_AGO - 6 * MIN), ok: true, result: 'Menu price bug fixed on a branch, PR #42 open with a preview. Status green: two invoices paid, nothing overdue. No new decisions.', cost_usd: 0.38, secs: 362, turns: 14, models: ['claude-sonnet'], agents: 0 },
  ],
  [RUN_GLOBEX]: [
    { t: 'start', at: iso(SHIFT_AGO), run_id: RUN_GLOBEX, kind: 'nightly', entity: 'globex', agent: 'globex-lead', doing: 'Night shift for Globex Rentals', prompt: 'NIGHTLY run for Globex Rentals (family/globex). Follow the Nightly run section of OPERATING.md.' },
    { t: 'tool', at: iso(SHIFT_AGO - 15_000), name: 'Read', summary: 'Reading family/globex/BRIEF.md' },
    { t: 'text', at: iso(SHIFT_AGO - 30_000), text: 'The tenant in 2B has waited nine days on the roof. That’s a late commitment, so health goes red. Three quotes are in; I’ll have the finance manager compare them.' },
    { t: 'deploy', at: iso(SHIFT_AGO - 40_000), agents: [{ id: 'tu-fin-1', type: 'finance-manager', description: 'Compare the three roof quotes', prompt: 'Compare the three roof repair quotes in family/globex/quotes/.', background: false, by: null }] },
    { t: 'tool', at: iso(SHIFT_AGO - 70_000), name: 'Read', summary: 'Reading family/globex/quotes/roof-quotes.md', sub: true },
    { t: 'agent_done', at: iso(SHIFT_AGO - 2 * MIN), id: 'tu-fin-1', status: 'completed', summary: 'Middle quote is best value: starts in two weeks, 5-year warranty, 12% above the cheapest, which can’t start for six weeks.', secs: 80, tools: 4 },
    { t: 'tool', at: iso(SHIFT_AGO - 3 * MIN), name: 'Write', summary: 'Writing family/globex/status.json' },
    { t: 'result', at: iso(SHIFT_AGO - 4 * MIN), ok: true, result: 'Health red (tenant waiting 9 days). Queued one decision: take the middle roof quote. Insurance renewal flagged for 6 weeks out.', cost_usd: 0.52, secs: 241, turns: 11, models: ['claude-sonnet'], agents: 1 },
  ],
  [RUN_ACT]: [
    { t: 'start', at: iso(DAY), run_id: RUN_ACT, kind: 'act', entity: 'acme', agent: 'acme-lead', doing: 'Approve: Offer Bluebird Bakery a monthly retainer?', prompt: 'DECISION run for Acme Studio. The owner just answered decision acme-retainer-offer in Pulse: APPROVE.' },
    { t: 'tool', at: iso(DAY - 20_000), name: 'Read', summary: 'Reading companies/acme/status.json' },
    { t: 'text', at: iso(DAY - 40_000), text: 'Approved. I’ll draft the retainer offer to Bluebird in the owner’s voice and leave it in Drafts. The owner sends it.' },
    { t: 'tool', at: iso(DAY - 90_000), name: 'mcp__email__create_draft', summary: 'Drafting an email' },
    { t: 'tool', at: iso(DAY - 2 * MIN), name: 'Bash', summary: 'Reporting back to the owner' },
    { t: 'result', at: iso(DAY - 3 * MIN), ok: true, result: 'Retainer offer drafted (in Drafts, not sent): 3 months, two deliverables a month. Decision recorded as done.', cost_usd: 0.21, secs: 174, turns: 8, models: ['claude-sonnet'], agents: 0 },
  ],
  [RUN_SESSION]: [
    { t: 'start', at: iso(3 * HOUR), run_id: RUN_SESSION, kind: 'interactive', entity: 'personal', agent: 'personal-lead', doing: 'Session with the owner', prompt: '' },
    { t: 'user', at: iso(3 * HOUR - 10_000), text: 'Which side projects should I archive this month?' },
    { t: 'tool', at: iso(3 * HOUR - 30_000), name: 'Read', summary: 'Reading personal/BRIEF.md' },
    { t: 'text', at: iso(3 * HOUR - 60_000), text: 'Archive the recipe scraper and the habit tracker: no commits in 60+ days and no users. Keep Initech; it has a waitlist of 38 and a working prototype.' },
    { t: 'user', at: iso(3 * HOUR - 2 * MIN), text: 'Agreed. Note it in the brief.' },
    { t: 'tool', at: iso(3 * HOUR - 150_000), name: 'Edit', summary: 'Editing personal/BRIEF.md' },
    { t: 'text', at: iso(3 * HOUR - 3 * MIN), text: 'Done. Both are listed under "Archive" in the brief; I won’t delete anything.' },
  ],
  [RUN_TEAM]: [
    { t: 'start', at: iso(TEAM_AGO), run_id: RUN_TEAM, kind: 'act', entity: 'northwind', agent: 'northwind-lead', doing: 'Discuss: Raise wholesale prices on January 1?', prompt: 'DECISION run for Northwind Supply. The owner asked about decision northwind-price-change.' },
    { t: 'tool', at: iso(TEAM_AGO - 15_000), name: 'Read', summary: 'Reading companies/northwind/BRIEF.md' },
    { t: 'text', at: iso(TEAM_AGO - 30_000), text: 'The owner wants to know how accounts will react. I’ll have sales check which accounts are price-sensitive while marketing drafts the notice.' },
    { t: 'deploy', at: iso(TEAM_AGO - 40_000), agents: [
      { id: 'tu-sales-1', type: 'sales-manager', description: 'Rank accounts by price sensitivity', prompt: 'Rank the 23 wholesale accounts by price sensitivity.', background: false, by: null },
      { id: 'tu-mkt-1', type: 'marketing-manager', description: 'Draft the price notice', prompt: 'Draft a short, warm price-change notice.', background: true, by: null },
    ] },
    { t: 'tool', at: iso(TEAM_AGO - 70_000), name: 'Read', summary: 'Reading companies/northwind/sales/accounts.csv', sub: true },
    { t: 'agent_done', at: iso(TEAM_AGO - 3 * MIN), id: 'tu-sales-1', status: 'completed', summary: 'Three accounts are price-sensitive (all under 10 lbs/week). The top 10 accounts by volume have accepted increases before.', secs: 70, tools: 5 },
  ],
};

const team: LiveRun['team'] = [
  { id: 'tu-sales-1', type: 'sales-manager', description: 'Rank accounts by price sensitivity', prompt: 'Rank the 23 wholesale accounts by price sensitivity.', background: false, by: null, batch: 0, started: iso(TEAM_AGO - 40_000), status: 'completed', finished: iso(TEAM_AGO - 3 * MIN), summary: 'Three accounts are price-sensitive (all under 10 lbs/week).', secs: 70 },
  { id: 'tu-mkt-1', type: 'marketing-manager', description: 'Draft the price notice', prompt: 'Draft a short, warm price-change notice.', background: true, by: null, batch: 0, started: iso(TEAM_AGO - 40_000), status: 'running' },
];

function liveRuns(): LiveRun[] {
  return [
    {
      run_id: RUN_TEAM, kind: 'act', entity: 'northwind', agent: 'northwind-lead', doing: 'Discuss: Raise wholesale prices on January 1?',
      started: iso(TEAM_AGO), pid: 0, transcript: `logs/transcripts/${RUN_TEAM}.jsonl`, state: 'running',
      step: 'Waiting on marketing-manager: Draft the price notice', step_at: iso(TEAM_AGO - 3 * MIN), updated: iso(30_000),
      team, deployments: 1,
    },
    {
      run_id: RUN_SESSION, kind: 'interactive', entity: 'personal', agent: 'personal-lead', doing: 'Which side projects should I archive this month?',
      started: iso(3 * HOUR), pid: 0, transcript: `logs/transcripts/${RUN_SESSION}.jsonl`, state: 'finished',
      step: 'Session ended', step_at: iso(2.9 * HOUR), updated: iso(2.9 * HOUR), finished: iso(2.9 * HOUR), ok: true, result: 'Session ended (exit)',
    },
  ];
}

function transcriptIndex(): TranscriptSummary[] {
  return Object.entries(transcripts)
    .map(([run_id, lines]) => ({ run_id, start: lines[0], last: lines[lines.length - 1], modified: lines[lines.length - 1].at }))
    .sort((a, b) => Date.parse(b.modified) - Date.parse(a.modified));
}

function activity(): ActivitySnapshot {
  const actDay = new Date(NOW - DAY);
  return {
    runs: [
      {
        file: `${shiftStamp}.json`,
        data: [
          { agent: 'acme-lead', run_id: RUN_ACME, agents: 0, ok: true, result: 'Menu price bug fixed on a branch, PR #42 open with a preview. Status green.', cost_usd: 0.38, secs: 362, models: ['claude-sonnet'] },
          { agent: 'northwind-lead', agents: 0, ok: true, result: 'Researched three cafe leads; price decision still open.', cost_usd: 0.29, secs: 288, models: ['claude-sonnet'] },
          { agent: 'globex-lead', run_id: RUN_GLOBEX, agents: 1, ok: true, result: 'Health red (tenant waiting 9 days). Queued one decision: take the middle roof quote.', cost_usd: 0.52, secs: 241, models: ['claude-sonnet'] },
          { agent: 'personal-lead', agents: 0, ok: true, result: 'Quiet night. Site refresh preview is ready for review.', cost_usd: 0.11, secs: 96, models: ['claude-sonnet'] },
        ],
      },
      {
        file: `act-${ymd(actDay)}_142210-acme.json`,
        data: { kind: 'act', entity: 'acme', decision: 'acme-retainer-offer', action: 'approve', agent: 'acme-lead', run_id: RUN_ACT, running: false, ok: true, started: iso(DAY), finished: iso(DAY - 3 * MIN), result: 'Retainer offer drafted (in Drafts, not sent).', cost_usd: 0.21, secs: 174 },
      },
    ],
    decisions: [
      {
        entity: 'acme',
        rows: [
          { id: 'acme-retainer-offer', action: 'approve', note: '', at: iso(DAY), ask: 'Offer Bluebird Bakery a monthly retainer?', recommend: 'Yes: 3 months, two deliverables a month' },
          { id: 'acme-retainer-offer', action: 'done', note: 'Drafted the retainer offer; it is in Drafts for you to send.', at: iso(DAY - 3 * MIN) },
        ],
      },
      {
        entity: 'northwind',
        rows: [{ id: 'northwind-price-change', action: 'discuss', note: 'Will the small cafes push back?', at: iso(TEAM_AGO), ask: 'Raise wholesale prices on January 1?', recommend: 'Yes: 6%, with 30 days’ notice' }],
      },
    ],
    drafts: [
      { date: dayOffset(-1), entity: 'acme', prospect: 'Bluebird Bakery', subject: 'A monthly plan for Bluebird', source: 'decision' },
      { date: dayOffset(0), entity: 'northwind', prospect: 'Harbor Cafe', vertical: 'cafes', subject: 'Tasting on Thursday?', source: 'nightly' },
    ],
    commits: [
      { hash: 'a1b2c3d', at: iso(SHIFT_AGO - 10 * MIN), subject: 'nightly: acme-lead, northwind-lead, globex-lead, personal-lead' },
      { hash: 'd4e5f6a', at: iso(DAY - 3 * MIN), subject: 'acme: decision acme-retainer-offer approve' },
    ],
    errors: [],
    read_at: new Date().toISOString(),
  };
}

// ------------------------------------------------------------------
// The optional tracker: tasks, inbox, repos and money
// ------------------------------------------------------------------

function months(values: number[]): [string, number][] {
  return values.map((v, i) => {
    const d = new Date(new Date(NOW).getFullYear(), new Date(NOW).getMonth() - (values.length - 1 - i), 1);
    return [`${d.getFullYear()}-${pad(d.getMonth() + 1)}`, v];
  });
}

const finance = (project: string, d30: number, d90: number, monthly: number[], channel: ProjectFinance['by_channel'], payers: ProjectFinance['payers']): ProjectFinance => ({
  project, d30, d90, months: months(monthly), by_channel: channel,
  by_rail: channel.map(([c, v]) => [c, c === 'bank' ? 'ach' : c === 'email' ? 'zelle' : 'card', v]),
  payers, no_payer_90d: 0,
});

function tracker(): TrackerSnapshot {
  const projects = [
    finance('acme', 18400, 47200, [14100, 14700, 18400], [['stripe', 47200]], [{ name: 'Bluebird Bakery', total: 21000, payments: 3 }, { name: 'Copper Kettle', total: 14600, payments: 2 }, { name: 'Lantern Bistro', total: 11600, payments: 2 }]),
    finance('northwind', 9250, 31900, [11800, 10850, 9250], [['stripe', 27400], ['bank', 4500]], [{ name: 'Harbor Cafe', total: 6200, payments: 6 }, { name: 'Morning Rise', total: 5100, payments: 5 }]),
    finance('globex', 4800, 14400, [4800, 4800, 4800], [['bank', 14400]], [{ name: 'Unit 1A', total: 3600, payments: 3 }, { name: 'Unit 1B', total: 3600, payments: 3 }, { name: 'Unit 2A', total: 3600, payments: 3 }, { name: 'Unit 2B', total: 3600, payments: 3 }]),
    finance('initech', 0, 0, [0, 0, 0], [], []),
  ];
  const d30 = projects.reduce((s, p) => s + p.d30, 0);
  const collected = secsAgo(2 * HOUR);
  return {
    installed: true,
    error: null,
    file_errors: {},
    tasks: [
      { id: 't1', title: 'Sign the Elm Street insurance renewal', detail: 'Renewal packet is in family/globex/insurance. Sign page 4.', url: null, project: 'globex', kind: null, urgency: 'soon', status: 'open', source: 'manual', first_seen: secsAgo(2 * DAY), show_from: null },
      { id: 't2', title: 'Send the Bluebird retainer offer (in Drafts)', detail: 'Drafted by acme-lead after you approved it.', url: null, project: 'acme', kind: null, urgency: 'now', status: 'open', source: 'manual', first_seen: secsAgo(DAY), show_from: null },
      { id: 't3', title: 'Review the personal site preview', detail: null, url: 'https://example.com/preview', project: 'personal', kind: null, urgency: 'whenever', status: 'open', source: 'manual', first_seen: secsAgo(2 * DAY), show_from: null },
      { id: 't4', title: 'Renew the food license', detail: 'Northwind, due in March.', url: null, project: 'northwind', kind: null, urgency: 'whenever', status: 'scheduled', source: 'manual', first_seen: secsAgo(5 * DAY), show_from: dayOffset(60) },
    ],
    tasks_updated_at: secsAgo(40 * MIN),
    email: {
      collected_at: collected, stale: false, age_hours: 2, replied_count: 6, accounts_not_fetching: [],
      needs_reply: [
        { account_label: 'work', sender: 'orders@harborcafe.example', name: 'Harbor Cafe', subject: 'Re: wholesale agreement', date: iso(DAY), age_days: 1, project: 'northwind', urgency: 'soon', url: null },
        { account_label: 'work', sender: 'hello@bluebird.example', name: 'Bluebird Bakery', subject: 'Logo options', date: iso(2 * DAY), age_days: 2, project: 'acme', urgency: 'soon', url: null },
      ],
    },
    repos: [
      { id: 'acme', name: 'acme-site', exists: true, is_git: true, branch: 'fix/menu-prices', dirty_count: 0, days_idle: 0, last_commit_ts: secsAgo(SHIFT_AGO) },
      { id: 'initech', name: 'initech-app', exists: true, is_git: true, branch: 'main', dirty_count: 2, days_idle: 6, last_commit_ts: secsAgo(6 * DAY) },
    ],
    scanned_at: secsAgo(HOUR),
    money: {
      configured: true,
      sources: { stripe: { ok: true }, email: { ok: true }, bank: { ok: true } },
      totals: { today: 1200, d7: 7350, d30 },
      counts: { today: 1, d7: 6, d30: 21 },
      failed_30d: 0,
      refunds_30d: 0,
      mrr_total: 2400,
      finance: {
        coverage: (['stripe', 'email', 'bank'] as const).map((source) => ({ source, ok: true, reason: null, collected_at: collected, window_days: 120 })),
        projects,
        stripe_accounts: [
          { project: 'acme', ok: true, error: null, active: 2, mrr: 2400 },
          { project: 'northwind', ok: true, error: null, active: 0, mrr: 0 },
        ],
        bank_accounts: [
          { name: 'Operating', org: 'Demo Bank', project: 'northwind', balance: 22140, currency: 'USD' },
          { name: 'Rentals', org: 'Demo Bank', project: 'globex', balance: 8310, currency: 'USD' },
        ],
      },
    },
    projects: [
      { id: 'acme', name: 'Acme Studio', area: 'companies' },
      { id: 'northwind', name: 'Northwind Supply', area: 'companies' },
      { id: 'globex', name: 'Globex Rentals', area: 'family' },
      { id: 'personal', name: 'Personal', area: 'personal' },
      { id: 'initech', name: 'Initech Labs', area: 'personal' },
    ],
    notes: {
      initech: { status: 'Prototype on TestFlight', goal: 'Waitlist page live this month', next: 'Pick the name', blocked_on: 'Launch name' },
    },
    read_at: new Date().toISOString(),
  };
}

// The read commands Pulse calls, answered from the bundle. Anything else is refused: the demo
// can look but never act.
export function demoRead(cmd: string, args?: Record<string, unknown>): unknown {
  switch (cmd) {
    case 'read_portfolio':
      return portfolio();
    case 'read_tracker':
      return tracker();
    case 'read_activity':
      return activity();
    case 'read_live':
      return { runs: liveRuns(), errors: [], read_at: new Date().toISOString() } satisfies LiveSnapshot;
    case 'list_transcripts':
      return transcriptIndex();
    case 'read_transcript': {
      const id = String(args?.runId ?? '');
      const lines = transcripts[id];
      if (!lines) throw new Error('missing');
      return { run_id: id, lines, truncated: false } satisfies Transcript;
    }
    case 'setup_check':
      return { setup_needed: false, claude: null, python3: null, tracker: true };
    default:
      throw new Error(`${cmd} is not available in the demo`);
  }
}
