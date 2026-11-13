# Credits

## Assets

Ilé ships **no third-party art or audio assets**.

| What | Source | Licence |
|---|---|---|
| Compound, table, plot, sun gizmo, Elder figure, handles | Generated in code (`src/model`, `src/scene`, `src/app.ts`) | MIT (this repo) |
| All sound effects and ambient wind | Synthesised with WebAudio (`src/audio.ts`) | MIT (this repo) |
| Text panels | Canvas-rendered with the device's system font | n/a |
| Elder voice | The browser's built-in `speechSynthesis` voice | n/a |

## Software

| Package | Use | Licence |
|---|---|---|
| [@iwsdk/core](https://www.npmjs.com/package/@iwsdk/core) and IWSDK tooling | WebXR world, input, emulator | MIT |
| [three.js](https://threejs.org) (via `super-three`) | Rendering | MIT |
| [Vite](https://vite.dev) | Build | MIT |

## Knowledge

The passive-cooling principles the Elder draws on — courtyards, thick earth walls, deep eaves, cross-ventilation and orientation — are long-standing practice in West African vernacular building, including the Yoruba *agbo ilé* courtyard compound. The comfort score is an original heuristic written for this project.
