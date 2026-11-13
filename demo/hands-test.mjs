// ~10 s hands-only test render: pick the scratch card, lay a room by
// pinch-drag, then (on the compound) pinch a room and ScaleShift inside.
import fs from 'node:fs';
import { findRoomAim, openRig, reach } from './hands.mjs';

const OUT = '/tmp/handtest';
const rig = await openRig({ out: OUT });
const log = async (label) => {
  const s = await rig.state();
  console.log(`  ${label}:`, JSON.stringify({ mode: s.mode, rooms: s.rooms, hover: s.hover, down: s.down, score: s.score }));
  return s;
};

const ONLY_B = process.env.ILE_PART === 'B';
if (!ONLY_B) {
// --- Clip A: build from scratch.
const card = await rig.where('app.cards[0].label.mesh');
rig.capturing = true;
rig.mark('card');
await rig.hold(0.5);
await rig.move({ gaze: card, right: [0.16, 1.02, -0.4] }, 0.6);
await log('aim card');
await rig.pinch('right', 1, 0.18);
await rig.hold(0.12);
await rig.pinch('right', 0, 0.18);
await rig.hold(0.5);
await log('after card');

rig.mark('lay');
for (const [x0, z0, x1, z1] of [[-5, -6, 5, -2], [-5, 2, 5, 6]]) {
  const a = await rig.local(x0, -0.24, z0);
  const b = await rig.local(x1, -0.24, z1);
  await reach(rig, 'right', a, 0.55);
  await rig.hold(0.12);
  await log('over plot');
  await rig.pinch('right', 1, 0.18);
  await rig.move({ right: b, gaze: b }, 0.9);
  await rig.hold(0.12);
  await rig.pinch('right', 0, 0.18);
  await rig.hold(0.3);
  await log('room laid');
}
await rig.move({ right: [0.2, 0.98, -0.32], gaze: [0, 1.0, -0.6] }, 0.5);

}

// --- Clip B: the compound (set up off camera), then step inside.
rig.capturing = false;
await rig.page.evaluate(() => {
  const a = globalThis.ile;
  if (a.mode !== 'start') a.newHouse();
  a.startWith('compound');
  a.onboarding.skip(true);
});
await rig.hold(0.4);
rig.capturing = true;
rig.mark('inside');
await rig.hold(0.4);
let aim = null;
let room = 'gate';
for (const id of ['gate', 'parlour', 'bed1', 'bed2']) {
  aim = await findRoomAim(rig, id);
  if (aim) { room = id; break; }
}
console.log('  aim', room, JSON.stringify(aim));
rig.gaze = [0, 1.0, -0.6];
await rig.hold(0.3);
await rig.move({ gaze: aim, right: [0.15, aim[1] + 0.25, aim[2] + 0.17] }, 0.7); // hand held clear of the grips; the gaze picks the room
await rig.hold(0.2);
await log('aim room');
await rig.pinch('right', 1, 0.18);
await rig.hold(0.12);
await rig.pinch('right', 0, 0.18);
// Drop the hands to the lap and look around the room at full scale.
await rig.move({ right: [0.22, 0.9, -0.3], left: [-0.22, 0.9, -0.3], gaze: [0, 1.1, -3], pitch: -0.05 }, 1.3);
await log('shifted');
await rig.hold(1.2);
await rig.move({ yaw: 0.5 }, 1.4);
await rig.move({ yaw: -0.45 }, 2.0);
await rig.move({ yaw: 0, pitch: -0.25 }, 1.2);
await log('inside');
rig.marks.push({ name: 'end', start: rig.now() });
fs.writeFileSync(`${OUT}/marks.json`, JSON.stringify(rig.marks));
await rig.browser.close();
console.log('done', rig.frameNo, 'frames', rig.wall());
