// Diagnostic: after entering XR, do values set on IWER_DEVICE persist, and do they reach the app?
import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 }, ignoreHTTPSErrors: true })).newPage();
page.on('pageerror', (e) => console.log('PAGEERROR', e.message.slice(0, 200)));
await page.clock.install({ time: new Date('2026-11-13T15:00:00') });
await page.goto('https://localhost:8081/', { waitUntil: 'load' });
const step = async (n = 1) => { for (let i = 0; i < n; i += 1) { await page.clock.runFor(1000 / 30); await page.evaluate(() => { const gl = globalThis.ile?.world.renderer.getContext(); if (gl) gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4)); }); } };
for (let i = 0; i < 900; i += 1) { await step(); if (await page.evaluate(() => !!globalThis.ile && !!window.IWER_DEVICE)) break; await new Promise((r) => setTimeout(r, 100)); }
const read = (label) => page.evaluate((label) => {
  const d = window.IWER_DEVICE, a = globalThis.ile, p = a.gestures.pointers.right;
  const rs = a.world.player.raySpaces.right.position;
  return label + ' ' + JSON.stringify({
    session: !!a.world.session, clock: +a.clock.toFixed(2), mode: d.primaryInputMode, captured: d.remote?.isCaptured,
    devHand: [d.hands.right.position.x, d.hands.right.position.y, d.hands.right.position.z].map((v) => +v.toFixed(3)),
    pinchValue: d.hands.right.pinchValue, connected: d.hands.right.connected, ctrlConnected: d.controllers?.right?.connected,
    raySpace: [rs.x, rs.y, rs.z].map((v) => +v.toFixed(3)), active: p.active, down: p.down,
    near: p.near ? [p.near.x, p.near.y, p.near.z].map((v) => +v.toFixed(3)) : null,
    head: [d.position.x, d.position.y, d.position.z].map((v) => +v.toFixed(2)), gaze: a.world.player.gazeOrigin,
    activeInputs: (d.activeInputs ?? []).length, methods: d.remote ? Object.keys(d.remote.listMethods?.() ?? {}).slice(0, 3) : null,
  });
}, label);
console.log(await read('before XR'));
await page.evaluate(() => { globalThis.ile.world.launchXR(); });
for (let i = 0; i < 40; i += 1) { await step(); if (await page.evaluate(() => !!globalThis.ile.world.session)) break; }
await step(5);
console.log(await read('in XR'));
const send = (state) => page.evaluate((state) => { window.__last = 'pending'; window.IWER_DEVICE.remote.dispatch('set_device_state', { state }).then((r) => { window.__last = 'ok ' + JSON.stringify(r).slice(0, 80); }, (e) => { window.__last = 'ERR ' + e.message; }); }, state);
await send({ inputMode: 'hand', headset: { position: { x: 0, y: 1.22, z: 0 }, orientation: { x: -0.149, y: 0, z: 0, w: 0.989 } }, hands: { right: { position: { x: 0.1, y: 1.0, z: -0.5 }, pinchValue: 1 }, left: { position: { x: -0.1, y: 1.0, z: -0.5 }, pinchValue: 0 } }, gaze: { orientation: { x: -0.2, y: 0, z: 0, w: 0.98 } } });
console.log(await read('just set'));
await step(1); console.log(await read('+1 frame'));
console.log('result', await page.evaluate(() => window.__last));
await step(5); console.log(await read('+6 frames'));
await send({ hands: { right: { position: { x: 0.2, y: 1.1, z: -0.45 }, pinchValue: 0 } } }); await step(1); console.log(await read('second send +1'));
await step(40); console.log(await read('+40 no sends'));
const r = await page.evaluate(async () => { try { return JSON.stringify(await Promise.race([window.IWER_DEVICE.remote.dispatch('get_transform', { device: 'hand-right' }), new Promise((res) => setTimeout(() => res('timeout'), 0))])); } catch (e) { return 'ERR ' + e.message; } });
console.log('dispatch get_transform:', String(r).slice(0, 200));
await browser.close();
