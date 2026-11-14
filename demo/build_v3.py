"""Assemble demo v3: frames + Kokoro narration + soundtrack + subtitles."""
import json, os, subprocess, sys, textwrap
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lines_v3 import LINES

OUT = "/tmp/v3"
FPS = int(os.environ.get("ILE_FPS", "30"))
FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
marks = json.load(open(f"{OUT}/marks.json"))
vo = {v["name"]: v["seconds"] for v in json.load(open(f"{OUT}/vo.json"))}
start = {}
for m in marks:
    start.setdefault(m["name"], m["start"])  # first mark of a name is the section start
total = max(m["start"] for m in marks if m["name"] in ("stop", "end"))
names = [n for n, _, _ in LINES if n in start]
subs = {n: (sub or say) for n, say, sub in LINES}

inputs = ["-framerate", str(FPS), "-i", f"{OUT}/frames/f%05d.jpg", "-i", f"{OUT}/music.wav"]
for n in names:
    inputs += ["-i", f"{OUT}/vo_{n}.wav"]

fade_at = max(0.0, total - 1.2)
filters = [f"[0:v]setsar=1,fade=t=out:st={fade_at:.2f}:d=1.2[v0]"]
last = "v0"
count = 0


def text(body, t0, t1, y, size=30, color="white", box=0.6):
    global last, count
    path = f"{OUT}/txt_{count}.txt"
    open(path, "w", encoding="utf-8").write(body)
    out = f"t{count}"
    filters.append(
        f"[{last}]drawtext=fontfile={FONT}:textfile={path}:fontsize={size}:fontcolor={color}:"
        f"box=1:boxcolor=black@{box}:boxborderw=12:x=(w-text_w)/2:y={y}:"
        f"enable='between(t,{t0:.2f},{t1:.2f})'[{out}]"
    )
    last = out
    count += 1


# Opening credit, chapter captions, end card.
text("Captured in Meta VR Glasses emulator  ·  hands only, no controllers", 0.2, min(6.5, start.get("rooms", 6.5)), 26, 24)
for m in marks:
    if m["name"].startswith("cap:"):
        text(m["name"][4:], m["start"] + 0.1, m["start"] + 3.2, 300, 52, "0xf2b23e", 0.65)
if "end" in start:
    text("Ilé", start["end"] + 0.1, total, 250, 96, "0xf2b23e", 0.5)
    text("Built by hand.", start["end"] + 0.4, total, 380, 44, "white", 0.5)
# Subtitles.
for name in names:
    lines = textwrap.wrap(subs[name], 64)
    # Long lines are shown two rows at a time, in step with the voice.
    pages = [lines[i : i + 2] for i in range(0, len(lines), 2)]
    chars = [sum(len(l) for l in p) for p in pages]
    t = start[name] + 0.15
    for page, c in zip(pages, chars):
        dur = (vo[name] + 0.3) * c / max(1, sum(chars))
        for j, line in enumerate(page):
            text(line, t, t + dur, 720 - 46 - (len(page) - j) * 44)
        t += dur

audio = []
for i, name in enumerate(names):
    ms = int((start[name] + 0.2) * 1000)
    filters.append(f"[{i + 2}:a]aresample=48000,adelay={ms}:all=1,volume=1.5[a{i}]")
    audio.append(f"[a{i}]")
filters.append("[1:a]aresample=48000,volume=0.9[mus]")
filters.append(f"{''.join(audio)}[mus]amix=inputs={len(names) + 1}:normalize=0:duration=longest,alimiter=limit=0.95,apad[aout]")

cmd = [
    "ffmpeg", "-y", "-loglevel", "error", *inputs,
    "-filter_complex", ";".join(filters),
    "-map", f"[{last}]", "-map", "[aout]",
    "-t", f"{total:.2f}", "-r", str(FPS),
    "-c:v", "libx264", "-preset", "slow", "-crf", "20", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart",
    f"{OUT}/ile-demo-v3.mp4",
]
subprocess.run(cmd, check=True)
print("built", f"{total:.1f}s")
