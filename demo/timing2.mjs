// True frame cost (forces the GPU to finish) before and after a real click,
// and whether a real click starts the emulated XR session.
import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 }, ignoreHTTPSErrors: true })).newPage();
page.on('pageerror', (e) => console.log('PAGEERROR', e.message.slice(0, 200)));
await page.clock.install({ time: new Date('2026-11-13T15:00:00') });
await page.goto('https://localhost:8081/', { waitUntil: 'load' });
const step = () => page.clock.runFor(1000 / 30);
for (let i = 0; i < 900; i += 1) { await step(); if (await page.evaluate(() => !!globalThis.ile)) break; await new Promise((r) => setTimeout(r, 100)); }
const sync = () => page.evaluate(() => { const gl = globalThis.ile.world.renderer.getContext(); const px = new Uint8Array(4); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); return [gl.drawingBufferWidth, gl.drawingBufferHeight]; });
const time = async (label, n = 4) => { await sync(); const t = Date.now(); let size; for (let i = 0; i < n; i += 1) { await step(); size = await sync(); } console.log(label.padEnd(30), ((Date.now() - t) / n).toFixed(0), 'ms/frame', JSON.stringify(size), 'session', await page.evaluate(() => !!globalThis.ile.world.session)); };
await time('start screen');
await page.evaluate(() => globalThis.ile.startWith('compound'));
await time('compound');
await page.mouse.move(900, 650); await page.mouse.down(); await step(); await page.mouse.up();
for (let i = 0; i < 20; i += 1) await step();
await time('after a real click');
console.log(JSON.stringify(await page.evaluate(() => ({ dpr: devicePixelRatio, xrEnabled: globalThis.ile.world.xrEnabled, iwer: !!window.IWER_DEVICE, device: window.IWER_DEVICE?.name, canvas: [globalThis.ile.world.renderer.domElement.width, globalThis.ile.world.renderer.domElement.height] }))));
await browser.close();
