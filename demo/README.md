# Demo videos

## `ile-demo-desktop.mp4` — backup, not for submission

89 s, 1280×720, 20 fps, Kokoro voiceover (`bm_george`), burned-in English subtitles.

This cut uses the **desktop preview with a mouse pointer** (hands appear only in two emulator stills), so it does not show the hands-first interaction the competition asks for. It is kept as a fallback.

How it was made (in a GitHub Codespace, no GPU):

1. `tts.py` — generates the narration with [Kokoro](https://github.com/thewh1teagle/kokoro-onnx) (`kokoro-v1.0.onnx`, Apache-2.0).
2. `record.mjs` — drives the live deployment with real Playwright mouse input on a virtual clock and saves one frame per step. The Elder replies in the video are live model responses.
3. `build.py` — ffmpeg: frames + voiceover + subtitles.

The scripts match the app as it was at commit `6113be0`; they need updating for the build-from-scratch start screen.
