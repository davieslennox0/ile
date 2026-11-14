/**
 * Everyday family life at full scale, seated, hands only.
 *
 *   dinner    stir the pot (circle the hand) → plates from the rack to the
 *             table → serve (carry the pot over each plate) → eat together →
 *             wash a plate (rub it back and forth in the basin) → rack it
 *   cot       place Tolu's cot → wind the mobile (circle the hand)
 *   homework  turn the notebook's pages (pinch and swipe sideways)
 *
 * Props are laid out in front of the seat, in building-local metres (1:1).
 */

import {
  BoxGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshLambertMaterial,
  Quaternion,
  SphereGeometry,
  Vector3,
} from '@iwsdk/core';
import type { App } from '../app.ts';
import { Sfx } from '../audio.ts';
import type { DragInfo } from '../interact/gestures.ts';
import { Human, type Look } from '../people/human.ts';
import characters from '../../data/characters.json' with { type: 'json' };

export type HomeTask = 'dinner' | 'cot' | 'homework';
type DinnerStep = 'stir' | 'plates' | 'serve' | 'eat' | 'wash' | 'rack' | 'done';

const _a = new Vector3();
const _b = new Vector3();
const _q = new Quaternion();
const box = new BoxGeometry(1, 1, 1);
const L = (c: number, e = 0) => new MeshLambertMaterial({ color: c, emissive: e ? c : 0, emissiveIntensity: e });

function mesh(geo: BoxGeometry | CylinderGeometry | SphereGeometry, m: MeshLambertMaterial, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1): Mesh {
  const o = new Mesh(geo, m);
  o.position.set(x, y, z);
  o.scale.set(sx, sy, sz);
  o.castShadow = true;
  o.receiveShadow = true;
  return o;
}

export class HomeLife {
  task: HomeTask | null = null;
  step = '';
  private readonly app: App;
  /** Seat-aligned frame: +z is away from the viewer, +x to their right. */
  private readonly kit = new Group();
  private done: (() => void) | null = null;
  // Dinner.
  private readonly pot = new Group();
  private readonly stew: Mesh;
  private readonly plates: { g: Group; food: Mesh; state: 'rack' | 'table' | 'full' | 'eaten' | 'basin' | 'clean' | 'racked' }[] = [];
  private readonly spots = [new Vector3(-0.28, 0.76, 1.15), new Vector3(0.28, 0.76, 1.15)];
  private readonly rackAt = new Vector3(0.82, 0.95, 0.92);
  private readonly basinAt = new Vector3(0.48, 0.9, 0.95);
  private readonly potHome = new Vector3(-0.8, 0.98, 0.92);
  private adaeze: Human | null = null;
  private tolu: Human | null = null;
  private turns = 0;
  private lastAngle: number | null = null;
  private rubs = 0;
  private lastDir = 0;
  private lastX = 0;
  private eatT = 0;
  // Cot and homework.
  private readonly cot = new Group();
  private readonly mobile = new Group();
  private readonly book = new Group();
  private readonly page: Mesh;
  private pages = 0;
  private pageAnim = 0;
  private readonly dragFrom = new Vector3();

  constructor(app: App) {
    this.app = app;
    this.kit.visible = false;
    app.view.group.add(this.kit);
    const wood = L(0x8a5a3a);
    const dark = L(0x5b3418);
    const white = L(0xf4efe6);
    const k = this.kit;

    // Kitchen corner: counter with a gas burner and the pot.
    k.add(mesh(box, L(0xb9a48a), -0.8, 0.45, 0.95, 0.7, 0.9, 0.55));
    k.add(mesh(new CylinderGeometry(0.16, 0.16, 0.04, 16), L(0x2a2a2a), -0.8, 0.92, 0.92));
    this.pot.add(mesh(new CylinderGeometry(0.15, 0.13, 0.18, 18), L(0x3a3a3a), 0, 0.09, 0));
    this.stew = mesh(new CylinderGeometry(0.135, 0.135, 0.01, 18), L(0xd9692b), 0, 0.17, 0);
    this.pot.add(this.stew);
    this.pot.position.copy(this.potHome);
    k.add(this.pot);
    // Plate rack, basin and the dining table with stools.
    k.add(mesh(box, wood, 0.82, 0.45, 0.95, 0.3, 0.9, 0.4));
    k.add(mesh(box, L(0xd8d2c6), 0.48, 0.42, 0.95, 0.4, 0.84, 0.45));
    k.add(mesh(box, L(0x4f9fd8, 0.15), 0.48, 0.85, 0.95, 0.32, 0.02, 0.36));
    k.add(mesh(box, wood, 0, 0.72, 1.25, 1.1, 0.06, 0.7));
    for (const [x, z] of [[-0.48, 1.0], [0.48, 1.0], [-0.48, 1.5], [0.48, 1.5]]) k.add(mesh(box, dark, x, 0.36, z, 0.06, 0.72, 0.06));
    for (const [x, z] of [[0, 1.75], [-0.7, 1.25], [0.7, 1.25]]) k.add(mesh(new CylinderGeometry(0.16, 0.16, 0.45, 12), dark, x, 0.225, z));
    for (let i = 0; i < 2; i += 1) {
      const g = new Group();
      g.add(mesh(new CylinderGeometry(0.11, 0.09, 0.02, 18), white, 0, 0, 0));
      const food = mesh(new SphereGeometry(0.075, 12, 6), L(0xd9692b), 0, 0.02, 0, 1, 0.35, 1);
      food.visible = false;
      g.add(food);
      g.position.copy(this.rackAt).add(new Vector3(0, 0.05 + i * 0.06, 0));
      g.rotation.x = -1.2;
      k.add(g);
      this.plates.push({ g, food, state: 'rack' });
    }

    // Tolu's cot and mobile, and the homework notebook.
    this.cot.add(mesh(box, L(0xf4efe6), 0, 0.45, 0, 0.7, 0.06, 1.2));
    this.cot.add(mesh(box, L(0x2fa58f), 0, 0.5, 0, 0.62, 0.06, 1.1));
    for (const [x, z] of [[-0.33, -0.58], [0.33, -0.58], [-0.33, 0.58], [0.33, 0.58]]) this.cot.add(mesh(box, wood, x, 0.4, z, 0.05, 0.8, 0.05));
    this.mobile.add(mesh(new CylinderGeometry(0.01, 0.01, 0.4, 6), dark, 0, 0.2, 0));
    for (let i = 0; i < 4; i += 1) {
      const a = (i / 4) * Math.PI * 2;
      this.mobile.add(mesh(new SphereGeometry(0.05, 8, 6), L([0xd9692b, 0xf2bf12, 0x2fa58f, 0xe04f3a][i], 0.2), Math.cos(a) * 0.18, -0.05, Math.sin(a) * 0.18));
    }
    this.mobile.position.set(0, 1.0, 0);
    this.mobile.visible = false;
    this.cot.add(this.mobile);
    this.cot.visible = false;
    k.add(this.cot);
    this.book.add(mesh(box, wood, 0, 0.36, 0, 0.7, 0.72, 0.45));
    this.book.add(mesh(box, L(0x2f5fa8), 0, 0.735, 0, 0.42, 0.02, 0.3));
    this.page = mesh(box, white, 0.1, 0.75, 0, 0.2, 0.004, 0.28);
    this.page.geometry = new BoxGeometry(1, 1, 1).translate(0.5, 0, 0);
    this.page.position.set(0, 0.75, 0);
    this.page.scale.set(0.2, 0.004, 0.28);
    this.book.add(this.page);
    this.book.position.set(0, 0, 0.8);
    this.book.visible = false;
    k.add(this.book);

    this.registerTargets();
  }

  /** Hand movement since the grab, in the kit's frame. */
  private delta(info: DragInfo): Vector3 {
    this.kit.updateWorldMatrix(true, false);
    return this.kit.worldToLocal(_a.copy(info.position)).sub(this.kit.worldToLocal(_b.copy(info.start)));
  }

  private registerTargets(): void {
    const app = this.app;
    const on = () => this.task !== null && app.mode === 'inside';
    // The pot: stir it, then carry it to serve.
    const potPick = new Group();
    potPick.position.y = 0.12;
    this.pot.add(potPick);
    app.gestures.add({
      id: 'home-pot',
      object: potPick,
      radius: 0.22,
      enabled: () => on() && this.task === 'dinner' && (this.step === 'stir' || this.step === 'serve'),
      onHover: (h) => this.pot.scale.setScalar(h ? 1.08 : 1),
      onDragStart: () => {
        this.lastAngle = null;
        this.dragFrom.copy(this.pot.position);
      },
      onDrag: (info) => {
        const d = this.delta(info);
        if (this.step === 'stir') {
          if (Math.hypot(d.x, d.z) < 0.012) return;
          const ang = Math.atan2(d.z, d.x);
          if (this.lastAngle !== null) {
            let s = ang - this.lastAngle;
            if (s > Math.PI) s -= Math.PI * 2;
            if (s < -Math.PI) s += Math.PI * 2;
            this.turns += Math.abs(s) / (Math.PI * 2);
            this.stew.rotation.y -= s;
            if (this.turns >= 2) this.next('plates');
          }
          this.lastAngle = ang;
        } else {
          const gain = 2.2;
          this.pot.position.set(this.dragFrom.x + d.x * gain, Math.max(0.85, this.dragFrom.y + d.y * gain), this.dragFrom.z + d.z * gain);
          this.pot.rotation.z = -0.5 * Math.min(1, this.nearPlate() ? 1 : 0);
        }
      },
      onDragEnd: () => {
        if (this.step !== 'serve') return;
        const p = this.nearPlate();
        if (p) {
          p.state = 'full';
          p.food.visible = true;
          Sfx.release();
        }
        this.pot.position.copy(this.potHome);
        this.pot.rotation.z = 0;
        if (this.plates.every((q) => q.state === 'full')) this.next('eat');
      },
    });
    // The plates: rack → table; later washed and racked.
    this.plates.forEach((p, i) => {
      const pick = new Group();
      p.g.add(pick);
      app.gestures.add({
        id: `home-plate-${i}`,
        object: pick,
        radius: 0.14,
        enabled: () =>
          on() && this.task === 'dinner' &&
          ((this.step === 'plates' && p.state === 'rack') || ((this.step === 'wash' || this.step === 'rack') && i === 0 && p.state !== 'racked')),
        onHover: (h) => p.g.scale.setScalar(h ? 1.12 : 1),
        onDragStart: () => {
          this.dragFrom.copy(p.g.position);
          this.lastDir = 0;
          this.lastX = 0;
          p.g.rotation.x = 0;
        },
        onDrag: (info) => {
          const d = this.delta(info);
          const gain = 2.2;
          if (this.step === 'wash' && p.state === 'basin') {
            // Rub: count changes of direction of the hand, side to side.
            p.g.position.set(this.basinAt.x + Math.max(-0.08, Math.min(0.08, d.x * 2)), this.basinAt.y + 0.02, this.basinAt.z);
            const dir = Math.sign(d.x - this.lastX);
            if (Math.abs(d.x - this.lastX) > 0.006) {
              if (dir !== 0 && dir !== this.lastDir) {
                this.rubs += 1;
                if (this.rubs % 2 === 0) Sfx.tick();
              }
              this.lastDir = dir;
              this.lastX = d.x;
            }
            if (this.rubs >= 6) {
              p.state = 'clean';
              (p.g.children[0] as Mesh).material = L(0xffffff, 0.25);
              this.next('rack');
            }
            return;
          }
          p.g.position.set(this.dragFrom.x + d.x * gain, Math.max(0.78, this.dragFrom.y + d.y * gain), this.dragFrom.z + d.z * gain);
          if (this.step === 'wash' && p.g.position.distanceTo(this.basinAt) < 0.25) {
            p.state = 'basin';
            this.lastX = d.x;
          }
        },
        onDragEnd: () => {
          if (this.step === 'plates') {
            const spot = this.spots[this.plates.filter((q) => q.state === 'table').length];
            p.g.position.copy(spot);
            p.state = 'table';
            Sfx.release();
            if (this.plates.every((q) => q.state === 'table')) this.next('serve');
          } else if (this.step === 'rack' && p.state === 'clean') {
            p.g.position.copy(this.rackAt).add(new Vector3(0, 0.05, 0));
            p.g.rotation.x = -1.2;
            p.state = 'racked';
            this.next('done');
          } else if (p.state !== 'basin' && p.state !== 'clean') {
            p.g.position.copy(this.dragFrom);
          }
        },
      });
    });
    // The cot: carry it into place; then the mobile.
    const cotPick = new Group();
    cotPick.position.y = 0.5;
    this.cot.add(cotPick);
    app.gestures.add({
      id: 'home-cot',
      object: cotPick,
      radius: 0.45,
      enabled: () => on() && this.task === 'cot' && this.step === 'place',
      onHover: (h) => this.cot.scale.setScalar(h ? 1.05 : 1),
      onDragStart: () => this.dragFrom.copy(this.cot.position),
      onDrag: (info) => {
        const d = this.delta(info);
        this.cot.position.set(this.dragFrom.x + d.x * 2.5, 0, this.dragFrom.z + d.z * 2.5);
      },
      onDragEnd: () => {
        Sfx.release();
        this.mobile.visible = true;
        this.next('wind');
      },
    });
    const mobPick = new Group();
    this.mobile.add(mobPick);
    app.gestures.add({
      id: 'home-mobile',
      object: mobPick,
      radius: 0.25,
      enabled: () => on() && this.task === 'cot' && this.step === 'wind',
      onDragStart: () => {
        this.lastAngle = null;
      },
      onDrag: (info) => {
        const d = this.delta(info);
        if (Math.hypot(d.x, d.z) < 0.012) return;
        const ang = Math.atan2(d.z, d.x);
        if (this.lastAngle !== null) {
          let s = ang - this.lastAngle;
          if (s > Math.PI) s -= Math.PI * 2;
          if (s < -Math.PI) s += Math.PI * 2;
          this.turns += Math.abs(s) / (Math.PI * 2);
          this.mobile.rotation.y -= s * 2;
          if (this.turns >= 2) this.next('done');
        }
        this.lastAngle = ang;
      },
    });
    // The notebook: pinch and swipe to turn a page.
    const bookPick = new Group();
    bookPick.position.y = 0.76;
    this.book.add(bookPick);
    app.gestures.add({
      id: 'home-book',
      object: bookPick,
      radius: 0.24,
      enabled: () => on() && this.task === 'homework' && this.step === 'pages',
      onDrag: (info) => {
        const d = this.delta(info);
        if (d.x < -0.05 && this.pageAnim <= 0) {
          this.pageAnim = 1;
          this.pages += 1;
          Sfx.tick();
          if (this.pages >= 3) this.next('done');
        }
      },
    });
  }

  private nearPlate() {
    return this.plates.find((p) => p.state === 'table' && p.g.position.distanceTo(_a.set(this.pot.position.x, p.g.position.y, this.pot.position.z)) < 0.22) ?? null;
  }

  private hint(): string {
    if (this.task === 'dinner') {
      return {
        stir: 'Pinch the pot and stir: circle your hand.',
        plates: 'Pinch a plate from the rack and set it on the table.',
        serve: 'Pinch the pot and carry it over each plate to serve.',
        eat: 'Eat together.',
        wash: 'Pinch a plate, put it in the basin and rub it back and forth.',
        rack: 'Clean! Put the plate back on the rack.',
        done: 'Dinner done.',
      }[this.step as DinnerStep] ?? '';
    }
    if (this.task === 'cot') return this.step === 'place' ? "Pinch Tolu's cot and set it down." : 'Pinch the mobile and circle your hand to wind it.';
    return 'Pinch the notebook and swipe left to turn the page.';
  }

  private next(step: string): void {
    this.step = step;
    this.turns = 0;
    this.lastAngle = null;
    this.rubs = 0;
    Sfx.chime();
    if (step === 'eat') {
      this.eatT = 0;
      for (const h of [this.adaeze, this.tolu]) h?.setMode('sit');
    }
    if (step === 'done') {
      const cb = this.done;
      this.app.toast(this.task === 'dinner' ? 'Dinner done. The kitchen is clean.' : this.task === 'cot' ? 'Tolu is sleeping.' : 'Homework done.', 2.5);
      setTimeout(() => {
        this.stop();
        cb?.();
      }, 1800);
      return;
    }
    this.app.setHint(this.hint());
    this.app.emit(`home:${step}`);
  }

  /** Lay the props out in front of the seat and begin a task. */
  start(task: HomeTask, done: () => void, family: { adaeze?: boolean; tolu?: boolean } = {}): void {
    const app = this.app;
    this.task = task;
    this.done = done;
    const g = app.view.group;
    g.updateWorldMatrix(true, false);
    app.headPose(_a, _q);
    const seat = g.worldToLocal(_a.clone());
    const fwd = g.worldToLocal(_a.clone().add(_b.set(0, 0, -1).applyQuaternion(_q).setY(0).normalize())).sub(seat);
    this.kit.position.set(seat.x, 0, seat.z);
    this.kit.rotation.set(0, Math.atan2(fwd.x, fwd.z), 0);
    this.kit.visible = true;
    for (const c of this.kit.children) c.visible = task === 'dinner';
    this.cot.visible = task === 'cot';
    this.book.visible = task === 'homework';
    if (task === 'dinner') {
      this.pot.position.copy(this.potHome);
      this.plates.forEach((p, i) => {
        p.state = 'rack';
        p.food.visible = false;
        (p.g.children[0] as Mesh).material = L(0xf4efe6);
        p.g.position.copy(this.rackAt).add(new Vector3(0, 0.05 + i * 0.06, 0));
        p.g.rotation.x = -1.2;
      });
      this.stew.visible = true;
      if (family.adaeze) {
        this.adaeze ??= new Human(characters.family.adaeze as Look);
        this.adaeze.group.position.set(-0.7, 0, 1.3);
        this.adaeze.group.rotation.y = Math.PI / 2;
        this.adaeze.setMode('stand');
        this.kit.add(this.adaeze.group);
      }
      if (family.tolu) {
        this.tolu ??= new Human(characters.family.tolu as Look);
        this.tolu.group.position.set(0.7, 0, 1.25);
        this.tolu.group.rotation.y = -Math.PI / 2;
        this.kit.add(this.tolu.group);
      }
      this.step = 'stir';
    } else if (task === 'cot') {
      this.cot.position.set(-0.6, 0, 1.0);
      this.mobile.visible = false;
      this.step = 'place';
    } else {
      this.pages = 0;
      this.step = 'pages';
    }
    app.setHint(this.hint());
    app.emit(`home:${this.step}`);
  }

  stop(): void {
    this.task = null;
    this.step = '';
    this.kit.visible = false;
  }

  /** Position of a named prop, for scripted hands. */
  where(name: 'pot' | 'plate0' | 'plate1' | 'basin' | 'rack' | 'table0' | 'table1' | 'cot' | 'mobile' | 'book'): Vector3 {
    this.kit.updateWorldMatrix(true, true);
    const local =
      name === 'pot' ? this.pot.position.clone().setY(this.pot.position.y + 0.12)
        : name === 'plate0' ? this.plates[0].g.position.clone()
          : name === 'plate1' ? this.plates[1].g.position.clone()
            : name === 'basin' ? this.basinAt.clone()
              : name === 'rack' ? this.rackAt.clone()
                : name === 'table0' ? this.spots[0].clone()
                  : name === 'table1' ? this.spots[1].clone()
                    : name === 'cot' ? this.cot.position.clone().setY(0.5)
                      : name === 'mobile' ? this.cot.position.clone().setY(1.0)
                        : this.book.position.clone().setY(0.76);
    return this.kit.localToWorld(local);
  }

  update(dt: number): void {
    if (!this.task) return;
    for (const h of [this.adaeze, this.tolu]) h?.update(dt);
    if (this.step === 'eat') {
      this.eatT += dt;
      for (const p of this.plates) p.food.scale.setScalar(Math.max(0.05, 1 - this.eatT / 4));
      if (this.eatT > 4.2) {
        for (const p of this.plates) {
          p.state = 'eaten';
          p.food.visible = false;
        }
        for (const h of [this.adaeze, this.tolu]) h?.setMode('stand');
        this.next('wash');
      }
    }
    if (this.step === 'wind' || this.task === 'cot') this.mobile.rotation.y += dt * 0.3;
    if (this.pageAnim > 0) {
      this.pageAnim = Math.max(0, this.pageAnim - dt * 2.5);
      this.page.rotation.z = (1 - this.pageAnim) * Math.PI;
      if (this.pageAnim === 0) this.page.rotation.z = 0;
    }
  }
}
