// Probe: plays the story mode end to end on the dev server (desktop preview,
// coarse time steps) and saves a few frames to /tmp/story.
import { chromium } from 'playwright';
import fs from 'node:fs';

const OUT = '/tmp/story';
fs.mkdirSync(OUT, { recursive: true });
const realSleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 }, ignoreHTTPSErrors: true })).newPage();
page.on('console', (m) => { const t = m.text(); if (t.includes('[ile]') || m.type() === 'error') console.log('  page:', t.slice(0, 160)); });
page.on('pageerror', (e) => console.log('  PAGEERROR', e.message.slice(0, 300)));
await page.clock.install({ time: new Date('2026-11-13T08:00:00') });
await page.goto('https://localhost:8081/', { waitUntil: 'load' });

const DT = 0.2; // coarse app tick: this probe checks logic, not motion
const step = async (n = 1) => {
  for (let i = 0; i < n; i += 1) {
    await page.evaluate((dt) => { globalThis.__ileStep = { pending: 1, dt }; }, DT);
    await page.clock.runFor(34);
    await page.evaluate(() => { const gl = globalThis.ile?.world.renderer.getContext(); if (gl) gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4)); });
  }
};
const seconds = (s) => step(Math.ceil(s / DT));
for (let i = 0; i < 900; i += 1) { await page.clock.runFor(34); if (await page.evaluate(() => !!globalThis.ile)) break; await realSleep(100); }

async function shot(name) {
  await page.evaluate(() => { requestAnimationFrame(() => { const gl = globalThis.ile.world.renderer.domElement; const c = Object.assign(document.createElement('canvas'), { width: gl.width, height: gl.height }); c.getContext('2d').drawImage(gl, 0, 0); window.__shot = c.toDataURL('image/jpeg', 0.9); }); });
  await step();
  fs.writeFileSync(`${OUT}/${name}.jpg`, Buffer.from((await page.evaluate(() => window.__shot)).split(',')[1], 'base64'));
}
const st = async (label) => {
  const s = await page.evaluate(() => {
    const a = globalThis.ile, s = a.story;
    return { mode: a.mode, beat: s.beat, day: s.story.day, savings: s.story.savings, power: s.story.power, items: s.story.items.map((i) => i.item), hour: a.design.hour, rooms: a.design.rooms.length, h: a.design.wallHeight, roof: a.design.roof, score: a.day.overall, now: a.now.overall, heat: a.heatOn, proposal: !!a.proposal, panel: a.panel.current?.split('|')[0], card: s.card.mesh.visible, room: a.room };
  });
  console.log(label.padEnd(16), JSON.stringify(s));
  return s;
};
const obj = (expr) => page.evaluate((expr) => {
  const app = globalThis.ile; const o = new Function('app', `return ${expr}`)(app);
  const p = o.position.clone(); o.updateWorldMatrix(true, false); o.getWorldPosition(p); p.project(app.world.camera);
  return { x: ((p.x + 1) / 2) * 1280, y: ((1 - p.y) / 2) * 720 };
}, expr);

await step(3);
await shot('01-start');
await page.keyboard.press('0'); await step(2);
await st('arrival');
await seconds(6);

// Build: two rooms, walls, roof (through the same commit path the hands use).
await page.evaluate(async () => {
  const s = await import('/src/model/state.ts');
  const a = globalThis.ile;
  a.commit(s.addRoom(a.design, { x0: -4, x1: 2, z0: -4, z1: 0 }), 'room');
  a.commit(s.addRoom(a.design, { x0: 2, x1: 5, z0: -4, z1: 0 }), 'room');
  a.commit(s.setWallHeight(a.design, 3), 'height');
});
await step(4);
await st('walls');
await page.keyboard.press('f'); await seconds(2);
await st('roof');
await shot('02-built');

// Too expensive: must be refused.
await page.evaluate(async () => {
  const s = await import('/src/model/state.ts');
  const a = globalThis.ile;
  a.commit(s.addRoom(a.design, { x0: -12, x1: 12, z0: 2, z1: 12 }), 'room');
});
await step(2);
await st('refused?');

// Move in.
await page.evaluate(() => globalThis.ile.enterRoom(globalThis.ile.design.rooms[0].id));
await seconds(2.5);
await st('inside');
await shot('03-tray');
for (const [id, dx, dy] of [['fan', -260, 60], ['photo', 200, -150], ['mattress', 120, 120]]) {
  const p = await obj(`app.story.items.get('${id}').group`);
  await page.mouse.move(p.x, p.y - (id === 'photo' ? 0 : 12)); await step(2);
  const hover = await page.evaluate(() => globalThis.ile.gestures.pointers.mouse.hover?.id ?? null);
  await page.mouse.down(); await step(2);
  for (let i = 1; i <= 5; i += 1) { await page.mouse.move(p.x + (dx * i) / 5, p.y + (dy * i) / 5); await step(1); }
  await page.mouse.up(); await step(2);
  console.log('  placed', id, 'hover was', hover);
}
await st('placed');
await shot('04-placed');
const fanBefore = await page.evaluate(() => globalThis.ile.now.rooms[globalThis.ile.room]?.comfort);

// Back out: afternoon, then the power cut.
await page.keyboard.press('b'); await seconds(2.5);
await st('afternoon');
await seconds(9);
await st('heat on');
await seconds(4);
const s1 = await st('nepa');
await shot('05-nepa');
await seconds(5);
await st('advice');
console.log('  room comfort with fan', fanBefore, '-> after cut', await page.evaluate(() => globalThis.ile.now.rooms[globalThis.ile.design.rooms[0].id].comfort));
await page.keyboard.press('e');
for (let i = 0; i < 100; i += 1) { await step(); await realSleep(40); if (await page.evaluate(() => !!globalThis.ile.proposal)) break; }
await st('proposal');
await page.keyboard.press('y'); await seconds(1);
await st('accepted');
await seconds(12);
await st('evening');
await seconds(6);
await st('journal');
await shot('06-journal');
console.log('  card:', await page.evaluate(() => globalThis.ile.story.card.current?.split('|')[0]));
const c = await obj('app.story.card.mesh');
await page.mouse.move(c.x, c.y); await step(2); await page.mouse.down(); await step(2); await page.mouse.up(); await seconds(3);
await st('day 2');
console.log('  saved:', await page.evaluate(() => (localStorage.getItem('ile.story.v1') ?? '').length), 'chars');
await browser.close();
console.log('story probe done', s1.power === false ? '(power cut seen)' : '');
