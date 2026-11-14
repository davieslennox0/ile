/**
 * The neighbourhood on the table: a low-poly Yaba street block around the
 * player's plot. Site metres (shown at 1:50). Static geometry is merged into
 * a few meshes; trees, palms and lamps are instanced.
 */

import {
  BoxGeometry,
  ConeGeometry,
  CylinderGeometry,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshLambertMaterial,
  PlaneGeometry,
  Quaternion,
  SphereGeometry,
  Vector3,
} from '@iwsdk/core';
import { earthTexture, mergeColorBoxes, type ColorBox } from './geo.ts';

export const PAL = {
  grass: 0x86b05a,
  dirt: 0xd9b98a,
  road: 0x5a5560,
  walk: 0xcbbba3,
  roof: 0xf4efe6,
  orange: 0xd9692b,
  teal: 0x2fa58f,
  danfo: 0xf2bf12,
};

/** Extent of the table top in site metres. */
export const TABLE_W = 47.5;
export const TABLE_D = 37.5;
const G = -0.24; // ground level of the plot
const ROAD_IN = 13.5;
const ROAD_OUT = 16.5;

const _m = new Matrix4();
const _q = new Quaternion();
const _p = new Vector3();
const _s = new Vector3();
const _up = new Vector3(0, 1, 0);

export class Diorama {
  readonly group = new Group();
  /** Glowing things at night. */
  private readonly lampMat = new MeshLambertMaterial({ color: 0xfff1c4, emissive: 0xffd27a, emissiveIntensity: 0 });
  private readonly windowGlow: MeshLambertMaterial;
  /** Where people can walk: the inner sidewalk ring, |x| or |z| = 13. */
  static readonly WALK = 13;
  static readonly LANE = 15;

  constructor() {
    const g = this.group;
    const boxes: ColorBox[] = [];
    const glow: ColorBox[] = [];
    const B = (x: number, y: number, z: number, sx: number, sy: number, sz: number, color: number, rot = 0) =>
      boxes.push({ x, y, z, sx, sy, sz, color, rot });

    // Ground, roads and sidewalks.
    const grass = new Mesh(new PlaneGeometry(TABLE_W, TABLE_D), new MeshLambertMaterial({ color: PAL.grass }));
    grass.rotation.x = -Math.PI / 2;
    grass.position.y = G - 0.012;
    grass.receiveShadow = true;
    g.add(grass);
    const mid = (ROAD_IN + ROAD_OUT) / 2;
    const rw = ROAD_OUT - ROAD_IN;
    B(0, G - 0.004, -mid, TABLE_W, 0.01, rw, PAL.road);
    B(0, G - 0.004, mid, TABLE_W, 0.01, rw, PAL.road);
    B(-mid, G - 0.004, 0, rw, 0.01, ROAD_IN * 2, PAL.road);
    B(mid, G - 0.004, 0, rw, 0.01, ROAD_IN * 2, PAL.road);
    for (let x = -22; x <= 22; x += 3) {
      B(x, G + 0.002, -mid, 1.4, 0.006, 0.18, 0xf4efe6);
      B(x, G + 0.002, mid, 1.4, 0.006, 0.18, 0xf4efe6);
    }
    for (let z = -12; z <= 12; z += 3) {
      B(-mid, G + 0.002, z, 0.18, 0.006, 1.4, 0xf4efe6);
      B(mid, G + 0.002, z, 0.18, 0.006, 1.4, 0xf4efe6);
    }
    // Inner sidewalk ring around the plot, and outer walks.
    const W = Diorama.WALK;
    B(0, G, -W, 27, 0.06, 1, PAL.walk);
    B(0, G, W, 27, 0.06, 1, PAL.walk);
    B(-W, G, 0, 1, 0.06, 25, PAL.walk);
    B(W, G, 0, 1, 0.06, 25, PAL.walk);
    B(0, G, -(ROAD_OUT + 0.5), TABLE_W, 0.06, 1, PAL.walk);
    B(0, G, ROAD_OUT + 0.5, TABLE_W, 0.06, 1, PAL.walk);
    B(-(ROAD_OUT + 0.5), G, 0, 1, 0.06, ROAD_OUT * 2, PAL.walk);
    B(ROAD_OUT + 0.5, G, 0, 1, 0.06, ROAD_OUT * 2, PAL.walk);

    // Neighbour houses: rammed earth, white roofs, glowing windows at night.
    const earth = new MeshLambertMaterial({ map: earthTexture() });
    const walls: Mesh[] = [];
    const house = (x: number, z: number, w: number, d: number, h: number) => {
      const m = new Mesh(new BoxGeometry(w, h, d), earth);
      m.position.set(x, G + h / 2, z);
      m.castShadow = true;
      m.receiveShadow = true;
      walls.push(m);
      B(x, G + h + 0.12, z, w + 0.5, 0.24, d + 0.5, PAL.roof);
      B(x, G + h + 0.36, z - d / 2, w + 0.5, 0.25, 0.12, PAL.roof);
      const n = Math.max(1, Math.floor(w / 2.2));
      for (let i = 0; i < n; i += 1) {
        const wx = x - w / 2 + (w / n) * (i + 0.5);
        for (let f = 0; f < Math.round(h / 3); f += 1) {
          glow.push({ x: wx, y: G + 1.5 + f * 3, z: z + d / 2 + 0.03, sx: 0.9, sy: 1.1, sz: 0.06, color: 0x3a3330 });
        }
      }
      B(x + w / 2 - 1.1, G + 1.05, z + d / 2 + 0.03, 0.9, 2.1, 0.06, 0x5b3418);
    };
    house(-20.5, -10, 5, 4, 3);
    house(20, -10.5, 5.5, 4, 6);
    house(20, -4, 4.5, 3.5, 3);
    house(-20.5, 14.2, 4, 2.6, 3);

    // The buka: a small eatery with an orange-and-teal awning and benches.
    house(-20.5, -3.5, 5, 3.5, 3);
    for (let i = 0; i < 6; i += 1) B(-18 + 0, G + 2.4, -5 + i * 0.6, 1.6, 0.08, 0.6, i % 2 ? PAL.teal : PAL.orange);
    for (let i = 0; i < 3; i += 1) {
      B(-17.6, G + 0.4, -4.6 + i * 1.6, 0.9, 0.08, 0.9, 0x8a5a3a);
      B(-17.6, G + 0.2, -4.6 + i * 1.6, 0.15, 0.4, 0.15, 0x5b3418);
    }
    // Market stalls with produce.
    const produce = [0xd8361f, 0xf2bf12, 0x4f9a52, 0xe07a2a];
    for (let i = 0; i < 3; i += 1) {
      const z = 3.5 + i * 3;
      B(-20, G + 0.45, z, 2.2, 0.9, 1.4, 0x8a5a3a);
      B(-20, G + 1.9, z, 2.6, 0.08, 1.8, [PAL.orange, PAL.teal, PAL.danfo][i]);
      for (const [dx, dz] of [[-1.1, -0.7], [1.1, -0.7], [-1.1, 0.7], [1.1, 0.7]]) B(-20 + dx, G + 0.95, z + dz, 0.08, 1.9, 0.08, 0x5b3418);
      for (let k = 0; k < 4; k += 1) B(-20.6 + k * 0.4, G + 1.0, z, 0.32, 0.18, 0.32, produce[(k + i) % 4]);
    }
    // Street football pitch.
    B(20, G + 0.01, 7, 6, 0.02, 10, 0x5e9a3f);
    for (const [x, z, sx, sz] of [[20, 2.1, 5.8, 0.1], [20, 11.9, 5.8, 0.1], [17.1, 7, 0.1, 9.8], [22.9, 7, 0.1, 9.8], [20, 7, 5.8, 0.1]]) {
      B(x, G + 0.03, z, sx, 0.01, sz, 0xf4efe6);
    }
    for (const gz of [2.2, 11.8]) {
      B(19, G + 0.5, gz, 0.08, 1, 0.08, 0xffffff);
      B(21, G + 0.5, gz, 0.08, 1, 0.08, 0xffffff);
      B(20, G + 1, gz, 2.1, 0.08, 0.08, 0xffffff);
    }
    // Office towers at the far corners.
    for (const [x, h] of [[-21.5, 11], [-17.8, 8], [21.5, 12], [17.6, 7]] as const) {
      B(x, G + h / 2, -18, 3.2, h, 1.4, 0x7d93a6);
      for (let y = 1.5; y < h - 0.5; y += 1.4) glow.push({ x, y: G + y, z: -17.27, sx: 2.8, sy: 0.5, sz: 0.04, color: 0x3a4652 });
    }

    const statics = mergeColorBoxes(boxes, { shadows: true });
    g.add(statics, ...walls);
    const windows = mergeColorBoxes(glow);
    this.windowGlow = windows.material as MeshLambertMaterial;
    this.windowGlow.emissive.setHex(0xffc46a);
    this.windowGlow.emissiveIntensity = 0;
    g.add(windows);

    // Trees and palms (instanced).
    const trees: [number, number][] = [[-22.5, 10.5], [-17, 12.4], [22.5, 0.5], [17.3, -1.5], [-22.8, -7], [-14.6, 18], [9, 18.2], [-6, -18.1], [5, -18.2], [12, -18.1], [-11, 18.2], [23, 15.5], [-23, 17.2], [17, 15.5]];
    const palms: [number, number][] = [[-12.5, 17.8], [-2, 17.8], [3, 17.8], [12.3, 17.8], [-14.5, -17.9], [14.5, -17.9], [0, -17.9], [-17.2, 0.6], [17.3, 13.4]];
    const trunk = new InstancedMesh(new CylinderGeometry(0.16, 0.22, 1, 6), new MeshLambertMaterial({ color: 0x7a4a24 }), trees.length + palms.length);
    const crown = new InstancedMesh(new IcosahedronGeometry(1, 0), new MeshLambertMaterial({ color: 0x4f8a3a }), trees.length);
    const leaf = new InstancedMesh(new ConeGeometry(0.35, 2.2, 4), new MeshLambertMaterial({ color: 0x5a9a3c }), palms.length * 6);
    let ti = 0;
    trees.forEach(([x, z], i) => {
      _m.compose(_p.set(x, G + 0.8, z), _q.identity(), _s.set(1, 1.6, 1));
      trunk.setMatrixAt(ti++, _m);
      const r = 1.1 + ((i * 37) % 5) * 0.12;
      _m.compose(_p.set(x, G + 2.2, z), _q.setFromAxisAngle(_up, i), _s.set(r, r * 1.1, r));
      crown.setMatrixAt(i, _m);
    });
    palms.forEach(([x, z], i) => {
      _m.compose(_p.set(x, G + 1.6, z), _q.identity(), _s.set(0.8, 3.2, 0.8));
      trunk.setMatrixAt(ti++, _m);
      for (let k = 0; k < 6; k += 1) {
        const a = (k / 6) * Math.PI * 2 + i;
        const tilt = new Quaternion().setFromAxisAngle(new Vector3(Math.cos(a), 0, -Math.sin(a)), -1.15);
        const spin = new Quaternion().setFromAxisAngle(_up, a);
        _m.compose(_p.set(x + Math.sin(a) * 0.8, G + 3.3, z + Math.cos(a) * 0.8), tilt.multiply(spin), _s.set(1, 1, 0.3));
        leaf.setMatrixAt(i * 6 + k, _m);
      }
    });
    for (const m of [trunk, crown, leaf]) {
      m.castShadow = true;
      m.instanceMatrix.needsUpdate = true;
      g.add(m);
    }

    // Streetlights along the plot's sidewalk ring.
    const lamps: [number, number][] = [];
    for (let t = -10; t <= 10; t += 5) lamps.push([t, -W - 0.4], [t, W + 0.4], [-W - 0.4, t], [W + 0.4, t]);
    const pole = new InstancedMesh(new BoxGeometry(0.12, 3.2, 0.12), new MeshLambertMaterial({ color: 0x3a3a40 }), lamps.length);
    const head = new InstancedMesh(new SphereGeometry(0.28, 8, 6), this.lampMat, lamps.length);
    lamps.forEach(([x, z], i) => {
      _m.compose(_p.set(x, G + 1.6, z), _q.identity(), _s.set(1, 1, 1));
      pole.setMatrixAt(i, _m);
      _m.compose(_p.set(x, G + 3.25, z), _q.identity(), _s.set(1, 1, 1));
      head.setMatrixAt(i, _m);
    });
    pole.instanceMatrix.needsUpdate = true;
    head.instanceMatrix.needsUpdate = true;
    g.add(pole, head);
  }

  /** 0 = full day, 1 = night: windows and streetlights glow. */
  setNight(k: number): void {
    this.lampMat.emissiveIntensity = k * 2.2;
    this.windowGlow.emissiveIntensity = k * 1.4;
  }
}
