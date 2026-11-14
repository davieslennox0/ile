/**
 * One generic low-poly Nigerian figure, dressed from data. Legs, torso, arms
 * on shoulder pivots, head, and an attire layer: agbada, kaftan, iro + gele,
 * market (wrapper + tray of peppers), ankara dress + headwrap, office,
 * school (child scale), worker (hard hat) or t-shirt. Real metres; the
 * diorama shows them at 1:50 and interiors at 1:1.
 */

import {
  BoxGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshLambertMaterial,
  SphereGeometry,
  type Texture,
} from '@iwsdk/core';
import { ankaraTexture } from '../world/geo.ts';

export type Attire = 'agbada' | 'kaftan' | 'iro' | 'market' | 'dress' | 'office' | 'school' | 'worker' | 'tshirt';

export interface Look {
  attire: Attire;
  /** Main garment colour (hex). */
  main: number;
  /** Accent colour (headwear, trim). */
  accent?: number;
  skin?: number;
  /** Ankara palette index for wrappers and dresses. */
  print?: number;
  scale?: number;
}

export const ANKARA: string[][] = [
  ['#d9692b', '#2fa58f', '#f2bf12', '#1f2a44'],
  ['#2f5fa8', '#f2bf12', '#e04f3a', '#ffffff'],
  ['#7a2a8a', '#f2a03a', '#2fa58f', '#f4efe6'],
  ['#1f7a4a', '#f4c430', '#d8361f', '#101010'],
  ['#c0392b', '#f4efe6', '#1f2a44', '#f2bf12'],
  ['#0f6e8c', '#f28c28', '#f4efe6', '#7a1f3d'],
];

const box = new BoxGeometry(1, 1, 1);
const cyl = new CylinderGeometry(1, 1, 1, 8);
const sph = new SphereGeometry(1, 10, 8);
const mats = new Map<string, MeshLambertMaterial>();
const prints = new Map<number, Texture>();

function mat(color: number, print?: number): MeshLambertMaterial {
  const key = `${color}:${print ?? ''}`;
  let m = mats.get(key);
  if (!m) {
    let map: Texture | undefined;
    if (print !== undefined) {
      map = prints.get(print);
      if (!map) {
        map = ankaraTexture(ANKARA[print % ANKARA.length], print);
        prints.set(print, map);
      }
    }
    m = new MeshLambertMaterial({ color: map ? 0xffffff : color, map });
    mats.set(key, m);
  }
  return m;
}

function part(geo: BoxGeometry | CylinderGeometry | SphereGeometry, m: MeshLambertMaterial, x: number, y: number, z: number, sx: number, sy: number, sz: number): Mesh {
  const mesh = new Mesh(geo, m);
  mesh.position.set(x, y, z);
  mesh.scale.set(sx, sy, sz);
  mesh.castShadow = true;
  return mesh;
}

export class Human {
  readonly group = new Group();
  readonly look: Look;
  private readonly legL = new Group();
  private readonly legR = new Group();
  private readonly armL = new Group();
  private readonly armR = new Group();
  private readonly body = new Group();
  private phase = Math.random() * 6;
  private swing: number;
  private mode: 'stand' | 'walk' | 'wave' | 'sit' | 'dance' | 'work' = 'stand';

  constructor(look: Look) {
    this.look = look;
    const skin = mat(look.skin ?? 0x5a3420);
    const main = mat(look.main, ['iro', 'market', 'dress'].includes(look.attire) ? look.print ?? 0 : undefined);
    const accent = mat(look.accent ?? 0xf4efe6);
    const dark = mat(0x22201e);
    const robe = ['agbada', 'kaftan', 'iro', 'market', 'dress'].includes(look.attire);
    this.swing = robe ? 0.25 : 0.6;
    const g = this.group;
    g.add(this.body);

    // Legs hinge at the hip (0.9 m).
    for (const [leg, x] of [[this.legL, -0.11], [this.legR, 0.11]] as const) {
      leg.position.set(x, 0.9, 0);
      const trousers = look.attire === 'office' ? dark : look.attire === 'school' ? mat(0x1f2a44) : look.attire === 'worker' ? mat(0x34495e) : mat(look.main);
      leg.add(part(box, trousers, 0, -0.42, 0, 0.16, 0.84, 0.17));
      leg.add(part(box, dark, 0, -0.86, 0.04, 0.17, 0.08, 0.26));
      this.body.add(leg);
    }
    // Torso.
    const torsoMat = look.attire === 'office' ? mat(0xf4efe6) : look.attire === 'school' ? mat(0xf4efe6) : look.attire === 'worker' ? mat(0xf28c28) : main;
    this.body.add(part(box, torsoMat, 0, 1.2, 0, 0.42, 0.62, 0.24));
    if (robe) {
      // A long garment over the legs: wider for the agbada.
      const w = look.attire === 'agbada' ? 0.42 : 0.3;
      this.body.add(part(cyl, main, 0, 0.62, 0, w, 1.12, w * 0.75));
    }
    if (look.attire === 'agbada') {
      this.body.add(part(box, main, 0, 1.15, 0, 0.9, 0.7, 0.28));
      this.body.add(part(box, mat(0xd9a63a), 0, 1.45, 0.13, 0.22, 0.06, 0.02));
    }
    if (look.attire === 'office') this.body.add(part(box, mat(look.accent ?? 0x2f5fa8), 0, 1.22, 0.125, 0.06, 0.4, 0.01));
    if (look.attire === 'school') this.body.add(part(box, mat(look.accent ?? 0xd8361f), 0, 1.2, -0.2, 0.32, 0.4, 0.14));
    // Arms hinge at the shoulder (1.48 m).
    for (const [arm, x] of [[this.armL, -0.27], [this.armR, 0.27]] as const) {
      arm.position.set(x, 1.48, 0);
      arm.add(part(box, look.attire === 'tshirt' || look.attire === 'worker' ? skin : torsoMat, 0, -0.28, 0, 0.12, 0.56, 0.13));
      arm.add(part(sph, skin, 0, -0.6, 0, 0.065, 0.065, 0.065));
      this.body.add(arm);
    }
    // Head and headwear.
    this.body.add(part(cyl, skin, 0, 1.56, 0, 0.06, 0.1, 0.06));
    this.body.add(part(sph, skin, 0, 1.74, 0, 0.13, 0.15, 0.13));
    this.body.add(part(sph, dark, 0, 1.79, -0.02, 0.13, 0.11, 0.12));
    if (look.attire === 'agbada' || look.attire === 'kaftan') this.body.add(part(cyl, accent, 0, 1.9, 0, 0.12, 0.12, 0.12));
    if (look.attire === 'iro') this.body.add(part(sph, mat(look.accent ?? 0xd9692b, look.print), 0, 1.92, -0.02, 0.24, 0.12, 0.2));
    if (look.attire === 'dress') this.body.add(part(sph, mat(look.accent ?? 0xf2bf12), 0, 1.88, -0.02, 0.15, 0.11, 0.15));
    if (look.attire === 'market') {
      this.body.add(part(sph, mat(look.accent ?? 0x2fa58f), 0, 1.88, 0, 0.15, 0.08, 0.15));
      this.body.add(part(cyl, mat(0x8a5a3a), 0, 1.97, 0, 0.3, 0.04, 0.3));
      for (let i = 0; i < 5; i += 1) this.body.add(part(sph, mat(0xd8361f), Math.cos(i * 1.3) * 0.15, 2.02, Math.sin(i * 1.3) * 0.15, 0.06, 0.06, 0.06));
    }
    if (look.attire === 'worker') this.body.add(part(sph, mat(0xf2bf12), 0, 1.84, 0, 0.16, 0.1, 0.16));
    g.scale.setScalar(look.scale ?? 1);
  }

  setMode(mode: Human['mode']): void {
    this.mode = mode;
    if (mode === 'sit') {
      this.legL.rotation.x = this.legR.rotation.x = -Math.PI / 2;
      this.body.position.y = -0.45;
    } else {
      this.body.position.y = 0;
    }
  }

  update(dt: number): void {
    this.phase += dt * (this.mode === 'walk' ? 7 : this.mode === 'dance' ? 6 : 4);
    const s = Math.sin(this.phase);
    if (this.mode === 'walk') {
      this.legL.rotation.x = s * this.swing;
      this.legR.rotation.x = -s * this.swing;
      this.armL.rotation.x = -s * 0.5;
      this.armR.rotation.x = s * 0.5;
      this.body.position.y = Math.abs(Math.cos(this.phase)) * 0.03;
    } else if (this.mode === 'wave') {
      this.armR.rotation.z = 2.6 + s * 0.35;
      this.armL.rotation.x = 0;
    } else if (this.mode === 'dance') {
      this.armL.rotation.z = -1.8 + s * 0.6;
      this.armR.rotation.z = 1.8 - s * 0.6;
      this.body.position.y = Math.abs(s) * 0.08;
      this.body.rotation.y = s * 0.4;
    } else if (this.mode === 'work') {
      this.armR.rotation.x = -1.2 + Math.abs(s) * 1.0;
    } else if (this.mode === 'sit') {
      this.armL.rotation.x = this.armR.rotation.x = -0.6 + Math.sin(this.phase * 0.5) * 0.15;
    } else {
      this.legL.rotation.x = this.legR.rotation.x = 0;
      this.armL.rotation.set(0, 0, 0);
      this.armR.rotation.set(0, 0, 0);
      this.body.rotation.y = 0;
    }
  }
}
