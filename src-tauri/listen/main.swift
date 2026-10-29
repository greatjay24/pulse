// pulse-listen: on-device speech to text for Pulse's listening panel.
//
// Uses macOS's Speech framework with requiresOnDeviceRecognition, so audio never leaves the
// Mac and nothing is paid for. Pulse starts it, reads one JSON object per line on stdout:
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
// Usage: pulse-listen [--locale en-US] [--pause 1.6] [--max 60]
//
// The usage strings the permission prompts show are embedded in this binary's __info_plist
// (see scripts/build-listen.sh) and repeated in Pulse's own Info.plist.

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

func option(_ name: String, _ fallback: String) -> String {
    let args = CommandLine.arguments
    if let i = args.firstIndex(of: name), i + 1 < args.count { return args[i + 1] }
    return fallback
}

let localeID = option("--locale", Locale.current.identifier)
let pauseSecs = max(0.6, Double(option("--pause", "1.6")) ?? 1.6)
let maxSecs = max(5.0, Double(option("--max", "60")) ?? 60)

final class Listener {
    let engine = AVAudioEngine()
    let request = SFSpeechAudioBufferRecognitionRequest()
    var task: SFSpeechRecognitionTask?
    var recognizer: SFSpeechRecognizer?
    var text = ""
    var lastChange = Date()
    let started = Date()
    var finishing = false
    var lastLevel = Date.distantPast

    func start() {
        guard let rec = SFSpeechRecognizer(locale: Locale(identifier: localeID)) ?? SFSpeechRecognizer() else {
            fail("Speech recognition isn't available for \(localeID).")
        }
        guard rec.supportsOnDeviceRecognition else {
            fail("On-device speech isn't installed for \(rec.locale.identifier). Turn on Dictation in System Settings > Keyboard once so macOS downloads it.")
        }
        guard rec.isAvailable else { fail("Speech recognition is unavailable right now.") }
        recognizer = rec
        request.requiresOnDeviceRecognition = true
        request.shouldReportPartialResults = true
        if #available(macOS 13, *) { request.addsPunctuation = true }

        let input = engine.inputNode
        let format = input.outputFormat(forBus: 0)
        guard format.sampleRate > 0 else { fail("No microphone found.") }
        input.installTap(onBus: 0, bufferSize: 1024, format: format) { [weak self] buffer, _ in
            guard let self = self else { return }
            self.request.append(buffer)
            self.level(buffer)
        }
        engine.prepare()
        do { try engine.start() } catch { fail("Couldn't start the microphone: \(error.localizedDescription)") }

        task = rec.recognitionTask(with: request) { [weak self] result, error in
            guard let self = self else { return }
            DispatchQueue.main.async {
                if let r = result {
                    let t = r.bestTranscription.formattedString
                    if t != self.text {
                        self.text = t
                        self.lastChange = Date()
                        emit(["type": "partial", "text": t])
                    }
                    if r.isFinal { self.done() }
                } else if let e = error {
                    // After endAudio an error with no result means nothing was heard.
                    if self.finishing { self.done() } else { fail(e.localizedDescription) }
                }
            }
        }
        emit(["type": "ready"])

        Timer.scheduledTimer(withTimeInterval: 0.15, repeats: true) { [weak self] _ in
            guard let self = self, !self.finishing else { return }
            let quiet = Date().timeIntervalSince(self.lastChange)
            if (!self.text.isEmpty && quiet >= pauseSecs) || Date().timeIntervalSince(self.started) >= maxSecs {
                self.finish()
            }
        }
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
        request.endAudio()
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
                fail("Pulse needs Speech Recognition: System Settings > Privacy & Security > Speech Recognition.")
            }
            AVCaptureDevice.requestAccess(for: .audio) { ok in
                DispatchQueue.main.async {
                    guard ok else { fail("Pulse needs the microphone: System Settings > Privacy & Security > Microphone.") }
                    listener.start()
                }
            }
        }
    }
}

authorizeAndStart()
RunLoop.main.run()
