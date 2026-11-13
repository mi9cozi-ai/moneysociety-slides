"""Procedural background music with moods. Everything is synthesized here (no third-party audio).

spec["music"] = {"mood": <one of MOODS>, "seed": optional int}
The same mood still varies by seed: key, progression, tempo (± a few BPM), instruments and patterns.
level(t) -> 0..1 is the story intensity (countdowns build up, the ending calms down).
"""
import numpy as np

SR = 44100

# name: tempo, scale ("major"/"minor"), progressions (scale degrees, 0-based), instruments, drum pattern, swing
MOODS = {
    "wonder":     dict(bpm=(88, 96),   scale="major", progs=[[0, 4, 5, 3], [0, 5, 3, 4], [3, 0, 4, 5]], lead="bell",  pad="soft",    bass="sub",   drums="light",   swing=0.0),
    "playful":    dict(bpm=(112, 124), scale="major", progs=[[0, 3, 4, 0], [0, 5, 3, 4], [0, 4, 5, 3]], lead="marimba", pad="none",  bass="pluck", drums="bouncy",  swing=0.12),
    "tense":      dict(bpm=(78, 86),   scale="minor", progs=[[0, 5, 0, 6], [0, 1, 0, 5], [0, 3, 5, 4]], lead="piano", pad="drone",   bass="pulse", drums="taiko",   swing=0.0),
    "epic":       dict(bpm=(68, 76),   scale="minor", progs=[[0, 5, 2, 6], [0, 3, 5, 4], [5, 6, 0, 0]], lead="brass", pad="strings", bass="sub",   drums="toms",    swing=0.0),
    "melancholy": dict(bpm=(66, 74),   scale="minor", progs=[[0, 5, 2, 6], [5, 3, 0, 4], [0, 3, 6, 2]], lead="piano", pad="soft",    bass="sub",   drums="none",    swing=0.0),
    "lofi":       dict(bpm=(80, 88),   scale="minor", progs=[[1, 4, 0, 5], [3, 4, 2, 5], [0, 5, 3, 4]], lead="keys",  pad="soft",    bass="sub",   drums="lofi",    swing=0.18),
    "driving":    dict(bpm=(122, 130), scale="minor", progs=[[0, 5, 2, 6], [0, 6, 5, 6], [0, 3, 4, 4]], lead="pluck", pad="strings", bass="eighth", drums="four",   swing=0.0),
}
SCALES = {"major": [0, 2, 4, 5, 7, 9, 11], "minor": [0, 2, 3, 5, 7, 8, 10]}


def _t(n):
    return np.arange(n) / SR


def adsr(n, a=0.005, d=0.1, s=0.6, r=0.2):
    t = _t(n); dur = n / SR
    e = np.where(t < a, t / max(a, 1e-4), s + (1 - s) * np.exp(-(t - a) / max(d, 1e-4)))
    rel = np.clip((dur - t) / max(r, 1e-4), 0, 1)
    return e * rel


def hz(midi):
    return 440.0 * 2 ** ((midi - 69) / 12)


# ---------- instruments ----------
def piano(f, dur):
    n = int(dur * SR); t = _t(n)
    w = sum(np.sin(2 * np.pi * f * k * t + k) * np.exp(-t * (1.6 + k * 1.1)) / k ** 1.2 for k in range(1, 7))
    return w * np.minimum(1, t / 0.003) * 0.6


def keys(f, dur):  # electric-piano-ish with tremolo
    n = int(dur * SR); t = _t(n)
    w = np.sin(2 * np.pi * f * t + 0.8 * np.sin(2 * np.pi * f * 2 * t) * np.exp(-t * 3)) * np.exp(-t * 1.4)
    return w * (1 + 0.15 * np.sin(2 * np.pi * 4.5 * t)) * np.minimum(1, t / 0.004) * 0.6


def bell(f, dur):
    n = int(dur * SR); t = _t(n)
    return np.sin(2 * np.pi * f * t + 2.2 * np.exp(-t * 2.5) * np.sin(2 * np.pi * f * 3.5 * t)) * np.exp(-t * 2.2) * 0.5


def marimba(f, dur):
    n = int(dur * SR); t = _t(n)
    return (np.sin(2 * np.pi * f * t) + 0.3 * np.sin(2 * np.pi * f * 4 * t) * np.exp(-t * 30)) * np.exp(-t * 9) * 0.7


def pluck(f, dur):
    n = int(dur * SR); t = _t(n)
    w = sum(np.sin(2 * np.pi * f * k * t) * np.exp(-t * (6 + 5 * k)) / k for k in range(1, 6))
    return w * 0.7


def brass(f, dur):
    n = int(dur * SR); t = _t(n)
    br = np.clip(t / 0.08, 0, 1)
    w = sum(np.sin(2 * np.pi * f * k * t) * (br ** (k * 0.5)) / k for k in range(1, 8))
    return w * adsr(n, 0.06, 0.4, 0.7, 0.25) * 0.35


def saw_stack(f, dur, detune=(0.995, 1.0, 1.005)):
    n = int(dur * SR); t = _t(n)
    return sum(2 * ((t * f * d + i * 0.33) % 1) - 1 for i, d in enumerate(detune)) / len(detune)


LEADS = {"piano": piano, "keys": keys, "bell": bell, "marimba": marimba, "pluck": pluck, "brass": brass}


# ---------- drums ----------
def kick(n=0.4, pitch=1.0):
    t = _t(int(n * SR)); f = (45 + 100 * np.exp(-t * 32)) * pitch
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 8)


def noise(dur, seed):
    return np.random.default_rng(seed).uniform(-1, 1, int(dur * SR))


def hat(seed=1, open_=False):
    d = 0.18 if open_ else 0.05
    return np.diff(noise(d, seed), prepend=0) * np.exp(-_t(int(d * SR)) * (18 if open_ else 70)) * 0.8


def snare(seed=2):
    t = _t(int(0.25 * SR))
    return (noise(0.25, seed) * np.exp(-t * 18) * 0.8 + np.sin(2 * np.pi * 190 * t) * np.exp(-t * 25) * 0.5)


def clap(seed=4):
    t = _t(int(0.2 * SR)); e = np.exp(-t * 30) + 0.6 * np.exp(-np.maximum(0, t - 0.012) * 30) * (t > 0.012)
    return np.diff(noise(0.2, seed), prepend=0) * e


def tom(f=90):
    t = _t(int(0.7 * SR))
    return np.sin(2 * np.pi * np.cumsum(f * (1 + 0.6 * np.exp(-t * 14))) / SR) * np.exp(-t * 5)


def taiko():
    t = _t(int(1.0 * SR))
    return np.sin(2 * np.pi * np.cumsum(60 * (1 + 0.8 * np.exp(-t * 20))) / SR) * np.exp(-t * 4.5) + noise(1.0, 8) * np.exp(-t * 40) * 0.3


# ---------- dsp ----------
def add(buf, sig, t, gain=1.0):
    i = int(t * SR)
    if i >= len(buf) or i < 0:
        return
    j = min(len(buf), i + len(sig))
    buf[i:j] += sig[: j - i] * gain


def fft_filter(x, lo=None, hi=None):
    X = np.fft.rfft(x); f = np.fft.rfftfreq(len(x), 1 / SR); g = np.ones_like(f)
    if hi: g *= 1 / np.sqrt(1 + (f / hi) ** 4)
    if lo: g *= 1 / np.sqrt(1 + (lo / np.maximum(f, 1)) ** 4)
    return np.fft.irfft(X * g, len(x))


def reverb(x, seconds=2.2, seed=0):
    n = int(seconds * SR); t = _t(n)
    ir = noise(seconds, seed) * np.exp(-t * 6.9 / seconds); ir[0] = 0
    ir = fft_filter(ir, hi=6000)
    L = len(x) + n; N = 1 << (L - 1).bit_length()
    y = np.fft.irfft(np.fft.rfft(x, N) * np.fft.rfft(ir, N), N)[: len(x)]
    return y / (np.max(np.abs(ir)) * np.sqrt(n) / 40 + 1e-9)


def render(spec, dur, level):
    m = spec.get("music") or {}
    mood = m.get("mood") or default_mood(spec)
    P = MOODS.get(mood, MOODS["wonder"])
    seed = int(m.get("seed", spec.get("seed", 7) * 131 + sum(map(ord, spec.get("id", "x")))))
    rng = np.random.default_rng(seed)
    bpm = rng.integers(P["bpm"][0], P["bpm"][1] + 1); beat = 60 / bpm; bar = 4 * beat
    key = 45 + int(rng.integers(0, 12))  # A2.. G#3 as the root
    sc = SCALES[P["scale"]]; prog = P["progs"][int(rng.integers(0, len(P["progs"])))]
    lead = LEADS[P["lead"]]; n = int(dur * SR) + SR
    stems = {k: np.zeros(n) for k in ("pad", "lead", "bass", "drums")}
    deg = lambda d, octv=0: key + 12 * octv + sc[d % 7] + 12 * (d // 7)
    chord = lambda d: [deg(d), deg(d + 2), deg(d + 4)]
    motif = [int(x) for x in rng.choice([0, 1, 2, 2, 4, 4, 5, 7], size=8)]  # one melody idea per episode, reused
    RH = [[0, 1, 2, 3], [0, 1.5, 2, 3], [0, 0.5, 1.5, 2.5, 3], [0, 2, 2.5, 3.5]]; rhythm = RH[int(rng.integers(0, len(RH)))]
    t = 0.0; k = 0
    while t < dur:
        d = prog[k % len(prog)]; L = level(t); ch = chord(d)
        # pad
        if P["pad"] != "none":
            for c in ch:
                if P["pad"] == "strings": s = saw_stack(hz(c + 12), bar + 0.4) * adsr(int((bar + 0.4) * SR), 0.5, 1, 0.8, 0.6) * 0.5
                elif P["pad"] == "drone": s = saw_stack(hz(c), bar + 0.4, (0.997, 1.003)) * adsr(int((bar + 0.4) * SR), 0.8, 1, 0.9, 0.6) * 0.4
                else: s = np.sin(2 * np.pi * hz(c + 12) * _t(int((bar + 0.4) * SR))) * adsr(int((bar + 0.4) * SR), 0.6, 1, 0.85, 0.7) * 0.6
                add(stems["pad"], s, t, 0.12 * (0.5 + 0.5 * L))
        # bass
        root = hz(deg(d, -1))
        for b in range(4):
            tb = t + b * beat
            if P["bass"] == "sub" and b in (0, 2): add(stems["bass"], np.sin(2 * np.pi * root * _t(int(beat * 1.9 * SR))) * adsr(int(beat * 1.9 * SR), 0.01, 0.6, 0.6, 0.15), tb, 0.35 * (0.4 + 0.6 * L))
            if P["bass"] == "pulse": [add(stems["bass"], saw_stack(root, beat / 2 * 0.9, (1.0,)) * adsr(int(beat / 2 * 0.9 * SR), 0.005, 0.1, 0.3, 0.05), tb + h * beat / 2, 0.22 * L) for h in range(2)]
            if P["bass"] == "eighth": [add(stems["bass"], saw_stack(root, beat / 2 * 0.8) * adsr(int(beat / 2 * 0.8 * SR), 0.003, 0.08, 0.4, 0.04), tb + h * beat / 2, 0.25 * (0.3 + 0.7 * L)) for h in range(2)]
            if P["bass"] == "pluck" and b in (0, 1, 3): add(stems["bass"], pluck(root, beat), tb, 0.45)
        # lead: the motif over the chord, denser when the story is intense
        if L > 0.3 or P["lead"] in ("piano", "keys"):
            for i, pos in enumerate(rhythm):
                if L < 0.5 and i % 2: continue
                note = deg(d + motif[(k * 3 + i) % len(motif)], 1)
                sw = P["swing"] * beat if (pos * 2) % 2 == 1 else 0
                add(stems["lead"], lead(hz(note), beat * 1.6), t + pos * beat + sw, 0.16 * (0.6 + 0.4 * L))
        # drums
        dr = P["drums"]
        for b in range(4):
            tb = t + b * beat
            if dr == "four" and L > 0.2:
                add(stems["drums"], kick(), tb, 0.6 * L); add(stems["drums"], hat(b), tb + beat / 2, 0.25 * L)
                if b % 2: add(stems["drums"], clap(b), tb, 0.3 * L)
            if dr == "light" and L > 0.35:
                if b == 0: add(stems["drums"], kick(), tb, 0.45 * L)
                add(stems["drums"], hat(b), tb + beat / 2, 0.12 * L)
            if dr == "bouncy" and L > 0.2:
                if b in (0, 2): add(stems["drums"], kick(0.3, 1.2), tb, 0.5)
                if b in (1, 3): add(stems["drums"], clap(b), tb, 0.3)
                add(stems["drums"], hat(b), tb + beat / 2 + P["swing"] * beat, 0.18)
            if dr == "lofi" and L > 0.15:
                if b in (0, 2): add(stems["drums"], kick(0.35, 0.9), tb + (0.5 * beat if b == 2 and k % 2 else 0), 0.5)
                if b in (1, 3): add(stems["drums"], snare(b), tb, 0.22)
                for h in range(2): add(stems["drums"], hat(b * 2 + h), tb + h * beat / 2 + (P["swing"] * beat if h else 0), 0.1)
            if dr == "taiko" and L > 0.3 and b in (0, 3 if L > 0.7 else 0): add(stems["drums"], taiko(), tb, 0.55 * L)
            if dr == "toms" and L > 0.35:
                if b == 0: add(stems["drums"], tom(70), tb, 0.6 * L)
                if L > 0.65 and b in (2, 3): add(stems["drums"], tom(95 if b == 2 else 120), tb, 0.4 * L)
        t += bar; k += 1
    if P["drums"] == "lofi": stems["drums"] += fft_filter(noise(len(stems["drums"]) / SR, 99), lo=800, hi=3000)[: n] * 0.015  # vinyl hiss
    if P["pad"] in ("strings", "drone"): stems["pad"] = fft_filter(stems["pad"], hi=1800 if P["pad"] == "strings" else 700)
    stems["bass"] = fft_filter(stems["bass"], hi=900)
    if P["drums"] == "lofi": stems["lead"] = fft_filter(stems["lead"], hi=3500)
    dry = stems["pad"] + stems["lead"] + stems["bass"] + stems["drums"]
    wet_src = stems["pad"] + stems["lead"] * 1.2 + stems["drums"] * 0.3
    rv = 3.0 if mood in ("epic", "melancholy", "tense") else 1.8
    left = dry + reverb(wet_src, rv, 1) * 0.35; right = dry + reverb(wet_src, rv, 2) * 0.35
    out = np.stack([left, right], 1)[: int(dur * SR)]
    return out, mood


def default_mood(spec):
    sc = {s.get("scene") for s in spec.get("scenes", [])}
    if "street" in sc and spec.get("time_of_day", "night") != "day": return "lofi"
    if "fuji" in sc or "earth" in sc: return "epic"
    if "station" in sc: return "driving"
    return "wonder"
