/**
 * Life on the street: about 25 people walking the sidewalks, kids playing
 * football on the pitch, a market woman at the buka, danfos and kekes on the
 * ring road, plus the family's own figures. All on the diorama (site metres).
 */

import { BoxGeometry, Group, Mesh, MeshLambertMaterial, RingGeometry, SphereGeometry, Vector3 } from '@iwsdk/core';
import { Diorama, PAL } from '../world/diorama.ts';
import { Human, type Look } from './human.ts';
import characters from '../../data/characters.json' with { type: 'json' };

const G = -0.24;

/** Position along a rectangle loop of half-size `h` at parameter t (0–1). */
function loop(h: number, t: number, out: Vector3): number {
  const side = 8 * h;
  let d = ((t % 1) + 1) % 1 * side;
  if (d < 2 * h) { out.set(-h + d, G, -h); return Math.PI / 2; }
  d -= 2 * h;
  if (d < 2 * h) { out.set(h, G, -h + d); return 0; }
  d -= 2 * h;
  if (d < 2 * h) { out.set(h - d, G, h); return -Math.PI / 2; }
  d -= 2 * h;
  out.set(-h, G, h - d);
  return Math.PI;
}

interface Walker { human: Human; t: number; speed: number; ring: number; offset: number }
interface Vehicle { group: Group; t: number; speed: number; ring: number }

export class Street {
  readonly group = new Group();
  /** The family and Baba, placed by the story. */
  readonly family = new Map<string, Human>();
  readonly ring: Mesh;
  private readonly walkers: Walker[] = [];
  private readonly vehicles: Vehicle[] = [];
  private readonly kids: Human[] = [];
  private readonly ball: Mesh;
  private readonly builders: Human[] = [];
  private readonly queue: Human[] = [];
  private readonly party: Human[] = [];
  private clock = 0;

  constructor() {
    const g = this.group;
    const crowd = characters.crowd as Look[];
    for (let i = 0; i < 22; i += 1) {
      const h = new Human(crowd[i % crowd.length]);
      g.add(h.group);
      h.setMode('walk');
      this.walkers.push({ human: h, t: i / 22 + (i % 3) * 0.013, speed: (0.008 + (i % 5) * 0.0018) * (i % 2 ? 1 : -1), ring: i % 3 === 0 ? 17 : Diorama.WALK, offset: (i % 3) * 0.3 - 0.3 });
    }
    // Market woman at the buka and a seller at the stalls.
    for (const [look, x, z] of [[characters.market, -18.6, 3.5], [characters.buka, -18.2, -2.5]] as [Look, number, number][]) {
      const h = new Human(look);
      h.group.position.set(x, G, z);
      h.group.rotation.y = Math.PI / 2;
      g.add(h.group);
    }
    // Kids on the pitch.
    for (let i = 0; i < 4; i += 1) {
      const k = new Human(characters.kids[i % characters.kids.length] as Look);
      k.setMode('walk');
      this.kids.push(k);
      g.add(k.group);
    }
    this.ball = new Mesh(new SphereGeometry(0.18, 8, 6), new MeshLambertMaterial({ color: 0xffffff }));
    g.add(this.ball);

    // Danfos and kekes on the ring road.
    const yellow = new MeshLambertMaterial({ color: PAL.danfo });
    const black = new MeshLambertMaterial({ color: 0x1b1b1b });
    const glass = new MeshLambertMaterial({ color: 0x8fb6c9 });
    const green = new MeshLambertMaterial({ color: 0x2f8f4a });
    const bx = new BoxGeometry(1, 1, 1);
    const add = (parent: Group, m: MeshLambertMaterial, x: number, y: number, z: number, sx: number, sy: number, sz: number) => {
      const mesh = new Mesh(bx, m);
      mesh.position.set(x, y, z);
      mesh.scale.set(sx, sy, sz);
      mesh.castShadow = true;
      parent.add(mesh);
    };
    for (let i = 0; i < 7; i += 1) {
      const v = new Group();
      if (i < 4) {
        add(v, yellow, 0, 1.1, 0, 1.8, 1.6, 4.2);
        add(v, black, 0, 1.0, 0, 1.82, 0.12, 4.22);
        add(v, black, 0, 0.6, 0, 1.82, 0.12, 4.22);
        add(v, glass, 0, 1.55, 0.2, 1.84, 0.5, 3.2);
      } else {
        add(v, green, 0, 0.9, 0, 1.2, 1.2, 2.2);
        add(v, yellow, 0, 1.55, -0.1, 1.25, 0.12, 2.0);
        add(v, black, 0, 0.3, 0.8, 0.2, 0.5, 0.5);
      }
      add(v, black, 0.7, 0.35, 1.2, 0.3, 0.7, 0.7);
      add(v, black, -0.7, 0.35, -1.2, 0.3, 0.7, 0.7);
      v.position.y = G;
      g.add(v);
      this.vehicles.push({ group: v, t: i / 7, speed: (i % 2 ? 1 : -1) * (0.012 + (i % 3) * 0.002), ring: i % 2 ? Diorama.LANE - 0.8 : Diorama.LANE + 0.8 });
    }

    // The player's marker: an orange ring under their figure.
    this.ring = new Mesh(new RingGeometry(0.5, 0.75, 24), new MeshLambertMaterial({ color: PAL.orange, emissive: PAL.orange, emissiveIntensity: 0.6 }));
    this.ring.rotation.x = -Math.PI / 2;
    g.add(this.ring);
  }

  /** Put a family member on the diorama (or move them). */
  placeFamily(id: keyof typeof characters.family, x: number, z: number, rotY = 0): Human {
    let h = this.family.get(id);
    if (!h) {
      h = new Human(characters.family[id] as Look);
      this.family.set(id, h);
      this.group.add(h.group);
    }
    h.group.visible = true;
    h.group.position.set(x, G, z);
    h.group.rotation.y = rotY;
    return h;
  }

  /** Builders in hard hats at work on the plot while the house goes up. */
  setBuilders(on: boolean, spots: [number, number][] = []): void {
    while (this.builders.length < spots.length) {
      const b = new Human(characters.builder as Look);
      b.setMode('work');
      this.builders.push(b);
      this.group.add(b.group);
    }
    this.builders.forEach((b, i) => {
      b.group.visible = on && !!spots[i];
      if (spots[i]) b.group.position.set(spots[i][0], G, spots[i][1]);
    });
  }

  /** Customers lining up at the family's food spot. */
  setQueue(n: number, at: [number, number]): void {
    const crowd = characters.crowd as Look[];
    while (this.queue.length < n) {
      const c = new Human(crowd[(this.queue.length * 5 + 3) % crowd.length]);
      this.queue.push(c);
      this.group.add(c.group);
    }
    this.queue.forEach((c, i) => {
      c.group.visible = i < n;
      c.group.position.set(at[0] + i * 0.9, G, at[1]);
      c.group.rotation.y = -Math.PI / 2;
    });
  }

  /** Neighbours dancing in the courtyard at the house-warming. */
  setParty(on: boolean, at: [number, number]): void {
    const crowd = characters.crowd as Look[];
    while (on && this.party.length < 8) {
      const p = new Human(crowd[(this.party.length * 3 + 1) % crowd.length]);
      p.setMode('dance');
      this.party.push(p);
      this.group.add(p.group);
    }
    this.party.forEach((p, i) => {
      p.group.visible = on;
      const a = (i / this.party.length) * Math.PI * 2;
      p.group.position.set(at[0] + Math.cos(a) * 1.6, G, at[1] + Math.sin(a) * 1.6);
      p.group.rotation.y = -a + Math.PI / 2;
    });
    for (const h of this.family.values()) if (on) h.setMode('dance');
  }

  private readonly _v = new Vector3();

  update(dt: number): void {
    this.clock += dt;
    for (const w of this.walkers) {
      w.t += w.speed * dt;
      const rot = loop(w.ring + w.offset, w.t, this._v);
      w.human.group.position.copy(this._v);
      w.human.group.rotation.y = rot + (w.speed < 0 ? Math.PI : 0);
      w.human.update(dt);
    }
    for (const v of this.vehicles) {
      v.t += v.speed * dt;
      const rot = loop(v.ring, v.t, this._v);
      v.group.position.set(this._v.x, G, this._v.z);
      v.group.rotation.y = rot + (v.speed < 0 ? Math.PI : 0);
    }
    // Kids chase the ball around the pitch.
    const bx = 20 + Math.sin(this.clock * 0.9) * 2.2;
    const bz = 7 + Math.sin(this.clock * 0.6) * 3.8;
    this.ball.position.set(bx, G + 0.18 + Math.abs(Math.sin(this.clock * 3)) * 0.4, bz);
    this.kids.forEach((k, i) => {
      const a = this.clock * 0.8 + i * 1.6;
      k.group.position.set(bx + Math.cos(a) * 1.4, G, bz + Math.sin(a) * 1.4);
      k.group.lookAt(this.ball.position.x, k.group.position.y, this.ball.position.z);
      k.update(dt);
    });
    for (const h of [...this.family.values(), ...this.builders, ...this.party, ...this.queue]) h.update(dt);
    const me = this.family.get('player');
    if (me) {
      this.ring.visible = me.group.visible;
      this.ring.position.set(me.group.position.x, G + 0.03, me.group.position.z);
    }
  }
}
