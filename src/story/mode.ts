/**
 * Story mode: "Your first home in Lagos".
 *
 * A light, skippable wrapper around the same Ilé tools. Beats:
 *   dawn arrival → Baba greets → build from scratch → move in and place your
 *   belongings → first afternoon heat → NEPA power cut → Baba's advice →
 *   evening and a journal card.
 * Savings pay for building. Returning on a later day brings one small prompt.
 */

import {
  BoxGeometry,
  BufferGeometry,
  CylinderGeometry,
  DomeGradient,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  Points,
  PointsMaterial,
  Quaternion,
  SphereGeometry,
  Vector3,
} from '@iwsdk/core';
import type { App } from '../app.ts';
import { Sfx } from '../audio.ts';
import type { ComfortContext } from '../heat/score.ts';
import { WALL_THICKNESS } from '../model/building.ts';
import { SIDES, edgeCoord, isComplete, roomById, type Design, type Side } from '../model/state.ts';
import { Label, PALETTE } from '../ui/label.ts';
import {
  BABA,
  BELONGINGS,
  ITEM_LABEL,
  buildCost,
  comfortContext,
  deserializeStory,
  journal,
  naira,
  newStory,
  serializeStory,
  visitPrompt,
  type ItemId,
  type Placed,
  type Story,
} from './story.ts';

const STORAGE_KEY = 'ile.story.v1';
type Beat = 'arrival' | 'build' | 'movein' | 'settle' | 'afternoon' | 'nepa' | 'advice' | 'evening' | 'journal' | 'free';

const SKY: Record<'dawn' | 'day' | 'dusk', { sky: number[]; equator: number[]; ground: number[] }> = {
  dawn: { sky: [0.5, 0.6, 0.82, 1], equator: [0.99, 0.74, 0.58, 1], ground: [0.62, 0.45, 0.34, 1] },
  day: { sky: [0.36, 0.62, 0.88, 1], equator: [0.96, 0.84, 0.66, 1], ground: [0.72, 0.5, 0.33, 1] },
  dusk: { sky: [0.07, 0.08, 0.22, 1], equator: [0.93, 0.42, 0.26, 1], ground: [0.3, 0.2, 0.2, 1] },
};

const _a = new Vector3();
const _b = new Vector3();
const _q = new Quaternion();

function lambert(color: number, emissive = 0): MeshLambertMaterial {
  return new MeshLambertMaterial({ color, emissive: emissive ? color : 0x000000, emissiveIntensity: emissive });
}

/** Simple primitive belongings, in real metres with the origin on the floor. */
function buildItem(id: ItemId): { group: Group; spin?: Group } {
  const g = new Group();
  const add = (mesh: Mesh, x = 0, y = 0, z = 0) => {
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    g.add(mesh);
    return mesh;
  };
  if (id === 'mattress') {
    add(new Mesh(new BoxGeometry(1.9, 0.2, 0.9), lambert(0xe9e2cf)), 0, 0.1, 0);
    add(new Mesh(new BoxGeometry(0.5, 0.12, 0.7), lambert(0x4f7fb8)), -0.62, 0.26, 0);
  } else if (id === 'fan') {
    add(new Mesh(new CylinderGeometry(0.22, 0.25, 0.05, 20), lambert(0x2d2d33)), 0, 0.025, 0);
    add(new Mesh(new CylinderGeometry(0.025, 0.025, 1.15, 10), lambert(0x9aa0a6)), 0, 0.6, 0);
    const head = add(new Mesh(new CylinderGeometry(0.27, 0.27, 0.07, 24), lambert(0x3b3f46)), 0, 1.22, 0.02);
    head.rotation.x = Math.PI / 2;
    const spin = new Group();
    spin.position.set(0, 1.22, 0.07);
    for (let i = 0; i < 3; i += 1) {
      const blade = new Mesh(new BoxGeometry(0.22, 0.07, 0.01), lambert(0x7fd0ff, 0.25));
      blade.position.x = 0.12;
      const arm = new Group();
      arm.rotation.z = (i * Math.PI * 2) / 3;
      arm.add(blade);
      spin.add(arm);
    }
    g.add(spin);
    return { group: g, spin };
  } else if (id === 'pot') {
    add(new Mesh(new CylinderGeometry(0.24, 0.2, 0.26, 20), lambert(0x2a2a2a)), 0, 0.13, 0);
    add(new Mesh(new CylinderGeometry(0.25, 0.25, 0.03, 20), lambert(0x55524c)), 0, 0.275, 0);
    add(new Mesh(new SphereGeometry(0.035, 10, 8), lambert(0x8a5a3a)), 0, 0.31, 0);
  } else if (id === 'photo') {
    add(new Mesh(new BoxGeometry(0.56, 0.44, 0.04), lambert(0x5b3418)), 0, 0, 0);
    add(new Mesh(new BoxGeometry(0.46, 0.34, 0.01), lambert(0xf2d9a6, 0.35)), 0, 0, 0.022);
    add(new Mesh(new SphereGeometry(0.06, 10, 8), lambert(0x6b4326)), -0.09, 0.02, 0.03);
    add(new Mesh(new SphereGeometry(0.06, 10, 8), lambert(0x4a2c16)), 0.09, 0.02, 0.03);
  } else if (id === 'rug') {
    add(new Mesh(new BoxGeometry(1.6, 0.02, 1.1), lambert(0x9c2f2a)), 0, 0.035, 0);
    add(new Mesh(new BoxGeometry(1.2, 0.022, 0.7), lambert(0xe0a83a)), 0, 0.037, 0);
    add(new Mesh(new BoxGeometry(0.8, 0.024, 0.3), lambert(0x2f5fa8)), 0, 0.039, 0);
  } else {
    add(new Mesh(new CylinderGeometry(0.09, 0.11, 0.06, 14), lambert(0x3a3a3a)), 0, 0.03, 0);
    add(new Mesh(new CylinderGeometry(0.075, 0.075, 0.2, 14), lambert(0xffd27a, 0.9)), 0, 0.16, 0);
    add(new Mesh(new CylinderGeometry(0.06, 0.09, 0.05, 14), lambert(0x3a3a3a)), 0, 0.285, 0);
  }
  return { group: g };
}

export class StoryMode {
  active = false;
  story: Story = newStory();
  private readonly app: App;
  private beat: Beat = 'free';
  private t = 0;
  private clock = 0;
  private readonly items = new Map<ItemId, { group: Group; spin?: Group }>();
  private readonly tray = new Mesh(new BoxGeometry(2.3, 0.04, 0.6), lambert(0x5b3418));
  private readonly stars: Points<BufferGeometry, PointsMaterial>;
  private readonly card: Label;
  private skyNow = { ...SKY.day };
  private skyGoal = SKY.day;
  private hourGoal: number | null = null;
  private dragStart = new Vector3();
  private pulse = 0;

  constructor(app: App) {
    this.app = app;
    const g = app.view.group;
    this.tray.visible = false;
    g.add(this.tray);

    for (const id of BELONGINGS) {
      const built = buildItem(id);
      built.group.visible = false;
      this.items.set(id, built);
      g.add(built.group);
      const pick = new Group();
      pick.position.y = id === 'photo' ? 0 : 0.3;
      built.group.add(pick);
      app.gestures.add({
        id: `item-${id}`,
        object: pick,
        radius: 0.5,
        enabled: () => this.active && app.mode === 'inside' && built.group.visible,
        onHover: (on) => {
          built.group.scale.setScalar(on ? 1.12 : 1);
          if (on) app.toast(ITEM_LABEL[id], 1);
        },
        onDragStart: () => {
          this.dragStart.copy(built.group.position);
        },
        onDrag: (info) => {
          g.updateWorldMatrix(true, false);
          const d = g.worldToLocal(_a.copy(info.position)).sub(g.worldToLocal(_b.copy(info.start)));
          // Far things move further for the same hand movement, so a seated
          // user can place anything in the room without leaning.
          const gain = Math.max(1, info.grab.distanceTo(info.start) / 0.4);
          built.group.position.set(
            this.dragStart.x + d.x * gain,
            Math.max(0, this.dragStart.y + d.y * gain),
            this.dragStart.z + d.z * gain,
          );
        },
        onDragEnd: () => this.drop(id),
      });
    }

    // Evening stars and the journal card.
    const pts: number[] = [];
    for (let i = 0; i < 260; i += 1) {
      const u = Math.random() * Math.PI * 2;
      const v = 0.12 + Math.random() * 0.85;
      const r = 160;
      pts.push(Math.cos(u) * Math.sqrt(1 - v * v) * r, v * r, Math.sin(u) * Math.sqrt(1 - v * v) * r);
    }
    const geo = new BufferGeometry();
    geo.setAttribute('position', new Float32BufferAttribute(pts, 3));
    this.stars = new Points(
      geo,
      new PointsMaterial({ color: 0xfff4d6, size: 2.2, sizeAttenuation: false, transparent: true, opacity: 0, depthWrite: false }),
    );
    this.stars.visible = false;
    this.stars.frustumCulled = false;
    app.root.add(this.stars);

    this.card = new Label({
      width: 0.74,
      height: 0.25,
      fontScale: 0.16,
      bold: true,
      bg: 'rgba(30, 16, 8, 0.96)',
      fg: PALETTE.cream,
      border: PALETTE.gold,
    });
    this.card.mesh.position.set(0, -0.2, 0.01);
    this.card.mesh.visible = false;
    app.hud.add(this.card.mesh);
    app.gestures.add({
      id: 'journal',
      object: this.card.mesh,
      radius: 1,
      surface: true,
      enabled: () => this.active && this.card.mesh.visible && app.hud.visible,
      onClick: () => this.nextDay(),
    });

    app.on((event) => this.onEvent(event));
  }

  // ------------------------------------------------------------- lifecycle

  hasSave(): boolean {
    return this.load() !== null;
  }

  /** Start day one on an empty plot, or come back to a saved home. */
  begin(resume: boolean): Design | null {
    const saved = resume ? this.load() : null;
    this.active = true;
    this.story = saved?.story ?? newStory();
    this.card.mesh.visible = false;
    for (const { group } of this.items.values()) group.visible = false;
    for (const p of this.story.items) this.show(p);
    if (saved) {
      this.setSky('dawn', true);
      this.go('free');
      const prompt = visitPrompt(this.story.day);
      this.app.say(prompt ? `Day ${this.story.day}. ${prompt}` : `Day ${this.story.day}. Welcome home.`);
      return saved.design;
    }
    this.setSky('dawn', true);
    this.go('arrival');
    return null;
  }

  end(): void {
    this.active = false;
    this.beat = 'free';
    this.card.mesh.visible = false;
    this.tray.visible = false;
    for (const { group } of this.items.values()) group.visible = false;
    this.stars.visible = false;
    this.story.power = true;
    this.setSky('day', true);
  }

  /** Skip the current scripted beat. */
  skip(): void {
    if (!this.active) return;
    const order: Beat[] = ['arrival', 'build', 'movein', 'settle', 'afternoon', 'nepa', 'advice', 'evening', 'journal'];
    const i = order.indexOf(this.beat);
    if (this.beat === 'build' || this.beat === 'movein' || this.beat === 'settle') this.go('free');
    else if (i >= 0 && i < order.length - 1) this.go(order[i + 1]);
  }

  get scripted(): boolean {
    return this.active && this.beat !== 'free' && this.beat !== 'journal';
  }

  // ----------------------------------------------------------------- money

  comfort(): ComfortContext {
    return this.active ? comfortContext(this.story) : {};
  }

  cost(from: Design, to: Design): number {
    return this.active ? buildCost(from, to) : 0;
  }

  canAfford(cost: number): boolean {
    return !this.active || cost <= this.story.savings;
  }

  spend(cost: number): void {
    if (!this.active || cost <= 0) return;
    this.story.savings -= cost;
    this.app.toast(`Paid ${naira(cost)}. ${naira(this.story.savings)} left.`, 2.2);
    this.save();
  }

  /** Undo gives the money back. */
  refund(cost: number): void {
    if (!this.active || cost <= 0) return;
    this.story.savings += cost;
    this.save();
  }

  /** Shown on the score badge. */
  savingsText(): string {
    return this.active ? naira(this.story.savings) : '';
  }

  // ----------------------------------------------------------------- beats

  private go(beat: Beat): void {
    const app = this.app;
    this.beat = beat;
    this.t = 0;
    if (beat === 'arrival') {
      app.setHour(8);
      app.say(BABA.arrival);
    } else if (beat === 'movein') {
      app.say(BABA.moveIn);
      app.setHint('Point at your room and pinch to step inside.');
    } else if (beat === 'settle') {
      app.setHint('Pinch a belonging and put it where you want it.');
    } else if (beat === 'afternoon') {
      this.hourGoal = 15;
      this.setSky('day');
      app.say(BABA.afternoon);
      app.setHint('Watch the rooms as the afternoon sun arrives.');
    } else if (beat === 'nepa') {
      this.story.power = false;
      this.pulse = 2.4;
      Sfx.dismiss();
      app.refresh(false);
      app.say(BABA.nepa);
    } else if (beat === 'advice') {
      app.say(BABA.afterNepa);
      app.setHint('Pinch Baba, the carved figure, for advice.');
    } else if (beat === 'evening') {
      this.hourGoal = 18;
      this.setSky('dusk');
      this.story.power = true;
      app.say(BABA.evening);
      app.setHint('Evening. The day is done.');
    } else if (beat === 'journal') {
      const j = journal(app.design, this.story);
      this.card.setText(`${j.title}\n${j.lines.join('\n')}\nPinch for tomorrow.`);
      this.card.mesh.visible = true;
      app.setHint('Pinch your journal to sleep until tomorrow.');
      this.save();
      Sfx.chime();
    }
    app.storyChanged();
  }

  private onEvent(event: string): void {
    if (!this.active) return;
    const app = this.app;
    if (event.startsWith('edit:') && (this.beat === 'arrival' || this.beat === 'build')) {
      if (this.beat === 'arrival') this.beat = 'build';
      if (isComplete(app.design) && !this.story.movedIn) this.go('movein');
    }
    if (event === 'inside') {
      this.layTray();
      if (this.beat === 'movein') {
        this.story.movedIn = true;
        this.go('settle');
      }
    }
    if (event === 'table') {
      this.tray.visible = false;
      if (this.beat === 'settle') this.go('afternoon');
    }
    if (event === 'accepted' && this.beat === 'advice') {
      this.t = 0;
      this.beat = 'evening';
      this.hourGoal = null;
      // Let the cooler house sit on screen a moment before the sun sets.
      this.t = -3.5;
      app.storyChanged();
    }
  }

  // ------------------------------------------------------------ belongings

  private show(p: Placed): void {
    const it = this.items.get(p.item);
    if (!it) return;
    it.group.visible = true;
    it.group.position.set(p.x, p.y, p.z);
    it.group.rotation.y = p.rot;
  }

  /** Set the unplaced belongings out on a tray in front of the seat. */
  private layTray(): void {
    const app = this.app;
    if (!app.room) return;
    const g = app.view.group;
    g.updateWorldMatrix(true, false);
    app.headPose(_a, _q);
    const seat = g.worldToLocal(_a.clone());
    const fwdWorld = _b.set(0, 0, -1).applyQuaternion(_q);
    fwdWorld.y = 0;
    fwdWorld.normalize();
    const ahead = g.worldToLocal(_a.clone().add(fwdWorld)).sub(seat);
    ahead.y = 0;
    ahead.normalize();
    const side = new Vector3(-ahead.z, 0, ahead.x);
    const loose = BELONGINGS.filter((id) => !this.story.items.some((p) => p.item === id));
    this.tray.visible = loose.length > 0;
    this.tray.position.copy(seat).addScaledVector(ahead, 1.15);
    this.tray.position.y = 0.62;
    this.tray.rotation.y = Math.atan2(ahead.x, ahead.z);
    loose.forEach((id, i) => {
      const it = this.items.get(id);
      if (!it) return;
      const offset = (i - (loose.length - 1) / 2) * 0.4;
      it.group.visible = true;
      it.group.scale.setScalar(1);
      it.group.position.copy(this.tray.position).addScaledVector(side, offset);
      it.group.position.y = 0.66 + (id === 'photo' ? 0.25 : 0);
      it.group.rotation.y = this.tray.rotation.y + Math.PI;
      // Tray pieces are shown small; they grow to full size when placed.
      it.group.scale.setScalar(id === 'mattress' || id === 'rug' ? 0.18 : 0.3);
    });
  }

  /** A belonging was let go: settle it in the room (photos snap to a wall). */
  private drop(id: ItemId): void {
    const app = this.app;
    const it = this.items.get(id);
    if (!it || !app.room) return;
    const d = app.design;
    const room = roomById(d, app.room);
    const inset = WALL_THICKNESS[d.material] / 2 + 0.25;
    const p = it.group.position;
    let x = Math.min(room.x1 - inset, Math.max(room.x0 + inset, p.x));
    let z = Math.min(room.z1 - inset, Math.max(room.z0 + inset, p.z));
    let y = 0.02;
    let rot = it.group.rotation.y;
    if (id === 'photo') {
      // Nearest wall, at eye height, facing into the room.
      let best: Side = 'north';
      let bestD = Infinity;
      for (const side of SIDES) {
        const c = edgeCoord(room, side);
        const dist = Math.abs((side === 'north' || side === 'south' ? p.z : p.x) - c);
        if (dist < bestD) {
          bestD = dist;
          best = side;
        }
      }
      const off = WALL_THICKNESS[d.material] / 2 + 0.03;
      if (best === 'north') { z = room.z0 + off; rot = 0; }
      if (best === 'south') { z = room.z1 - off; rot = Math.PI; }
      if (best === 'west') { x = room.x0 + off; rot = Math.PI / 2; }
      if (best === 'east') { x = room.x1 - off; rot = -Math.PI / 2; }
      y = Math.min(1.9, Math.max(1.2, p.y));
    }
    it.group.scale.setScalar(1);
    it.group.position.set(x, y, z);
    it.group.rotation.y = rot;
    this.story.items = this.story.items.filter((q) => q.item !== id);
    this.story.items.push({ item: id, room: room.id, x, y, z, rot });
    Sfx.release();
    this.save();
    app.refresh(false);
    this.layTray();
    app.toast(`${ITEM_LABEL[id]} placed.`, 1.6);
    if (this.beat === 'settle' && this.story.items.length >= 2) {
      app.setHint('Feels like home. Palm up, or pinch Table, to go back out.');
    }
  }

  // ------------------------------------------------------------ day cycle

  private nextDay(): void {
    this.card.mesh.visible = false;
    this.story.day += 1;
    this.story.power = true;
    this.save();
    this.stars.visible = false;
    this.setSky('dawn');
    this.hourGoal = 8;
    this.go('free');
    const prompt = visitPrompt(this.story.day);
    this.app.say(prompt ? `Day ${this.story.day}. ${prompt}` : `Day ${this.story.day}. Good morning, neighbour.`);
  }

  private setSky(name: keyof typeof SKY, now = false): void {
    this.skyGoal = SKY[name];
    if (now) {
      this.skyNow = { sky: [...this.skyGoal.sky], equator: [...this.skyGoal.equator], ground: [...this.skyGoal.ground] };
      this.applySky();
    }
  }

  private applySky(): void {
    try {
      const root = this.app.world.activeLevel.value;
      root.getVectorView(DomeGradient, 'sky').set(this.skyNow.sky);
      root.getVectorView(DomeGradient, 'equator').set(this.skyNow.equator);
      root.getVectorView(DomeGradient, 'ground').set(this.skyNow.ground);
    } catch {
      // No sky dome on this level: the story still plays.
    }
  }

  update(dt: number): void {
    if (!this.active) return;
    const app = this.app;
    this.clock += dt;
    this.t += dt;

    // Ease the sky and the sun toward where the beat wants them.
    let moved = false;
    for (const key of ['sky', 'equator', 'ground'] as const) {
      for (let i = 0; i < 3; i += 1) {
        const diff = this.skyGoal[key][i] - this.skyNow[key][i];
        if (Math.abs(diff) > 0.002) {
          this.skyNow[key][i] += diff * Math.min(1, dt * 0.9);
          moved = true;
        }
      }
    }
    if (moved) this.applySky();
    if (this.hourGoal !== null) {
      const h = app.design.hour;
      const next = h + Math.sign(this.hourGoal - h) * Math.min(Math.abs(this.hourGoal - h), dt * 2.4);
      if (Math.abs(this.hourGoal - h) < 0.26) {
        app.setHour(this.hourGoal, true);
        this.hourGoal = null;
      } else {
        app.setHour(next, true);
      }
    }
    const dusk = this.skyGoal === SKY.dusk;
    this.stars.visible = dusk || this.stars.material.opacity > 0.02;
    this.stars.material.opacity += ((dusk ? 0.95 : 0) - this.stars.material.opacity) * Math.min(1, dt * 0.6);
    app.headPose(_a, _q);
    this.stars.position.copy(_a);

    // The fan turns only while there is light.
    const fan = this.items.get('fan');
    if (fan?.spin && this.story.power) fan.spin.rotation.z += dt * 14;
    if (this.pulse > 0) {
      this.pulse = Math.max(0, this.pulse - dt);
      app.pulseHeat(this.pulse > 0 ? 1 + 0.35 * Math.abs(Math.sin(this.pulse * 7)) : 1);
    }

    // Timed beats. Never advance mid-gesture or mid-transition.
    if (app.gestures.dragging || app.mode === 'shifting') return;
    if (this.beat === 'afternoon' && this.t > 5 && this.hourGoal === null) {
      app.setHeat(true);
      if (this.t > 8) this.go('nepa');
    } else if (this.beat === 'nepa' && this.t > 4.5) {
      this.go('advice');
    } else if (this.beat === 'evening' && this.t > 0 && this.hourGoal === null && this.skyGoal !== SKY.dusk) {
      this.go('evening');
    } else if (this.beat === 'evening' && this.t > 6.5 && this.skyGoal === SKY.dusk) {
      this.go('journal');
    }
  }

  // ----------------------------------------------------------- persistence

  save(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ story: serializeStory(this.story), design: this.app.exportDesign() }));
    } catch {
      // Storage can be blocked; the story still plays.
    }
  }

  private load(): { story: Story; design: Design } | null {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const both = JSON.parse(raw) as { story?: string; design?: string };
      const story = both.story ? deserializeStory(both.story) : null;
      const design = both.design ? this.app.importDesign(both.design) : null;
      return story && design && design.rooms.length > 0 ? { story, design } : null;
    } catch {
      return null;
    }
  }
}
