"""Assemble the Ilé demo: frames + Kokoro voiceover + subtitles -> MP4."""
import json
import subprocess
import textwrap

OUT = "/tmp/demo"
FPS = 20
FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"

SUBS = {
    "intro": "This is Ilé. The Yoruba word for home. A hands-first studio for shaping West African houses, seated, in VR.",
    "hands": "In the headset, every action is a pinch. No controllers. On the Meta VR Glasses, you simply look, and pinch.",
    "sculpt": "On the table sits a Yoruba courtyard compound. Pinch a wall and pull, and the rooms grow on a half-metre grid.",
    "heat": "Turn on the heat map. It is three in the afternoon in Lagos, and the western rooms are baking.",
    "sun": "Drag the sun along its arc, and watch every room respond, from morning to evening.",
    "elder": "Need advice? Ask the Elder. An AI architect reads your design, and answers with the old wisdom. Deeper eaves. Moving air. A wider courtyard.",
    "accept": "His fix appears as a ghost. Nothing changes until your hand accepts it. Then the score climbs.",
    "inside": "Now pinch a room, and step inside at full scale, to sit in the shade you made.",
    "compare": "Back at the table, compare where you began, with where you are now.",
    "outro": "Ilé. Built by hand.",
}

marks = json.load(open(f"{OUT}/marks.json"))
vo = {v["name"]: v["seconds"] for v in json.load(open(f"{OUT}/vo.json"))}
start = {m["name"]: m["start"] for m in marks}
total = start["end"]

inputs = ["-framerate", str(FPS), "-i", f"{OUT}/frames/f%05d.jpg"]
# Cutaway stills from the Meta VR Glasses emulator (hand tracking, gaze + pinch).
stills = [f"{OUT}/still_hands.png", f"{OUT}/still_menu.png"]
for s in stills:
    inputs += ["-loop", "1", "-t", str(total), "-i", s]
names = [n for n in SUBS]
for n in names:
    inputs += ["-i", f"{OUT}/vo_{n}.wav"]

filters = []
# Stills: crop away the emulator's black field-of-view mask, fit to 720p.
h0 = start["hands"]
h1 = start["sculpt"]
mid = (h0 + h1) / 2
for i, (a, b) in enumerate([(h0, mid), (mid, h1)]):
    filters.append(
        f"[{i + 1}:v]crop=602:560:99:213,scale=-2:720,"
        f"pad=1280:720:(ow-iw)/2:0:color=0x1b120b,setsar=1[st{i}]"
    )
chain = "[0:v]setsar=1[v0]"
filters.append(chain)
last = "v0"
for i, (a, b) in enumerate([(h0, mid), (mid, h1)]):
    filters.append(f"[{last}][st{i}]overlay=enable='between(t,{a:.2f},{b:.2f})'[vs{i}]")
    last = f"vs{i}"

# Caption on the cutaway, then subtitles.
def text(label_in, label_out, body, t0, t1, y, size=30):
    path = f"{OUT}/txt_{label_out}.txt"
    open(path, "w", encoding="utf-8").write(body)
    filters.append(
        f"[{label_in}]drawtext=fontfile={FONT}:textfile={path}:fontsize={size}:fontcolor=white:"
        f"box=1:boxcolor=black@0.6:boxborderw=12:x=(w-text_w)/2:y={y}:"
        f"enable='between(t,{t0:.2f},{t1:.2f})'[{label_out}]"
    )
    return label_out

last = text(last, "cap", "Meta VR Glasses emulator  ·  hands only, gaze + pinch", h0, h1, 28, 24)
n = 0
for name in names:
    lines = textwrap.wrap(SUBS[name], 62)
    t0 = start[name] + 0.15
    t1 = start[name] + vo[name] + 0.35
    for j, line in enumerate(lines):
        y = 720 - 46 - (len(lines) - j) * 44
        last = text(last, f"s{n}", line, t0, t1, y)
        n += 1

# Audio: place each line at its slot start.
audio_in = 1 + len(stills)
mix = []
for i, name in enumerate(names):
    ms = int((start[name] + 0.2) * 1000)
    filters.append(f"[{audio_in + i}:a]aresample=48000,adelay={ms}:all=1[a{i}]")
    mix.append(f"[a{i}]")
filters.append(f"{''.join(mix)}amix=inputs={len(names)}:normalize=0:duration=longest,apad[aout]")

cmd = [
    "ffmpeg", "-y", "-loglevel", "error", *inputs,
    "-filter_complex", ";".join(filters),
    "-map", f"[{last}]", "-map", "[aout]",
    "-t", f"{total:.2f}", "-r", str(FPS),
    "-c:v", "libx264", "-preset", "slow", "-crf", "20", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart",
    f"{OUT}/ile-demo.mp4",
]
subprocess.run(cmd, check=True)
print("built", f"{total:.1f}s")
