// Probe: exercises build-from-scratch with real mouse input on the dev server,
// then checks that IWER (the XR emulator) can run an immersive session and be
// driven from page script under a virtual clock. Writes JPEG frames to /tmp/probe.
import { chromium } from 'playwright';
import fs from 'node:fs';

const URL = process.env.ILE_URL || 'https://localhost:8081/';
const OUT = '/tmp/probe';
const FPS = 30;
fs.mkdirSync(OUT, { recursive: true });
const realSleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'],
});
const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, ignoreHTTPSErrors: true });
const page = await context.newPage();
page.on('console', (m) => { const t = m.text(); if (t.includes('[ile]') || m.type() === 'error') console.log('  page:', t.slice(0, 200)); });
page.on('pageerror', (e) => console.log('  PAGEERROR', e.message.slice(0, 300)));
page.on('crash', () => console.log('  PAGE CRASHED'));
page.on('close', () => console.log('  PAGE CLOSED'));
browser.on('disconnected', () => console.log('  BROWSER DISCONNECTED'));
page.on('framenavigated', (f) => { if (f === page.mainFrame()) console.log('  NAVIGATED', f.url()); });

await page.clock.install({ time: new Date('2026-11-13T15:00:00') });
await page.goto(URL, { waitUntil: 'load' });

// One frame, then wait for the GPU so frames never pile up unrendered.
const step = async () => {
  await page.clock.runFor(1000 / FPS);
  await page.evaluate(() => {
    const gl = globalThis.ile?.world.renderer.getContext();
    if (gl) gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
  });
};
const steps = async (n) => { for (let i = 0; i < n; i += 1) await step(); };
for (let i = 0; i < 900; i += 1) {
  await step();
  if (await page.evaluate(() => !!globalThis.ile)) break;
  await realSleep(100);
}
console.log('app ready:', await page.evaluate(() => !!globalThis.ile));

async function shot(name) {
  await page.evaluate(() => {
    requestAnimationFrame(() => {
      const gl = globalThis.ile.world.renderer.domElement;
      const c = Object.assign(document.createElement('canvas'), { width: gl.width, height: gl.height });
      c.getContext('2d').drawImage(gl, 0, 0);
      window.__shot = c.toDataURL('image/jpeg', 0.9);
      window.__size = [gl.width, gl.height];
    });
  });
  await step();
  const data = await page.evaluate(() => window.__shot);
  fs.writeFileSync(`${OUT}/${name}.jpg`, Buffer.from(data.split(',')[1], 'base64'));
  console.log('  shot', name, await page.evaluate(() => window.__size));
}

/** Screen position of a building-local point (metres). */
const local = (x, y, z) =>
  page.evaluate(([x, y, z]) => {
    const app = globalThis.ile;
    const g = app.view.group;
    g.updateWorldMatrix(true, false);
    const p = g.position.clone().set(x, y, z);
    g.localToWorld(p);
    p.project(app.world.camera);
    const r = app.world.renderer.domElement.getBoundingClientRect();
    return { x: r.left + ((p.x + 1) / 2) * r.width, y: r.top + ((1 - p.y) / 2) * r.height };
  }, [x, y, z]);
const obj = (expr) =>
  page.evaluate((expr) => {
    const app = globalThis.ile;
    const o = new Function('app', `return ${expr}`)(app);
    const p = o.position.clone();
    o.getWorldPosition(p);
    p.project(app.world.camera);
    const r = app.world.renderer.domElement.getBoundingClientRect();
    return { x: r.left + ((p.x + 1) / 2) * r.width, y: r.top + ((1 - p.y) / 2) * r.height };
  }, expr);
const state = () =>
  page.evaluate(() => {
    const a = globalThis.ile;
    const d = a.design;
    return { mode: a.mode, rooms: d.rooms.length, court: !!d.court, h: d.wallHeight, roof: d.roof, score: a.day.overall, heat: a.heatOn };
  });

let cur = { x: 640, y: 400 };
async function glide(to, n = 5) {
  for (let i = 1; i <= n; i += 1) {
    await page.mouse.move(cur.x + ((to.x - cur.x) * i) / n, cur.y + ((to.y - cur.y) * i) / n);
    await step();
  }
  cur = { ...to };
}
async function drag(a, b) {
  await glide(a); await steps(4);
  await page.mouse.down(); await steps(4);
  await glide(b, 7); await steps(3);
  await page.mouse.up(); await steps(4);
}
async function click(a) { await glide(a); await steps(4); await page.mouse.down(); await steps(3); await page.mouse.up(); await steps(4); }

await steps(6);
await shot('01-start');
console.log('start', await state());

// --- Build from scratch with the mouse.
await click(await obj('app.cards[0].label.mesh'));
console.log('after card', await state());
const Y = -0.2;
for (const [x0, z0, x1, z1] of [[-5, -6, 5, -2], [-5, 2, 5, 6], [-5, -2, -2, 2], [2, -2, 5, 2]]) {
  console.log('drag', x0, z0, x1, z1, JSON.stringify(await local(x0, Y, z0)), JSON.stringify(await local(x1, Y, z1)));
  await drag(await local(x0, Y, z0), await local(x1, Y, z1));
  console.log('  ->', JSON.stringify(await state()), await page.evaluate(() => globalThis.ile.gestures.pointers.mouse.hover?.id ?? null));
}
console.log('rooms laid', await state());
await shot('02-rooms');
await click(await local(0, Y, 0));
console.log('courtyard', await state());
const spire = await obj('app.handles.spire');
await drag(spire, { x: spire.x, y: spire.y - 60 });
await steps(26);
console.log('walls', await state());
await shot('03-walls');
await page.keyboard.press('f'); await steps(10);
console.log('roof', await state());
// Cut two openings by clicking wall panels.
const panels = await page.evaluate(() => globalThis.ile.handles.slots.filter((m) => m.visible).length);
console.log('panels', panels);
await page.keyboard.press('h'); await steps(10);
await shot('04-heat');
console.log('heat', await state());
await page.keyboard.press('e');
for (let i = 0; i < 150; i += 1) { await step(); await realSleep(40); if (await page.evaluate(() => !!globalThis.ile.proposal)) break; }
await steps(10);
await shot('05-elder');
await page.keyboard.press('y'); await steps(20);
console.log('accepted', await state());
await page.keyboard.press('c'); await steps(10);
await shot('06-compare');
await page.keyboard.press('c'); await steps(5);

// --- IWER: is the emulator present, and can an immersive session run here?
const iwer = await page.evaluate(() => {
  const d = window.IWER_DEVICE;
  if (!d) return { present: false };
  const proto = (o) => (o ? Object.getOwnPropertyNames(Object.getPrototypeOf(o)).slice(0, 40) : null);
  return {
    present: true,
    name: d.name,
    device: proto(d),
    hands: d.hands ? Object.keys(d.hands) : null,
    hand: proto(d.hands?.right),
    primaryInputMode: d.primaryInputMode,
  };
});
console.log('IWER', JSON.stringify(iwer));
if (iwer.present) {
  await page.evaluate(() => { try { globalThis.ile.world.launchXR(); } catch (e) { console.error('launchXR', String(e)); } });
  for (let i = 0; i < 30; i += 1) { await step(); await realSleep(30); }
  const xr = await page.evaluate(() => ({ session: !!globalThis.ile.world.session, mode: globalThis.ile.mode }));
  console.log('XR', JSON.stringify(xr));
  if (xr.session) {
    await page.evaluate(() => {
      const d = window.IWER_DEVICE;
      d.primaryInputMode = 'hand';
      d.hands.right.position.set(0.12, 1.42, -0.45);
      d.hands.left.position.set(-0.14, 1.4, -0.45);
    });
    await steps(8);
    await shot('07-xr-hands');
    console.log('XR state', await state());
  }
}
await browser.close();
console.log('probe done');
