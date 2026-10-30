"""Procedural soundtrack for a simulation episode. Everything is synthesized here (no third-party audio).
Music: 100 BPM minor loop (kick, hat, bass, pad, pluck) whose intensity follows the story.
SFX are placed automatically from the episode: countdown ticks + riser, whoosh on scene changes,
jump swoosh + landing impact, chime when a big number appears, soft chord at the ending."""
import wave

import numpy as np

SR = 44100
BPM = 100
BEAT = 60 / BPM


def env(n, a=0.005, r=0.2):
    t = np.arange(n) / SR
    e = np.minimum(1, t / max(a, 1e-4)) * np.exp(-t / max(r, 1e-4))
    return e


def tone(freq, dur, kind="sine", a=0.005, r=0.3):
    n = int(dur * SR); t = np.arange(n) / SR
    ph = 2 * np.pi * freq * t
    w = np.sin(ph) if kind == "sine" else (2 * (t * freq % 1) - 1) if kind == "saw" else np.sign(np.sin(ph))
    return w * env(n, a, r)


def add(buf, sig, t, gain=1.0):
    i = int(t * SR)
    if i >= len(buf) or i < 0:
        return
    j = min(len(buf), i + len(sig))
    buf[i:j] += sig[: j - i] * gain


def noise(dur, seed=0):
    return np.random.default_rng(seed).uniform(-1, 1, int(dur * SR))


def lowpass(x, k=0.08):
    y = np.empty_like(x); acc = 0.0
    for i, v in enumerate(x):
        acc += k * (v - acc); y[i] = acc
    return y


def kick():
    n = int(0.35 * SR); t = np.arange(n) / SR
    f = 50 + 90 * np.exp(-t * 30)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 9)


def hat():
    return np.diff(noise(0.05, 3), prepend=0) * env(int(0.05 * SR), 0.001, 0.015)


def note_hz(semi):  # semitones from A2
    return 110 * 2 ** (semi / 12)


PROG = [(0, [0, 3, 7]), (-4, [-4, 0, 3]), (-7, [-7, -3, 0]), (-2, [-2, 2, 5])]  # Am F C G (in A minor)


def music(dur, level):
    """level(t) -> 0..1 intensity."""
    buf = np.zeros(int(dur * SR))
    bar = 4 * BEAT
    t = 0.0; k = 0
    while t < dur:
        root, chord = PROG[k % 4]
        L = level(t)
        for c in chord:  # pad
            add(buf, tone(note_hz(c + 12), bar, "saw", a=0.4, r=bar * 0.9), t, 0.018 * (0.4 + 0.6 * L))
        for b in range(4):
            tb = t + b * BEAT
            if L > 0.25:
                add(buf, kick(), tb, 0.55 * L)
            if L > 0.45:
                add(buf, hat(), tb + BEAT / 2, 0.25 * L)
            add(buf, tone(note_hz(root - 12), BEAT * 0.9, "sine", 0.005, 0.25), tb, 0.22 * (0.3 + 0.7 * L))
            if L > 0.55:
                for s in range(2):
                    n = chord[(b * 2 + s) % 3] + 24
                    add(buf, tone(note_hz(n), 0.18, "square", 0.002, 0.08), tb + s * BEAT / 2, 0.035 * L)
        t += bar; k += 1
    return buf


def tick():
    return tone(1900, 0.05, "sine", 0.001, 0.015)


def whoosh(dur=0.7, up=True):
    n = noise(dur, 5)
    sweep = np.linspace(0.02, 0.35, len(n)) if up else np.linspace(0.35, 0.02, len(n))
    y = np.empty_like(n); acc = 0.0
    for i, v in enumerate(n):
        acc += sweep[i] * (v - acc); y[i] = acc
    shape = np.sin(np.linspace(0, np.pi, len(n)))
    return y * shape * 2.2


def impact():
    t = np.arange(int(0.9 * SR)) / SR
    boom = np.sin(2 * np.pi * (40 + 40 * np.exp(-t * 12)) * t) * np.exp(-t * 4.5)
    crack = lowpass(noise(0.9, 9), 0.25) * np.exp(-t * 18)
    return boom * 0.9 + crack * 1.2


def chime():
    return tone(1318.5, 1.2, "sine", 0.002, 0.5) * 0.6 + tone(1975.5, 1.2, "sine", 0.002, 0.35) * 0.35


def riser(dur):
    n = int(dur * SR); t = np.arange(n) / SR
    f = 200 + 900 * (t / dur) ** 2
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * (t / dur) ** 1.5 * 0.5 + lowpass(noise(dur, 11), 0.2) * (t / dur) ** 2 * 0.6


def build(spec, path):
    dur = spec["duration"]
    cds = spec.get("countdowns") or ([spec["countdown"]] if spec.get("countdown") else [])
    jumps = [a["t"] for a in spec.get("actions", []) if a["type"] in ("jump", "earth_jump")]
    calm = [(j + 1.2, j + 4.0) for j in jumps]

    def level(t):
        if any(a <= t < b for a, b in calm):
            return 0.15
        for c in cds:
            if c["zero_at"] - 10 <= t < c["zero_at"]:
                return 0.6 + 0.4 * (t - (c["zero_at"] - 10)) / 10
        if spec.get("end") and t >= spec["end"]["t0"]:
            return 0.3
        return 0.5

    buf = music(dur, level) * 0.9
    for c in cds:
        for k in range(10):
            tt = c["zero_at"] - 10 + k
            if tt >= c.get("show_from", 0):
                add(buf, tick(), tt, 0.5 if k < 7 else 0.75)
        add(buf, riser(3.0), c["zero_at"] - 3.0, 0.5)
    for j in jumps:
        add(buf, whoosh(0.5, True), j, 0.35)
        add(buf, impact(), j + 0.85, 0.9)
    for s in spec.get("scenes", [])[1:]:
        add(buf, whoosh(0.7, False), s["t0"] - 0.35, 0.3)
    for b in spec.get("big", []):
        add(buf, chime(), b["t0"], 0.35)
    for c in spec.get("captions", []):
        if c.get("sfx") == "twist":
            add(buf, riser(1.6), c["t0"] - 1.6, 0.35)
            add(buf, chime(), c["t0"], 0.4)
    if spec.get("end"):
        for semi in (0, 3, 7, 12):
            add(buf, tone(note_hz(semi + 12), 3.5, "sine", 0.3, 1.6), spec["end"]["t0"], 0.07)
    peak = np.max(np.abs(buf)) or 1
    buf = np.tanh(buf / peak * 1.4) * 0.85
    pcm = (buf * 32767).astype(np.int16)
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR); w.writeframes(pcm.tobytes())
