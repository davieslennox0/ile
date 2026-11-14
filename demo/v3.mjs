// Ilé demo v3 — "Your first home in Lagos", hands only.
//
// One script for both the rehearsal and the take:
//   ILE_TAKE=0 (default)  no frames saved, coarse time: checks every gesture lands
//   ILE_TAKE=1            saves frames + marks.json for build-v3.py
import fs from 'node:fs';
import { FPS, findRoomAim, openRig } from './hands.mjs';

const TAKE = process.env.ILE_TAKE === '1';
const ONLY = (process.env.ILE_ONLY || '').split(',').filter(Boolean);
const OUT = TAKE ? '/tmp/v3' : '/tmp/v3-rehearsal';
const vo = fs.existsSync('/tmp/v3/vo.json')
  ? Object.fromEntries(JSON.parse(fs.readFileSync('/tmp/v3/vo.json', 'utf8')).map((v) => [v.name, v.seconds]))
  : {};

const rig = await openRig({ out: OUT, pitch: -0.34 });
const page = rig.page;
const REST = { right: [0.2, 0.97, -0.33], left: [-0.2, 0.97, -0.33] };
const LOOK = [0, 1.0, -0.62];
const fails = [];

const app = (fn, arg) => page.evaluate(fn, arg);
const info = () =>
  app(() => {
    const a = globalThis.ile, d = a.design, s = a.story;
    return {
      mode: a.mode, rooms: d.rooms.length, court: !!d.court, h: d.wallHeight, roof: d.roof, open: Object.keys(d.openings).length,
      mud: +a.mud.progress.toFixed(2), score: a.day.overall, now: a.now.overall, heat: a.heatOn, proposal: !!a.proposal,
      beat: s.beat, savings: s.story.savings, items: s.story.items.map((i) => i.item), day: s.story.day, power: s.story.power,
      menu: a.menu.isOpen, card: s.card.mesh.visible, hour: d.hour,
    };
  });
async function check(label, ok) {
  const s = await info();
  const pass = ok(s);
  if (!pass) fails.push(label);
  console.log(`${pass ? '  ok  ' : '  FAIL'} ${label}`, JSON.stringify(s));
  return s;
}
const hover = async () => (await rig.state()).hover.right;

/** A section of the video: its start is where the narration line begins. */
async function section(name, fn, tail = 0.6) {
  if (ONLY.length && !ONLY.includes(name)) return;
  const start = rig.now();
  rig.mark(name);
  await fn();
  const need = (vo[name] ?? 0) + tail;
  if (TAKE && rig.now() - start < need) await rig.hold(need - (rig.now() - start));
}

/** Look at a point, raise the hand, pinch and release. */
async function tap(point, hand = 'right', want = null) {
  const up = hand === 'right' ? [0.16, 1.04, -0.41] : [-0.16, 1.04, -0.41];
  await rig.move({ gaze: point, [hand]: up }, 0.5);
  await rig.settle();
  const h = await hover();
  if (want && h !== want && !(want instanceof RegExp && want.test(h ?? ''))) console.log(`    (hover ${h}, wanted ${want})`);
  await rig.pinch(hand, 1, 0.18);
  await rig.hold(0.12);
  await rig.pinch(hand, 0, 0.18);
  await rig.hold(0.25);
  return h;
}

/** Look at a point, pinch, move the hand by `by` metres, release. */
async function pull(point, by, seconds = 0.9, at = [0.16, 1.03, -0.41]) {
  await rig.move({ gaze: point, right: at }, 0.5);
  await rig.hold(0.2);
  const h = await hover();
  await rig.pinch('right', 1, 0.18);
  await rig.hold(0.1);
  await rig.move({ right: at.map((v, i) => v + by[i]), gaze: point.map((v, i) => v + by[i]) }, seconds);
  await rig.hold(0.12);
  await rig.pinch('right', 0, 0.18);
  await rig.hold(0.25);
  return h;
}

/** Pinch-drag on the plot between two building-local points. */
async function lay(x0, z0, x1, z1) {
  const a = await rig.local(x0, -0.24, z0);
  const b = await rig.local(x1, -0.24, z1);
  // Reach right down to the plot: the hand does the drawing.
  // The hand hovers just above the plot, clear of the wall grips.
  await rig.move({ gaze: a, right: [a[0], a[1] + 0.06, a[2]] }, 0.55);
  await rig.hold(0.2);
  await rig.pinch('right', 1, 0.18);
  await rig.move({ right: [b[0], b[1] + 0.06, b[2]], gaze: b }, 0.95);
  await rig.hold(0.15);
  await rig.pinch('right', 0, 0.18);
  await rig.hold(0.3);
}

const rest = (seconds = 0.5) => rig.move({ ...REST, gaze: LOOK }, seconds);

// ---------------------------------------------------------------- the day

rig.capturing = TAKE;

await section('title', async () => {
  await rig.hold(2.2);
});

await section('arrive', async () => {
  const card = await rig.where('app.cards[0].label.mesh');
  await tap(card, 'right', 'card-0');
  await rest(0.6);
  await rig.hold(2.5);
  await check('story started', (s) => s.mode === 'table' && s.beat === 'arrival' && s.savings === 600000);
});

await section('rooms', async () => {
  await lay(-4.8, -5.8, 4.8, -2.2);
  await lay(-4.8, -1.8, -2.2, 1.8);
  await lay(2.2, -1.8, 4.8, 1.8);
  await lay(-4.8, 2.2, 4.8, 5.8);
  await check('four rooms', (s) => s.rooms === 4);
  // The open middle becomes the courtyard.
  await tap(await rig.local(1.2, -0.24, -0.7), 'right', 'plot');
  await check('courtyard', (s) => s.court);
  await rest();
});

await section('mud', async () => {
  const heaps = { earth: [6.6, 11.3], sand: [8.4, 8.2], water: [11.6, 6.9] };
  const pit = [10.6, 10.6];
  for (const id of ['earth', 'sand', 'water']) {
    const [x, z] = heaps[id];
    const from = await rig.where(`app.mud.group.children.find((c) => Math.abs(c.position.x - ${x}) < 0.01 && Math.abs(c.position.z - ${z}) < 0.01)`);
    const to = await rig.local(pit[0], 0.2, pit[1]);
    // Reach to the heap, pinch a scoop, carry it over the pit, let go.
    await rig.move({ gaze: from, right: [from[0], from[1] + 0.02, from[2]] }, 0.55);
    await rig.hold(0.2);
    await rig.pinch('right', 1, 0.18);
    await rig.move({ right: [to[0], to[1] + 0.04, to[2]], gaze: to }, 0.8);
    await rig.hold(0.12);
    await rig.pinch('right', 0, 0.18);
    await rig.hold(0.3);
  }
  await check('ingredients in', (s) => s.mud >= 0.49);
  // Stir: pinch in the pit and circle the hand.
  const c = await rig.local(pit[0], 0.1, pit[1]);
  const centre = [c[0], c[1] + 0.03, c[2]];
  await rig.move({ gaze: c, right: centre }, 0.5);
  await rig.hold(0.2);
  await rig.pinch('right', 1, 0.18);
  const r = 0.022;
  const steps = Math.round(4.2 * FPS);
  for (let i = 1; i <= steps; i += 1) {
    const a = (i / steps) * Math.PI * 2 * 3.6;
    const grow = Math.min(1, i / (0.25 * FPS));
    rig.hands.right.pos = [centre[0] + Math.cos(a) * r * grow, centre[1], centre[2] + Math.sin(a) * r * grow];
    await rig.frame();
    if (i % FPS === 0 && (await info()).mud >= 1) break;
  }
  await rig.pinch('right', 0, 0.18);
  await rig.hold(0.4);
  await check('mud ready', (s) => s.mud >= 1);
  await rest();
});

await section('walls', async () => {
  const spire = await rig.where('app.handles.spire');
  const h = await pull(spire, [0, 0.024, 0], 1.0, [spire[0], spire[1] + 0.01, spire[2]]);
  console.log('    spire hover', h);
  await rig.hold(1.2);
  await check('walls up', (s) => s.h >= 2.4);
  await rest(0.4);
  // Palm up: the menu blooms over the left hand. Pinch "Roof".
  rig.hands.left.quat = [0, 0, 1, 0];
  await rig.move({ left: [-0.14, 1.0, -0.36], gaze: [-0.1, 1.08, -0.4] }, 0.5);
  await rig.hold(1.0);
  await check('menu open', (s) => s.menu);
  const roof = await rig.where('app.menu.labels[4].mesh');
  await tap(roof, 'right', 'menu-4');
  rig.hands.left.quat = [0, 0, 0, 1];
  await rest(0.5);
  await rig.hold(0.8);
  await check('roofed', (s) => s.roof && s.beat === 'movein');
  // Cut a window in two outside walls.
  const panels = await app(() => {
    const a = globalThis.ile;
    return a.handles.slots
      .filter((m) => m.visible && m.userData.slot.type !== 'room')
      .map((m) => { const p = m.position.clone(); m.getWorldPosition(p); return { key: `${m.userData.slot.room}:${m.userData.slot.side}`, type: m.userData.slot.type, p: [p.x, p.y, p.z] }; });
  });
  let cut = 0;
  for (const panel of panels) {
    if (cut >= 3) break;
    rig.gaze = panel.p;
    const was = rig.capturing;
    rig.capturing = false;
    await rig.settle();
    rig.capturing = was;
    if (!/^slot-/.test((await hover()) ?? '')) continue;
    await tap(panel.p, 'right', /^slot-/);
    cut += 1;
  }
  await check('openings cut', (s) => s.open >= 2);
  await rest();
});

let home = 'r1';
await section('movein', async () => {
  let aim = null;
  for (const id of await app(() => globalThis.ile.design.rooms.map((r) => r.id))) {
    aim = await findRoomAim(rig, id);
    if (aim) { home = id; break; }
  }
  await rig.move({ gaze: LOOK }, 0.3);
  await tap(aim, 'right', `room-${home}`);
  await rig.move({ ...REST, pitch: -0.3, gaze: [0, 0.7, -1.2] }, 1.6);
  await rig.hold(0.8);
  await check('inside', (s) => s.mode === 'inside' && s.beat === 'settle');
  const carry = async (id, by, seconds) => {
    const p = await rig.where(`app.story.items.get('${id}').group`);
    const hand = [0.17, 1.02, -0.42];
    await rig.move({ gaze: [p[0], p[1] + (id === 'photo' ? 0 : 0.08), p[2]], right: hand }, 0.55);
    await rig.hold(0.2);
    await rig.pinch('right', 1, 0.2);
    const n = Math.round(seconds * FPS);
    for (let i = 1; i <= n; i += 1) {
      const k = i / n;
      const e = k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2;
      rig.hands.right.pos = hand.map((v, j) => v + by[j] * e);
      if (i % 3 === 0) rig.gaze = await rig.where(`app.story.items.get('${id}').group`);
      await rig.frame();
    }
    await rig.hold(0.15);
    await rig.pinch('right', 0, 0.2);
    await rig.hold(0.45);
  };
  await carry('fan', [-0.3, 0, -0.16], 1.3);
  await carry('photo', [0.1, 0.2, -0.22], 1.3);
  await carry('mattress', [0.26, 0, -0.1], 1.2);
  await check('belongings placed', (s) => s.items.length >= 2);
  // Look around the room you built.
  await rig.move({ ...REST, gaze: [-0.4, 1.0, -2], pitch: -0.1, yaw: 0.45 }, 1.4);
  await rig.hold(0.8);
  await rig.move({ yaw: -0.4 }, 1.8);
  await rig.move({ yaw: 0, pitch: -0.3 }, 1.0);
  // Back out to the table.
  const back = await rig.where('app.back.mesh');
  await tap(back, 'right', 'back');
  await rig.move({ ...REST, pitch: -0.34, gaze: LOOK }, 1.5);
  await rig.hold(0.6);
  await check('back at table', (s) => s.mode === 'table' && s.beat === 'afternoon');
});

await section('afternoon', async () => {
  await rig.hold(9.5);
  await check('heat on', (s) => s.heat && s.hour === 15);
});

await section('nepa', async () => {
  for (let i = 0; i < 12 && (await info()).power; i += 1) await rig.hold(0.5);
  await check('power cut', (s) => !s.power);
  await rig.hold(4.5);
});

await section('baba', async () => {
  const before = (await info()).score;
  for (let round = 0; round < 3; round += 1) {
    const baba = await rig.where('app.elder');
    await tap([baba[0], baba[1] + 0.045, baba[2]], 'right', 'elder');
    await rest(0.4);
    for (let i = 0; i < 60 && !(await info()).proposal; i += 1) { await rig.hold(0.25); await new Promise((r) => setTimeout(r, 60)); }
    if (!(await info()).proposal) break;
    await rig.hold(TAKE ? 3.2 : 0.5);
    const yes = await rig.where('app.accept.mesh');
    await tap(yes, 'right', 'accept');
    await rest(0.5);
    await rig.hold(TAKE ? 1.6 : 0.4);
    const s = await info();
    if (s.score - before >= 10 || s.beat !== 'advice') {
      if (s.score - before >= 10) break;
    }
    // After the first fix the story moves to evening; later fixes just help.
    if (round === 0 && s.score - before >= 10) break;
  }
  await check('fix accepted, score up', (s) => s.score > before);
  console.log('    score', before, '->', (await info()).score);
});

await section('evening', async () => {
  for (let i = 0; i < 60 && !(await info()).card; i += 1) await rig.hold(0.5);
  await check('journal', (s) => s.card);
  await rig.hold(TAKE ? 3.5 : 0.5);
});

// ------------------------------------------------------- the years after

await section('day2', async () => {
  const card = await rig.where('app.story.card.mesh');
  await tap(card, 'right', 'journal');
  await rest(0.5);
  await rig.hold(2.5);
  await check('day 2', (s) => s.day === 2 && !s.card);
  // Baba's prompt: a room for your sister. Lay it by hand.
  await lay(5.2, -5.8, 8.8, -2.2);
  await check('sister room', (s) => s.rooms === 5);
  await rest();
});

async function sweepSun(seconds) {
  const n = Math.round(seconds * FPS);
  for (let i = 0; i <= n; i += 1) {
    await app((h) => globalThis.ile.setHour(h, true), 8 + (10 * i) / n);
    await rig.frame();
  }
}

await section('years', async () => {
  // Off camera between cuts: the house as it stands a year on, then ten.
  await app(async () => {
    const st = await import('/src/model/state.ts');
    const a = globalThis.ile;
    let d = a.design;
    for (const r of st.rooms(d)) for (const s of st.SIDES) if (r.sides[s].type !== 'room') d = st.setOpening(d, r.id, s, true);
    d = st.setOverhang(d, 'all', 1.2);
    a.story.story.savings = 9_000_000;
    a.commit(d, 'years');
    a.story.story.savings = 185_000;
    a.story.story.day = 365;
    a.setHeat(true);
    a.refresh();
  });
  rig.marks.push({ name: 'cap:One year later', start: rig.now() });
  await sweepSun(4.5);
  await app(async () => {
    const st = await import('/src/model/state.ts');
    const a = globalThis.ile;
    let d = a.design;
    d = st.setCourtSize(d, 6, 6);
    d = st.setWallHeight(d, 3.6);
    d = st.setOverhang(d, 'west', 1.8);
    const more = st.addRoom(d, { x0: -9, x1: -6, z0: -3, z1: 3 });
    if (more) d = more;
    a.story.story.savings = 9_000_000;
    a.commit(d, 'years');
    a.story.story.savings = 640_000;
    a.story.story.day = 3650;
    a.refresh();
  });
  rig.marks.push({ name: 'cap:Ten years later', start: rig.now() });
  await sweepSun(4.5);
  await check('grown house', (s) => s.rooms >= 5 && s.score >= 60);
});

await section('home', async () => {
  // Step back inside the first room, at dusk, among your things.
  await app(() => { const a = globalThis.ile; a.setHeat(false); a.setHour(17.5, true); });
  const aim = await findRoomAim(rig, home);
  await rig.move({ gaze: LOOK }, 0.3);
  await tap(aim, 'right', `room-${home}`);
  await rig.move({ ...REST, pitch: -0.12, gaze: [0, 1.0, -2] }, 1.6);
  await rig.hold(1.0);
  await rig.move({ yaw: 0.4 }, 1.6);
  await rig.move({ yaw: -0.3 }, 2.0);
  await check('home again', (s) => s.mode === 'inside');
});

await section('end', async () => {
  await rig.hold(3.0);
});

rig.marks.push({ name: 'end', start: rig.now() });
fs.writeFileSync(`${OUT}/marks.json`, JSON.stringify(rig.marks, null, 1));
await rig.browser.close();
console.log(fails.length ? `FAILED: ${fails.join(' | ')}` : 'ALL OK', '·', rig.frameNo, 'frames', rig.now().toFixed(1), 's', rig.wall());
