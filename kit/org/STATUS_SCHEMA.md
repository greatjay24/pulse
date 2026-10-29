# status.json: what each director reports up

Pulse (the desktop dashboard) and chief-of-staff read these files. Directors
and venture leads overwrite theirs at the end of every session. Keep the
shape exactly. Use empty arrays, never omit keys.

```json
{
  "entity": "acme",                        // the entity id
  "name": "Acme",
  "group": "companies",                    // a group id from portfolio.json
  "parent": null,                          // the parent entity id for ventures
  "stage": "active",                       // active | pending | paused | idea
  "updated": "2026-01-15T05:30:00-05:00",
  "health": "yellow",                      // green | yellow | red (see rules below)
  "health_why": "Pipeline: 12 drafts unsent for 9 days",
  "headline": "One line: the state of the business today.",
  "metrics": [
    {"label": "Cash in (30d)", "value": "$0", "trend": "flat", "source": "stripe"}
  ],
  "lanes": {                               // the five functions
    "sales":     {"status": "one line", "next": "one line"},
    "marketing": {"status": "", "next": ""},
    "delivery":  {"status": "", "next": ""},
    "finance":   {"status": "", "next": ""},
    "admin":     {"status": "", "next": ""}
  },
  "decisions": [                           // gate items for the owner
    {"id": "acme-90-day-offer",            // stable slug: same decision = same id every run
     "ask": "Pick the 90-day lead offer", "recommend": "Fixed-price starter package",
     "why": "...", "gate": "decision", "due": null,
     "on_approve": "What you'll do the moment the owner approves (one line, within the guardrails)"}
  ],
  "owner_actions": [{"what": "Rotate the API token", "how": "provider.com > Settings > API tokens > ...", "due": null}],
  "waiting_on": [{"who": "A client", "what": "homepage pick", "since": "2026-01-10"}],
  "risks": [{"what": "...", "date": null, "severity": "high"}],
  "next": ["ranked move 1", "move 2", "move 3"],
  "done": [{"what": "...", "link": null, "date": "2026-01-14"}]   // last 7 days
}
```
`gate` is one of decision | money | relationship | taste.

## What counts as a decision
A decision is a **choice** the owner makes, with a **concrete answer** you recommend, that
you can carry out the moment it's approved. Test: could the owner press
"Approve: <recommend>" and you'd know exactly what to do?
- `recommend` is the answer itself ("Fixed-price starter package", "No action: keep the
  current vendor"), never process advice ("Decide before the deadline", "Do it this week").
- Chores only the owner can do (rotate a key in a dashboard, sign in somewhere, buy a
  domain) are **not** decisions. Put them in `owner_actions: [{"what","how","due"}]` with
  exact steps, one item per topic.
- Anything the owner already answered (in decisions.jsonl, or noted in the brief as
  decided) never comes back.

## Health: earn the color
Health has to discriminate. "yellow everywhere" is a failure. Use `health_why` (one line)
to say which rule set it.
- **red:** a commitment to someone is late (client, family, partner waiting > 7 days); no
  cash in for 30+ days in an operating company that's selling; a dated risk within 7 days
  with no plan; a security exposure that's live.
- **yellow:** one thing is slipping (a waiting_on older than 3 days, a decision due within
  14 days, pipeline with no sends this week).
- **green:** commitments current, cash or progress moving this week, and nothing urgent is unowned.
- Pending ventures use green or yellow against their own goals (is it moving toward
  launch?), not revenue.

## Decisions the owner acts on in Pulse
The owner can Approve, Reject, or Discuss a decision in Pulse. Each action is appended to
`<entity path>/decisions.jsonl` (`{"id","action","note","at"}`) and the lead is run right
away to carry it out. At the start of every session, read that file:
- carry out any approved item not yet done, within the guardrails (OPERATING.md), then
  record `done` with what you did and a link;
- for a reject, drop the decision and record why if a note was given;
- for a discuss, answer the note as a `reply`, short.
Never re-ask a decision the owner has answered.

Pulse writes through `bin/act.py`, which validates the answer, appends it under a lock,
and runs the lead (same allow/deny lists as the night shift, in `bin/policy.py`). Its rows
also carry the decision's `ask` and `recommend`, so the answer still reads after the
decision leaves status.json. Leads report back with the same script, never by editing
the file:
`python3 {{ORG}}/bin/act.py --record <entity> <id> done|reply --note "<what you did + link>"`.
A decision without an `id` is matched by a slug of its `ask` (lowercase, runs of
non-alphanumerics to `-`, 60 chars max); set `id` on new decisions so it never moves.
