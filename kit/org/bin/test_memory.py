#!/usr/bin/env python3
"""Tests for the shared memory store (memory.py), the import (memory_import.py) and the Outbox
learning step (outbox_learn.py). Everything runs in a temp PORTFOLIO_ROOT; nothing reads the
real home folder, ~/.claude or the Keychain."""
import io, json, os, pathlib, shutil, sys, tempfile, unittest
from contextlib import redirect_stdout

ROOT = pathlib.Path(tempfile.mkdtemp(prefix="memory-test-"))
CLAUDE = ROOT / "_claude"
TRACKER = ROOT / "_tracker"
os.environ["PORTFOLIO_ROOT"] = str(ROOT)
os.environ["CLAUDE_MEMORY_DIR"] = str(CLAUDE)
os.environ["PULSE_TRACKER_DIR"] = str(TRACKER)
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import memory as mem  # noqa: E402
import memory_import  # noqa: E402
import outbox_learn as ol  # noqa: E402

ENTITIES = [{"id": "acme", "name": "Acme Studio", "path": "companies/acme"},
            {"id": "northwind", "name": "Northwind Supply", "path": "companies/northwind"},
            {"id": "globex", "name": "Globex Rentals", "path": "family/globex"},
            {"id": "personal", "name": "Personal", "path": "personal"},
            {"id": "initech", "name": "Initech", "path": "personal/ventures/initech", "parent": "personal"},
            {"id": "hooli", "name": "Hooli", "path": "elsewhere/hooli", "parent": "personal"}]


def write(path, obj):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(obj if isinstance(obj, str) else json.dumps(obj))


def fresh(owner="Sam"):
    for d in ("memory", "outbox", "_claude", "_tracker"):
        shutil.rmtree(ROOT / d, ignore_errors=True)
    write(ROOT / "portfolio.json", {"owner": {"name": owner}, "entities": ENTITIES})


def cli(*args):
    buf = io.StringIO()
    with redirect_stdout(buf):
        code = mem.main(list(args))
    return code, buf.getvalue()


class Store(unittest.TestCase):
    def setUp(self):
        fresh()

    def test_add_get_and_dedupe(self):
        r = mem.add("Sam cuts sign-offs", "Sam cuts sign-offs from email drafts.", "acme", "preference")
        self.assertTrue(r["changed"])
        again = mem.add("", "Sam cuts sign offs from email drafts", "acme", "preference")
        self.assertTrue(again["duplicate"])
        self.assertEqual(again["id"], r["id"])
        self.assertEqual(len(mem.all_facts()), 1)
        f = mem.load(r["id"])
        self.assertEqual(f["entity"], ["acme"])
        self.assertEqual(f["status"], "active")

    def test_entity_required_and_known(self):
        with self.assertRaises(mem.Invalid):
            mem.add("x", "some text", "", "fact")
        with self.assertRaises(mem.Invalid):
            mem.add("x", "some text", "umbrella", "fact")
        self.assertEqual(mem.parse_entities("*", allow_all=True), ["all"])

    def test_visibility_keeps_entities_apart(self):
        a = mem.add("Globex rent", "Globex tenants pay rent by check.", "globex")["id"]
        g = mem.add("Times", "Times are US Eastern.", "general")["id"]
        b = mem.add("Initech domain", "initech.example renews Feb 2027.", "initech")["id"]
        h = mem.add("Hooli note", "Hooli is a parked idea.", "hooli")["id"]
        both = mem.add("Globex pays Acme", "Globex pays Acme by check; never chase.", "globex,acme")["id"]
        acme = {f["id"] for f in mem.select("acme")}
        self.assertEqual(acme, {g, both})
        self.assertNotIn(a, {f["id"] for f in mem.select("northwind")})
        # Ventures roll up to their parent: by folder (initech) and by "parent" (hooli).
        self.assertEqual({f["id"] for f in mem.select("personal")}, {g, b, h})
        self.assertEqual({f["id"] for f in mem.select("globex")}, {a, g, both})
        self.assertEqual(len(mem.select("all")), 5)
        code, out = cli("get", a, "--entity", "acme")
        self.assertEqual(code, 2)
        self.assertNotIn("check", out)

    def test_secrets_are_redacted(self):
        fid = mem.add("Stripe", "The key is sk_live_abcdefghijklmnop1234 do not share", "acme")["id"]
        text = (mem.FACTS / f"{fid}.md").read_text()
        self.assertNotIn("sk_live_abcdefghijklmnop1234", text)
        self.assertIn("[redacted]", text)

    def test_search_context_and_status(self):
        x = mem.add("Sign-offs", "Sam cuts sign-offs from email drafts.", "acme", "lesson")["id"]
        mem.add("Hooks", "Northwind TikTok drafts need a hook in the first line.", "northwind", "lesson")
        mem.add("Plain", "Prefers plain words.", "general", "preference")
        self.assertEqual([f["id"] for f in mem.search("sign-offs email", "acme")], [x])
        self.assertEqual(mem.search("tiktok hook", "acme"), [])
        ctx = mem.context("acme")
        self.assertIn("Learned from the Outbox", ctx)
        self.assertIn("How Sam likes things done", ctx)      # the owner's name from portfolio.json
        self.assertIn(x, ctx)
        self.assertNotIn("TikTok", ctx)
        mem.set_status(x, "disabled")
        self.assertNotIn(x, mem.context("acme"))
        self.assertTrue(mem.FACTS.joinpath(f"{x}.md").exists())     # never deleted

    def test_context_without_owner_name(self):
        write(ROOT / "portfolio.json", {"entities": ENTITIES})
        mem.add("Plain", "Prefers plain words.", "general", "preference")
        self.assertIn("How the owner likes things done", mem.context("all"))

    def test_replaces_marks_superseded(self):
        old = mem.add("Prices", "Quote in ranges.", "acme", "preference")["id"]
        new = mem.add("Prices", "Quote by page count, not ranges.", "acme", "preference", replaces=old)["id"]
        self.assertEqual(mem.load(old)["status"], "superseded")
        self.assertEqual(mem.load(old)["superseded_by"], new)

    def test_upsert_is_idempotent(self):
        self.assertTrue(mem.upsert("l-abcd1234", "T", "Body", ["acme"], "lesson"))
        self.assertFalse(mem.upsert("l-abcd1234", "T", "Body", ["acme"], "lesson"))
        self.assertTrue(mem.upsert("l-abcd1234", "T", "Body 2", ["acme"], "lesson"))

    def test_cli_add_and_index(self):
        code, out = cli("add", "--entity", "northwind", "--title", "No UGC", "--text", "Sam doesn't want UGC.", "--type", "preference")
        self.assertEqual(code, 0)
        fid = json.loads(out)["id"]
        index = (mem.MEMORY / "INDEX.md").read_text()
        self.assertIn(fid, index)
        self.assertIn("bin/memory.py context", index)
        meta = json.loads((mem.MEMORY / "index.json").read_text())["facts"]
        self.assertNotIn("body", meta[0])
        code, out = cli("list", "--entity", "acme", "--json")
        self.assertEqual(json.loads(out), [])


class Import(unittest.TestCase):
    def setUp(self):
        fresh()
        write(CLAUDE / "MEMORY.md", "# index\n")
        write(CLAUDE / "initech-project.md", "---\nname: initech-project\ndescription: Initech newsletter idea\nmetadata:\n  type: project\n---\n\nInitech facts.\n")
        write(CLAUDE / "feedback-succinct-answers.md", "---\nname: feedback-succinct-answers\ndescription: Be concise\nmetadata:\n  type: feedback\n---\n\nKeep it short.\n")
        write(CLAUDE / "new-thing.md", "---\nname: new-thing\ndescription: Globex Rentals lease notes\n---\n\nGlobex detail.\n")
        write(mem.MEMORY / "facts.md", "# Stable facts\n\nIntro.\n\n- Times are US Eastern.\n- Three mail accounts, incl. one\n  for the shop.\n")
        write(mem.MEMORY / "preferences.json", {"preferences": [
            {"id": "p-aaaaaa", "text": "Prefers short posts.", "area": "posts", "entity": "northwind", "status": "active", "disabled": False},
            {"id": "p-bbbbbb", "text": "Old rule.", "area": "email", "entity": None, "status": "superseded", "superseded_by": "p-aaaaaa"}]})
        write(mem.MEMORY / "preferences.md", "# x\n\n## Added by Sam\n- [globex] Don't draft tenant replies. (Oct 31)\n")
        write(TRACKER / "notes.json", {"notes": {"acme": {"goal": "Pipeline", "next": "Call the printer", "status": "active"},
                                                 "side-thing": {"goal": "Launch Initech"}}})

    def test_import_tags_and_is_rerunnable(self):
        res = memory_import.run()
        self.assertTrue(res["ok"], res)
        facts = {f["source"]: f for f in mem.all_facts()}
        self.assertEqual(facts["claude-memory/initech-project.md"]["entity"], ["initech"])
        self.assertEqual(facts["claude-memory/feedback-succinct-answers.md"]["type"], "feedback")
        self.assertEqual(facts["claude-memory/feedback-succinct-answers.md"]["entity"], ["general"])
        self.assertEqual(facts["claude-memory/new-thing.md"]["entity"], ["globex"])     # tagged by entity name
        mail = next(f for f in mem.all_facts() if f["body"].startswith("Three mail"))
        self.assertEqual(mail["entity"], ["general"])
        self.assertIn("for the shop", mail["body"])                                    # wrapped bullet joined
        self.assertEqual(mem.load("p-bbbbbb")["status"], "superseded")
        own = next(f for f in mem.all_facts() if f.get("by") == "owner" and f["type"] == "preference")
        self.assertEqual(own["entity"], ["globex"])
        notes = {f["source"]: f for f in mem.all_facts() if f["type"] == "project" and "notes.json" in f["source"]}
        self.assertEqual(notes["tracker/notes.json#acme"]["entity"], ["acme"])
        self.assertEqual(notes["tracker/notes.json#side-thing"]["entity"], ["initech"])
        n = len(mem.all_facts())
        again = memory_import.run()
        self.assertEqual(again["written"], 0)
        self.assertEqual(len(mem.all_facts()), n)
        self.assertTrue((CLAUDE / "initech-project.md").exists())                      # originals untouched

    def test_missing_sources_are_skipped(self):
        shutil.rmtree(CLAUDE)
        shutil.rmtree(TRACKER)
        res = memory_import.run()
        self.assertTrue(res["ok"], res)

    def test_claude_project_dir_naming(self):
        d = memory_import.claude_project_dir(pathlib.Path("/Users/sam/my.org"))
        self.assertEqual(d.name, "-Users-sam-my-org")

    def test_dry_run_writes_nothing(self):
        res = memory_import.run(dry_run=True)
        self.assertTrue(res["written"])
        self.assertEqual(mem.all_facts(), [])

    def test_cross_source_duplicates_skipped(self):
        write(CLAUDE / "dup.md", "---\nname: dup\ndescription: d\nmetadata:\n  type: user\n---\n\nTimes are US Eastern.\n")
        res = memory_import.run(only=["claude", "facts"])
        self.assertEqual(len(res["duplicates"]), 1)


def item(i, by="acme-lead", kind="email", status="sent", at="2026-11-01T10:00:00-04:00", **kw):
    d = {"id": f"20261101-1000{i:02d}-x-{i}", "kind": kind, "entity": kw.pop("entity", "acme"), "created_by": by,
         "status": status, "subject": f"Subject {i}", "body": "Hi Pat,\nBody text.\nBest,\nSam", "history": [],
         "created_at": at}
    if status == "sent":
        d["sent_at"] = at
    if status == "skipped":
        d["skipped_at"] = at
    d.update(kw)
    write(ROOT / "outbox" / f"{d['id']}.json", d)
    return d


LONG = "Hi Pat,\nI hope this finds you well! I just wanted to send the revised homepage timeline and a few notes on scope today.\n" \
       "We can start Monday and finish the build in two weeks with one round of edits included.\nBest,\nSam"
SHORT = "Pat,\nRevised timeline: start Monday, done in two weeks, one round of edits."


class OutboxLearning(unittest.TestCase):
    def setUp(self):
        fresh()

    def test_decisions_ledger_and_tests_ignored(self):
        item(1)
        item(2, status="skipped", history=[{"what": "skipped in Pulse: too long"}])
        item(3, status="pending")
        item(4, subject="Dry run: outbox", created_by="ops-builder")
        item(5, status="sent", original={"body": LONG}, body=SHORT, edited_at="2026-11-01T09:00:00-04:00")
        res = ol.run()
        rows = ol.read_jsonl(ol.LEDGER)
        self.assertEqual(sorted(r["decision"] for r in rows), ["edited", "skipped", "unchanged"])
        self.assertEqual(next(r for r in rows if r["decision"] == "skipped")["note"], "too long")
        self.assertNotIn("body", rows[0])
        self.assertEqual(res["new_decisions"], 3)
        self.assertEqual(ol.run()["new_decisions"], 0)                   # append-only, once per item
        st = json.loads(ol.STATS.read_text())
        self.assertEqual(st["by_agent"]["acme-lead"]["approval_rate"], round(2 / 3, 3))

    def test_ledger_survives_outbox_cleanup(self):
        item(1)
        ol.run()
        shutil.rmtree(ROOT / "outbox")
        ol.run()
        self.assertEqual(json.loads(ol.STATS.read_text())["overall"]["decided"], 1)

    def test_streak_candidates_never_money_and_keep_answers(self):
        for i in range(5):
            item(i, at=f"2026-11-0{i + 1}T10:00:00-04:00")
        item(9, kind="stripe_invoice")
        for i in range(10, 16):
            item(i, kind="stripe_invoice", at="2026-11-02T10:00:00-04:00")
        ol.run(min_streak=5)
        c = json.loads(ol.CANDIDATES.read_text())
        self.assertEqual([(r["agent"], r["kind"]) for r in c["candidates"]], [("acme-lead", "email")])
        md = ol.CANDIDATES_MD.read_text()
        self.assertIn("nothing auto-sends", md.lower())
        self.assertIn("Sam approved unchanged", md)
        c["candidates"][0]["owner"] = "no"
        write(ol.CANDIDATES, c)
        item(20, status="skipped", at="2026-11-09T10:00:00-04:00")       # breaks the streak
        ol.run(min_streak=5)
        c = json.loads(ol.CANDIDATES.read_text())
        self.assertEqual(c["candidates"][0]["owner"], "no")
        self.assertEqual(c["candidates"][0]["streak_unchanged"], 0)

    def test_streak_counts_only_latest_run(self):
        item(1, status="skipped", at="2026-11-01T10:00:00-04:00")
        for i in range(2, 5):
            item(i, at=f"2026-11-0{i}T10:00:00-04:00")
        ol.run()
        st = json.loads(ol.STATS.read_text())
        self.assertEqual(st["by_agent_kind"]["acme-lead|email"]["streak_unchanged"], 3)

    def test_edit_traits(self):
        t = ol.edit_traits({"original": {"body": LONG, "subject": "Homepage timeline update"}, "body": SHORT, "subject": "Timeline"})
        for want in ("cuts_signoff", "cuts_greeting", "shorter", "cuts_filler", "cuts_exclamations", "rewrites_subject"):
            self.assertIn(want, t)
        self.assertEqual(ol.edit_traits({"original": {"body": "Hi\nok"}, "body": "Hi\nok then"}) & {"cuts_signoff"}, set())

    def test_lessons_need_two_items_and_carry_entities(self):
        item(1, original={"body": LONG}, body=SHORT, edited_at="x")
        ol.run()
        self.assertEqual([f for f in mem.all_facts() if f["type"] == "lesson"], [])
        item(2, original={"body": LONG}, body=SHORT, edited_at="x", entity="globex")
        ol.run()
        lessons = [f for f in mem.all_facts() if f["type"] == "lesson"]
        signoff = next(f for f in lessons if "sign-off" in f["title"])
        self.assertIn("acme-lead", signoff["title"])
        self.assertTrue(signoff["title"].startswith("Sam cuts"), signoff["title"])
        self.assertEqual(signoff["entity"], ["acme", "globex"])
        self.assertNotIn("Pat", signoff["body"])                         # no names or bodies in lessons
        n = len(lessons)
        ol.run()
        self.assertEqual(len([f for f in mem.all_facts() if f["type"] == "lesson"]), n)

    def test_cross_agent_lesson_only_when_two_agents(self):
        item(1, original={"body": LONG}, body=SHORT, edited_at="x")
        item(2, by="northwind-lead", original={"body": LONG}, body=SHORT, edited_at="x", entity="northwind")
        ol.run()
        titles = [f["title"] for f in mem.all_facts() if f["type"] == "lesson"]
        self.assertTrue(any("agents'" in t and "sign-off" in t for t in titles), titles)

    def test_skip_lessons(self):
        for i in range(3):
            item(i, by="northwind-lead", kind="post", channel="tiktok", entity="northwind", status="skipped",
                 history=[{"what": "skipped in Pulse: no hook"}] if i == 0 else [])
        item(5, by="claude", status="skipped", history=[{"what": "skipped in Pulse: sent it from Gmail at 11:10"}])
        ol.run()
        titles = [f["title"] for f in mem.all_facts() if f["type"] == "lesson"]
        self.assertTrue(any("skips most of northwind-lead's tiktok post drafts" in t for t in titles), titles)
        self.assertTrue(any('"no hook"' in t for t in titles), titles)
        self.assertFalse(any("Gmail" in t for t in titles), titles)            # one-off status note, not a rule


class Nightly(unittest.TestCase):
    def test_learn_runs_outbox_and_sync(self):
        fresh()
        import learn
        item(1)
        write(mem.MEMORY / "preferences.json", {"preferences": [
            {"id": "p-cccccc", "text": "Prefers plain words.", "area": "general", "entity": None, "status": "active",
             "evidence": {"said": 2}, "first_seen": "2026-11-01", "last_seen": "2026-11-01", "sources": [], "disabled": False}]})
        out = learn.learn(use_model=False)
        self.assertTrue(out["outbox"]["ok"], out)
        self.assertTrue(out["memory_sync"]["ok"], out)
        self.assertEqual(mem.load("p-cccccc")["entity"], ["general"])
        self.assertTrue(ol.STATS.exists())


if __name__ == "__main__":
    unittest.main()
