// ~10 s hands-only test render of the move-in beat: inside the first room,
// pinch the standing fan and the family photo off the tray and place them.
import fs from 'node:fs';
import { findRoomAim, openRig } from './hands.mjs';

const OUT = '/tmp/handstory';
const rig = await openRig({ out: OUT });
const log = async (label) => {
  const s = await rig.state();
  const story = await rig.page.evaluate(() => ({ beat: globalThis.ile.story.beat, items: globalThis.ile.story.story.items.map((i) => i.item), savings: globalThis.ile.story.story.savings }));
  console.log(`  ${label}:`, JSON.stringify({ mode: s.mode, hover: s.hover.right, down: s.down.right, ...story }));
  return s;
};

// Off camera: start the story and build a small two-room house.
await rig.page.evaluate(async () => {
  const s = await import('/src/model/state.ts');
  const a = globalThis.ile;
  a.startWith('story');
  a.commit(s.addRoom(a.design, { x0: -4, x1: 2, z0: -4, z1: 0.5 }), 'room');
  a.commit(s.addRoom(a.design, { x0: 2, x1: 5, z0: -4, z1: 0.5 }), 'room');
  a.commit(s.setWallHeight(a.design, 3), 'height');
  a.toggleRoof();
  a.commit(s.setOpening(a.design, 'r1', 'north', true), 'opening');
  a.commit(s.setOpening(a.design, 'r1', 'south', true), 'opening');
});
await rig.hold(1.5);
const aim = await findRoomAim(rig, 'r1');
console.log('  aim', JSON.stringify(aim));
await rig.move({ gaze: aim, right: [0.15, aim[1] + 0.25, aim[2] + 0.17] }, 0.5);
await rig.pinch('right', 1, 0.18);
await rig.hold(0.12);
await rig.pinch('right', 0, 0.18);
await rig.move({ right: [0.2, 0.95, -0.34], left: [-0.2, 0.95, -0.34], pitch: -0.32, gaze: [0, 0.7, -1.2] }, 1.6);
await rig.hold(0.6);
await log('inside');

/** Gaze at a belonging, pinch it, carry it by moving the hand, let go. */
async function carry(id, by, seconds) {
  const p = await rig.where(`app.story.items.get('${id}').group`);
  const hand = [0.17, 1.02, -0.42];
  await rig.move({ gaze: [p[0], p[1] + (id === 'photo' ? 0 : 0.08), p[2]], right: hand }, 0.55);
  await rig.hold(0.15);
  await log(`aim ${id}`);
  await rig.pinch('right', 1, 0.2);
  await rig.hold(0.1);
  const to = hand.map((v, i) => v + by[i]);
  // Keep looking at the thing while it is carried.
  const steps = Math.round(seconds * 30);
  for (let i = 1; i <= steps; i += 1) {
    const k = i / steps;
    const e = k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2;
    rig.hands.right.pos = hand.map((v, j) => v + (to[j] - v) * e);
    if (i % 3 === 0) rig.gaze = await rig.where(`app.story.items.get('${id}').group`);
    await rig.frame();
  }
  await rig.hold(0.15);
  await rig.pinch('right', 0, 0.2);
  await rig.hold(0.45);
  await log(`placed ${id}`);
}

rig.capturing = true;
rig.mark('move-in');
await rig.hold(0.6);
await carry('fan', [-0.3, 0, -0.16], 1.3);
await carry('photo', [0.08, 0.2, -0.22], 1.3);
await rig.move({ right: [0.2, 0.95, -0.34], gaze: [-0.4, 1.0, -2], pitch: -0.12, yaw: 0.25 }, 1.2);
await rig.hold(1.0);
rig.marks.push({ name: 'end', start: rig.now() });
fs.writeFileSync(`${OUT}/marks.json`, JSON.stringify(rig.marks));
await rig.browser.close();
console.log('done', rig.frameNo, 'frames', rig.wall());
