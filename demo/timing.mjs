// Times one frame step under different conditions to find what is slow.
import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 }, ignoreHTTPSErrors: true })).newPage();
page.on('pageerror', (e) => console.log('PAGEERROR', e.message.slice(0, 200)));
await page.clock.install({ time: new Date('2026-11-13T15:00:00') });
await page.goto('https://localhost:8081/', { waitUntil: 'load' });
const step = () => page.clock.runFor(1000 / 30);
for (let i = 0; i < 900; i += 1) { await step(); if (await page.evaluate(() => !!globalThis.ile)) break; await new Promise((r) => setTimeout(r, 100)); }
const time = async (label, n = 5) => { const t = Date.now(); for (let i = 0; i < n; i += 1) await step(); console.log(label.padEnd(34), ((Date.now() - t) / n).toFixed(0), 'ms/frame'); };
await time('start screen');
await page.evaluate(() => globalThis.ile.startWith('scratch'));
await time('empty plot');
await page.mouse.move(640, 420); await time('empty plot, mouse over plot');
await page.evaluate(async () => {
  const s = await import('/src/model/state.ts');
  const a = globalThis.ile;
  a.commit(s.addRoom(a.design, { x0: -5, x1: 5, z0: -6, z1: -2 }), 'room');
});
await time('one room');
await page.evaluate(() => { globalThis.__g = globalThis.ile.gestures.update; globalThis.ile.gestures.update = () => {}; });
await time('one room, gestures off');
await page.evaluate(() => { globalThis.ile.gestures.update = globalThis.__g; globalThis.ile.view.group.visible = false; });
await time('one room, building hidden');
await page.evaluate(() => { globalThis.ile.view.group.visible = true; });
const info = await page.evaluate(() => {
  const a = globalThis.ile; const r = a.world.renderer.info;
  return { calls: r.render.calls, tris: r.render.triangles, geos: r.memory.geometries, targets: a.gestures.targets.length, grips: a.handles.lineGrips.filter((g) => g.visible).length };
});
console.log(JSON.stringify(info));
const local = (x, y, z) => page.evaluate(([x, y, z]) => { const app = globalThis.ile; const g = app.view.group; g.updateWorldMatrix(true, false); const p = g.position.clone().set(x, y, z); g.localToWorld(p); p.project(app.world.camera); return { x: ((p.x + 1) / 2) * 1280, y: ((1 - p.y) / 2) * 720 }; }, [x, y, z]);
const hov = () => page.evaluate(() => globalThis.ile.gestures.pointers.mouse.hover?.id ?? null);
let p = await local(0, 0, -4); await page.mouse.move(p.x, p.y); await time('hover room floor'); console.log('  hover', await hov());
p = await local(0, 0.6, -6); await page.mouse.move(p.x, p.y); await time('hover a wall grip'); console.log('  hover', await hov());
p = await local(-5, -0.2, 2); await page.mouse.move(p.x, p.y); await time('hover empty plot'); console.log('  hover', await hov());
await page.mouse.down(); await time('pinch down on plot', 3);
for (const [x, z] of [[-3, 3], [0, 4], [3, 5], [5, 6]]) { p = await local(x, -0.2, z); await page.mouse.move(p.x, p.y); await time(`drag to ${x},${z}`, 2); }
await page.mouse.up(); await time('release', 3);
console.log(JSON.stringify(await page.evaluate(() => ({ rooms: globalThis.ile.design.rooms.length }))));
await browser.close();
