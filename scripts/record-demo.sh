#!/usr/bin/env bash
# Render the Ilé demo video on any Ubuntu machine with an NVIDIA GPU.
#   bash scripts/record-demo.sh            # 1920x1080 landscape + 1080x1920 vertical
# Output: /tmp/v4/ile-v2-demo.mp4 and /tmp/v4/ile-v2-vertical.mp4
# Needs: NVIDIA driver (with graphics/EGL libraries), sudo for apt, internet.
set -euo pipefail
cd "$(dirname "$0")/.."

echo "== GPU"
nvidia-smi --query-gpu=name,driver_version --format=csv,noheader || { echo "No NVIDIA GPU found."; exit 1; }

echo "== System packages"
sudo apt-get update -qq
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq curl ffmpeg fonts-dejavu-core libegl1 libgl1 libgles2 libvulkan1 python3-pip >/dev/null
command -v node >/dev/null && node -v | grep -qE '^v(22|24)' || {
  curl -sL https://nodejs.org/dist/v22.12.0/node-v22.12.0-linux-x64.tar.xz | sudo tar xJ -C /opt
  sudo ln -sf /opt/node-v22.12.0-linux-x64/bin/* /usr/local/bin/
}
pip install -q numpy soundfile kokoro-onnx

echo "== Project"
npm ci --ignore-scripts --no-audit --no-fund
npx playwright install --with-deps chromium
mkdir -p .demo /tmp/v4/frames && cp demo/*.mjs demo/*.py .demo/

echo "== Narration (Kokoro)"
[ -f /tmp/v4/kokoro-v1.0.onnx ] || curl -sL -o /tmp/v4/kokoro-v1.0.onnx https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.onnx
[ -f /tmp/v4/voices-v1.0.bin ] || curl -sL -o /tmp/v4/voices-v1.0.bin https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin
OUT=/tmp/v4 python3 .demo/tts_v4.py

echo "== Dev server (Baba answers from the live endpoint)"
(VITE_ELDER_URL=https://ile-dun.vercel.app/api/elder nohup npx @iwsdk/cli dev up --no-open > /tmp/dev.log 2>&1 &)
for i in $(seq 1 60); do curl -sk -o /dev/null https://localhost:8081/ && break; sleep 3; done

echo "== Rehearsal (checks every hand gesture lands; no frames)"
ILE_GPU=1 ILE_FPS=30 node .demo/v4.mjs | tail -3

echo "== Take (1920x1080, 30 fps, hands only)"
rm -f /tmp/v4/frames/*.jpg
ILE_GPU=1 ILE_HD=1 ILE_TAKE=1 ILE_FPS=30 node .demo/v4.mjs | tail -3

echo "== Soundtrack, subtitles, assembly"
OUT=/tmp/v4 python3 .demo/music.py
OUT=/tmp/v4 ILE_FPS=30 ILE_H=1080 python3 .demo/build_v4.py
ls -la /tmp/v4/ile-v2-demo.mp4 /tmp/v4/ile-v2-vertical.mp4
