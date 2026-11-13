// Records a scripted desktop-preview session of the live Ilé deployment.
//
// The Codespace has no GPU, so real-time capture is choppy. Instead the page
// runs on a virtual clock: each step advances exactly one video frame, and the
// frame is read from the WebGL canvas inside the same animation-frame batch
// that rendered it. Mouse input is real Playwright input.
import { chromium } from 'playwright';
import fs from 'node:fs';

const URL = process.env.ILE_URL || 'https://ile-dun.vercel.app/';
const OUT = '/tmp/demo';
const FRAMES = `${OUT}/frames`;
const FPS = Number(process.env.ILE_FPS || 30);
const LIMIT = Number(process.env.ILE_FRAMES || 0);
const vo = Object.fromEntries(
  JSON.parse(fs.readFileSync(`${OUT}/vo.json`, 'utf8')).map((v) => [v.name, v.seconds]),
);
const realSleep = (ms) => new Promise((r) => setTimeout(r, ms));

fs.mkdirSync(FRAMES, { recursive: true });
for (const f of fs.readdirSync(FRAMES)) fs.unlinkSync(`${FRAMES}/${f}`);

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'],
});
const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
const page = await context.newPage();
const wall0 = Date.now();
const wall = () => `${((Date.now() - wall0) / 1000).toFixed(0)}s wall`;
let frameNo = 0;
let capturing = false;
const now = () => frameNo / FPS;

page.on('console', (m) => { if (m.text().includes('[ile]')) console.log('  page:', m.text()); });
page.on('pageerror', (e) => console.log('  PAGEERROR', e.message));

await page.clock.install({ time: new Date('2026-11-13T15:00:00') });
await page.addInitScript(() => {
  window.__mouse = { x: 640, y: 420, down: false };
  window.addEventListener('pointermove', (e) => { window.__mouse.x = e.clientX; window.__mouse.y = e.clientY; }, true);
  window.addEventListener('pointerdown', () => { window.__mouse.down = true; }, true);
  window.addEventListener('pointerup', () => { window.__mouse.down = false; }, true);
});

/** Advance the page by one video frame and (when capturing) save it. */
async function frame() {
  if (!capturing) { await page.clock.runFor(1000 / FPS); return; }
  await page.evaluate(() => {
    requestAnimationFrame(() => {
      const gl = globalThis.ile.world.renderer.domElement;
      const c = (window.__cap ??= Object.assign(document.createElement('canvas'), { width: 1280, height: 720 }));
      const g = c.getContext('2d');
      g.drawImage(gl, 0, 0, 1280, 720);
      const m = window.__mouse;
      const r = m.down ? 7 : 11;
      g.beginPath(); g.arc(m.x, m.y, r, 0, Math.PI * 2);
      g.fillStyle = m.down ? 'rgba(255,255,255,.95)' : 'rgba(242,178,62,.6)'; g.fill();
      g.lineWidth = 3; g.strokeStyle = '#fff'; g.stroke();
      g.beginPath(); g.arc(m.x, m.y, r + 2.5, 0, Math.PI * 2);
      g.lineWidth = 1; g.strokeStyle = 'rgba(0,0,0,.6)'; g.stroke();
      window.__shot = c.toDataURL('image/jpeg', 0.93);
    });
  });
  await page.clock.runFor(1000 / FPS);
  const data = await page.evaluate(() => window.__shot);
  fs.writeFileSync(`${FRAMES}/f${String(frameNo).padStart(5, '0')}.jpg`, Buffer.from(data.split(',')[1], 'base64'));
  frameNo += 1;
  if (frameNo % 150 === 0) console.log('  frames', frameNo, wall());
  if (LIMIT && frameNo >= LIMIT) { console.log('frame limit reached', wall()); await browser.close(); process.exit(0); }
}
/** Wait in video time. */
async function sleep(ms) {
  const n = Math.max(1, Math.round((ms / 1000) * FPS));
  for (let i = 0; i < n; i += 1) await frame();
}

await page.goto(URL, { waitUntil: 'load' });
for (let i = 0; i < 600; i += 1) {
  await frame();
  if (await page.evaluate(() => !!globalThis.ile)) break;
  await realSleep(100);
}

/** Screen position of an object reachable from the app, e.g. "app.table.sunBall". */
const at = (expr, dx = 0, dy = 0, dz = 0) =>
  page.evaluate(([expr, dx, dy, dz]) => {
    const app = globalThis.ile;
    const o = new Function('app', `return ${expr}`)(app);
    const p = o.position.clone();
    o.getWorldPosition(p);
    p.x += dx; p.y += dy; p.z += dz;
    p.project(app.world.camera);
    const r = app.world.renderer.domElement.getBoundingClientRect();
    return { x: r.left + ((p.x + 1) / 2) * r.width, y: r.top + ((1 - p.y) / 2) * r.height };
  }, [expr, dx, dy, dz]);
const hover = () => page.evaluate(() => globalThis.ile.gestures.pointers.mouse.hover?.id ?? null);
const state = () => page.evaluate(() => {
  const a = globalThis.ile;
  return { mode: a.mode, score: a.day.overall, proposal: !!a.proposal, hour: a.design.hour };
});

let cur = { x: 640, y: 420 };
async function glide(to, ms = 600) {
  const steps = Math.max(4, Math.round((ms / 1000) * FPS));
  for (let i = 1; i <= steps; i += 1) {
    const k = i / steps;
    const e = k * k * (3 - 2 * k);
    await page.mouse.move(cur.x + (to.x - cur.x) * e, cur.y + (to.y - cur.y) * e);
    await frame();
  }
  cur = { ...to };
}
async function click(to, ms = 700) {
  await glide(to, ms); await sleep(250);
  await page.mouse.down(); await sleep(140); await page.mouse.up();
}
async function drag(from, by, ms = 1400) {
  await glide(from, 700); await sleep(300);
  await page.mouse.down(); await sleep(200);
  await glide({ x: from.x + by.x, y: from.y + by.y }, ms); await sleep(250);
  await page.mouse.up();
}

// ---- setup (not captured)
await sleep(3400);
await page.keyboard.press('s'); // skip the tutorial
await sleep(600);
const sunAt = {};
for (let h = 9; h <= 17; h += 1) {
  await page.evaluate((hour) => globalThis.ile.setHour(hour), h);
  await sleep(70);
  sunAt[h] = await at('app.table.sunBall');
}
await page.evaluate(() => globalThis.ile.setHour(15));
await page.mouse.move(cur.x, cur.y);
await sleep(3200); // let the "Intro skipped" toast clear
console.log('setup done', wall(), await state());
capturing = true;

const marks = [];
async function slot(name, extra, fn) {
  const start = now();
  marks.push({ name, start });
  console.log(`[${start.toFixed(1)}s] ${name} (${wall()})`);
  await fn();
  const end = start + vo[name] + extra;
  if (now() < end) await sleep((end - now()) * 1000);
}

await slot('intro', 0.7, async () => {
  await sleep(1200);
  await glide(await at('app.handles.wall.east'), 1500); await sleep(900);
  await glide(await at('app.table.sunBall'), 1500); await sleep(800);
  await glide(await at('app.elder', 0, 0.05, 0), 1600);
});
await slot('hands', 0.6, async () => { await glide({ x: 640, y: 430 }, 800); });
await slot('sculpt', 0.8, async () => {
  await sleep(600);
  await drag(await at('app.handles.wall.east'), { x: 62, y: 0 }, 1500);
  await sleep(500);
  await drag(await at('app.handles.wall.west'), { x: -44, y: 0 }, 1300);
  console.log('  after sculpt', await state());
});
await slot('heat', 0.8, async () => {
  await sleep(700);
  await page.keyboard.press('h');
  await glide({ x: 640, y: 330 }, 900);
});
await slot('sun', 2.4, async () => {
  await glide(await at('app.table.sunBall'), 700); await sleep(250);
  await page.mouse.down(); await sleep(200);
  for (const h of [14, 13, 12, 11, 10, 9]) await glide(sunAt[h], 420);
  await sleep(500);
  for (const h of [10, 11, 12, 13, 14, 15, 16, 17]) await glide(sunAt[h], 330);
  await sleep(400);
  for (const h of [16, 15]) await glide(sunAt[h], 330);
  await sleep(200);
  await page.mouse.up();
  console.log('  after sun', await state());
});
await slot('elder', 0.6, async () => {
  await sleep(1500);
  await click(await at('app.elder', 0, 0.05, 0), 900);
  for (let i = 0; i < 240 && !(await state()).proposal; i += 1) { await frame(); await realSleep(40); }
  console.log('  proposal', await state());
  await glide({ x: 640, y: 400 }, 900);
});
await slot('accept', 0.8, async () => {
  await sleep(2600);
  await click(await at('app.accept.mesh'), 800);
  await sleep(500);
  console.log('  after accept', await state());
  await glide({ x: 700, y: 300 }, 700);
});
await slot('inside', 4.2, async () => {
  await sleep(1300);
  // Find a point on a room floor that really picks that room.
  let hit = null;
  for (const room of ['gate', 'parlour', 'bed1', 'bed2']) {
    for (const [dx, dz] of [[0, 0], [0.012, 0], [-0.012, 0], [0, -0.012], [0.02, -0.01], [-0.02, -0.01]]) {
      const p = await at(`app.view.floors.get('${room}')`, dx, 0, dz);
      await glide(p, 260); await sleep(120);
      if ((await hover()) === `room-${room}`) { hit = p; break; }
    }
    if (hit) break;
  }
  console.log('  room hit', hit, await hover());
  await sleep(300);
  await page.mouse.down(); await sleep(140); await page.mouse.up();
  await sleep(2600);
  console.log('  inside?', await state());
});
await slot('compare', 2.8, async () => {
  await page.keyboard.press('b'); await sleep(1900);
  console.log('  back?', await state());
  await page.keyboard.press('c');
  await glide({ x: 640, y: 560 }, 800);
});
await slot('outro', 2.4, async () => {});
marks.push({ name: 'end', start: now() });

fs.writeFileSync(`${OUT}/marks.json`, JSON.stringify(marks, null, 1));
await browser.close();
console.log('done', frameNo, 'frames', marks.at(-1).start.toFixed(1), 's', wall());
