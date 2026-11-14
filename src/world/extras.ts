/**
 * What the family adds over the years, drawn on top of the house: upper
 * storeys with a flat roof, a roof garden, solar panels, the street-front food
 * spot, a car in the drive, and party lights. Building-local metres.
 */

import { BoxGeometry, Group, Mesh, MeshLambertMaterial, SphereGeometry } from '@iwsdk/core';
import { bounds, rectCx, rectCz, rectD, rectW, type Design } from '../model/state.ts';
import { Label } from '../ui/label.ts';
import { PAL } from './diorama.ts';
import { earthTexture, mergeColorBoxes, type ColorBox } from './geo.ts';

export interface Extras {
  floors: number;
  garden: boolean;
  solar: boolean;
  /** 0 none, 1 food spot, 2 restaurant front. */
  shop: number;
  car: boolean;
  party: boolean;
}

export const NO_EXTRAS: Extras = { floors: 1, garden: false, solar: false, shop: 0, car: false, party: false };

/** Where the food spot stands for a design (building-local metres). */
export function shopSpot(d: Design): { x: number; z: number } {
  const b = bounds(d);
  return { x: rectCx(b), z: Math.min(11, b.z1 + 2.6) };
}

export class ExtrasView {
  readonly group = new Group();
  private readonly earth = new MeshLambertMaterial({ map: earthTexture(['#c07a4e', '#d0905f', '#ad6a42', '#d9a173']) });
  private readonly lights = new MeshLambertMaterial({ color: 0xfff1c4, emissive: 0xffc46a, emissiveIntensity: 1.6 });
  private sign: Label | null = null;
  private key = '';

  update(d: Design, e: Extras): void {
    const key = JSON.stringify([d.rooms, d.court, d.wallHeight, e]);
    if (key === this.key) return;
    this.key = key;
    for (const c of [...this.group.children]) {
      this.group.remove(c);
      if (c instanceof Mesh && c.geometry) c.geometry.dispose();
    }
    if (d.rooms.length === 0 || d.wallHeight === 0) return;
    const h = d.wallHeight;
    const boxes: ColorBox[] = [];
    const B = (x: number, y: number, z: number, sx: number, sy: number, sz: number, color: number) =>
      boxes.push({ x, y, z, sx, sy, sz, color });

    // Upper storeys over every room.
    const top = h * e.floors;
    for (let f = 1; f < e.floors; f += 1) {
      for (const r of d.rooms) {
        const m = new Mesh(new BoxGeometry(rectW(r) - 0.1, h, rectD(r) - 0.1), this.earth);
        m.position.set(rectCx(r), h * f + h / 2, rectCz(r));
        m.castShadow = true;
        m.receiveShadow = true;
        this.group.add(m);
        B(rectCx(r), h * f + 0.06, rectCz(r), rectW(r) + 0.3, 0.12, rectD(r) + 0.3, PAL.roof);
        const n = Math.max(1, Math.floor(rectW(r) / 2.5));
        for (let i = 0; i < n; i += 1) {
          const wx = r.x0 + (rectW(r) / n) * (i + 0.5);
          B(wx, h * f + 1.5, r.z1 - 0.02, 0.9, 1.1, 0.08, 0x3a3330);
          B(wx, h * f + 1.5, r.z0 + 0.02, 0.9, 1.1, 0.08, 0x3a3330);
        }
      }
    }
    if (e.floors > 1) {
      for (const r of d.rooms) {
        B(rectCx(r), top + 0.1, rectCz(r), rectW(r) + 0.4, 0.2, rectD(r) + 0.4, PAL.roof);
      }
      if (e.garden) {
        for (const r of d.rooms) {
          B(rectCx(r), top + 0.3, rectCz(r), rectW(r) * 0.6, 0.2, rectD(r) * 0.6, 0x4f8a3a);
          for (let i = 0; i < 3; i += 1) {
            const px = r.x0 + (rectW(r) / 3) * (i + 0.5);
            B(px, top + 0.55, rectCz(r), 0.5, 0.5, 0.5, 0x5a9a3c);
          }
        }
      }
      if (e.solar) {
        const r = d.rooms.reduce((a, b) => (rectW(b) * rectD(b) > rectW(a) * rectD(a) ? b : a));
        for (let i = 0; i < 4; i += 1) {
          B(r.x0 + 1 + i * 1.6, top + 0.55, r.z0 + 1, 1.4, 0.08, 1.0, 0x1f3a6b);
          B(r.x0 + 1 + i * 1.6, top + 0.35, r.z0 + 1, 0.08, 0.4, 0.08, 0x9aa0a6);
        }
      }
    }

    // The food spot on the street front.
    if (e.shop > 0) {
      const s = shopSpot(d);
      const w = e.shop > 1 ? 7 : 4;
      const m = new Mesh(new BoxGeometry(w, 2.8, 2.4), this.earth);
      m.position.set(s.x, 1.4, s.z);
      m.castShadow = true;
      this.group.add(m);
      B(s.x, 2.95, s.z, w + 0.4, 0.2, 2.8, PAL.roof);
      for (let i = 0; i < Math.round(w / 0.8); i += 1) {
        B(s.x - w / 2 + 0.4 + i * 0.8, 2.3, s.z + 1.6, 0.8, 0.08, 1.2, i % 2 ? PAL.teal : PAL.orange);
      }
      B(s.x, 1.0, s.z + 1.3, w - 0.6, 0.2, 0.5, 0x8a5a3a);
      if (!this.sign) {
        this.sign = new Label({ width: 3.6, height: 0.7, ppm: 120, fontScale: 0.55, bold: true, bg: '#d9692b', fg: '#ffffff' });
      }
      this.sign.setText(e.shop > 1 ? "Adaeze's Kitchen" : "Adaeze's Food Spot");
      this.sign.mesh.position.set(s.x, 3.5, s.z + 1.25);
      this.group.add(this.sign.mesh);
    }

    // A car in the drive.
    if (e.car) {
      const b = bounds(d);
      const cx = Math.min(10, b.x1 + 2.2);
      const cz = b.z1 - 2;
      B(cx, 0.55, cz, 1.8, 0.7, 4, 0x2f5fa8);
      B(cx, 1.15, cz - 0.2, 1.6, 0.55, 2.2, 0x9fc2d6);
      for (const [dx, dz] of [[-0.9, 1.2], [0.9, 1.2], [-0.9, -1.3], [0.9, -1.3]]) B(cx + dx, 0.3, cz + dz, 0.25, 0.6, 0.6, 0x1b1b1b);
    }
    if (boxes.length) this.group.add(mergeColorBoxes(boxes, { shadows: true }));

    // String lights for the house-warming.
    if (e.party) {
      const b = bounds(d);
      const c = d.court ?? { x0: b.x0, x1: b.x1, z0: b.z0, z1: b.z1 };
      const bulb = new SphereGeometry(0.12, 6, 4);
      const y = top + 0.4;
      for (let k = 0; k < 4; k += 1) {
        const z = c.z0 + ((c.z1 - c.z0) / 3) * k;
        for (let i = 0; i <= 10; i += 1) {
          const x = c.x0 + ((c.x1 - c.x0) / 10) * i;
          const sag = Math.sin((i / 10) * Math.PI) * 0.6;
          const m = new Mesh(bulb, this.lights);
          m.position.set(x, y - sag, z);
          this.group.add(m);
        }
      }
    }
  }
}
