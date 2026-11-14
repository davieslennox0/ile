# Ilé

**Build a home. Grow a life in Lagos, with your own hands.**

Ilé (Yoruba: *home*) is a cosy, hands-first, seated VR life-sim for Meta Quest and Meta VR Glasses, built with the Meta Immersive Web SDK (IWSDK). A low-poly street in Yaba, Lagos sits on a wooden table in front of you: danfos and kekes loop the road, people in agbada, iro and gele, ankara and school uniforms walk the sidewalks, kids play football, and the buka is busy. In the middle is an empty plot, and ₦600,000.

Over seven days you build a house from mud you mix yourself, move in, survive the afternoon heat and a NEPA power cut with the help of Baba (an AI neighbour who knows the old builders' passive-cooling wisdom), meet Adaeze, cook and wash up together, welcome baby Tolu, open a food spot, build upward, and end with a house-warming party under string lights.

Built for the Meta VR Start Developer Competition 2026.

Live: https://ile-dun.vercel.app

## The seven days

Days are data in `data/days.json` (event card, Baba's line, the steps, the journal line).

| Day | Event | What you do with your hands |
|---|---|---|
| 1 Arrival | ₦600,000 and an empty plot | Pinch-drag rooms on the grid, pinch the open middle for a courtyard, carry red earth, sand and water to the pit and stir the mud, pull the walls up, palm-up → Roof |
| 2 Move in | First night under your own roof | ScaleShift inside, place the fan, photo and more from a tray (the photo snaps to a wall), pinch the fan's switch. Then the afternoon sun, a NEPA cut, and Baba's ghost fix: pinch ✓ to accept |
| 3 Love | You meet Adaeze at the buka | Build her a room. First dinner inside: stir the pot (circle your hand), set two plates, serve (carry the pot over each plate), eat together, wash a plate (rub it back and forth in the basin) and rack it |
| 4 Family | Welcome, little Tolu | Build a nursery that must stay cool (Baba helps if it doesn't), place the cot, wind the mobile |
| 5 Hustle | Adaeze opens a food spot | Pinch the marker and pull up: the food spot rises and customers queue. It earns every day |
| 6 Growing | Tolu's first football match | Pull up a second floor and roof garden; turn the pages of Tolu's homework |
| 7 Making it big | The talk of Yaba | Pull up the three-storey compound with solar panels and a car; the house-warming party at night |

Each day ends with a journal card; pinch it to sleep. Salary (from Day 2) and the business (from Day 5) pay out overnight. The HUD shows the day and clock, ₦ savings, Energy / Comfort / Joy and the Ilé Score. Progress saves after every step.

The free modes are still on the start screen: **Build from scratch** and **Start from a Yoruba compound**.

## Demo video

`demo/ile-v2-demo.mp4` (2:36, 1920×1080) and `demo/ile-v2-vertical.mp4` (1080×1920). Captured in the IWER emulator with the Meta VR Glasses profile, driven only by emulated hands, gaze and head, with Kokoro narration, burned-in subtitles and a synthesised soundtrack. Re-render on any NVIDIA GPU machine with `bash scripts/record-demo.sh`.

## Free modes

The app opens on two pinch cards:

- **Build from scratch** — an empty Lagos plot. Lay rooms, mark the courtyard, raise the walls, cut openings, add a roof. A single guidance line tells you the next step.
- **Start from a Yoruba compound** — the *agbo ilé* template, with a short tutorial.

Rooms are named automatically by size (Parlour, Bedroom 1, Kitchen…) so the heat map and the Elder can refer to them. The heat map, the Elder, ScaleShift and Compare work the same on both. For a scratch-built house, Compare's "before" is the first moment the house has rooms, walls and a roof.

## Hands only

No controller is needed anywhere. Every gesture also has a pinch-only path, so it works with gaze + pinch on the VR Glasses.

| Gesture | Action |
|---|---|
| Pinch + drag on the empty plot | Lay a room footprint (0.5 m grid, 1 m minimum) |
| Pinch the open middle enclosed by rooms (or two-hand spread on it) | Mark it as the courtyard |
| Pinch + drag an orange wall grip | Move that wall line; every room sharing it follows |
| Pinch + pull the white spire up / down | Raise the walls from the floor; then wall height |
| Pinch a wall panel | Cut or close a window / doorway |
| Palm-up menu → **Roof** | Add or remove the roof |
| Pinch a gold eave grip + twist the wrist (or drag outward) | Roof overhang depth |
| Two-hand pinch on the courtyard, spread / close (or drag the teal corner grip) | Resize the courtyard |
| Pinch + drag the knob on the plot ring | Orientation, 15° snaps |
| Pinch + drag the sun along its arc | Time of day, 8 AM – 6 PM |
| Point + pinch a room | ScaleShift: sit inside it at 1:1 |
| Pinch a doorway light (inside) | Walk to the next room |
| Pinch the carved Elder figure | Ask for advice |
| Pinch ✓ / swipe a hand away | Accept / reject the Elder's ghost preview |
| Hold a palm up for 0.5 s (or pinch **Menu**) | Tools: Heat, Elder, Compare, Undo, Roof, Walls, New house, Re-centre |
| Flick an open hand left | Undo |

On desktop (no headset) the same targets work with the mouse, so the build can be judged in a browser tab. Desktop-only shortcuts: `1` scratch, `2` compound, `H` heat, `E` ask the Elder, `Y`/`N` accept/reject, `C` compare, `U` undo, `F` roof, `M` wall material, `R` new house, `B` back to table, `S` skip intro.

Text is one large panel at a time: the Elder's words replace the instruction while he speaks, a sentence or two per page.

## The heat score is a heuristic, not physics

`src/heat/score.ts` is a small pure function, unit-tested in `test/`. Per room it combines:

- **Sun exposure** — the sun vector for Lagos (6.5° N, mid-November) at the chosen hour, against each outside wall, reduced by the shade its eave casts.
- **Material** — thick earth passes less heat than sandcrete block, which passes less than zinc sheet.
- **Cross-ventilation** — openings on opposite sides, or onto the courtyard.
- **Courtyard ratio** — courtyard area over footprint.
- **Wall height** — room for warm air to rise.

The **Ilé Score** on the badge is the area-weighted comfort averaged over the whole day. It is a believable rule of thumb for design intuition. It is not a thermal simulation and should not be used to size a real building.

## The Elder (agentic interaction)

Pinching the Elder sends the design state to `POST /api/elder`, a small server function that calls OpenAI's open-weight `gpt-oss-120b` model hosted on Cerebras (the key never reaches the client). The model returns one short explanation and one or two structured actions, constrained by a JSON schema:

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
npx vercel env add CEREBRAS_API_KEY production   # then redeploy
```

Vercel builds the Vite app to `dist/` and serves `api/elder.ts` as a function. Optional: `ELDER_MODEL` to choose another Cerebras-hosted model. Without a key the app still works, using the built-in Elder.

## Layout

```
src/
  index.ts              IWSDK world bootstrap
  app.ts                app core: state, HUD, modes, Elder flow
  scene/table.ts        table, plot, compass, sun arc
  model/building.ts     procedural house: walls per shared line, openings, roofs, floors
  model/state.ts        rooms on a grid, courtyard, wall lines, naming, undo, serialise
  interact/gestures.ts  pinch / twist / two-hand / palm-up / flick; gaze + mouse
  interact/handles.ts   sculpting grips mapped to design parameters
  heat/score.ts         comfort heuristic (pure, tested)
  heat/overlay.ts       floor tinting + per-room numbers
  scaleshift/shift.ts   scale transition, vignette, room hop
  elder/                actions + validation, built-in Elder, API client
  ui/                   labels, palm menu, onboarding, compare
api/elder.ts            model call → {say, actions[]}
test/                   unit tests (node --test)
```

## Licence

MIT — see `LICENSE`. All geometry and audio are generated in code; see `CREDITS.md`.
