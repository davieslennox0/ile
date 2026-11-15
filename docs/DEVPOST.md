# Ilé — Devpost text

**Tagline (≤140):** Build a home. Grow a life in Lagos, with your own hands.

**Track:** Gaming (casual / narrative). Hands only, seated, Meta Quest + Meta VR Glasses.

**Images:** logo / thumbnail `brand/ile-mark-1024.png` (square), cover `brand/ile-social.png` (1280×640), wordmark `brand/ile-logo-light.png`.
**Video:** `demo/ile-v2-demo.mp4` (2:36; upload to YouTube and paste the link). Vertical cut for socials: `demo/ile-v2-vertical.mp4`.
**Try it:** https://ile-dun.vercel.app

## Inspiration
In Lagos, a home is built one room at a time, often by hand, and modern block houses trap heat that our grandparents' courtyard compounds never did. Ilé turns that into a cosy life-sim: start with an empty plot and ₦600,000, mix the mud yourself, and grow a family and a business on a street in Yaba.

## What it does
A low-poly Yaba street lives on a table in front of you: danfos, kekes, a buka, market stalls, kids playing football. Over seven days you build a house by hand (pinch-drag rooms, stir mud, pull walls up, palm-up for the roof), move in at full scale, and live in it: switch on the fan, cook jollof, serve, eat with Adaeze, wash up, care for baby Tolu, open a food spot, and build upward until the house-warming party. When NEPA takes light, Baba, an AI neighbour, explains what the old builders knew and proposes passive-cooling fixes as ghost previews. Nothing changes until your hand accepts them.

## How we built it
Meta IWSDK (WebXR, Three.js), deployed on Vercel. Everything you see is procedural: the neighbourhood, the people (one data-driven figure with nine attire styles and generated ankara prints), the furniture, and the sound. A small heat heuristic scores comfort per room from the Lagos sun angle, eaves, wall material, cross-ventilation and the courtyard. Baba runs on `gpt-oss-120b` via Cerebras behind a server function, with JSON-schema output, client-side validation and a rule-based fallback.

## Challenges
Hands-only on the VR Glasses means gaze picks and a pinch acts, inside a narrow field of view. Every interaction (stirring, rubbing a plate, pulling a storey up) is a gesture detector on top of one shared pinch layer. The demo video is captured in the IWER emulator, driven only by emulated hands, on a rented GPU.

## What's next
Ambient audio (buka chatter, generator hum during NEPA), Yoruba and Pidgin voice lines, more home actions, and performance tuning for Quest 3.
