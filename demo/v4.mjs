// Ilé v2 demo — "Build a home. Grow a life in Lagos." Seven days, hands only.
//   ILE_TAKE=0 rehearsal (no frames) · ILE_TAKE=1 take (frames + marks)
//   ILE_GPU=1 real GPU · ILE_HD=1 1920x1080 · ILE_ONLY=a,b run some sections
import fs from 'node:fs';
import { FPS, findRoomAim, openRig } from './hands.mjs';

const TAKE = process.env.ILE_TAKE === '1';
const OUT = TAKE ? '/tmp/v4/frames' : '/tmp/v4-rehearsal';
const MARKS = TAKE ? '/tmp/v4/marks.json' : '/tmp/v4-rehearsal/marks.json';
const vo = fs.existsSync('/tmp/v4/vo.json')
  ? Object.fromEntries(JSON.parse(fs.readFileSync('/tmp/v4/vo.json', 'utf8')).map((v) => [v.name, v.seconds]))
  : {};

const rig = await openRig({ out: OUT, pitch: -0.36 });
// Pace: hands move a little faster than life (ILE_PACE < 1), and app time
// runs 1/PACE per video frame, so the story's timing is unchanged.
const PACE = Number(process.env.ILE_PACE || 0.72);
const BASE = 1 / PACE;
rig.speed = BASE;
const rawHold = rig.hold;
const rawMove = rig.move;
rig.move = (to, s = 0.45) => rawMove(to, s * PACE);
rig.hold = (s) => rawHold(s * PACE);
const page = rig.page;
const REST = { right: [0.24, 1.0, -0.2], left: [-0.24, 1.0, -0.2] };
const RAISED = { right: [0.13, 1.13, -0.36], left: [-0.13, 1.13, -0.36] };
const LOOK = [0, 0.98, -0.62];
const fails = [];
const app = (fn, arg) => page.evaluate(fn, arg);
const info = () =>
  app(() => {
    const a = globalThis.ile, d = a.design, s = a.story;
    return {
      mode: a.mode, rooms: d.rooms.length, court: !!d.court, h: d.wallHeight, roof: d.roof, mud: +a.mud.progress.toFixed(2),
      score: a.dayScore, proposal: !!a.proposal, step: s.stepId, day: s.story.day, savings: s.story.savings, joy: s.story.joy,
      items: s.story.items.map((i) => i.item), fan: s.story.fanOn, power: s.story.power, card: s.card.mesh.visible,
      home: s.home.task, homeStep: s.home.step, floors: s.story.extras.floors, shop: s.story.extras.shop, menu: a.menu.isOpen,
    };
  });
async function check(label, ok) {
  const s = await info();
  const pass = ok(s);
  console.log(`${pass ? '  ok  ' : '  FAIL'} ${label}`, JSON.stringify(s));
  if (!pass) {
    fails.push(label);
    if (TAKE) {
      fs.writeFileSync(MARKS, JSON.stringify(rig.marks, null, 1));
      console.log(`ABORTED at "${label}"`);
      await rig.browser.close();
      process.exit(1);
    }
  }
  return s;
}
const hover = async () => (await rig.state()).hover.right;
async function section(name, fn, tail = 0.4) {
  const start = rig.now();
  rig.mark(name);
  await fn();
  const need = (vo[name] ?? 0) + tail;
  if (TAKE && rig.now() - start < need) {
    const was = rig.speed;
    rig.speed = BASE;
    await rawHold(need - (rig.now() - start));
    rig.speed = was;
  }
}
const rest = (s = 0.45) => rig.move({ ...REST, gaze: LOOK }, s);
async function pinchAt(point, hand = 'right') {
  await rig.move({ gaze: point, [hand]: RAISED[hand] }, 0.45);
  await rig.settle();
  const h = await hover();
  await rig.pinch(hand, 1, 0.16);
  await rig.hold(0.1);
  await rig.pinch(hand, 0, 0.16);
  await rig.hold(0.2);
  return h;
}
/** Gaze at a point, pinch, move the hand by `by` (world metres), release. */
async function carry(point, by, seconds = 0.8, from = RAISED.right) {
  await rig.move({ gaze: point, right: from }, 0.45);
  await rig.settle();
  await rig.pinch('right', 1, 0.16);
  await rig.hold(0.08);
  await rig.move({ right: from.map((v, i) => v + by[i]), gaze: point.map((v, i) => v + by[i]) }, seconds);
  await rig.hold(0.1);
  await rig.pinch('right', 0, 0.16);
  await rig.hold(0.2);
}
async function lay(x0, z0, x1, z1) {
  const a = await rig.local(x0, -0.24, z0);
  const b = await rig.local(x1, -0.24, z1);
  await rig.move({ gaze: a, right: [a[0], a[1] + 0.06, a[2]] }, 0.5);
  await rig.settle();
  const h = await hover();
  if (h !== 'plot') console.log(`    lay: hover ${h}`);
  await rig.pinch('right', 1, 0.16);
  await rig.move({ right: [b[0], b[1] + 0.06, b[2]], gaze: b }, 0.85);
  await rig.hold(0.1);
  await rig.pinch('right', 0, 0.16);
  await rig.hold(0.25);
}
async function enterRoom(preferred) {
  const ids = await app(() => globalThis.ile.design.rooms.map((r) => r.id));
  for (const id of [preferred, ...ids.filter((x) => x !== preferred)].filter(Boolean)) {
    const aim = await findRoomAim(rig, id);
    if (!aim) continue;
    await rig.move({ gaze: aim, right: RAISED.right }, 0.45);
    await rig.settle();
    if ((await hover()) !== `room-${id}`) continue;
    await rig.pinch('right', 1, 0.16);
    await rig.hold(0.1);
    await rig.pinch('right', 0, 0.16);
    await rig.move({ ...REST, pitch: -0.3, gaze: [0, 0.75, -1.2] }, 1.5);
    await rig.hold(0.4);
    return id;
  }
  return null;
}
async function backToTable() {
  await pinchAt(await rig.where('app.back.mesh'));
  await rig.move({ ...REST, pitch: -0.36, gaze: LOOK }, 1.4);
  await rig.hold(0.3);
}
async function journal() {
  for (let i = 0; i < 40 && !(await info()).card; i += 1) await rig.hold(0.25);
  await rig.hold(TAKE ? 1.8 : 0.3);
  await pinchAt(await rig.where('app.story.card.mesh'));
  await rest();
}
async function askBaba(until) {
  for (let round = 0; round < 3; round += 1) {
    const b = await rig.where('app.elder');
    await pinchAt([b[0], b[1] + 0.045, b[2]]);
    await rest(0.35);
    for (let i = 0; i < 60 && !(await info()).proposal; i += 1) { await rig.hold(0.2); await new Promise((r) => setTimeout(r, 60)); }
    if (!(await info()).proposal) break;
    await rig.hold(TAKE ? 2.4 : 0.3);
    await pinchAt(await rig.where('app.accept.mesh'));
    await rest(0.35);
    await rig.hold(TAKE ? 1.0 : 0.2);
    if (until(await info())) break;
  }
}
async function raise() {
  const tip = await rig.where('app.story.rise.children[0].children[1]');
  await carry(tip, [0, 0.03, 0], 0.9, [tip[0], tip[1] + 0.012, tip[2]]);
  await rig.hold(0.8);
}
const houseBounds = () => app(() => {
  const d = globalThis.ile.design.rooms;
  return { x0: Math.min(...d.map((r) => r.x0)), x1: Math.max(...d.map((r) => r.x1)), z0: Math.min(...d.map((r) => r.z0)), z1: Math.max(...d.map((r) => r.z1)) };
});
const homeAt = (name) => app((n) => { const p = globalThis.ile.story.home.where(n); return [p.x, p.y, p.z]; }, name);
const minus = (a, b, k = 1) => a.map((v, i) => (v - b[i]) / k);

rig.capturing = TAKE;

// ---------------------------------------------------------------- Day 1
await section('cold', async () => {
  await rig.move({ gaze: [0, 0.95, -0.75], pitch: -0.32 }, 2.6);
  await rig.move({ yaw: 0.25 }, 1.6);
  await rig.move({ yaw: -0.2 }, 1.8);
  await rig.move({ yaw: 0, gaze: LOOK, pitch: -0.36 }, 1.0);
});
await section('day1', async () => {
  await pinchAt(await rig.where('app.cards[0].label.mesh'));
  await rest(0.5);
  await rig.hold(2.0);
  await check('day 1 started', (s) => s.day === 1 && s.step === 'build');
  await lay(-4.8, -5.8, 4.8, -2.2);
  await lay(-4.8, -1.8, -2.2, 1.8);
  await lay(2.2, -1.8, 4.8, 1.8);
  await lay(-4.8, 2.2, 4.8, 5.8);
  await pinchAt(await rig.local(1.2, -0.24, -0.7));
  await check('rooms and courtyard', (s) => s.rooms === 4 && s.court);
  await rest();
});
await section('mud', async () => {
  const pit = await rig.local(10.6, 0.1, 10.6);
  for (const [x, z] of [[6.6, 11.3], [8.4, 8.2], [11.6, 6.9]]) {
    const from = await rig.where(`app.mud.group.children.find((c) => Math.abs(c.position.x - ${x}) < 0.01 && Math.abs(c.position.z - ${z}) < 0.01)`);
    await rig.move({ gaze: from, right: [from[0], from[1] + 0.02, from[2]] }, 0.45);
    await rig.settle();
    await rig.pinch('right', 1, 0.16);
    await rig.move({ right: [pit[0], pit[1] + 0.04, pit[2]], gaze: pit }, 0.7);
    await rig.pinch('right', 0, 0.16);
    await rig.hold(0.2);
  }
  const c = [pit[0], pit[1] + 0.03, pit[2]];
  await rig.move({ gaze: pit, right: c }, 0.4);
  await rig.settle();
  await rig.pinch('right', 1, 0.16);
  const n = Math.round(3.4 * FPS);
  for (let i = 1; i <= n; i += 1) {
    const a = (i / n) * Math.PI * 2 * 3.6;
    const g = Math.min(1, i / (0.25 * FPS));
    rig.hands.right.pos = [c[0] + Math.cos(a) * 0.022 * g, c[1], c[2] + Math.sin(a) * 0.022 * g];
    await rig.frame();
    if (i % FPS === 0 && (await info()).mud >= 1) break;
  }
  await rig.pinch('right', 0, 0.16);
  await check('mud ready', (s) => s.mud >= 1);
  await rest();
});
await section('walls', async () => {
  const spire = await rig.where('app.handles.spire');
  await carry(spire, [0, 0.024, 0], 0.9, [spire[0], spire[1] + 0.01, spire[2]]);
  await rig.hold(0.8);
  rig.hands.left.quat = [0, 0, 1, 0];
  await rig.move({ left: [-0.14, 1.0, -0.36], gaze: [-0.1, 1.08, -0.4] }, 0.45);
  await rig.hold(0.9);
  await pinchAt(await rig.where('app.menu.labels[4].mesh'));
  rig.hands.left.quat = [0, 0, 0, 1];
  await rest();
  await rig.hold(0.8);
  await check('house built, day 1 done', (s) => s.roof && s.h >= 2.4 && s.step === null);
  await journal();
  await check('day 2', (s) => s.day === 2 && s.step === 'movein');
});

// ---------------------------------------------------------------- Day 2
let home = 'r1';
await section('day2', async () => {
  rig.speed = BASE;
  home = (await enterRoom('r1')) ?? home;
  await check('inside', (s) => s.mode === 'inside');
  const place = async (id, by) => {
    const p = await rig.where(`app.story.items.get('${id}').group`);
    await carry([p[0], p[1] + (id === 'photo' ? 0 : 0.08), p[2]], by, 1.0, [0.17, 1.02, -0.42]);
  };
  await place('fan', [-0.3, 0, -0.16]);
  await place('photo', [0.1, 0.2, -0.22]);
  await check('belongings', (s) => s.items.length >= 2 && s.step === 'fan');
  await pinchAt(await rig.where("app.story.items.get('fan').switch"));
  await rig.hold(1.2);
  await check('fan on', (s) => s.fan && s.step === 'out');
  await backToTable();
  await check('afternoon', (s) => s.step === 'afternoon');
});
await section('nepa', async () => {
  rig.speed = 2 * BASE;
  for (let i = 0; i < 80 && (await info()).step !== 'advice'; i += 1) await rig.hold(0.25);
  rig.speed = BASE;
  await check('power cut, Baba', (s) => !s.power && s.step === 'advice');
});
await section('baba', async () => {
  await askBaba((s) => s.step !== 'advice');
  await check('fixes accepted', (s) => s.step !== 'advice');
  await journal();
  await check('day 3', (s) => s.day === 3 && s.step === 'meet');
});

// ---------------------------------------------------------------- Day 3
await section('day3', async () => {
  rig.speed = 2 * BASE;
  for (let i = 0; i < 60 && (await info()).step === 'meet'; i += 1) await rig.hold(0.25);
  rig.speed = BASE;
  // Next to the house as it now stands (Baba's fixes can move its walls).
  const b = await houseBounds();
  // Start at the corner far from the house, so the line of sight clears its walls.
  await lay(Math.min(11.6, b.x1 + 4.7), b.z0 + 0.3, b.x1 + 1.3, b.z0 + 3.7);
  await check('second room', (s) => s.rooms === 5 && s.step === 'dinner');
});
await section('dinner', async () => {
  await enterRoom(home);
  await check('dinner kit', (s) => s.home === 'dinner' && s.homeStep === 'stir');
  const pot = await homeAt('pot');
  await rig.move({ gaze: pot, right: RAISED.right }, 0.45);
  await rig.settle();
  await rig.pinch('right', 1, 0.16);
  const c = RAISED.right;
  const n = Math.round(2.6 * FPS);
  for (let i = 1; i <= n; i += 1) {
    const a = (i / n) * Math.PI * 2 * 2.6;
    rig.hands.right.pos = [c[0] + Math.cos(a) * 0.035, c[1], c[2] + Math.sin(a) * 0.035];
    await rig.frame();
  }
  await rig.pinch('right', 0, 0.16);
  await check('stirred', (s) => s.homeStep === 'plates');
  for (const k of [0, 1]) {
    const from = await homeAt(`plate${k}`);
    const to = await homeAt(`table${k}`);
    await carry(from, minus(to, from, 2.2), 0.8);
  }
  await check('plates on table', (s) => s.homeStep === 'serve');
  for (const k of [0, 1]) {
    const p = await homeAt('pot');
    const to = await homeAt(`table${k}`);
    await carry(p, minus([to[0], to[1] + 0.1, to[2]], p, 2.2), 0.8);
  }
  await check('served', (s) => s.homeStep === 'eat');
  await rig.hold(4.6);
  await check('eaten', (s) => s.homeStep === 'wash');
});
await section('wash', async () => {
  const plate = await homeAt('plate0');
  const basin = await homeAt('basin');
  await rig.move({ gaze: plate, right: RAISED.right }, 0.45);
  await rig.settle();
  await rig.pinch('right', 1, 0.16);
  const start = [...RAISED.right];
  const to = start.map((v, i) => v + minus(basin, plate, 2.2)[i]);
  await rig.move({ right: to, gaze: basin }, 0.8);
  for (let i = 0; i < 5; i += 1) {
    await rig.move({ right: [to[0] + 0.03, to[1], to[2]] }, 0.2);
    await rig.move({ right: [to[0] - 0.03, to[1], to[2]] }, 0.2);
  }
  await check('washed', (s) => s.homeStep === 'rack');
  const rack = await homeAt('rack');
  await rig.move({ right: to.map((v, i) => v + minus(rack, basin, 2.2)[i]), gaze: rack }, 0.6);
  await rig.pinch('right', 0, 0.16);
  await rig.hold(2.4);
  await check('dinner done', (s) => s.home === null);
  await backToTable();
  await journal();
  await check('day 4', (s) => s.day === 4 && s.step === 'nursery');
});

// ---------------------------------------------------------------- Day 4
let nursery = null;
await section('day4', async () => {
  // Below Adaeze's room, dragged from the far corner toward it.
  const r = await app(() => { const d = globalThis.ile.design.rooms; const x = d[d.length - 1]; return { x0: x.x0, x1: x.x1, z1: x.z1 }; });
  await lay(r.x1 - 0.1, r.z1 + 3.6, r.x0 + 0.1, r.z1 - 0.1);
  await rig.hold(1.5);
  nursery = await app(() => globalThis.ile.design.rooms.find((r) => r.name === 'Nursery')?.id ?? null);
  if ((await info()).step === 'cool') await askBaba((s) => s.step !== 'cool');
  for (let i = 0; i < 20 && (await info()).step === 'cool'; i += 1) await rig.hold(0.25);
  await check('nursery cool', (s) => s.step === 'cot');
  await enterRoom(nursery);
  await check('cot', (s) => s.home === 'cot');
  const cot = await homeAt('cot');
  await carry(cot, [0.06, 0, 0.04], 0.6);
  const mob = await homeAt('mobile');
  await rig.move({ gaze: mob, right: RAISED.right }, 0.45);
  await rig.settle();
  await rig.pinch('right', 1, 0.16);
  const c = RAISED.right;
  for (let i = 1; i <= Math.round(2.4 * FPS); i += 1) {
    const a = (i / (2.4 * FPS)) * Math.PI * 2 * 2.6;
    rig.hands.right.pos = [c[0] + Math.cos(a) * 0.035, c[1], c[2] + Math.sin(a) * 0.035];
    await rig.frame();
  }
  await rig.pinch('right', 0, 0.16);
  await rig.hold(2.4);
  await check('Tolu asleep', (s) => s.home === null);
  await backToTable();
  await journal();
  await check('day 5', (s) => s.day === 5 && s.step === 'shop');
});

// ---------------------------------------------------------------- Day 5–7
await section('day5', async () => {
  await raise();
  await check('food spot', (s) => s.shop === 1);
  rig.speed = 2 * BASE;
  for (let i = 0; i < 40 && (await info()).step === 'customers'; i += 1) await rig.hold(0.25);
  rig.speed = BASE;
  await journal();
  await check('day 6', (s) => s.day === 6);
});
await section('day6', async () => {
  rig.speed = 2 * BASE;
  for (let i = 0; i < 40 && (await info()).step === 'match'; i += 1) await rig.hold(0.25);
  rig.speed = BASE;
  await raise();
  await check('upstairs', (s) => s.floors === 2 && s.step === 'homework');
  await enterRoom(home);
  await check('homework', (s) => s.home === 'homework');
  const book = await homeAt('book');
  for (let k = 0; k < 3; k += 1) await carry(book, [-0.08, 0, 0], 0.35);
  await rig.hold(2.4);
  await backToTable();
  await journal();
  await check('day 7', (s) => s.day === 7 && s.step === 'big');
});
await section('day7', async () => {
  await raise();
  await check('compound', (s) => s.floors === 3 && s.shop === 2);
  await rig.move({ gaze: [0, 1.0, -0.6], pitch: -0.3 }, 1.2);
});
await section('party', async () => {
  rig.speed = 2 * BASE;
  for (let i = 0; i < 80 && (await info()).step === 'party'; i += 1) await rig.hold(0.25);
  rig.speed = BASE;
  await rig.move({ yaw: 0.2 }, 1.4);
  await rig.move({ yaw: -0.15 }, 1.6);
  await rig.move({ yaw: 0 }, 0.8);
  for (let i = 0; i < 30 && !(await info()).card; i += 1) await rig.hold(0.25);
  await check('final journal', (s) => s.card);
  await rig.hold(2.5);
});
await section('end', async () => {
  await rig.hold(4.0);
});

rig.marks.push({ name: 'stop', start: rig.now() });
fs.writeFileSync(MARKS, JSON.stringify(rig.marks, null, 1));
await rig.browser.close();
console.log(fails.length ? `FAILED: ${fails.join(' | ')}` : 'ALL OK', '·', rig.frameNo, 'frames', rig.now().toFixed(1), 's', rig.wall());
