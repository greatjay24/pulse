# Roo Roadmap

Roo is Jay's one assistant (desktop app here; Telegram via ~/project-tracker/jaybot).
Agents prepare, Jay decides: nothing is sent, posted, charged or merged without his click.
Org scripts live in ~/portfolio (watcher, Outbox, memory); this repo is the app.

Status as of 2026-11-05.

---

## Phase 1: One assistant you talk to ✅

- Roo chat, Telegram, morning brief and end-of-day recap
- Voice: press to send, quick lane with streaming, British System voice (Kokoro optional)
- Proactive voice: Roo speaks up when something needs Jay

## Phase 2: Always watching, acting on its own 🟡

Done:
- Watcher every 15 min (`~/portfolio/bin/watch.py`): email, calendar, GitHub, Vercel, Stripe, deadlines
- Follow-up nudges, 6pm "what I did without you" digest, undo
- Meeting notes routed to each team (Ayson → Meghan/Felicia, Crafted → Marcus/Sebastian)
- Meeting prep: brief 10 min before; before-9am meetings get it the night before (#21)

Left:
- Google Voice text alerts (built; Jay installs)
- Mercury bank watching (needs read-only token)
- Auto-accept meetings from an approved list (built, off)
- Chase overdue invoices, fix broken deploys as PRs, draft replies before asked

## Phase 3: Full reach 🟠

Done:
- Resend email from visuo.io and notify.craftco.io; Stripe invoices, quotes, refunds, subscriptions (#22). Keys in Keychain only.

Left:
- Real posting from the Outbox: TikTok (via Higgsfield), YouTube; copy-and-open for Instagram/LinkedIn
- Slack, LinkedIn, ads and analytics
- Loosen Stripe key (Payment Intents write) when Jay wants direct charges

## Phase 4: Learns Jay 🟡

Done (#24):
- One shared memory: `~/portfolio/memory/facts/`, CLI `~/portfolio/bin/memory.py`, entity-scoped
- Nightly learning from Outbox decisions: approval stats, lessons, auto-approve candidates (proposals only)
- Skip asks why

Left:
- Point every agent at shared memory (`~/portfolio/bin/roo-memory-prompt.sh`, Jay runs)
- Roo screen for stats and auto-approve candidates
- Wording pass on lessons

---

## App polish (backlog)

- Dashboard clarity: Jay's top 3 annoyances (pending)
- Loading and error states per widget, manual refresh
- Keyboard shortcuts (Cmd+1..9 pages, Cmd+, settings)
- Code splitting (bundle ~929KB)
- Bundle id `com.pulse.app` ends in `.app` (Tauri warns); changing it resets macOS grants, so only with a planned re-grant

## Working on it

```bash
bash scripts/install.sh   # build, sign with a stable identity, install to /Applications
npm run tauri dev         # dev
```

Branch per change, PR to main; merges are Jay's click.
