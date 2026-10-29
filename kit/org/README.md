# {{OWNER}}'s organization

Each entity has a lead agent, a `BRIEF.md` (for humans) and a `status.json` (for Pulse).
The rules every agent follows are in [OPERATING.md](OPERATING.md); the report format is
in [STATUS_SCHEMA.md](STATUS_SCHEMA.md).

```
{{ORG_TREE}}
```
- **Directors** (schedule "nightly") run on their own every night at 5:30am.
- **Chief of staff** (Mondays at 6:30am) reviews everything and writes [WEEK.md](WEEK.md):
  your three moves.
- **On-call leads** run when a director or you call them.
- **Shared managers** (called by directors for any entity): sales, marketing, delivery,
  finance, admin.
- **Workers:** temporary agents, one job each.

## What reaches you
Only gate items: a decision, money or a signature, a relationship (anything sent in your
name), or your taste. They show in Pulse as decisions, each with a recommendation and
Approve / Reject / Discuss buttons.

## Commands
- Talk to a lead: `claude --agent <entity-id>-lead`
- The week: `claude --agent chief-of-staff "weekly review"`
- Run the night shift by hand: `python3 {{ORG}}/bin/nightly.py [entity ...]`
- Check the setup without doing work: `python3 {{ORG}}/bin/nightly.py --check`
- Pulse (desktop) reads `portfolio.json`, every `status.json`, `WEEK.md` and `logs/`.
