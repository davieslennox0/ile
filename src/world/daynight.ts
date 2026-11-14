/**
 * Day and night. One clock (0–24 h) drives the sky dome, the stars, and the
 * glow of windows and streetlights. Sky colours blend dawn → day → dusk → night.
 */

import {
  BufferGeometry,
  DomeGradient,
  Float32BufferAttribute,
  Points,
  PointsMaterial,
  Quaternion,
  Vector3,
  type World,
} from '@iwsdk/core';
import type { Diorama } from './diorama.ts';

type Sky = { sky: number[]; equator: number[]; ground: number[] };
const KEYS: [number, Sky][] = [
  [5.5, { sky: [0.16, 0.14, 0.3, 1], equator: [0.42, 0.3, 0.38, 1], ground: [0.2, 0.15, 0.15, 1] }],
  [7.5, { sky: [0.5, 0.6, 0.82, 1], equator: [0.99, 0.74, 0.58, 1], ground: [0.62, 0.45, 0.34, 1] }],
  [10, { sky: [0.36, 0.62, 0.88, 1], equator: [0.96, 0.84, 0.66, 1], ground: [0.72, 0.5, 0.33, 1] }],
  [16, { sky: [0.38, 0.6, 0.86, 1], equator: [0.97, 0.82, 0.62, 1], ground: [0.72, 0.5, 0.33, 1] }],
  [18, { sky: [0.3, 0.26, 0.48, 1], equator: [0.95, 0.45, 0.26, 1], ground: [0.36, 0.24, 0.2, 1] }],
  [19.5, { sky: [0.165, 0.137, 0.251, 1], equator: [0.3, 0.2, 0.32, 1], ground: [0.12, 0.1, 0.12, 1] }],
];

const _p = new Vector3();
const _q = new Quaternion();

export class DayNight {
  /** Clock in hours, 0–24. */
  clock = 8;
  private readonly world: World;
  private readonly diorama: Diorama;
  private readonly stars: Points<BufferGeometry, PointsMaterial>;
  private last = -1;

  constructor(world: World, diorama: Diorama, parent: { add: (o: Points) => void }) {
    this.world = world;
    this.diorama = diorama;
    const pts: number[] = [];
    for (let i = 0; i < 300; i += 1) {
      const u = Math.random() * Math.PI * 2;
      const v = 0.1 + Math.random() * 0.88;
      const r = 160;
      pts.push(Math.cos(u) * Math.sqrt(1 - v * v) * r, v * r, Math.sin(u) * Math.sqrt(1 - v * v) * r);
    }
    const geo = new BufferGeometry();
    geo.setAttribute('position', new Float32BufferAttribute(pts, 3));
    this.stars = new Points(geo, new PointsMaterial({ color: 0xfff4d6, size: 2.2, sizeAttenuation: false, transparent: true, opacity: 0, depthWrite: false }));
    this.stars.frustumCulled = false;
    this.stars.visible = false;
    parent.add(this.stars);
  }

  /** 0 in daylight, 1 at full night. */
  get night(): number {
    const h = this.clock;
    if (h >= 17.6) return Math.min(1, (h - 17.6) / 1.4);
    if (h <= 6.5) return Math.min(1, (6.5 - h) / 1.2);
    return 0;
  }

  update(headPos: Vector3): void {
    const h = this.clock;
    if (Math.abs(h - this.last) > 0.004) {
      this.last = h;
      let a = KEYS[0];
      let b = KEYS[KEYS.length - 1];
      for (let i = 0; i < KEYS.length - 1; i += 1) {
        if (h >= KEYS[i][0] && h <= KEYS[i + 1][0]) {
          a = KEYS[i];
          b = KEYS[i + 1];
          break;
        }
      }
      if (h > KEYS[KEYS.length - 1][0]) a = b;
      if (h < KEYS[0][0]) b = a;
      const k = b[0] === a[0] ? 0 : (h - a[0]) / (b[0] - a[0]);
      const mix = (x: number[], y: number[]) => x.map((v, i) => v + (y[i] - v) * k);
      try {
        const root = this.world.activeLevel.value;
        root.getVectorView(DomeGradient, 'sky').set(mix(a[1].sky, b[1].sky));
        root.getVectorView(DomeGradient, 'equator').set(mix(a[1].equator, b[1].equator));
        root.getVectorView(DomeGradient, 'ground').set(mix(a[1].ground, b[1].ground));
      } catch {
        // No sky dome on this level.
      }
      const n = this.night;
      this.diorama.setNight(n);
      this.stars.material.opacity = n * 0.95;
      this.stars.visible = n > 0.02;
    }
    this.stars.position.copy(headPos);
    void _p;
    void _q;
  }
}
