# Ilé

**Sculpt a West African home with your hands, feel the Lagos sun inside it, and let an elder architect help you keep it cool.**

Ilé (Yoruba: *home*) is a hands-first, seated VR studio for Meta Quest and Meta VR Glasses, built with the Meta Immersive Web SDK (IWSDK). A Yoruba courtyard compound (*agbo ilé*) sits on a miniature table in front of you. Pull its walls, twist its eaves, spread its courtyard, and watch a heat map show how every room copes with the afternoon sun. Then pinch a room to drop inside at full scale and sit in the shade you made.

Built for the Meta VR Start Developer Competition 2026 — Productivity track.

## The loop

Sculpt → Heat-check → ScaleShift inside → Ask the Elder → Fix → Compare.

## Hands only

No controller is needed anywhere. Every gesture also has a pinch-only path, so it works with gaze + pinch on the VR Glasses.

| Gesture | Action |
|---|---|
| Pinch + drag an orange wall grip | Push / pull that outer wall (0.5 m grid) |
| Pinch + pull the roof spire up / down | Wall height |
| Two-hand pinch on the courtyard, spread / close (or drag the teal corner grip) | Resize the courtyard |
| Pinch a gold eave grip + twist the wrist (or drag outward) | Roof overhang depth |
| Pinch + drag the knob on the plot ring | Orientation, 15° snaps |
| Pinch a wall panel | Toggle that window / doorway |
| Pinch + drag the sun along its arc | Time of day, 8 AM – 6 PM |
| Point + pinch a room | ScaleShift: sit inside it at 1:1 |
| Pinch a doorway light (inside) | Walk to the next room |
| Pinch the carved Elder figure | Ask for advice |
| Pinch ✓ / swipe a hand away | Accept / reject the Elder's ghost preview |
| Hold a palm up for 0.5 s (or pinch **Menu**) | Tool menu: Heat, Elder, Compare, Undo, Walls, Reset, Re-centre |
| Flick an open hand left | Undo |

On desktop (no headset) the same targets work with the mouse, so the build can be judged in a browser tab.

## The heat score is a heuristic, not physics

`src/heat/score.ts` is a small pure function, unit-tested in `test/`. Per room it combines:

- **Sun exposure** — the sun vector for Lagos (6.5° N, mid-November) at the chosen hour, against each outside wall, reduced by the shade its eave casts.
- **Material** — thick earth passes less heat than sandcrete block, which passes less than zinc sheet.
- **Cross-ventilation** — openings on opposite sides, or onto the courtyard.
- **Courtyard ratio** — courtyard area over footprint.
- **Wall height** — room for warm air to rise.

The **Ilé Score** on the badge is the area-weighted comfort averaged over the whole day. It is a believable rule of thumb for design intuition. It is not a thermal simulation and should not be used to size a real building.

## The Elder (agentic interaction)

Pinching the Elder sends the design state to `POST /api/elder`, a small server function that calls the Claude API (the key never reaches the client). Claude returns one short explanation and one or two structured actions, constrained by a JSON schema:

```json
{"say":"Your west bedroom takes the full afternoon sun. Our builders deepened the eaves on that side.",
 "actions":[{"type":"set_overhang","side":"west","value":1.2},
            {"type":"add_opening","room":"bed2","side":"east"}]}
```

The client validates every action against its own vocabulary (`src/elder/actions.ts`), shows the result as a translucent ghost over the model, and waits. **The agent proposes; your hands decide.** If the endpoint is unreachable or returns anything unusable, a built-in rule-based Elder (`src/elder/local.ts`) answers instead, so a proposal always arrives — including on a static host with no API key.

## Run it

Requires Node 20.19+ (22 recommended).

```bash
npm install
npm run dev        # IWSDK dev server + emulator (Meta VR Glasses profile)
npm test           # heat score, state model, Elder validation
npm run typecheck
npm run build      # static build in dist/
```

The emulator device is set in `iwsdk.config.json` (`dev.emulator.device`: `metaVRGlasses` or `metaQuest3`).

## Deploy (Vercel)

```bash
npx vercel login
npx vercel deploy --prod
npx vercel env add ANTHROPIC_API_KEY production   # then redeploy
```

Vercel builds the Vite app to `dist/` and serves `api/elder.ts` as a function. Optional: `ELDER_MODEL` to choose the Claude model. Without a key the app still works, using the built-in Elder.

## Layout

```
src/
  index.ts              IWSDK world bootstrap
  app.ts                app core: state, HUD, modes, Elder flow
  scene/table.ts        table, plot, compass, sun arc
  model/building.ts     procedural compound: walls, openings, roof, floors
  model/state.ts        design state, grid snapping, undo, serialise
  interact/gestures.ts  pinch / twist / two-hand / palm-up / flick; gaze + mouse
  interact/handles.ts   sculpting grips mapped to design parameters
  heat/score.ts         comfort heuristic (pure, tested)
  heat/overlay.ts       floor tinting + per-room numbers
  scaleshift/shift.ts   scale transition, vignette, room hop
  elder/                actions + validation, built-in Elder, API client
  ui/                   labels, palm menu, onboarding, compare
api/elder.ts            Claude call → {say, actions[]}
test/                   unit tests (node --test)
```

## Licence

MIT — see `LICENSE`. All geometry and audio are generated in code; see `CREDITS.md`.
