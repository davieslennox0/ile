"""Assemble demo v3: frames + Kokoro narration + soundtrack + subtitles."""
import json, os, subprocess, sys, textwrap
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lines_v4 import LINES

OUT = os.environ.get("OUT", "/tmp/v4")
FPS = int(os.environ.get("ILE_FPS", "30"))
FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
marks = json.load(open(f"{OUT}/marks.json"))
vo = {v["name"]: v["seconds"] for v in json.load(open(f"{OUT}/vo.json"))}
start = {}
for m in marks:
    start.setdefault(m["name"], m["start"])  # first mark of a name is the section start
total = max(m["start"] for m in marks if m["name"] in ("stop", "end"))
names = [n for n, _, _, _ in LINES if n in start]
subs = {n: (sub or say) for n, _, say, sub in LINES}

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
H = int(os.environ.get("ILE_H", "1080"))
K = H / 720
text("Captured in Meta VR Glasses emulator  ·  hands only, no controllers", 0.2, 7.5, int(26 * K), int(24 * K))
text("Ilé", 0.6, 4.6, int(400 * K), int(110 * K), "0xf2b23e", 0.45)
text("Build a home. Grow a life in Lagos.", 0.9, 4.6, int(520 * K), int(46 * K), "white", 0.45)
for m in marks:
    if m["name"].startswith("cap:"):
        text(m["name"][4:], m["start"] + 0.1, m["start"] + 3.2, 300, 52, "0xf2b23e", 0.65)
if "end" in start:
    # Dim the frame behind the end card.
    filters.append(f"[{last}]drawbox=x=0:y=0:w=iw:h=ih:color=black@0.62:t=fill:enable='between(t,{start['end']:.2f},{total:.2f})'[scrim]")
    last = "scrim"
    text("Ilé", start["end"] + 0.1, total, int(200 * K), int(110 * K), "0xf2b23e", 0.5)
    text("Build a home. Grow a life in Lagos, with your own hands.", start["end"] + 0.4, total, int(330 * K), int(36 * K), "white", 0.5)
    text("Hands only ✓    Seated ✓    Agentic Baba ✓    First 5 min ✓", start["end"] + 0.8, total, int(420 * K), int(30 * K), "0xbff0b0", 0.55)
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
            text(line, t, t + dur, int(H - 46 * K - (len(page) - j) * 44 * K), int(30 * K))
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
    f"{OUT}/ile-v2-demo.mp4",
]
subprocess.run(cmd, check=True)
print("built", f"{total:.1f}s")

# Vertical cut for socials: the landscape video over a blurred, filled background.
subprocess.run([
    "ffmpeg", "-y", "-loglevel", "error", "-i", f"{OUT}/ile-v2-demo.mp4",
    "-filter_complex",
    "[0:v]split[a][b];[a]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=24:2[bg];"
    "[b]scale=1080:-2[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2[v]",
    "-map", "[v]", "-map", "0:a", "-c:v", "libx264", "-preset", "medium", "-crf", "21", "-pix_fmt", "yuv420p",
    "-c:a", "copy", "-movflags", "+faststart", f"{OUT}/ile-v2-vertical.mp4",
], check=True)
print("vertical built")
