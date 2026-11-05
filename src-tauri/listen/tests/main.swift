// Run: sh scripts/test-listen.sh
import Foundation
var failures = 0
func check(_ cond: Bool, _ what: String) { if !cond { failures += 1; print("FAIL: \(what)") } }

// A reset after a pause (seen on macOS: "Hello there…" then "And…") keeps the first part.
var t = Transcript()
for (s, q) in [("Hello", 0.0), ("Hello there", 0.2), ("Hello there, this is the first part", 0.3), ("And", 9.0), ("And this is the second part", 0.3)] {
    t.update(s, quiet: q)
}
check(t.text == "Hello there, this is the first part And this is the second part", "reset keeps earlier words: \(t.text)")

// An empty final after a pause never wipes the transcript.
var e = Transcript()
e.update("What's on my list today", quiet: 0)
e.update("", quiet: 5)
check(e.text == "What's on my list today", "empty result keeps text: \(e.text)")

// Revisions while talking, or punctuation added after a short quiet, replace the utterance.
var r = Transcript()
r.update("Boy an", quiet: 0); r.update("For an", quiet: 0.1); r.update("For an agent", quiet: 0.2)
r.update("For an agent, to help", quiet: 1.2)
check(r.text == "For an agent, to help", "revision replaces: \(r.text)")

// A task the recognizer closed: commit, then the next task's words follow.
var c = Transcript()
c.update("first stretch", quiet: 0); c.commit(); c.update("second stretch", quiet: 0)
check(c.text == "first stretch second stretch", "commit keeps stretches: \(c.text)")

if failures > 0 { print("\(failures) failed"); exit(1) }
print("pulse-listen transcript tests: ok")
