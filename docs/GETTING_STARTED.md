# Getting started with Pulse

Pulse is a desktop dashboard for people who run more than one business. Each business
gets an AI **lead**: a Claude Code agent that works every night, handles what it can, and
writes a short report. You see the reports, the decisions waiting on you, and what your
agents are doing right now, all in one window.

## What you need

- A Mac (macOS 10.15 or later).
- **Claude Code**, installed and signed in. Open Terminal, run `claude` once and sign in.
  Your agents run on your Claude plan.
- **python3**. Most Macs have it. If Terminal says it's missing, run `xcode-select --install`.
- Optional: **GitHub's `gh` tool**, if you want your leads to open pull requests for you.

## 1. Install Pulse

1. Download the latest `.dmg` from the [Releases](https://github.com/greatjay24/pulse/releases) page.
2. Open it and drag Pulse into Applications.
3. The app isn't signed by Apple yet, so the first time, **right-click Pulse and choose Open**,
   then click Open again. On macOS 15 or later, if it only offers "Done", open System Settings
   → Privacy & Security, scroll down and click **Open Anyway**. After that it opens normally.

Pulse opens on a welcome screen. It checks for Claude Code and python3 and shows the setup
command. Click **Try the demo** to look around a made-up org first. Nothing in the demo is
real, and its buttons don't do anything.

## 2. Run setup

Copy the command from the welcome screen into Terminal:

```
git clone https://github.com/greatjay24/pulse.git ~/pulse && python3 ~/pulse/kit/setup.py
```

Setup asks your first name, how you group your businesses (for example Companies, Family,
Personal), and for each business: a short id, its name, a one-line description, a color and
an optional logo. It shows you the plan before it writes anything. Then it:

- creates `~/portfolio`, your org: one folder per business with a `BRIEF.md` (for you) and a
  `status.json` (for Pulse), plus the rules every agent follows (`OPERATING.md`);
- installs your agents in `~/.claude/agents`: a lead per business (`<id>-lead`), a chief of
  staff, and five shared managers (sales, marketing, delivery, finance, admin);
- never overwrites a file that already exists. Run it again any time to add a business.

At the end it prints two things it does **not** do for you. Do them when you're ready:

- **Turn on the night shift:** `sh ~/portfolio/launchd/install.sh`
- **Show your own sessions in Pulse:** paste the hooks snippet it prints into `~/.claude/settings.json`.

Click **I ran it, check again** in Pulse, and your board appears.

## What happens every night

At 5:30am each lead reads its business's brief, looks at what changed, does the work that
needs nobody's sign-off (research, drafts, fixes on a branch, notes), and rewrites its
report. On Mondays at 6:30am the chief of staff reads everything and writes `WEEK.md`:
your three moves for the week. You can run a shift by hand with
`python3 ~/portfolio/bin/nightly.py`, or test that everything is wired with `--check`.

## The four gates

A lead brings something to you **only** if it needs:

1. **A decision** only you can make (strategy, pricing, people, partners).
2. **Money or a signature** (any spend, contract, purchase or filing).
3. **A relationship**: anything sent in your name. The lead drafts it; you send it.
4. **Your taste**: sign-off on anything that goes public.

Everything else, the lead handles and lists under "done". Agents never send email or
messages, never pay for anything, never merge to main or deploy to production, and never
delete data. Email goes to your Drafts folder.

## Using Pulse

- **Today** opens first: one line (moves, decisions, cash), last night's shift, the
  decisions waiting on you, and each business, worst health first.
- **Approve, Reject or Discuss.** Every decision comes with a recommendation. **Approve**
  tells the lead to carry it out now. **Reject** drops it. **Discuss** sends the lead your
  question; its answer appears under the decision. Anything touching money or a relationship
  asks you to confirm first.
- **Working now** shows each agent while it runs, what it's doing this second, and the team
  it deployed (a lead can hand work to the managers in parallel).
- **Board** is every business as a card; click one for its full report.
- **Activity** is what the org did: runs, decisions, drafts and cost.
- **Conversations** is every run, word for word, grouped by business. Secrets are redacted.
- **Money** appears only if you connect an optional tracker that collects payments.
  Without one, your leads report cash in their own numbers on the Board.

## Talk to a lead

Open Terminal and run:

```
claude --agent acme-lead
```

(use your own business's id). It already knows the business and the rules. Ask it anything:
"what's slipping?", "draft the follow-up to the bakery", "plan the launch". For the whole
picture, run `claude --agent chief-of-staff "weekly review"`.
