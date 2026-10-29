<p align="center">
  <img src="src-tauri/icons/icon.png" width="128" height="128" alt="Pulse Logo">
</p>

<h1 align="center">Pulse</h1>

<p align="center">
  <strong>A beautiful desktop dashboard for tracking your SaaS metrics</strong>
</p>

<p align="center">
  <a href="#features">Features</a> •
  <a href="#installation">Installation</a> •
  <a href="#development">Development</a> •
  <a href="#integrations">Integrations</a>
</p>

---

## Features

- **Multi-Platform Projects** - Track Web, Mobile, and Service metrics in one place
- **Real-Time Revenue** - Connect Stripe, LemonSqueezy, Paddle, or Gumroad
- **Analytics Dashboard** - Plausible, Google Analytics, PostHog, and Mixpanel support
- **Calendar Integration** - Sync with Google Calendar
- **Beautiful UI** - Dark mode, customizable widgets, and a clean design
- **Privacy First** - All data stored locally on your machine
- **Cross-Platform** - Available for macOS, Windows, and Linux

## Getting started

New here? Read **[docs/GETTING_STARTED.md](docs/GETTING_STARTED.md)** (one page, no
engineering needed). In short:

1. Install one agent CLI and sign in: Codex (with a ChatGPT plan), Claude Code, or opencode
   (any provider). Make sure `python3` works.
2. Download Pulse from [Releases](https://github.com/greatjay24/pulse/releases) and open it
   (right-click → Open the first time; the build isn't signed yet).
3. Pulse opens on a welcome screen with the setup command, or **Try the demo** to click
   through a fictional org (Acme Studio, Northwind Supply, Globex Rentals) first. The demo is
   bundled in the app, read-only, and its action buttons only show a message.
4. Run setup: `git clone https://github.com/greatjay24/pulse.git ~/pulse && python3 ~/pulse/kit/setup.py`.
   It builds your org in `~/portfolio` with a lead agent per business, on the runner you pick
   (`"runner"` in `portfolio.json`; switch any time). See [kit/README.md](kit/README.md) for what the starter kit contains.

## Today, Board, Money

The sidebar is Today, Board, Money and Settings, in that order of importance. Pulse opens
on **Today**: one headline line (`Today: N moves · N decisions need you · $X in this month`),
then the decision queue (every report decision, riskiest business first), then each
business with its health, `health_why` and what is due today. *Moves* are the chief of
staff's moves for the week (the list in the first section of `WEEK.md`, normally three).
Without a `WEEK.md` the line reads `N due today`: tasks marked now, leaving out "Decide:"
items, which are decisions and already counted.
Each page header carries a "Data as of" stamp per source (reports, tasks, email, money),
flagged when a source is old.

## Org board

The Board is a card for every entity in `~/portfolio`. It reads
`portfolio.json`, each entity's `status.json` (schema in `~/portfolio/STATUS_SCHEMA.md`)
and `WEEK.md` through a read-only Rust command scoped to `~/portfolio`. No network.

- **Board**: one column per group (operating companies, family, personal, with ventures
  nested under Personal), red first, then yellow, then green. Each card shows health and
  its `health_why`, a two-line headline (the full text is on the entity page), open
  decisions, top metrics and report age (flagged as stale after 36h). Above the groups:
  the first section of `WEEK.md`.
- **Entity dashboard**: click a card. Three tabs: Overview (metrics, lanes, decisions with
  recommendations and gates, next moves, waiting on, risks, done this week), Finance and
  Tasks and inbox.
- **Logos**: optional `logo` (for light themes) and `logo_dark` (for dark themes) per
  entity in `portfolio.json`, as paths under `~/portfolio/assets/` (svg, png, jpg or webp,
  1 MB max). Swapping a logo is a one-line change to that path. Without one, the card shows
  the entity's initial on its `color` (optional hex in `portfolio.json`).
- **TV mode**: press `T` (or the TV mode button) for fullscreen with larger type, the
  headline line and no sidebar; `Esc` exits. `Backspace` returns from an entity to the
  page it was opened from.
- Data re-reads every 60 seconds and whenever the window regains focus.

The original SaaS metrics views (Overview, Analytics, Calendar, per-app projects and Total
MRR) sit behind Settings > General > SaaS metrics, off by default. Their settings, data
and calendar fetching are unchanged.

### Tracker (optional)

The board can also read a project tracker (`~/project-tracker`) through a second
read-only command, `read_tracker`. The tracker is optional: without it, Pulse hides the
Money page, the entity Finance and Tasks tabs and the inbox rows, with no errors.
It can open only a fixed list of files:
`data/tasks.json`, `email.json`, `scan.json`, `stripe.json`, `bank.json`,
`payments_email.json`, plus `projects.json` and `notes.json`. Tracker projects roll up
into entities through `tracker_projects` in `~/portfolio/portfolio.json`; a project no
entity lists shows under Unassigned in Today.

- **Today** (sidebar, or click the Today card): tasks due now, gate items ("Decide: …")
  marked now or soon, and emails needing a reply, grouped by entity. Gate items marked
  "whenever" and report decisions stay on the board and entity dashboards.
- **Cards** show open task and needs-reply counts and cash in over 30 days.
- **Tasks and inbox** tab: Your tasks (gate items first), Needs a reply (subject and
  sender only) and Repos (branch, uncommitted, days idle).
- Tasks are read-only. Links open in the default browser.

### Money

Money comes from the tracker's collectors (`stripe.json`, `bank.json`,
`payments_email.json`) through a Rust port of `money.py`, so every total matches the
brief: the same payment seen as a Stripe charge, its payout and the bank deposit counts once.

- **Money page**: cash in over 30 and 90 days, a split by entity, the last 12 months,
  and a card per business (click one to open its Finance tab).
- **Finance tab** per entity: 30 and 90 days, monthly cash in, by source (Stripe, bank,
  payment emails, with the rail behind each), top payers, repeat vs one-off payers, Stripe
  MRR and subscriptions per project, and mapped bank balances.
- A source that is not connected says so and shows the command:
  `python3 ~/project-tracker/connect_money.py stripe <project>` or
  `python3 ~/project-tracker/connect_money.py simplefin`. Nothing is estimated.
- The collectors keep 30 days, so 90-day and 12-month views say how far back data reaches;
  older months show as not on file, not as zero. Money out is not shown: the bank
  collector keeps deposits only.
- Payer names reach the UI for the top payers list (this is the owner's own machine). Email
  bodies, transaction descriptions and account numbers never leave Rust.

### Ask, chat and terminal

Pulse is also where you tell the org what to do.

- **Command box** (⌘K, or "Ask a lead…" at the top of the sidebar): type anything. A
  leading name routes it (`Acme: draft the pricing page`), as does `@acme` or a single
  entity mentioned anywhere; everything else goes to the chief of staff. The To menu
  overrides the route. Enter sends, Shift+Enter adds a line, Esc closes. It shows your
  recent commands and a few starting points. Sending starts the lead at once: it shows in
  Working now and its conversation opens live.
- **Chat** under every Conversations thread: a message continues your latest conversation
  with that lead (its Claude session is resumed), or starts a new one. Replies stream in
  with their tool steps and any team the lead deploys. While a lead is replying, Enter
  queues your next message (it goes when the reply ends, in the same conversation) and
  "Stop and send" ends the reply first. Stop ends a run and everything it started.
- **Terminal**: real `claude --agent <lead>` (or plain `claude`) sessions in tabs, started
  in your home folder through your login shell, so your environment and sign-in are the
  usual ones. Up to eight tabs; closing one ends its session. "Open in Terminal.app" opens
  the same thing outside Pulse.

How it runs: Pulse calls `~/portfolio/bin/ask.py <entity|lead> --message "..."`
(`--new`, `--session <id>`, `--stop <run_id>`), the same way decisions call `act.py`.
The script validates against `portfolio.json`, starts `claude -p --agent <lead>` in the
background with the night shift's allow and deny lists, and writes the run's live file and
transcript (kind `chat`) like any other run. Runs use the `claude` CLI's own sign-in (your
Claude subscription): `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN` and the variables that
switch provider are removed from the child's environment, and Pulse makes no API calls of
its own. A lead's `model` in `portfolio.json` is used when set, else the CLI's default.
Chat needs a Claude Code org with `ask.py` in its `bin/`; the starter kit doesn't ship it
yet, and Pulse says so when it's missing.

### Mac app

- **Menu bar**: a Pulse mark with the count of decisions waiting on you. Its menu: Open
  Pulse, Today, Quit. Closing the window keeps Pulse in the menu bar; Quit (or Cmd+Q) exits.
- **Notifications**: a native alert when a new urgent item appears (a "Decide:" item
  marked now, or a business turning red). Alerts arriving together are batched, each item
  is announced once, and the first read after launch only records what is already there.
  Turn them off in Settings > General.
- **Build**: `npm run tauri build` writes `src-tauri/target/release/bundle/macos/Pulse.app`.
  Google sign-in (SaaS metrics only) needs `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`
  in the environment at build time; without them the build still succeeds and sign-in
  says it isn't configured.
- **Icon**: `icon-concepts/concept6-signal.svg` (app) and `icon-concepts/tray-template.svg`
  (menu bar). Swap either and run `node scripts/generate-icons.mjs`.

### Appearance

Wings of Desire (rich black and white) is the default: with the chrome in black and white,
the only color on screen is signal. Settings > Appearance has six color themes after the films in the owner's taste guide (Paris,
Texas; Wings of Desire; Moonlight; Days of Heaven; Chungking Express; In the Mood for
Love), each with light and dark versions, an optional custom accent, and a type choice
(Editorial, the default: serif titles and a system sans; or Inter, Space Grotesk,
JetBrains Mono). Choices are saved in the app's local storage.

## Installation

### Download

Download the latest release for your platform from the [Releases](https://github.com/greatjay24/pulse/releases) page.

### Build from Source

```bash
# Clone the repository
git clone https://github.com/greatjay24/pulse.git
cd pulse

# Install dependencies
npm install

# Run in development mode
npm run tauri dev

# Build for production
npm run tauri build
```

## Development

### Prerequisites

- [Node.js](https://nodejs.org/) (v18+)
- [Rust](https://rustup.rs/)
- [Tauri CLI](https://tauri.app/v1/guides/getting-started/prerequisites)

### Project Structure

```
pulse/
├── src/                  # React frontend
│   ├── components/       # UI components
│   ├── contexts/         # React contexts
│   └── hooks/            # Custom hooks
├── src-tauri/            # Rust backend
│   └── src/              # Tauri commands
└── icon-concepts/        # Logo design files
```

## Integrations

### Supported Services

| Category | Services |
|----------|----------|
| **Payments** | Stripe, LemonSqueezy, Paddle, Gumroad |
| **Analytics** | Plausible, Google Analytics, PostHog, Mixpanel, Amplitude |
| **Hosting** | Vercel, Netlify |
| **Backend** | Supabase, Firebase |
| **Calendar** | Google Calendar, Cal.com |
| **Communication** | Slack, Resend |
| **Error Tracking** | Sentry |
| **Mobile** | RevenueCat |

### Adding Your API Keys

1. Open Pulse and go to **Settings**
2. Select your project
3. Click on the integration you want to configure
4. Enter your API key

All credentials are stored securely in your local app data directory.

## License

MIT

## First run and demo mode

When `~/portfolio/portfolio.json` doesn't exist, Pulse shows a welcome screen instead of an
empty board: what Pulse is, a check for an agent CLI (Claude Code, Codex or opencode) and
python3 (`setup_check`, existence checks at fixed paths only), the setup command with a copy button, and **Try the demo**.

Demo mode serves a fictional org bundled in the frontend (`src/demo/demoOrg.ts`): status
reports, decisions, a `WEEK.md`, finished runs with transcripts, an interactive session and
a lead with a team at work. No file is read or written, the Rust read restrictions are
unchanged, the menu bar and notifications stay off, and Approve/Reject/Discuss only show a
message. **Exit demo** (bottom right) returns to the real org. A browser preview of the
frontend (`npm run dev`) shows the welcome screen; `?demo=1` opens the demo.

Debug builds only: `PULSE_PORTFOLIO_DIR` and `PULSE_TRACKER_DIR` point Pulse at scratch
folders, so first run can be tried without touching `~/portfolio`. Release builds ignore them.
