"""Kokoro voiceover for the v2 demo -> $OUT/vo_<name>.wav and vo.json."""
import json, os, sys
import soundfile as sf
from kokoro_onnx import Kokoro
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lines_v4 import LINES

OUT = os.environ.get("OUT", "/tmp/v4")
MODELS = os.environ.get("MODELS", OUT)
os.makedirs(OUT, exist_ok=True)
k = Kokoro(f"{MODELS}/kokoro-v1.0.onnx", f"{MODELS}/voices-v1.0.bin")
out = []
for name, voice, say, _ in LINES:
    samples, sr = k.create(say, voice=voice, speed=0.97 if voice != "bm_lewis" else 0.92, lang="en-gb")
    sf.write(f"{OUT}/vo_{name}.wav", samples, sr)
    out.append({"name": name, "seconds": round(len(samples) / sr, 2)})
json.dump(out, open(f"{OUT}/vo.json", "w"))
print(round(sum(o["seconds"] for o in out), 1), "s of narration")
