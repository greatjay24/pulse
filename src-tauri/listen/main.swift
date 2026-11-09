// pulse-listen: on-device speech to text for Roo's listening panel.
//
// Uses macOS's Speech framework with requiresOnDeviceRecognition, so audio never leaves the
// Mac and nothing is paid for. Roo starts it, reads one JSON object per line on stdout:
//
//   {"type":"ready"}                       listening
//   {"type":"level","value":0.0...1.0}     microphone level, ~10 a second
//   {"type":"partial","text":"..."}        the transcript so far
//   {"type":"final","text":"..."}          the finished transcript; the helper then exits
//   {"type":"error","message":"..."}       it can't listen (permission, no on-device model); exits 1
//
// It finishes (and sends "final") after --pause seconds of silence once something was said,
// on "stop" or EOF on stdin, on SIGINT or SIGTERM, or after --max seconds. "cancel" on stdin
// exits at once with no final.
//
// --pause 0 is press-to-send: silence never finishes it, only "stop" (or --max) does. The
// recognizer may still close a stretch of speech on its own after a long quiet spell; the
// helper keeps what was said and starts a new stretch, so a pause never cuts the owner off.
//
// --converse is conversation mode (the panel's always-listening, full-duplex mode). The mic
// stays open with voice processing on (acoustic echo cancellation, so Roo's own voice is mostly
// removed from what the recognizer hears), and the helper never finishes by itself:
//
//   {"type":"ready","aec":true|false}         listening; aec: whether echo cancellation is on
//   {"type":"partial","text":"...","turn":n}  what's been heard in turn n so far
//   {"type":"idle"}                           --idle seconds with nothing heard; the helper exits
//
// The panel decides when a turn ends (a pause, utils/listen.ts) and writes "next" on stdin: the
// helper drops what it heard and starts turn n+1 on a fresh recognition task. The recognizer's
// ~1 minute limit per task is handled here: a long-running task is swapped for a new one at the
// next short pause (or at 58 s regardless), keeping the turn's words. --pause and --max don't
// apply; it quits after --idle seconds (default 600) with nothing heard, a backstop for the
// panel's own quiet timeout. No audio is ever written anywhere.
//
// Usage: pulse-listen [--locale en-US] [--pause 1.6 | --pause 0] [--max 60] [--converse [--idle 600]]
//
// The usage strings the permission prompts show are embedded in this binary's __info_plist
// (see scripts/build-listen.sh) and repeated in Roo's own Info.plist.

import AVFoundation
import Foundation
import Speech

setvbuf(stdout, nil, _IOLBF, 0)

func emit(_ obj: [String: Any]) {
    guard let data = try? JSONSerialization.data(withJSONObject: obj),
          let line = String(data: data, encoding: .utf8) else { return }
    print(line)
    fflush(stdout)
}

func fail(_ message: String) -> Never {
    emit(["type": "error", "message": message])
    exit(1)
}

func describe(_ error: Error) -> String {
    let e = error as NSError
    return "\(e.localizedDescription) (\(e.domain) \(e.code))"
}

func option(_ name: String, _ fallback: String) -> String {
    let args = CommandLine.arguments
    if let i = args.firstIndex(of: name), i + 1 < args.count { return args[i + 1] }
    return fallback
}

let localeID = option("--locale", Locale.current.identifier)
let pauseArg = Double(option("--pause", "1.6")) ?? 1.6
let manual = pauseArg <= 0                       // press-to-send: only "stop" finishes
let pauseSecs = max(0.6, pauseArg)
let maxSecs = min(600.0, max(5.0, Double(option("--max", "60")) ?? 60))
let converse = CommandLine.arguments.contains("--converse")
let idleSecs = min(3600.0, max(30.0, Double(option("--idle", "600")) ?? 600))
let taskSoftLimit = 50.0 // seconds: swap the recognition task at the next pause after this
let taskHardLimit = 58.0 // ...or now, before the recognizer's own ~1 minute cut-off

// The voice-processed input can come with several channels; the recognizer wants one.
func mono(_ buffer: AVAudioPCMBuffer) -> AVAudioPCMBuffer {
    let fmt = buffer.format
    guard fmt.channelCount > 1, let src = buffer.floatChannelData,
          let monoFmt = AVAudioFormat(standardFormatWithSampleRate: fmt.sampleRate, channels: 1),
          let out = AVAudioPCMBuffer(pcmFormat: monoFmt, frameCapacity: buffer.frameLength),
          let dst = out.floatChannelData else { return buffer }
    out.frameLength = buffer.frameLength
    let n = Int(buffer.frameLength)
    if fmt.isInterleaved {
        let ch = Int(fmt.channelCount)
        for i in 0..<n { dst[0][i] = src[0][i * ch] }
    } else {
        dst[0].update(from: src[0], count: n)
    }
    return out
}

final class Listener {
    let engine = AVAudioEngine()
    private let lock = NSLock()
    private var request = SFSpeechAudioBufferRecognitionRequest()
    var task: SFSpeechRecognitionTask?
    var recognizer: SFSpeechRecognizer?
    var transcript = Transcript() // across pauses and closed stretches (segments.swift)
    var text = ""
    var lastChange = Date()
    let started = Date()
    var finishing = false
    var lastLevel = Date.distantPast
    var restarts = 0
    var turn = 0                      // converse: the turn being heard
    var stretchStarted = Date()       // converse: when the current recognition task began
    var lastHeard = Date()            // converse: last time any words came in
    var recentRestarts: [Date] = []   // converse: tasks the recognizer closed on its own

    func tapAndStart(_ input: AVAudioInputNode) throws {
        let format = input.outputFormat(forBus: 0)
        guard format.sampleRate > 0 else { fail("No microphone found.") }
        input.installTap(onBus: 0, bufferSize: 1024, format: format) { [weak self] buffer, _ in
            guard let self = self else { return }
            let b = mono(buffer)
            self.currentRequest().append(b)
            self.level(b)
        }
        engine.prepare()
        try engine.start()
    }

    func start() {
        guard let rec = SFSpeechRecognizer(locale: Locale(identifier: localeID)) ?? SFSpeechRecognizer() else {
            fail("Speech recognition isn't available for \(localeID).")
        }
        guard rec.supportsOnDeviceRecognition else {
            fail("On-device speech isn't installed for \(rec.locale.identifier). Turn on Dictation in System Settings > Keyboard once so macOS downloads it.")
        }
        guard rec.isAvailable else { fail("Speech recognition is unavailable right now.") }
        recognizer = rec

        let input = engine.inputNode
        // Conversation mode: Apple's voice processing (echo cancellation, as in FaceTime) so the
        // mic can stay open while Roo talks. Ducking of other audio is kept to the minimum, or
        // Roo's own voice would drop to a whisper. Without it, the panel's text gate still applies.
        var aec = false
        if converse {
            do {
                try input.setVoiceProcessingEnabled(true)
                aec = input.isVoiceProcessingEnabled
                if #available(macOS 14.0, *) {
                    input.voiceProcessingOtherAudioDuckingConfiguration =
                        AVAudioVoiceProcessingOtherAudioDuckingConfiguration(enableAdvancedDucking: false, duckingLevel: .min)
                }
            } catch {
                aec = false
            }
            _ = engine.mainMixerNode // voice processing runs input and output as one unit
        }
        // Bluetooth headset mics (and some device pairs) refuse voice processing: the engine
        // won't start with it on. Then start plain; headphones don't echo, and the panel's text
        // gate still covers speakers.
        do {
            try tapAndStart(input)
        } catch where aec {
            engine.stop()
            input.removeTap(onBus: 0)
            try? input.setVoiceProcessingEnabled(false)
            aec = false
            do { try tapAndStart(input) } catch { fail("Couldn't start the microphone: \(describe(error))") }
        } catch {
            fail("Couldn't start the microphone: \(describe(error))")
        }

        beginStretch()
        emit(converse ? ["type": "ready", "aec": aec] : ["type": "ready"])

        Timer.scheduledTimer(withTimeInterval: 0.15, repeats: true) { [weak self] _ in
            guard let self = self, !self.finishing else { return }
            let now = Date()
            if converse {
                let age = now.timeIntervalSince(self.stretchStarted)
                let quiet = now.timeIntervalSince(self.lastChange)
                if age >= taskHardLimit || (age >= taskSoftLimit && quiet >= 0.6) { self.renewTask() }
                if now.timeIntervalSince(self.lastHeard) >= idleSecs {
                    emit(["type": "idle"])
                    exit(0)
                }
                return
            }
            let quiet = now.timeIntervalSince(self.lastChange)
            if (!manual && !self.text.isEmpty && quiet >= pauseSecs) || now.timeIntervalSince(self.started) >= maxSecs {
                self.finish()
            }
        }
    }

    // Converse: a fresh recognition task, keeping the turn's words (the ~1 minute limit).
    func renewTask() {
        let old = task
        transcript.commit()
        beginStretch()
        old?.cancel()
    }

    // Converse: the panel took the turn. Forget it and listen for the next one.
    func nextTurn() {
        guard converse, !finishing else { return }
        turn += 1
        transcript = Transcript()
        text = ""
        lastChange = Date()
        let old = task
        beginStretch()
        old?.cancel()
    }

    func currentRequest() -> SFSpeechAudioBufferRecognitionRequest {
        lock.lock(); defer { lock.unlock() }
        return request
    }

    // One recognition task. Press-to-send starts another when the recognizer closes one early.
    func beginStretch() {
        guard let rec = recognizer else { return }
        let req = SFSpeechAudioBufferRecognitionRequest()
        req.requiresOnDeviceRecognition = true
        req.shouldReportPartialResults = true
        if #available(macOS 13, *) { req.addsPunctuation = true }
        lock.lock(); request = req; lock.unlock()
        stretchStarted = Date()
        task = rec.recognitionTask(with: req) { [weak self] result, error in
            guard let self = self else { return }
            DispatchQueue.main.async {
                guard req === self.currentRequest() else { return } // a stretch already replaced
                if let r = result {
                    self.transcript.update(r.bestTranscription.formattedString, quiet: Date().timeIntervalSince(self.lastChange))
                    let t = self.transcript.text
                    if t != self.text {
                        self.text = t
                        self.lastChange = Date()
                        self.lastHeard = self.lastChange
                        if converse { emit(["type": "partial", "text": t, "turn": self.turn]) }
                        else { emit(["type": "partial", "text": t]) }
                    }
                    if r.isFinal { self.stretchEnded() }
                } else if error != nil {
                    // After endAudio an error with no result means nothing more was heard.
                    if self.finishing { self.done() }
                    else if manual || converse { self.stretchEnded() }
                    else { fail(error!.localizedDescription) }
                }
            }
        }
    }

    func stretchEnded() {
        if converse && !finishing {
            // The recognizer closes tasks on its own (silence, its time limit). Start another,
            // unless it keeps failing at once (no speech service): then say so and quit.
            let now = Date()
            recentRestarts = recentRestarts.filter { now.timeIntervalSince($0) < 10 } + [now]
            if recentRestarts.count > 20 { fail("Speech recognition keeps stopping. Try again in a moment.") }
            transcript.commit()
            beginStretch()
            return
        }
        if finishing || !manual { done(); return }
        restarts += 1
        guard restarts <= 200 else { finish(); return }
        transcript.commit()
        beginStretch()
    }
    func level(_ buffer: AVAudioPCMBuffer) {
        guard Date().timeIntervalSince(lastLevel) > 0.1, let data = buffer.floatChannelData?[0] else { return }
        lastLevel = Date()
        let n = Int(buffer.frameLength)
        guard n > 0 else { return }
        var sum: Float = 0
        for i in 0..<n { sum += data[i] * data[i] }
        let rms = sqrt(sum / Float(n))
        let value = min(1, max(0, (20 * log10(max(rms, 1e-6)) + 55) / 50))
        emit(["type": "level", "value": (Double(value) * 100).rounded() / 100])
    }

    // Stop listening and let the recognizer settle on its final text.
    func finish() {
        guard !finishing else { return }
        finishing = true
        engine.stop()
        engine.inputNode.removeTap(onBus: 0)
        currentRequest().endAudio()
        DispatchQueue.main.asyncAfter(deadline: .now() + 2.0) { [weak self] in self?.done() }
    }

    func done() {
        emit(["type": "final", "text": text.trimmingCharacters(in: .whitespacesAndNewlines)])
        exit(0)
    }
}


let listener = Listener()

// stdin: "stop" (or EOF) finishes, "cancel" quits without a final.
Thread.detachNewThread {
    while let line = readLine() {
        let cmd = line.trimmingCharacters(in: .whitespaces)
        if cmd == "cancel" { exit(0) }
        if cmd == "stop" { DispatchQueue.main.async { listener.finish() } }
        if cmd == "next" { DispatchQueue.main.async { listener.nextTurn() } }
    }
    DispatchQueue.main.async { listener.finish() }
}

var signalSources: [DispatchSourceSignal] = []
for sig in [SIGINT, SIGTERM] {
    signal(sig, SIG_IGN)
    let src = DispatchSource.makeSignalSource(signal: sig, queue: .main)
    src.setEventHandler { listener.finish() }
    src.resume()
    signalSources.append(src)
}

func authorizeAndStart() {
    SFSpeechRecognizer.requestAuthorization { status in
        DispatchQueue.main.async {
            guard status == .authorized else {
                fail("Roo needs Speech Recognition: System Settings > Privacy & Security > Speech Recognition.")
            }
            AVCaptureDevice.requestAccess(for: .audio) { ok in
                DispatchQueue.main.async {
                    guard ok else { fail("Roo needs the microphone: System Settings > Privacy & Security > Microphone.") }
                    listener.start()
                }
            }
        }
    }
}

authorizeAndStart()
RunLoop.main.run()
