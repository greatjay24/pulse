import { openUrl } from '@tauri-apps/plugin-opener';
import { useTheme } from '../contexts/ThemeContext';
import { Card, CommandLine, PageHeader } from './BoardUI';
import { Icon } from './Icons';

// The getting-started guide inside the app: the same steps as docs/GETTING_STARTED.md, short,
// so a new user can set Roo up without anyone explaining it. Keep the two in step.

const GUIDE_URL = 'https://github.com/greatjay24/pulse/blob/main/docs/GETTING_STARTED.md';

interface Step {
  title: string;
  lines: string[];
  command?: string;
  open?: { page: string; label: string };
}

const STEPS: Step[] = [
  {
    title: 'What Roo is',
    lines: [
      'Each of your businesses gets an AI lead. A lead reads that business\'s files, does the work nobody needs to sign off on, and writes a short report.',
      'You talk to Roo. Roo answers quick questions and hands bigger jobs to the right lead.',
      'Everything runs on your Mac, on the AI plan you already pay for.',
    ],
  },
  {
    title: 'Set up your businesses and leads',
    lines: [
      'Paste this in Terminal. It asks your name, your businesses and which AI to use, and shows the plan before it writes anything.',
      'Then open each business\'s BRIEF.md in ~/portfolio and write a few lines: what it sells, who buys, what matters now. Leads read it every run.',
      'Run setup again any time to add a business. It never overwrites your files.',
    ],
    command: 'git clone https://github.com/greatjay24/pulse.git ~/pulse && python3 ~/pulse/kit/setup.py',
  },
  {
    title: 'Connect your accounts',
    lines: [
      'Connectors shows a card per service: connected or not, which account, and when Roo last checked.',
      'Click Connect or Reconnect to start the real sign-in. Services without one show the steps.',
      'Keys and passwords live in your Mac\'s Keychain. Roo never shows them.',
    ],
    open: { page: 'connections', label: 'Open Connectors' },
  },
  {
    title: 'Start your day on Today',
    lines: [
      'The top line: your moves this week, decisions waiting on you, cash in.',
      'Every decision has the lead\'s recommendation. Approve does it, Reject drops it, Discuss asks the lead a question.',
    ],
    open: { page: 'today', label: 'Open Today' },
  },
  {
    title: 'Send from the Outbox',
    lines: [
      'Emails, posts, texts and invoices agents wrote for you wait here. Read, edit, then click Send.',
      'Nothing leaves until you click.',
    ],
    open: { page: 'outbox', label: 'Open the Outbox' },
  },
  {
    title: 'Board, Goals, Conversations',
    lines: [
      'Board: every business as a card, worst health first. Click one for the full report.',
      'Goals: your targets per business. Leads update the numbers and flag what is at risk.',
      'Conversations: every run, word for word. Type under a thread to keep talking with that lead.',
    ],
    open: { page: 'board', label: 'Open the Board' },
  },
  {
    title: 'Talk, type or text',
    lines: [
      'Press ⌘K and type. Start with a business name to go straight to its lead, like "Acme: draft the pricing page".',
      'Press ⌥⇧Space anywhere and speak. A pause sends it. Say "Brief me" for a summary.',
      'Optional: with a Telegram bot of your own, Roo sends meeting briefs to your phone when the Mac is closed.',
    ],
  },
  {
    title: 'The safety gates',
    lines: [
      'Agents draft. You send. They never send email, texts, DMs or posts.',
      'Money is your click: no payments, purchases, refunds or plan changes without your Approve.',
      'Agents never delete data, never submit a form for you, and never type passwords, card numbers or IDs.',
      'A lead only brings you a decision, money or a signature, something sent in your name, or something going public.',
    ],
  },
  {
    title: 'Turn on the night shift',
    lines: ['At 5:30am each lead checks what changed, does what it can, and rewrites its report. Run this once:'],
    command: 'sh ~/portfolio/launchd/install.sh',
  },
];

export function HelpPage({ onNavigate }: { onNavigate: (page: string) => void }) {
  const { tokens } = useTheme();
  const c = tokens.colors;
  return (
    <div style={{ maxWidth: '820px', margin: '0 auto' }}>
      <PageHeader
        title="Getting started"
        subtitle={<span style={{ color: c.textMuted, fontSize: tokens.type.small }}>Set up Roo in about 20 minutes. No engineering needed.</span>}
        right={
          <button className="btn btn-secondary" onClick={() => openUrl(GUIDE_URL)} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Icon name="external-link" size={14} color="currentColor" /> Full guide
          </button>
        }
      />
      <ol style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '14px' }}>
        {STEPS.map((s, i) => (
          <li key={s.title}>
            <Card padding="20px 22px">
              <div style={{ display: 'flex', gap: '14px', alignItems: 'flex-start' }}>
                <span
                  aria-hidden
                  style={{
                    width: 26, height: 26, borderRadius: '50%', flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    background: c.bgElevated, border: `1px solid ${c.border}`, fontSize: tokens.type.micro, fontWeight: 600, color: c.textMuted,
                  }}
                >
                  {i + 1}
                </span>
                <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <div style={{ fontSize: tokens.type.body, fontWeight: 600 }}>{s.title}</div>
                  {s.lines.map((l) => (
                    <p key={l} style={{ margin: 0, fontSize: tokens.type.small, lineHeight: 1.55, color: c.textMuted }}>{l}</p>
                  ))}
                  {s.command && <CommandLine command={s.command} />}
                  {s.open && (
                    <div>
                      <button className="btn btn-secondary" onClick={() => onNavigate(s.open!.page)} style={{ fontSize: tokens.type.small }}>
                        {s.open.label}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </Card>
          </li>
        ))}
      </ol>
    </div>
  );
}
