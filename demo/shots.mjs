// Screenshots of key states (desktop preview, jumps between states by script).
import { chromium } from 'playwright';
import fs from 'node:fs';

const OUT = process.env.OUT || '/tmp/shots';
fs.mkdirSync(OUT, { recursive: true });
const gpu = process.env.ILE_GPU === '1';
const browser = await chromium.launch({
  headless: true,
  args: gpu ? ['--use-gl=angle', '--use-angle=gl-egl', '--ignore-gpu-blocklist'] : ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist'],
});
const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 }, ignoreHTTPSErrors: true })).newPage();
page.on('pageerror', (e) => console.log('PAGEERROR', e.message.slice(0, 300)));
page.on('console', (m) => { if (m.type() === 'error') console.log('console.error', m.text().slice(0, 200)); });
await page.clock.install({ time: new Date('2026-11-13T08:00:00') });
await page.goto(process.env.ILE_URL || 'https://localhost:8081/?gfx=high', { waitUntil: 'load' });
const tick = async (n = 1, dt = 0.1) => {
  for (let i = 0; i < n; i += 1) {
    await page.evaluate((dt) => { globalThis.__ileStep = { pending: 1, dt }; }, dt);
    await page.clock.runFor(34);
  }
};
for (let i = 0; i < 900; i += 1) { await page.clock.runFor(34); if (await page.evaluate(() => !!globalThis.ile)) break; await new Promise((r) => setTimeout(r, 100)); }
async function shot(name) {
  await page.evaluate(() => { requestAnimationFrame(() => { const gl = globalThis.ile.world.renderer.domElement; const c = Object.assign(document.createElement('canvas'), { width: gl.width, height: gl.height }); c.getContext('2d').drawImage(gl, 0, 0); window.__shot = c.toDataURL('image/jpeg', 0.9); }); });
  await tick(1);
  fs.writeFileSync(`${OUT}/${name}.jpg`, Buffer.from((await page.evaluate(() => window.__shot)).split(',')[1], 'base64'));
  console.log('shot', name);
}
const ev = (fn) => page.evaluate(fn);

await tick(10);
await shot('1-start');
await ev(() => globalThis.ile.startWith('story'));
await tick(25);
await shot('2-day1-arrival');
await ev(async () => {
  const s = await import('/src/model/state.ts');
  const a = globalThis.ile;
  a.story.story.savings = 9e6;
  a.commit(s.addRoom(a.design, { x0: -5, x1: 5, z0: -6, z1: -2 }), 'room');
  a.commit(s.addRoom(a.design, { x0: -5, x1: -2, z0: -2, z1: 2 }), 'room');
  a.commit(s.addRoom(a.design, { x0: 2, x1: 5, z0: -2, z1: 2 }), 'room');
  a.commit(s.addRoom(a.design, { x0: -5, x1: 5, z0: 2, z1: 6 }), 'room');
  a.commit(s.setCourt(a.design, { x0: -2, x1: 2, z0: -2, z1: 2 }), 'court');
  a.mud.reset(true);
  a.commit(s.setWallHeight(a.design, 3), 'height');
});
await tick(20);
await ev(() => globalThis.ile.toggleRoof());
await tick(20);
await shot('3-house');
// Day 3 dinner inside.
await ev(() => { const a = globalThis.ile; a.story.story.day = 3; a.story.stepIndex = 1; a.story.next(); a.enterRoom(a.design.rooms[0].id); });
await tick(30);
await shot('4-dinner');
// Day 7 at night: the grown compound and the party.
await ev(() => { const a = globalThis.ile; a.shift.exit(); });
await tick(30);
await ev(() => {
  const a = globalThis.ile;
  a.story.home.stop();
  Object.assign(a.story.story.extras, { floors: 3, garden: true, solar: true, shop: 2, car: true });
  a.story.story.day = 7;
  a.story.stepIndex = 0;
  a.story.next();
  a.refresh();
});
await tick(80, 0.25);
await shot('5-party-night');
await browser.close();
