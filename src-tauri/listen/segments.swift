// One transcript across the recognizer's resets.
//
// After a pause, macOS's on-device recognizer starts a new utterance inside the same task:
// bestTranscription.formattedString restarts from the new words (and can come back empty in the
// final result), so taking it as the whole transcript drops everything said before the pause.
// Transcript keeps the earlier utterances and never lets an empty result wipe what was said.

import Foundation

func joined(_ a: String, _ b: String) -> String {
    let a = a.trimmingCharacters(in: .whitespaces), b = b.trimmingCharacters(in: .whitespaces)
    return a.isEmpty ? b : b.isEmpty ? a : a + " " + b
}

func firstWord(_ s: String) -> String {
    let w = s.split(whereSeparator: { $0 == " " }).first.map(String.init) ?? ""
    return w.lowercased().filter { $0.isLetter || $0.isNumber }
}

// A result that starts a new utterance rather than revising the current one: it comes after a
// pause, and it begins differently or is much shorter. Revisions while talking come fast.
func isNewUtterance(old: String, new: String, quiet: Double) -> Bool {
    guard !old.isEmpty, quiet >= 0.8 else { return false }
    return firstWord(new) != firstWord(old) || new.count * 2 < old.count
}

struct Transcript {
    var committed = "" // earlier utterances, kept
    var current = ""   // the utterance being recognized now
    var text: String { joined(committed, current) }

    // quiet: seconds since the transcript last changed.
    mutating func update(_ result: String, quiet: Double) {
        let n = result.trimmingCharacters(in: .whitespacesAndNewlines)
        if n.isEmpty { return }
        if isNewUtterance(old: current, new: n, quiet: quiet) { committed = joined(committed, current) }
        current = n
    }

    // The recognizer closed its task: what was said stays, the next task starts fresh.
    mutating func commit() {
        committed = text
        current = ""
    }
}
