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

## Org board

Pulse's home view is a board for every entity in `~/portfolio`. It reads
`portfolio.json`, each entity's `status.json` (schema in `~/portfolio/STATUS_SCHEMA.md`)
and `WEEK.md` through a read-only Rust command scoped to `~/portfolio`. No network.

- **Board**: one column per group (operating companies, family, personal, with ventures
  nested under Personal). Each card shows health, headline, open decisions, top metrics
  and report age (flagged as stale after 36h). The top strip totals decisions waiting on
  you and shows the first section of `WEEK.md`.
- **Entity dashboard**: click a card for metrics, lanes, decisions with recommendations
  and gates, waiting on, risks, next moves and done this week.
- **TV mode**: press `T` (or the TV mode button) for fullscreen with larger type and no
  sidebar; `Esc` exits. `Backspace` returns from an entity to the board.
- Data re-reads every 60 seconds and whenever the window regains focus.

The SaaS metrics views (Overview, Analytics, Calendar, Projects) are still in the sidebar.

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
