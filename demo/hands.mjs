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

export async function openRig({ out, head = [0, 1.22, 0], pitch = -0.4, fov = 64 }) {
  fs.mkdirSync(out, { recursive: true });
  for (const f of fs.readdirSync(out)) if (f.endsWith('.jpg')) fs.unlinkSync(`${out}/${f}`);
  const browser = await chromium.launch({
    headless: true,
    // ILE_GPU=1 draws on a real (NVIDIA) GPU through EGL; otherwise software.
    args: process.env.ILE_GPU === '1'
      ? ['--use-gl=angle', '--use-angle=gl-egl', '--ignore-gpu-blocklist', '--enable-webgl']
      : ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'],
  });
  // Rehearsals run small (ILE_SMALL=1) so they finish quickly; takes are 720p.
  const small = process.env.ILE_SMALL === '1';
  const big = process.env.ILE_HD === '1';
  const context = await browser.newContext({ viewport: small ? { width: 480, height: 270 } : big ? { width: 1920, height: 1080 } : { width: 1280, height: 720 }, ignoreHTTPSErrors: true });
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
    fov,
    /** App time per video frame (2 = double speed, for slow scenes). */
    speed: 1,
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
      ({ head, pitch, yaw, gaze, hands, dt, fov, speed }) => {
        const mul = (a, b) => [
          a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
          a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
          a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
          a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
        ];
        const q = ([x, y, z, w]) => ({ x, y, z, w });
        const v = ([x, y, z]) => ({ x, y, z });
        const look = (yw, pt) => mul([0, Math.sin(yw / 2), 0, Math.cos(yw / 2)], [Math.sin(pt / 2), 0, 0, Math.cos(pt / 2)]);
        // Gaze: look from the head at the target.
        const dir = [gaze[0] - head[0], gaze[1] - head[1], gaze[2] - head[2]];
        const state = {
          inputMode: 'hand',
          fov,
          headset: { position: v(head), orientation: q(look(yaw, pitch)) },
          gaze: { orientation: q(look(Math.atan2(-dir[0], -dir[2]), Math.atan2(dir[1], Math.hypot(dir[0], dir[2])))) },
          hands: {},
        };
        for (const side of ['left', 'right']) {
          state.hands[side] = { position: v(hands[side].pos), pinchValue: hands[side].pinch };
          if (hands[side].quat) state.hands[side].orientation = q(hands[side].quat);
        }
        // IWER's own remote-control command: the same path the IWSDK CLI uses.
        window.IWER_DEVICE.remote.dispatch('set_device_state', { state }).catch((e) => console.error('rig', e.message));
        // One fixed app tick per video frame.
        globalThis.__ileStep = { pending: 1, dt: dt * speed };
      },
      {
        head: rig.headBase.map((v, i) => v + sway[i]),
        pitch: rig.pitch + 0.006 * Math.sin(t * 0.8),
        yaw: rig.yaw + 0.008 * Math.sin(t * 0.5),
        gaze: rig.gaze,
        dt: 1 / FPS,
        fov: rig.fov,
        speed: rig.speed,
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
          const c = (window.__cap ??= Object.assign(document.createElement('canvas'), { width: gl.width, height: gl.height }));
          c.getContext('2d').drawImage(gl, 0, 0, c.width, c.height);
          window.__shot = c.toDataURL('image/jpeg', 0.93);
        });
      });
    }
    await page.clock.runFor((1000 / FPS) * rig.speed);
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
  /** Wait until a new gaze or hand pose has reached the app (a few frames). */
  rig.settle = async () => { for (let i = 0; i < 7; i += 1) await rig.frame(); };
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
  await page.evaluate(() => globalThis.ile.world.launchXR());
  for (let i = 0; i < 40; i += 1) {
    await page.clock.runFor(1000 / FPS);
    await realSleep(30);
    if (await page.evaluate(() => !!globalThis.ile.world.session)) break;
  }
  rig.xr = await page.evaluate(() => !!globalThis.ile.world.session);
  if (!rig.xr) throw new Error('The immersive session did not start.');
  await rig.hold(0.5);
  // Seat the table in front of the (now seated-height) head.
  await page.evaluate(() => globalThis.ile.recenter());
  await rig.hold(0.3);

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

/**
 * Find a point on a room's floor that the gaze can reach without a grip or
 * panel in the way. Run it off camera; returns a world point or null.
 */
export async function findRoomAim(rig, room) {
  const r = await rig.page.evaluate((id) => globalThis.ile.design.rooms.find((x) => x.id === id), room);
  if (!r) return null;
  const was = rig.capturing;
  rig.capturing = false;
  let found = null;
  for (const fz of [0, 0.25, -0.25, 0.4, -0.4]) {
    for (const fx of [0, 0.25, -0.25, 0.4, -0.4]) {
      const p = await rig.local((r.x0 + r.x1) / 2 + fx * (r.x1 - r.x0), 0.02, (r.z0 + r.z1) / 2 + fz * (r.z1 - r.z0));
      rig.gaze = p;
      await rig.settle();
      if ((await rig.state()).hover.right === `room-${room}`) { found = p; break; }
    }
    if (found) break;
  }
  rig.capturing = was;
  return found;
}
