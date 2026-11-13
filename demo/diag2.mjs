// How does app time advance per virtual-clock step inside the XR session?
import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 }, ignoreHTTPSErrors: true })).newPage();
await page.clock.install({ time: new Date('2026-11-13T15:00:00') });
await page.goto('https://localhost:8081/', { waitUntil: 'load' });
const sync = () => page.evaluate(() => { const gl = globalThis.ile?.world.renderer.getContext(); if (gl) gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4)); });
for (let i = 0; i < 900; i += 1) { await page.clock.runFor(33); await sync(); if (await page.evaluate(() => !!globalThis.ile && !!window.IWER_DEVICE)) break; await new Promise((r) => setTimeout(r, 100)); }
await page.evaluate(() => { const a = globalThis.ile; const u = a.update.bind(a); window.__d = []; a.update = (d, t) => { window.__d.push(+d.toFixed(4)); u(d, t); }; });
const probe = async (label, ms, n = 6) => { await page.evaluate(() => { window.__d = []; }); for (let i = 0; i < n; i += 1) { await page.clock.runFor(ms); await sync(); } const d = await page.evaluate(() => window.__d); console.log(label.padEnd(26), 'updates/step', (d.length / n).toFixed(2), 'deltas', JSON.stringify(d.slice(0, 8))); };
await probe('desktop runFor(33.3)', 1000 / 30);
await page.evaluate(() => { globalThis.ile.world.launchXR(); });
for (let i = 0; i < 40; i += 1) { await page.clock.runFor(33); await sync(); if (await page.evaluate(() => !!globalThis.ile.world.session)) break; }
await probe('XR runFor(33.3)', 1000 / 30);
await probe('XR runFor(16.7)', 1000 / 60);
await probe('XR runFor(8)', 8);
console.log(JSON.stringify(await page.evaluate(() => ({ rate: window.IWER_DEVICE.internalNominalFrameRate, canvas: [globalThis.ile.world.renderer.domElement.width, globalThis.ile.world.renderer.domElement.height], fovy: window.IWER_DEVICE.fovy, mask: window.IWER_DEVICE.visibilityMaskEnabled, stereo: window.IWER_DEVICE.stereoEnabled }))));
await browser.close();
