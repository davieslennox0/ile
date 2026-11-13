# Demo video

`ile-demo.mp4` — 81 s, 1280×720, Kokoro voiceover (`bm_george`), burned-in English subtitles.

How it was made (all in a GitHub Codespace, no GPU):

1. `tts.py` — generates the narration with [Kokoro](https://github.com/thewh1teagle/kokoro-onnx) (`kokoro-v1.0.onnx`, Apache-2.0).
2. `record.mjs` — drives the live deployment with real Playwright mouse input on a virtual clock and saves one frame per step. Footage is the **desktop preview** (mouse pointer); the Elder's reply in the video is a live model response.
3. `build.py` — ffmpeg: frames + voiceover + subtitles, plus two stills from the Meta VR Glasses emulator (hand tracking, gaze + pinch).

Not shown: capture from a physical headset.
