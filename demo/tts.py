import json, soundfile as sf
from kokoro_onnx import Kokoro
k = Kokoro("kokoro-v1.0.onnx", "voices-v1.0.bin")
LINES = [
 ("intro",  "This is Ee-leh. The Yoruba word for home. A hands-first studio for shaping West African houses, seated, in VR."),
 ("hands",  "In the headset, every action is a pinch. No controllers. On the Meta VR glasses, you simply look, and pinch."),
 ("sculpt", "On the table sits a Yoruba courtyard compound. Pinch a wall and pull, and the rooms grow on a half-metre grid."),
 ("heat",   "Turn on the heat map. It is three in the afternoon in Lagos, and the western rooms are baking."),
 ("sun",    "Drag the sun along its arc, and watch every room respond, from morning to evening."),
 ("elder",  "Need advice? Ask the Elder. An AI architect reads your design, and answers with the old wisdom. Deeper eaves. Moving air. A wider courtyard."),
 ("accept", "His fix appears as a ghost. Nothing changes until your hand accepts it. Then the score climbs."),
 ("inside", "Now pinch a room, and step inside at full scale, to sit in the shade you made."),
 ("compare","Back at the table, compare where you began, with where you are now."),
 ("outro",  "Ee-leh. Built by hand."),
]
out = []
for name, text in LINES:
    samples, sr = k.create(text, voice="bm_george", speed=0.95, lang="en-gb")
    sf.write(f"vo_{name}.wav", samples, sr)
    out.append({"name": name, "seconds": round(len(samples)/sr, 2)})
json.dump(out, open("vo.json", "w"))
print(out, sum(o["seconds"] for o in out))
