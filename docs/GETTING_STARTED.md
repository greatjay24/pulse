# Getting started with Roo

This guide takes you from zero to a working Roo in about 20 minutes. You don't need to be an
engineer. Every step says what to click or what to paste.

The same steps are in the app under **Help** in the sidebar.

## Contents

1. [What Roo is](#1-what-roo-is)
2. [What you need](#2-what-you-need)
3. [Install and first run](#3-install-and-first-run)
4. [Set up your businesses and leads](#4-set-up-your-businesses-and-leads)
5. [Connect your accounts](#5-connect-your-accounts)
6. [Your daily flow](#6-your-daily-flow)
7. [The safety gates](#7-the-safety-gates)
8. [Night shift, runners and limits](#8-night-shift-runners-and-limits)
9. [Troubleshooting](#9-troubleshooting)

## 1. What Roo is

Roo is a desktop app for people who run more than one thing: a company, a side project, a
family business. Each one gets an AI **lead**. A lead is an agent that reads that business's
files, does the work nobody needs to sign off on, and writes a short report.

You see every report, every decision waiting on you, and every agent at work, in one window.
You talk to **Roo**, the assistant at the front. Roo answers quick questions itself and hands
bigger jobs to the right lead.

Everything runs on your Mac. Your files stay in a folder you own (`~/portfolio`). The agents
use the AI plan you already pay for.

## 2. What you need

- A Mac (macOS 10.15 or later).
- **One AI to run your agents**, installed and signed in. Pick the one you already pay for:
  - **Claude:** install Claude Code from Anthropic's Claude Code page, run `claude` once in
    Terminal and sign in.
  - **ChatGPT:** run `npm install -g @openai/codex` (or `brew install codex`), then
    `codex login` and choose **Sign in with ChatGPT**.
  - **Anything else:** run `npm install -g opencode-ai` (or `brew install opencode`), then
    `opencode auth login` for your provider.
- **python3.** Most Macs have it. If Terminal says it's missing, run `xcode-select --install`.
- Optional: GitHub's `gh` tool, if you want leads to open pull requests for you.

Chat, voice and team runs work best with Claude Code. Codex and opencode run the night shift
and the leads, one job at a time.

## 3. Install and first run

1. Download the latest `.dmg` from the [Releases](https://github.com/greatjay24/pulse/releases)
   page.
2. Open it and drag **Roo** into Applications.
3. The app isn't signed by Apple yet. The first time, **right-click Roo and choose Open**,
   then click Open again. On macOS 15 or later, if it only offers "Done", open System
   Settings > Privacy & Security, scroll down and click **Open Anyway**.

Roo opens on a welcome screen. It checks for your AI and python3, and shows the setup
command.

Want to look around first? Click **Try the demo**. It loads a made-up org (Acme Studio,
Northwind Supply, Globex Rentals). Nothing in it is real and its buttons do nothing.

## 4. Set up your businesses and leads

Copy the command from the welcome screen into Terminal:

```
git clone https://github.com/greatjay24/pulse.git ~/pulse && python3 ~/pulse/kit/setup.py
```

Setup asks you a few questions:

- Your first name.
- How you group your businesses. For example: Companies, Family, Personal.
- For each business: a short id (`acme`), its name (`Acme Studio`), one line on what it does,
  a color and an optional logo.
- Which AI runs your agents. It offers the ones it finds and checks you're signed in.

It shows you the plan before it writes anything. Then it creates:

- `~/portfolio`, your org. One folder per business, each with a `BRIEF.md` (for you to edit)
  and a `status.json` (the report Roo reads).
- `~/portfolio/OPERATING.md`, the rules every agent follows.
- Your agents in `~/portfolio/agents`:
  - **Roo**, the assistant you talk to.
  - **A lead per business**, named `<id>-lead` (for example `acme-lead`).
  - **A chief of staff**, who reads everything each week and picks your top moves.
  - **Five shared managers**: sales, marketing, delivery, finance and admin. Any lead can
    hand them work.
- The scripts Roo runs, in `~/portfolio/bin`.

Setup never overwrites a file that already exists.

**Make the leads yours.** Open each business's `BRIEF.md` and write a few lines: what the
business sells, who the customers are, what matters this quarter, what to leave alone. The
lead reads it before every run. A good brief is the biggest upgrade you can make.

**Add a business later.** Run setup again. It adds the new one and leaves the rest alone.

**Let a lead touch code.** By default a lead works only inside `~/portfolio`. To let the
Acme lead work on its website, add the folder to that business in
`~/portfolio/portfolio.json`:

```
"dirs": ["~/code/acme-site"]
```

When setup finishes, click **I ran it, check again** in Roo. Your board appears.

## 5. Connect your accounts

Open **Connectors** in the sidebar. It shows one card per service: connected or not, which
account it's signed in as (partly hidden), and when Roo last checked.

- **Connect** or **Reconnect** starts the real sign-in for that service. That's a Terminal
  window with the sign-in command ready, or a browser page. You do the sign-in. Roo never
  sees your password or token.
- Services with no sign-in command show the exact steps instead.
- **Check again** re-tests every connection.
- To add a service or a Connect button, edit `~/portfolio/connections.json`. Each entry can
  have an `"account"` and a `"connect"` step, for example
  `"connect": [{"label": "Sign in to GitHub", "terminal": ["gh", "auth", "login"]}]`. Roo only
  runs known sign-in commands, so a bad entry can't run anything else.

The ones most people start with:

| Service | What agents do with it | How you connect it |
|---|---|---|
| Email | Save drafts. You send from the Outbox. | Add the mailbox to `portfolio.json`, then store its app password with `keyring_store.py set <id>` |
| Google Calendar and Drive | Read your calendar and files, make docs | In Claude Code, type `/mcp` and connect the claude.ai connectors |
| GitHub | Branches and pull requests | `gh auth login` |
| Vercel | Preview deploys | `vercel login` |
| Stripe | Draft invoices and quotes | A restricted key per business, stored in the Keychain |

Keys and passwords go in your Mac's Keychain. Roo never shows them, prints them or writes
them to a file.

**Different Google accounts per business.** The claude.ai connectors sign in to one Google
account. If Acme uses its own Google Workspace account, give that account its own sign-in
from its card under Connectors. Each business can also have its own Chrome profile, so agents
that use the browser act as the right account. List them under `browsers` in
`portfolio.json` and Connectors shows them, with which business uses each.

## 6. Your daily flow

**Morning: Today.** Roo opens on Today. The top line says how many moves you have this week,
how many decisions need you, and the cash that came in. Below it: what the night shift did,
the decisions waiting on you, and each business, worst first.

**Decide.** Every decision comes with the lead's recommendation.

- **Approve** tells the lead to do it now.
- **Reject** drops it.
- **Discuss** sends the lead your question. The answer shows up under the decision.

**Outbox: one click to send.** Anything an agent writes for someone else waits here: emails,
posts, texts, invoices. Read it, edit it if you like, and click **Send** (or **Approve**).
Nothing leaves until you click. Roo learns from what you edit and what you skip.

**Board.** Every business as a card, colored by health. Click one for its full report:
metrics, decisions, next moves, risks, and what got done this week.

**Goals.** Each business's goals and how close it is. You set the targets. Leads update the
numbers they can measure and flag the ones at risk.

**Conversations.** Every run, word for word, grouped by business. Secrets are hidden. Type
under any thread to keep talking with that lead.

**Activity.** What the org did: runs, decisions, drafts, your clicks, and what it cost.

**Talk to Roo.** Press ⌘K and type, or start with a business name to go straight to its
lead:

```
Acme: draft a follow-up to the bakery that asked about pricing
```

Say **Brief me** for a morning or evening summary.

**Voice.** Press ⌥⇧Space anywhere on your Mac and speak. Speech turns into text on the Mac.
A pause sends it to Roo. Roo can read its replies aloud. Change the voice, speed and hotkey in
Settings > General. The first time, macOS asks for the microphone and speech recognition.

**Telegram (optional).** If you run a Telegram bot for your org, Roo sends the meeting brief
there when your Mac is closed or locked, so you stay in the loop from your phone. The bot
isn't in the starter kit yet. Make one with Telegram's BotFather if you want it.

## 7. The safety gates

Agents do the work. You make the calls that matter. A lead brings you something **only** if
it needs one of these:

1. **A decision only you can make**: strategy, pricing, people, partners.
2. **Money or a signature**: any spend, contract, purchase or filing.
3. **A relationship**: anything sent in your name. The lead drafts it. You send it.
4. **Your taste**: sign-off on anything that goes public.

And these are always yours, every time:

- **Sending.** Agents never send email, texts, DMs or posts. They draft. You click Send.
- **Money.** Agents never pay, buy or move money. Refunds, charges and plan changes wait for
  your Approve click.
- **Deletes.** Agents never delete data. They can archive.
- **Form submits.** Agents can fill in a web form for you. You read it and click Submit.
- **Passwords and IDs.** Agents never type passwords, card numbers, bank numbers or
  government IDs.

Out of the box, agents also never merge to main or deploy to production. You can loosen that
per business later in `OPERATING.md`.

## 8. Night shift, runners and limits

**Turn on the night shift.** Run this once:

```
sh ~/portfolio/launchd/install.sh
```

At 5:30am each lead reads its brief, checks what changed, does what it can, and rewrites its
report. On Mondays the chief of staff writes `WEEK.md`: your three moves for the week. To run
a shift by hand: `python3 ~/portfolio/bin/nightly.py`. To test the wiring:
add `--check`.

**Switch AI later.** One line in `~/portfolio/portfolio.json` picks the AI:

```
"runner": "claude-code"
```

Use `"codex"` or `"opencode"` instead and the next run uses that one. One business can use a
different AI from the rest: add `"runner"` to that business.

**What agents can see.** A lead works in `~/portfolio` and the folders you list in its
`dirs`. Codex enforces that for every command. Claude Code and opencode enforce it for their
own file tools; other programs a lead runs are not fenced.

**Talk to a lead in Terminal.** Run `python3 ~/portfolio/bin/talk.py acme` (your own id). It
opens that lead in your AI, already knowing the business and the rules.

**Updating.** Run `git -C ~/pulse pull`, then `python3 ~/pulse/kit/setup.py --update-bin`.
That refreshes the scripts. Your businesses, reports and agents are left alone.

## 9. Troubleshooting

- **"Roo is damaged" or it won't open.** Right-click > Open, or System Settings > Privacy &
  Security > Open Anyway.
- **The board is empty.** Setup didn't finish, or `~/portfolio` is somewhere else. Run setup
  again and click **I ran it, check again**.
- **A lead never runs at night.** Run `python3 ~/portfolio/bin/nightly.py --check`. It says
  what's missing.
- **A connector says "Needs sign-in".** Click **Reconnect** on its card under
  Connectors, finish the sign-in, then click **Check again**.
- **Voice does nothing.** Turn on Dictation once in System Settings > Keyboard, then allow the
  microphone for Roo.
