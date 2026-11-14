"""Kokoro voiceover for demo v3 -> /tmp/v3/vo_<name>.wav and vo.json."""
import json, os, sys
import soundfile as sf
from kokoro_onnx import Kokoro
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lines_v3 import LINES

OUT = "/tmp/v3"
os.makedirs(OUT, exist_ok=True)
k = Kokoro(f"{OUT}/kokoro-v1.0.onnx", f"{OUT}/voices-v1.0.bin")
out = []
for name, say, _ in LINES:
    samples, sr = k.create(say, voice="bm_george", speed=0.95, lang="en-gb")
    sf.write(f"{OUT}/vo_{name}.wav", samples, sr)
    out.append({"name": name, "seconds": round(len(samples) / sr, 2)})
json.dump(out, open(f"{OUT}/vo.json", "w"))
print(out, round(sum(o["seconds"] for o in out), 1))
