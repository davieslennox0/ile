# Credits

Ilé ships **no third-party art, models, music or sound files**.

| What | Source | Licence |
|---|---|---|
| Neighbourhood, houses, people, vehicles, furniture, table, handles | Generated in code (`src/world`, `src/people`, `src/interior`, `src/model`, `src/scene`) | MIT (this repo) |
| Ankara prints, rammed-earth textures | Generated on a canvas in code (`src/world/geo.ts`) | MIT (this repo) |
| In-app sound effects and wind | Synthesised with WebAudio (`src/audio.ts`) | MIT (this repo) |
| Demo soundtrack (bell, gong, shaker, bass) | Synthesised from sine partials (`demo/music.py`) | MIT (this repo) |
| Demo narration | [Kokoro-82M](https://huggingface.co/hexgrad/Kokoro-82M) via [kokoro-onnx](https://github.com/thewh1teagle/kokoro-onnx) | Apache-2.0 |
| In-app Baba voice | The browser's built-in `speechSynthesis` voice | n/a |
| Baba's advice | `gpt-oss-120b` on Cerebras | Apache-2.0 (model weights) |

## Software

| Package | Use | Licence |
|---|---|---|
| [@iwsdk/core](https://www.npmjs.com/package/@iwsdk/core) and IWSDK tooling | WebXR world, input, emulator | MIT |
| [three.js](https://threejs.org) (via `super-three`) | Rendering | MIT |
| [Vite](https://vite.dev) | Build | MIT |
| [Playwright](https://playwright.dev) | Demo capture | Apache-2.0 |

No real money and no crypto: ₦ in Ilé is game naira only.
