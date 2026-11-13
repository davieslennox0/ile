// Hands-only capture rig for Ilé.
//
// Runs the app on the IWSDK dev server inside an immersive session of IWER
// (the XR emulator) with the Meta VR Glasses profile, and drives it ONLY
// through IWER's device API: head pose, gaze direction, hand positions and
// pinch values, set every frame. No mouse, no keyboard.
//
// Time is virtual: each step advances exactly one video frame and the frame
// is read back from the canvas, so a slow (software) GPU only makes the
// capture take longer, never choppy.
import { chromium } from 'playwright';
import fs from 'node:fs';

export const FPS = Number(process.env.ILE_FPS || 30);
const URL = process.env.ILE_URL || 'https://localhost:8081/?gfx=high';
const realSleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ease = (k) => (k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2); // cubic in/out

export async function openRig({ out, head = [0, 1.22, 0], pitch = -0.3 }) {
  fs.mkdirSync(out, { recursive: true });
  for (const f of fs.readdirSync(out)) if (f.endsWith('.jpg')) fs.unlinkSync(`${out}/${f}`);
  const browser = await chromium.launch({
    headless: true,
    args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'],
  });
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, ignoreHTTPSErrors: true });
  const page = await context.newPage();
  page.on('console', (m) => { const t = m.text(); if (t.includes('[ile]')) console.log('  page:', t.slice(0, 120)); });
  page.on('pageerror', (e) => console.log('  PAGEERROR', e.message.slice(0, 300)));
  await page.clock.install({ time: new Date('2026-11-13T15:00:00') });
  await page.goto(URL, { waitUntil: 'load' });

  const wall0 = Date.now();
  const rig = {
    page,
    browser,
    frameNo: 0,
    capturing: false,
    marks: [],
    t: 0,
    // Rig state, all in world metres (the XR origin is the world origin).
    headBase: [...head],
    pitch,
    yaw: 0,
    gaze: [0, 1.0, -0.6],
    hands: {
      left: { pos: [-0.2, 0.95, -0.3], pinch: 0 },
      right: { pos: [0.2, 0.95, -0.3], pinch: 0 },
    },
    offset: { left: [0, 0, 0], right: [0, 0, 0] },
  };
  rig.now = () => rig.frameNo / FPS;
  rig.wall = () => `${((Date.now() - wall0) / 1000).toFixed(0)}s wall`;

  /** Push the rig state into IWER for this frame. */
  async function apply() {
    const t = rig.t;
    // Subtle seated sway and breathing; tiny hand tremor.
    const sway = [0.006 * Math.sin(t * 0.9), 0.004 * Math.sin(t * 1.7), 0.004 * Math.sin(t * 0.6 + 1)];
    const jit = (i, a = 0.0012) => a * Math.sin(t * (5.3 + i * 1.9) + i * 2.1);
    await page.evaluate(
      ({ head, pitch, yaw, gaze, hands }) => {
        const d = window.IWER_DEVICE;
        // Hold the device in programmatic-control mode, or IWER's on-page
        // control panel writes its own values back every frame.
        if (d.remote) d.remote._isCaptured = true;
        if (d.primaryInputMode !== 'hand') d.primaryInputMode = 'hand';
        const setQ = (q, [x, y, z, w]) => { if (typeof q.set === 'function') q.set(x, y, z, w); else Object.assign(q, { x, y, z, w }); };
        const setV = (v, [x, y, z]) => { if (typeof v.set === 'function') v.set(x, y, z); else Object.assign(v, { x, y, z }); };
        const mul = (a, b) => [
          a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
          a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
          a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
          a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
        ];
        const qy = [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)];
        const qx = [Math.sin(pitch / 2), 0, 0, Math.cos(pitch / 2)];
        setV(d.position, head);
        setQ(d.quaternion, mul(qy, qx));
        // Gaze: look from the head at the target.
        const dir = [gaze[0] - head[0], gaze[1] - head[1], gaze[2] - head[2]];
        const gy = Math.atan2(-dir[0], -dir[2]);
        const gp = Math.atan2(dir[1], Math.hypot(dir[0], dir[2]));
        if (d.gaze) setQ(d.gaze.quaternion, mul([0, Math.sin(gy / 2), 0, Math.cos(gy / 2)], [Math.sin(gp / 2), 0, 0, Math.cos(gp / 2)]));
        for (const side of ['left', 'right']) {
          const h = d.hands[side];
          setV(h.position, hands[side].pos);
          if (hands[side].quat) setQ(h.quaternion, hands[side].quat);
          h.updatePinchValue(hands[side].pinch);
        }
      },
      {
        head: rig.headBase.map((v, i) => v + sway[i]),
        pitch: rig.pitch + 0.006 * Math.sin(t * 0.8),
        yaw: rig.yaw + 0.008 * Math.sin(t * 0.5),
        gaze: rig.gaze,
        hands: {
          left: { ...rig.hands.left, pos: rig.hands.left.pos.map((v, i) => v + rig.offset.left[i] + jit(i)) },
          right: { ...rig.hands.right, pos: rig.hands.right.pos.map((v, i) => v + rig.offset.right[i] + jit(i + 3)) },
        },
      },
    );
  }

  /** Advance one frame; save it when capturing. */
  rig.frame = async () => {
    if (rig.xr) await apply();
    if (rig.capturing) {
      await page.evaluate(() => {
        requestAnimationFrame(() => {
          const gl = globalThis.ile.world.renderer.domElement;
          const c = (window.__cap ??= Object.assign(document.createElement('canvas'), { width: 1280, height: 720 }));
          c.getContext('2d').drawImage(gl, 0, 0, 1280, 720);
          window.__shot = c.toDataURL('image/jpeg', 0.93);
        });
      });
    }
    await page.clock.runFor(1000 / FPS);
    rig.t += 1 / FPS;
    if (rig.capturing) {
      const data = await page.evaluate(() => window.__shot);
      fs.writeFileSync(`${out}/f${String(rig.frameNo).padStart(5, '0')}.jpg`, Buffer.from(data.split(',')[1], 'base64'));
      rig.frameNo += 1;
      if (rig.frameNo % 60 === 0) console.log('  frames', rig.frameNo, rig.wall());
    } else {
      // Keep the GPU in step so frames never pile up unrendered.
      await page.evaluate(() => {
        const gl = globalThis.ile?.world.renderer.getContext();
        if (gl) gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
      });
    }
  };
  rig.hold = async (seconds) => { for (let i = 0; i < Math.max(1, Math.round(seconds * FPS)); i += 1) await rig.frame(); };

  /** Ease any of: hands, gaze, pitch, yaw to new values over `seconds`. */
  rig.move = async (to, seconds = 0.45) => {
    const from = { left: [...rig.hands.left.pos], right: [...rig.hands.right.pos], gaze: [...rig.gaze], pitch: rig.pitch, yaw: rig.yaw, pl: rig.hands.left.pinch, pr: rig.hands.right.pinch };
    const n = Math.max(2, Math.round(seconds * FPS));
    const mix = (a, b, e) => a.map((v, i) => v + (b[i] - v) * e);
    for (let i = 1; i <= n; i += 1) {
      const e = ease(i / n);
      if (to.left) rig.hands.left.pos = mix(from.left, to.left, e);
      if (to.right) rig.hands.right.pos = mix(from.right, to.right, e);
      if (to.gaze) rig.gaze = mix(from.gaze, to.gaze, e);
      if (to.pitch !== undefined) rig.pitch = from.pitch + (to.pitch - from.pitch) * e;
      if (to.yaw !== undefined) rig.yaw = from.yaw + (to.yaw - from.yaw) * e;
      if (to.pinchLeft !== undefined) rig.hands.left.pinch = from.pl + (to.pinchLeft - from.pl) * e;
      if (to.pinchRight !== undefined) rig.hands.right.pinch = from.pr + (to.pinchRight - from.pr) * e;
      await rig.frame();
    }
  };
  rig.pinch = (hand, value, seconds = 0.2) => rig.move({ [hand === 'left' ? 'pinchLeft' : 'pinchRight']: value }, seconds);

  /** World position of something in the app, e.g. "app.table.sunBall". */
  rig.where = (expr) =>
    page.evaluate((expr) => {
      const app = globalThis.ile;
      const o = new Function('app', `return ${expr}`)(app);
      const p = o.position.clone();
      o.updateWorldMatrix(true, false);
      o.getWorldPosition(p);
      return [p.x, p.y, p.z];
    }, expr);
  /** World position of a building-local point (metres). */
  rig.local = (x, y, z) =>
    page.evaluate(([x, y, z]) => {
      const g = globalThis.ile.view.group;
      g.updateWorldMatrix(true, false);
      const p = g.localToWorld(g.position.clone().set(x, y, z));
      return [p.x, p.y, p.z];
    }, [x, y, z]);
  rig.state = () =>
    page.evaluate(() => {
      const a = globalThis.ile;
      const d = a.design;
      const p = a.gestures.pointers;
      return {
        mode: a.mode, rooms: d.rooms.length, court: !!d.court, h: d.wallHeight, roof: d.roof, score: a.day.overall,
        heat: a.heatOn, proposal: !!a.proposal, session: !!a.world.session,
        hover: { left: p.left.hover?.id ?? null, right: p.right.hover?.id ?? null },
        down: { left: p.left.down, right: p.right.down },
        near: { right: p.right.near ? [p.right.near.x, p.right.near.y, p.right.near.z] : null, left: p.left.near ? [p.left.near.x, p.left.near.y, p.left.near.z] : null },
      };
    });
  rig.mark = (name) => { rig.marks.push({ name, start: rig.now() }); console.log(`[${rig.now().toFixed(1)}s] ${name} (${rig.wall()})`); };

  // Wait for the app, set a seated head height, then enter the immersive session.
  for (let i = 0; i < 900; i += 1) {
    await rig.frame();
    if (await page.evaluate(() => !!globalThis.ile && !!window.IWER_DEVICE)) break;
    await realSleep(100);
  }
  await page.evaluate(([x, y, z]) => {
    const d = window.IWER_DEVICE;
    d.primaryInputMode = 'hand';
    d.position.set(x, y, z);
    globalThis.ile.world.launchXR();
  }, rig.headBase);
  for (let i = 0; i < 40; i += 1) {
    await page.clock.runFor(1000 / FPS);
    await realSleep(30);
    if (await page.evaluate(() => !!globalThis.ile.world.session)) break;
  }
  rig.xr = await page.evaluate(() => !!globalThis.ile.world.session);
  if (!rig.xr) throw new Error('The immersive session did not start.');
  await rig.hold(0.5);

  // Calibrate: where is each hand's pinch point relative to the position we set?
  for (const side of ['left', 'right']) {
    const s = await rig.state();
    const near = s.near[side];
    if (near) rig.offset[side] = rig.hands[side].pos.map((v, i) => v - near[i]);
  }
  await rig.hold(0.2);
  console.log('rig ready', rig.wall(), JSON.stringify({ offset: rig.offset, device: await page.evaluate(() => window.IWER_DEVICE.name) }));
  return rig;
}

/** Look at a point and bring a hand's pinch point to it. */
export async function reach(rig, hand, point, seconds = 0.5, lift = 0) {
  const p = [point[0], point[1] + lift, point[2]];
  await rig.move({ [hand]: p, gaze: point }, seconds);
}
