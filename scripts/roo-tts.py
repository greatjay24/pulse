#!/usr/bin/env python3
"""Roo's local voice: Kokoro TTS kept warm, speaking sentence by sentence.

Runs as a child of Roo (src-tauri/src/tts.rs embeds this file and starts it with the voice
venv's Python). No network: commands arrive as JSON lines on stdin, events leave as JSON lines
on stdout.

  in:  {"op": "speak", "id": 7, "text": "...", "voice": "british-1"}
       {"op": "begin", "id": 8, "voice": "british-1"}     a reply arriving in pieces:
       {"op": "append", "id": 8, "text": "Morning. Two th"}  each sentence is spoken as soon
       {"op": "end", "id": 8}                               as it's complete; end flushes
       {"op": "stop"}
  out: {"event": "ready"}                       model loaded and warmed up
       {"event": "done", "id": 7}               the last sentence finished
       {"event": "error", "id": 7, "message": "..."}   nothing was spoken; the app falls back

The first sentence plays while the next one is synthesized, so speech starts about a second
after the text arrives. "stop", a new "speak"/"begin", or stdin closing kills the audio and drops the
queue. Audio plays through /usr/bin/afplay from a private temp dir; files are removed as soon
as they've played.

Model files come from ROO_VOICE_DIR (default ~/.local/share/roo-voice):
kokoro-v1.0.onnx and voices-v1.0.bin.

Test by hand:  <venv>/bin/python roo-tts.py --say "Morning. Two things are waiting." [--voice british-2]
"""

import json
import os
import queue
import re
import shutil
import subprocess
import sys
import tempfile
import threading

VOICES = {
    # Roo British 1 (smooth-1) and Roo British 2 (smooth-2)
    "british-1": [("bf_emma", 0.7), ("bf_isabella", 0.3)],
    "british-2": [("bf_emma", 0.6), ("bf_alice", 0.4)],
}
DEFAULT_VOICE = "british-1"
LANG = "en-gb"
SPEED = 1.0
FADE_S = 0.030
MAX_CHARS = 4000
AFPLAY = "/usr/bin/afplay"


def emit(obj):
    sys.stdout.write(json.dumps(obj) + "\n")
    sys.stdout.flush()


def log(msg):
    sys.stderr.write(f"roo-tts: {msg}\n")
    sys.stderr.flush()


def sentences(text, first_max=140, max_len=260, min_len=24):
    """Split text into speakable chunks: sentences, short ones merged into the next, long ones cut
    at a comma or semicolon. The first chunk is kept short so speech starts sooner."""
    text = re.sub(r"\s+", " ", text).strip()
    if not text:
        return []
    parts = [p.strip() for p in re.split(r"(?<=[.!?…])[\"')\]]?\s+(?=[\"'(\[]?[A-Z0-9])", text) if p.strip()]
    out = []
    for p in parts:
        limit = first_max if not out else max_len
        while len(p) > limit:
            cut = max(p.rfind(", ", 0, limit), p.rfind("; ", 0, limit), p.rfind(" - ", 0, limit))
            if cut < min_len:
                cut = p.rfind(" ", 0, limit)
            if cut < min_len:
                break
            out.append(p[: cut + 1].strip())
            p = p[cut + 1 :].strip()
            limit = max_len
        if p:
            out.append(p)
    merged = []
    for p in out:
        if merged and len(merged[-1]) < min_len:
            merged[-1] = merged[-1] + " " + p
        else:
            merged.append(p)
    return merged


# A sentence end with more text after it: everything before it can be spoken now.
BOUNDARY = re.compile(r"[.!?…][\"')\]]?\s+(?=[\"'(\[]?[A-Z0-9])")


def split_ready(buf):
    """(complete text, remainder) for a growing reply: the complete part ends at the last
    sentence boundary that has text after it."""
    last = None
    for m in BOUNDARY.finditer(buf):
        last = m
    if not last:
        return "", buf
    return buf[: last.end()].strip(), buf[last.end() :]


class Speaker:
    def __init__(self, voice_dir):
        import numpy as np
        import soundfile as sf
        from kokoro_onnx import Kokoro

        self.np, self.sf = np, sf
        self.kokoro = Kokoro(os.path.join(voice_dir, "kokoro-v1.0.onnx"), os.path.join(voice_dir, "voices-v1.0.bin"))
        self.styles = {}
        for name, mix in VOICES.items():
            self.styles[name] = sum(self.kokoro.get_voice_style(v) * w for v, w in mix)
        self.tmp = tempfile.mkdtemp(prefix="roo-tts-")
        self.lock = threading.Lock()
        self.gen = 0  # bumped by stop/begin; work from an older generation is dropped
        self.stream = None  # the reply being spoken: {"id", "voice", "buf", "count"}
        self.player = None
        self.jobs = queue.Queue()
        self.clips = queue.Queue()
        threading.Thread(target=self._synth_loop, daemon=True).start()
        threading.Thread(target=self._play_loop, daemon=True).start()
        self._synth("Ready.", DEFAULT_VOICE)  # the first inference is the slow one

    def _synth(self, text, voice):
        np = self.np
        samples, sr = self.kokoro.create(text, voice=self.styles[voice], speed=SPEED, lang=LANG)
        samples = np.asarray(samples, dtype=np.float32)
        n = min(int(sr * FADE_S), len(samples) // 2)
        if n > 0:
            ramp = np.linspace(0.0, 1.0, n, dtype=np.float32)
            samples[:n] *= ramp
            samples[-n:] *= ramp[::-1]
        return samples, sr

    # --- a reply, whole or in pieces: begin, append..., end. speak = all three at once. ---

    def begin(self, sid, voice):
        with self.lock:
            self.gen += 1
            self.stream = {"id": sid, "voice": voice, "buf": "", "count": 0, "gen": self.gen}
            self._kill_player()

    def append(self, sid, text):
        with self.lock:
            st = self.stream
            if not st or st["id"] != sid:
                return
            st["buf"] = (st["buf"] + text)[-MAX_CHARS:]
            ready, st["buf"] = split_ready(st["buf"])
            self._queue(st, ready)

    def end(self, sid):
        with self.lock:
            st = self.stream
            if not st or st["id"] != sid:
                return
            self._queue(st, st["buf"])
            st["buf"] = ""
            self.jobs.put((st["gen"], sid, None, None, None))
            self.stream = None

    def speak(self, sid, text, voice):
        self.begin(sid, voice)
        self.append(sid, text)
        self.end(sid)

    def _queue(self, st, text):  # holds self.lock
        for chunk in sentences(text, first_max=140 if st["count"] == 0 else 260):
            self.jobs.put((st["gen"], st["id"], chunk, st["voice"], st["count"]))
            st["count"] += 1

    def stop(self):
        with self.lock:
            self.gen += 1
            self.stream = None
            self._kill_player()

    def _current(self, gen):
        with self.lock:
            return gen == self.gen

    def _kill_player(self):
        p = self.player
        if p and p.poll() is None:
            p.kill()

    def _synth_loop(self):
        failed = set()  # generations whose first sentence couldn't be synthesized
        while True:
            gen, sid, chunk, voice, i = self.jobs.get()
            if chunk is None:  # end of the reply
                if gen in failed:
                    failed.discard(gen)
                else:
                    self.clips.put((gen, sid, None, "done", None))
                continue
            if gen in failed or not self._current(gen):
                continue
            try:
                samples, sr = self._synth(chunk, voice)
            except Exception as e:  # noqa: BLE001 - report and let the app fall back
                log(f"synthesis failed: {e}")
                if i == 0:
                    failed.add(gen)
                    self.clips.put((gen, sid, None, "error", str(e)[:200]))
                continue
            path = os.path.join(self.tmp, f"{gen}-{i}.wav")
            self.sf.write(path, samples, sr)
            self.clips.put((gen, sid, path, None, None))

    def _play_loop(self):
        while True:
            gen, sid, path, event, message = self.clips.get()
            if path is None:
                if event == "error":
                    emit({"event": "error", "id": sid, "message": message})
                else:
                    emit({"event": "done", "id": sid})
                continue
            try:
                with self.lock:
                    current = gen == self.gen
                    if current:
                        self.player = subprocess.Popen([AFPLAY, path], stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                if current:
                    self.player.wait()
            finally:
                try:
                    os.remove(path)
                except OSError:
                    pass

    def close(self):
        self.stop()
        shutil.rmtree(self.tmp, ignore_errors=True)


def voice_dir():
    return os.path.expanduser(os.environ.get("ROO_VOICE_DIR") or "~/.local/share/roo-voice")


def serve():
    try:
        speaker = Speaker(voice_dir())
    except Exception as e:  # noqa: BLE001 - missing model or packages: the app falls back to `say`
        emit({"event": "failed", "message": str(e)[:200]})
        return 1
    emit({"event": "ready"})
    try:
        for line in sys.stdin:
            try:
                msg = json.loads(line)
            except ValueError:
                continue
            op = msg.get("op")
            sid = msg.get("id")
            text = str(msg.get("text") or "").replace("\0", "")[:MAX_CHARS]
            voice = msg.get("voice") if msg.get("voice") in VOICES else DEFAULT_VOICE
            if op == "stop":
                speaker.stop()
            elif op == "speak":
                speaker.speak(sid, text, voice)
            elif op == "begin":
                speaker.begin(sid, voice)
            elif op == "append":
                speaker.append(sid, text)
            elif op == "end":
                speaker.end(sid)
    finally:
        speaker.close()
    return 0


def say_once(text, voice):
    """--say: speak one text and exit (for trying a voice from the terminal)."""
    import time

    t = time.time()
    speaker = Speaker(voice_dir())
    log(f"model ready in {time.time() - t:.1f}s")
    done = threading.Event()
    real_emit = globals()["emit"]
    globals()["emit"] = lambda obj: (obj.get("event") in ("done", "error")) and done.set()
    t = time.time()
    speaker.speak(1, text, voice if voice in VOICES else DEFAULT_VOICE)
    done.wait()
    globals()["emit"] = real_emit
    log(f"spoken in {time.time() - t:.1f}s")
    speaker.close()
    return 0


if __name__ == "__main__":
    args = sys.argv[1:]
    if args[:1] == ["--say"] and len(args) >= 2:
        v = args[args.index("--voice") + 1] if "--voice" in args[:-1] else DEFAULT_VOICE
        sys.exit(say_once(args[1], v))
    if args[:1] == ["--split"]:  # for tests: print the chunks
        print(json.dumps(sentences(sys.stdin.read())))
        sys.exit(0)
    if args[:1] == ["--ready"]:  # for tests: complete part and remainder of a growing reply
        print(json.dumps(split_ready(sys.stdin.read())))
        sys.exit(0)
    sys.exit(serve())
