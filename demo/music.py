"""Original soundtrack for demo v3: a West African-style iron bell (agogo)
pattern over a low gong, synthesised here from sine partials — no samples,
no recordings. It plays in the gaps and ducks under the narration."""
import json
import numpy as np
import soundfile as sf

import os
OUT = os.environ.get("OUT", "/tmp/v3")
SR = 44100
marks = json.load(open(f"{OUT}/marks.json"))
vo = {v["name"]: v["seconds"] for v in json.load(open(f"{OUT}/vo.json"))}
stop = [m["start"] for m in marks if m["name"] in ("stop", "end")]
total = max(stop)
n = int(total * SR)
mix = np.zeros(n)
rng = np.random.default_rng(7)


def strike(freq, partials, decay, length, gain):
    t = np.arange(int(length * SR)) / SR
    y = np.zeros_like(t)
    for ratio, amp, d in partials:
        y += amp * np.sin(2 * np.pi * freq * ratio * t + rng.uniform(0, 6.28)) * np.exp(-t / (decay * d))
    attack = np.minimum(1, t / 0.002)
    return gain * y * attack


def put(sound, at):
    i = int(at * SR)
    if i < 0:  # a hit nudged just before the start: drop the part before 0
        sound = sound[-i:]
        i = 0
    if i >= n or len(sound) == 0:
        return
    j = min(n, i + len(sound))
    mix[i:j] += sound[: j - i]


BELL = [(1.0, 1.0, 1.0), (2.76, 0.55, 0.6), (5.4, 0.3, 0.35), (8.9, 0.14, 0.2)]
GONG = [(1.0, 1.0, 1.0), (1.48, 0.7, 0.9), (2.09, 0.5, 0.7), (2.87, 0.35, 0.5), (3.7, 0.22, 0.35), (5.2, 0.12, 0.2)]
high = strike(622, BELL, 0.22, 0.9, 0.16)
low = strike(466, BELL, 0.26, 1.0, 0.18)

# The 12/8 "standard" bell pattern: strokes on these eighth-notes of the bar.
eighth = (60 / 104) / 1.5
PATTERN = [(0, low), (2, high), (4, high), (5, low), (7, high), (9, high), (11, low)]
bar = eighth * 12
t = 0.0
k = 0
while t < total:
    for pos, sound in PATTERN:
        # A little human looseness in time and loudness.
        put(sound * rng.uniform(0.8, 1.0), t + pos * eighth + rng.uniform(-0.006, 0.006))
    # Soft shaker on the off-beats.
    for pos in (1.5, 4.5, 7.5, 10.5):
        burst = rng.normal(0, 1, int(0.05 * SR)) * np.exp(-np.arange(int(0.05 * SR)) / (0.012 * SR)) * 0.035
        put(burst, t + pos * eighth)
    t += bar
    k += 1

# A warm bassline under the bells: a short riff that repeats every bar.
def bass(freq, length, gain):
    t = np.arange(int(length * SR)) / SR
    y = np.sin(2 * np.pi * freq * t) + 0.35 * np.sin(4 * np.pi * freq * t)
    return gain * y * np.exp(-t / 0.28) * np.minimum(1, t / 0.01)

RIFF = [(0, 55.0), (3, 55.0), (6, 65.4), (8, 73.4), (10, 65.4)]
t = 0.0
while t < total:
    for pos, f in RIFF:
        put(bass(f, 0.6, 0.22), t + pos * eighth)
    t += bar

# A low gong marks each new chapter.
for m in marks:
    if m["name"].startswith("cap:") or m["name"] in ("end", "stop"):
        continue
    put(strike(98, GONG, 3.2, 7.0, 0.3), m["start"])
put(strike(73.4, GONG, 4.5, 9.0, 0.38), next(m["start"] for m in marks if m["name"] == "end"))

# Duck under the narration; full in the silences.
gain = np.ones(n)
for m in marks:
    if m["name"] in vo:
        a = int((m["start"] + 0.05) * SR)
        b = min(n, int((m["start"] + vo[m["name"]] + 0.45) * SR))
        gain[a:b] = 0.2
ramp = int(0.35 * SR)
gain = np.convolve(gain, np.ones(ramp) / ramp, mode="same")
mix *= gain
fade = int(1.5 * SR)
mix[:fade] *= np.linspace(0, 1, fade)
mix[-fade:] *= np.linspace(1, 0, fade)
mix = np.tanh(mix * 1.4) / 1.4
sf.write(f"{OUT}/music.wav", mix.astype(np.float32), SR)
print("music", round(total, 1), "s", "peak", round(float(np.abs(mix).max()), 2))
