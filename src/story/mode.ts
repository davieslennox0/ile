/**
 * Story mode: "Build a home. Grow a life in Lagos."
 *
 * Seven days from data/days.json. Each day: an event card and a word from
 * Baba → a few steps the player does with their hands (build, move in,
 * cook, care for the family, grow the house) → a journal card → salary and
 * business income → the next morning. Savings pay for building; Energy,
 * Comfort and Joy show how the family is doing. Progress saves every step.
 */

import {
  BoxGeometry,
  ConeGeometry,
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
import type { ComfortContext } from '../heat/score.ts';
import { HomeLife } from '../interior/home.ts';
import { WALL_THICKNESS } from '../model/building.ts';
import {
  SIDES,
  bounds,
  cloneDesign,
  edgeCoord,
  isComplete,
  isOpen,
  rectCx,
  rectCz,
  roomById,
  rooms,
  type Design,
  type Side,
} from '../model/state.ts';
import { MINI_SCALE } from '../scene/table.ts';
import { EventCard, StatusStrip } from '../ui/hud.ts';
import { Label } from '../ui/label.ts';
import { scratchHint } from '../ui/onboarding.ts';
import { shopSpot } from '../world/extras.ts';
import days from '../../data/days.json' with { type: 'json' };
import {
  BELONGINGS,
  ITEM_LABEL,
  START_ENERGY,
  buildCost,
  comfortContext,
  deserializeStory,
  journal,
  naira,
  newStory,
  serializeStory,
  type ItemId,
  type Placed,
  type Story,
} from './story.ts';

const STORAGE_KEY = 'ile.story.v2';
type StepId =
  | 'build' | 'movein' | 'fan' | 'out' | 'afternoon' | 'nepa' | 'advice' | 'meet' | 'room' | 'dinner'
  | 'nursery' | 'cool' | 'cot' | 'shop' | 'customers' | 'match' | 'upstairs' | 'homework' | 'big' | 'party';
interface DayPlan { day: number; title: string; card: string; baba: string; steps: string[]; journal: string }
const PLAN = days.days as DayPlan[];
/** Steps that just play out (skippable); the rest wait for the player. */
const TIMED: StepId[] = ['afternoon', 'nepa', 'meet', 'customers', 'match', 'party'];

const _a = new Vector3();
const _b = new Vector3();
const _q = new Quaternion();

function lambert(color: number, emissive = 0): MeshLambertMaterial {
  return new MeshLambertMaterial({ color, emissive: emissive ? color : 0x000000, emissiveIntensity: emissive });
}

/** Simple primitive belongings, in real metres with the origin on the floor. */
function buildItem(id: ItemId): { group: Group; spin?: Group; switch?: Mesh } {
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
    const sw = add(new Mesh(new SphereGeometry(0.06, 12, 8), lambert(0xd8361f, 0.4)), 0.12, 0.08, 0.16);
    return { group: g, spin, switch: sw };
  } else if (id === 'pot') {
    add(new Mesh(new CylinderGeometry(0.24, 0.2, 0.26, 20), lambert(0x2a2a2a)), 0, 0.13, 0);
    add(new Mesh(new CylinderGeometry(0.25, 0.25, 0.03, 20), lambert(0x55524c)), 0, 0.275, 0);
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
  }
  return { group: g };
}

export class StoryMode {
  active = false;
  story: Story = newStory();
  readonly home: HomeLife;
  readonly strip = new StatusStrip();
  readonly event = new EventCard();
  readonly items = new Map<ItemId, { group: Group; spin?: Group; switch?: Mesh }>();
  readonly card: Label;
  /** The glowing "pull up to build" marker for the food spot and new storeys. */
  readonly rise = new Group();
  stepId: StepId | null = null;
  private readonly app: App;
  private stepIndex = -1;
  private t = 0;
  private clockGoal: number | null = null;
  private readonly tray = new Mesh(new BoxGeometry(2.3, 0.04, 0.6), lambert(0x5b3418));
  private readonly ghost = new Group();
  private readonly heart: Label;
  private dragStart = new Vector3();
  private pulse = 0;
  private stepStart = 0;
  private fixes = 0;
  private earned = 0;
  private riseUp = 0;

  constructor(app: App) {
    this.app = app;
    this.home = new HomeLife(app);
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
        enabled: () => this.active && app.mode === 'inside' && built.group.visible && !this.home.task,
        onHover: (on) => {
          const base = (built.group.userData.size as number | undefined) ?? 1;
          built.group.scale.setScalar(base * (on ? 1.12 : 1));
          if (on) app.toast(ITEM_LABEL[id], 1);
        },
        onDragStart: () => {
          this.dragStart.copy(built.group.position);
        },
        onDrag: (info) => {
          g.updateWorldMatrix(true, false);
          const d = g.worldToLocal(_a.copy(info.position)).sub(g.worldToLocal(_b.copy(info.start)));
          const gain = Math.max(1, info.grab.distanceTo(info.start) / 0.4);
          built.group.position.set(this.dragStart.x + d.x * gain, Math.max(0, this.dragStart.y + d.y * gain), this.dragStart.z + d.z * gain);
        },
        onDragEnd: () => this.drop(id),
      });
      if (built.switch) {
        app.gestures.add({
          id: 'fan-switch',
          object: built.switch,
          radius: 0.1,
          enabled: () => this.active && app.mode === 'inside' && this.story.items.some((p) => p.item === 'fan') && !this.home.task,
          onHover: (on) => built.switch?.scale.setScalar(on ? 1.5 : 1),
          onClick: () => {
            this.story.fanOn = !this.story.fanOn;
            Sfx.tick();
            app.toast(this.story.fanOn ? 'Fan on.' : 'Fan off.', 1.4);
            app.refresh(false);
            this.save();
            if (this.stepId === 'fan' && this.story.fanOn) this.next();
          },
        });
      }
    }

    // Journal card: pinch to sleep until tomorrow.
    this.card = new Label({ width: 0.74, height: 0.25, fontScale: 0.16, bold: true, bg: 'rgba(247, 234, 208, 0.98)', fg: '#2a1a0e', border: '#2a1a0e' });
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
    this.strip.mesh.position.set(0, 0.128, 0.004);
    this.strip.mesh.visible = false;
    app.hud.add(this.strip.mesh);
    this.event.group.position.set(0, -0.19, 0.012);
    app.hud.add(this.event.group);

    // The rise marker: an orange arrow on the plot, pinch it and pull up.
    const arrow = new Group();
    arrow.add(new Mesh(new CylinderGeometry(0.22, 0.22, 1.6, 10), lambert(0xd9692b, 0.5)));
    const tip = new Mesh(new ConeGeometry(0.55, 0.9, 12), lambert(0xd9692b, 0.5));
    tip.position.y = 1.2;
    arrow.add(tip);
    this.rise.add(arrow);
    this.rise.visible = false;
    g.add(this.rise);
    app.gestures.add({
      id: 'rise',
      object: tip,
      radius: 1.3,
      enabled: () => this.rise.visible && app.mode === 'table',
      onHover: (on) => this.rise.scale.setScalar(on ? 1.25 : 1),
      onDragStart: () => {
        this.riseUp = 0;
      },
      onDrag: (info) => {
        g.updateWorldMatrix(true, false);
        const d = g.worldToLocal(_a.copy(info.position)).sub(g.worldToLocal(_b.copy(info.start)));
        this.riseUp = d.y;
        arrow.position.y = Math.max(0, Math.min(2.5, d.y));
      },
      onDragEnd: () => {
        arrow.position.y = 0;
        if (this.riseUp > 0.5) this.raise();
        else app.toast('Pull it higher.', 1.2);
      },
    });

    // Onboarding ghost hand: shows the first pinch-and-drag on the plot.
    const ghostMat = new MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 0.75, depthWrite: false });
    for (const [x, y, z, r] of [[0, 0.012, 0.03, 0.022], [-0.006, 0, 0, 0.008], [0.006, 0, 0, 0.008]]) {
      const s = new Mesh(new SphereGeometry(r, 12, 8), ghostMat);
      s.position.set(x, y, z);
      this.ghost.add(s);
    }
    this.ghost.scale.setScalar(1 / MINI_SCALE);
    this.ghost.visible = false;
    g.add(this.ghost);

    this.heart = new Label({ width: 1.6, height: 1.6, ppm: 60, fontScale: 0.8, bold: true, bg: 'rgba(0,0,0,0)', fg: '#e04f3a' });
    this.heart.setText('♥');
    this.heart.mesh.visible = false;
    app.table.site.add(this.heart.mesh);

    app.on((event) => this.onEvent(event));
  }

  // ------------------------------------------------------------- lifecycle

  hasSave(): boolean {
    return this.load() !== null;
  }

  /** Start Day 1 on an empty plot, or come back to a saved home. */
  begin(resume: boolean): Design | null {
    const saved = resume ? this.load() : null;
    this.active = true;
    this.story = saved?.story ?? newStory();
    this.card.mesh.visible = false;
    for (const { group } of this.items.values()) group.visible = false;
    for (const p of this.story.items) this.show(p);
    this.strip.mesh.visible = true;
    this.placeFamily();
    this.startDay();
    return saved?.design ?? null;
  }

  end(): void {
    this.active = false;
    this.stepId = null;
    this.card.mesh.visible = false;
    this.tray.visible = false;
    this.rise.visible = false;
    this.ghost.visible = false;
    this.strip.mesh.visible = false;
    this.home.stop();
    for (const { group } of this.items.values()) group.visible = false;
    this.story.power = true;
    this.app.street.setBuilders(false);
    this.app.street.setQueue(0, [0, 0]);
    this.app.street.setParty(false, [0, 0]);
    for (const h of this.app.street.family.values()) h.group.visible = false;
  }

  /** Skip the current scene (timed steps only; building steps wait for you). */
  skip(): void {
    if (this.stepId && TIMED.includes(this.stepId)) this.next();
    else if (this.stepId === 'advice' || this.stepId === 'cool') this.next();
  }

  get scripted(): boolean {
    return this.active && this.stepId !== null && TIMED.includes(this.stepId);
  }

  get plan(): DayPlan | null {
    return PLAN.find((p) => p.day === this.story.day) ?? null;
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

  refund(cost: number): void {
    if (!this.active || cost <= 0) return;
    this.story.savings += cost;
    this.save();
  }

  savingsText(): string {
    return this.active ? naira(this.story.savings) : '';
  }

  // ------------------------------------------------------------------ days

  private startDay(): void {
    const plan = this.plan;
    const app = this.app;
    app.dayNight.clock = 7.5;
    this.clockGoal = 9;
    this.story.power = true;
    this.story.energy = START_ENERGY;
    this.story.extras.party = false;
    app.street.setParty(false, [0, 0]);
    this.stepIndex = -1;
    if (!plan) {
      this.stepId = null;
      this.event.show(`Day ${this.story.day}`, 'A new morning in Yaba. Build, cook, rest: it is your home.', 5);
      app.setHint(scratchHint(app.design, app.mud));
      return;
    }
    this.event.show(`Day ${plan.day} — ${plan.title}`, plan.card, 6);
    app.say(plan.baba);
    const baba = app.street.placeFamily('baba', 2.6, 13.1, Math.PI);
    baba.setMode('wave');
    setTimeout(() => baba.setMode('stand'), 4000);
    this.next();
  }

  /** Move on to the day's next step, or end the day. */
  next(): void {
    const plan = this.plan;
    if (!plan) return;
    this.stepIndex += 1;
    this.t = 0;
    this.story.energy = Math.max(15, this.story.energy - 9);
    const id = plan.steps[this.stepIndex] as StepId | undefined;
    if (!id) {
      this.stepId = null;
      this.endDay();
      return;
    }
    this.stepId = id;
    this.startStep(id);
    this.save();
    this.app.emit(`step:${id}`);
    this.app.storyChanged();
  }

  private startStep(id: StepId): void {
    const app = this.app;
    const d = app.design;
    this.stepStart = d.rooms.length;
    this.fixes = 0;
    this.rise.visible = false;
    this.app.handles.setVisible(app.mode === 'table' && !app.compareOn && !this.card.mesh.visible);
    if (id === 'build') {
      this.clockGoal = 11;
      app.setHint(scratchHint(d, app.mud));
    } else if (id === 'movein') {
      this.clockGoal = 12;
      app.setHint('Step inside: point at your room and pinch.');
    } else if (id === 'fan') {
      app.setHint(this.story.items.some((p) => p.item === 'fan') ? 'Pinch the red switch on the fan to turn it on.' : 'Place the standing fan, then pinch its red switch.');
    } else if (id === 'out') {
      app.setHint('Palm up, or pinch Table, to go back out.');
    } else if (id === 'afternoon') {
      this.clockGoal = 15;
      app.setHint('Watch the rooms as the afternoon sun arrives.');
    } else if (id === 'nepa') {
      this.story.power = false;
      this.pulse = 2.4;
      Sfx.dismiss();
      app.refresh(false);
      app.say('NEPA don take light.');
    } else if (id === 'advice') {
      this.stepStart = app.dayScore;
      app.say('The fan sleeps, but a good house does not need it. Ask me, my son.');
      app.setHint('Pinch Baba, the carved figure, for advice.');
    } else if (id === 'meet') {
      this.clockGoal = 13;
      app.street.placeFamily('adaeze', -17.6, -1, -Math.PI / 2);
      app.setHint('At the buka…');
    } else if (id === 'room') {
      app.setHint('Adaeze is moving in. Lay a new room for her: pinch and drag on the plot.');
    } else if (id === 'dinner') {
      this.clockGoal = 18;
      app.setHint('First dinner together. Step inside: point at a room and pinch.');
    } else if (id === 'nursery') {
      app.setHint('Lay a room for the nursery: pinch and drag on the plot.');
    } else if (id === 'cool') {
      this.checkNursery();
    } else if (id === 'cot') {
      app.setHint('Step into the nursery to set up the cot.');
    } else if (id === 'shop') {
      const s = shopSpot(d);
      this.rise.position.set(s.x, 0, s.z);
      this.rise.visible = true;
      // Nothing else on the table may sit between the eyes and the marker.
      app.handles.setVisible(false);
      app.setHint(`Pinch the orange marker and pull up to build the food spot (${naira(days.costs.shop)}).`);
    } else if (id === 'customers') {
      const s = shopSpot(d);
      app.street.setQueue(5, [s.x + 3, s.z + 2.2]);
      this.story.joy = Math.min(100, this.story.joy + 4);
      app.setHint('Customers are queueing for jollof.');
    } else if (id === 'match') {
      app.street.placeFamily('tolu', 20, 6, 0).setMode('walk');
      this.story.joy = Math.min(100, this.story.joy + 4);
      app.setHint("Tolu's first match on the street pitch.");
    } else if (id === 'upstairs' || id === 'big') {
      const b = bounds(d);
      this.rise.position.set(rectCx(b), d.wallHeight * this.story.extras.floors + 1.2, rectCz(b));
      this.rise.visible = true;
      // Nothing else on the table may sit between the eyes and the marker.
      app.handles.setVisible(false);
      const cost = id === 'big' ? days.costs.big : days.costs.upstairs;
      app.setHint(id === 'big'
        ? `Pinch the marker and pull up: the compound rises (${naira(cost)}).`
        : `Pinch the marker and pull up to build a second floor (${naira(cost)}).`);
    } else if (id === 'homework') {
      this.clockGoal = 17;
      app.setHint("Step inside to check Tolu's homework.");
    } else if (id === 'party') {
      this.clockGoal = 20.5;
      app.setHint('Night falls on the house-warming.');
    }
  }

  private checkNursery(): void {
    const app = this.app;
    const n = rooms(app.design).find((r) => r.label === 'Nursery');
    const c = n ? app.roomDayScore(n.id) : 100;
    if (c >= 70 || this.fixes >= 3) {
      app.toast(`The nursery stays cool: comfort ${c}.`, 2.5);
      this.story.joy = Math.min(100, this.story.joy + 5);
      setTimeout(() => this.stepId === 'cool' && this.next(), 1200);
    } else {
      app.say(`The nursery is too hot for a baby. Comfort ${c}. Ask me how to cool it.`);
      app.setHint('Pinch Baba for advice on the nursery.');
    }
  }

  /** The rise marker was pulled up: build the food spot or a new storey. */
  private raise(): void {
    const id = this.stepId;
    const cost = id === 'shop' ? days.costs.shop : id === 'big' ? days.costs.big : days.costs.upstairs;
    if (!this.canAfford(cost)) {
      this.app.toast(`That costs ${naira(cost)}. You have ${naira(this.story.savings)}.`, 3);
      return;
    }
    this.spend(cost);
    const e = this.story.extras;
    if (id === 'shop') e.shop = 1;
    else if (id === 'upstairs') {
      e.floors = 2;
      e.garden = true;
    } else if (id === 'big') {
      e.floors = 3;
      e.solar = true;
      e.car = true;
      e.shop = 2;
    }
    this.story.joy = Math.min(100, this.story.joy + 4);
    Sfx.chime();
    this.rise.visible = false;
    this.app.handles.setVisible(this.app.mode === 'table');
    this.app.refresh();
    this.app.emit('edit:raise');
    this.next();
  }

  private endDay(): void {
    const plan = this.plan;
    this.clockGoal = Math.max(this.app.dayNight.clock, 18.4);
    const salary = this.story.day >= 2 ? days.salary : 0;
    const business = this.story.extras.shop > 0 ? days.business * this.story.extras.shop : 0;
    this.earned = salary + business;
    setTimeout(() => {
      const j = journal(this.app.design, this.story);
      const lines = [plan?.journal ?? '', j.lines[0] ?? ''];
      if (this.earned > 0) lines.push(`Earned today: ${naira(this.earned)}.`);
      this.card.setText(`${j.title}\n${lines.filter(Boolean).join('\n')}\nPinch to sleep until tomorrow.`);
      this.card.mesh.visible = true;
      this.app.handles.setVisible(false);
      this.app.setHeat(false);
      this.app.setHint('Pinch your journal to sleep until tomorrow.');
      this.app.emit('journal');
      Sfx.chime();
    }, 2500);
  }

  private nextDay(): void {
    this.card.mesh.visible = false;
    this.app.handles.setVisible(this.app.mode === 'table' && !this.app.compareOn);
    this.story.savings += this.earned;
    this.earned = 0;
    this.story.day += 1;
    this.story.joy = Math.min(100, this.story.joy + 1);
    this.save();
    this.placeFamily();
    this.startDay();
  }

  /** Put the family on the diorama for the current day. */
  private placeFamily(): void {
    const s = this.app.street;
    const day = this.story.day;
    s.placeFamily('player', -1.2, 12.6, Math.PI);
    if (day >= 4 || (day === 3 && this.stepIndex > 0)) s.placeFamily('adaeze', 0.4, 12.6, Math.PI);
    if (day >= 5) s.placeFamily('tolu', 1.6, 12.6, Math.PI);
    s.placeFamily('baba', 2.6, 13.1, Math.PI);
  }

  // ------------------------------------------------------------- events

  private onEvent(event: string): void {
    if (!this.active || !this.stepId) return;
    const app = this.app;
    const id = this.stepId;
    if (id === 'build' && event.startsWith('edit:')) {
      if (isComplete(app.design)) this.next();
      else app.setHint(scratchHint(app.design, app.mud));
    }
    if ((id === 'room' || id === 'nursery') && event === 'edit:room' && app.design.rooms.length > this.stepStart) {
      if (id === 'nursery') {
        const d = cloneDesign(app.design);
        d.rooms[d.rooms.length - 1].name = 'Nursery';
        app.commit(d, 'name');
      }
      this.story.joy = Math.min(100, this.story.joy + 3);
      this.next();
    }
    if (event === 'inside') {
      if (id === 'movein') {
        this.story.movedIn = true;
        this.layTray();
        app.setHint('Pinch a belonging and put it where you want it.');
      } else if (id === 'fan') {
        this.layTray();
      } else if (id === 'dinner') {
        this.home.start('dinner', () => this.homeDone(9), { adaeze: true, tolu: this.story.day >= 5 });
      } else if (id === 'cot') {
        this.home.start('cot', () => this.homeDone(7));
      } else if (id === 'homework') {
        this.home.start('homework', () => this.homeDone(5));
      }
    }
    if (event === 'table') {
      this.tray.visible = false;
      if (id === 'out') this.next();
    }
    if (event === 'accepted') {
      this.fixes += 1;
      if (id === 'advice') {
        if (app.dayScore - this.stepStart >= 8 || this.fixes >= 3) this.next();
        else app.setHint('Better. Pinch Baba again: there is more to do.');
      }
      if (id === 'cool') this.checkNursery();
    }
  }

  private homeDone(joy: number): void {
    this.story.joy = Math.min(100, this.story.joy + joy);
    this.save();
    this.app.setHint('Palm up, or pinch Table, to go back out.');
    this.next();
  }

  // ------------------------------------------------------------ belongings

  private show(p: Placed): void {
    const it = this.items.get(p.item);
    if (!it) return;
    it.group.visible = true;
    it.group.userData.size = 1;
    it.group.scale.setScalar(1);
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
      it.group.position.copy(this.tray.position).addScaledVector(side, offset);
      it.group.position.y = 0.66 + (id === 'photo' ? 0.25 : 0);
      it.group.rotation.y = this.tray.rotation.y + Math.PI;
      it.group.userData.size = id === 'mattress' || id === 'rug' ? 0.18 : 0.3;
      it.group.scale.setScalar(it.group.userData.size as number);
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
      if (isOpen(d, room, best)) {
        const info = room.sides[best];
        const alongX = best === 'north' || best === 'south';
        const at = alongX ? x : z;
        const clear = Math.min(1.6, info.span * 0.35) + 0.45;
        if (Math.abs(at - info.center) < clear) {
          const lo = (alongX ? room.x0 : room.z0) + inset + 0.3;
          const hi = (alongX ? room.x1 : room.z1) - inset - 0.3;
          const pick = at >= info.center ? (info.center + clear <= hi ? info.center + clear : info.center - clear) : info.center - clear >= lo ? info.center - clear : info.center + clear;
          if (alongX) x = Math.min(hi, Math.max(lo, pick));
          else z = Math.min(hi, Math.max(lo, pick));
        }
      }
    }
    it.group.userData.size = 1;
    it.group.scale.setScalar(1);
    it.group.position.set(x, y, z);
    it.group.rotation.y = rot;
    this.story.items = this.story.items.filter((q) => q.item !== id);
    this.story.items.push({ item: id, room: room.id, x, y, z, rot });
    this.story.joy = Math.min(100, this.story.joy + 2);
    Sfx.release();
    this.save();
    app.refresh(false);
    this.layTray();
    app.toast(`${ITEM_LABEL[id]} placed.`, 1.6);
    if (this.stepId === 'movein' && this.story.items.length >= 2) this.next();
  }

  // ---------------------------------------------------------------- tick

  /** Numbers for the status strip. */
  status() {
    return {
      day: this.story.day,
      clock: this.app.dayNight.clock,
      savings: this.story.savings,
      energy: this.story.energy,
      comfort: this.app.dayScore,
      joy: this.story.joy,
      score: this.app.dayScore,
    };
  }

  update(dt: number): void {
    if (!this.active) return;
    const app = this.app;
    this.t += dt;
    this.home.update(dt);
    this.event.update(dt);
    this.strip.set(this.status());
    app.extras.update(app.design, this.story.extras);
    app.view.flatTop = this.story.extras.floors > 1;

    // Ease the clock toward where the step wants it; the sun follows.
    if (this.clockGoal !== null) {
      const c = app.dayNight.clock;
      const diff = this.clockGoal - c;
      const step = Math.sign(diff) * Math.min(Math.abs(diff), dt * 1.6);
      app.dayNight.clock = c + step;
      if (Math.abs(diff) < 1e-3) this.clockGoal = null;
      app.setHour(Math.min(18, Math.max(8, app.dayNight.clock)), true);
    }

    // The fan turns only with the switch on and the light on.
    const fan = this.items.get('fan');
    if (fan?.spin && this.story.power && this.story.fanOn) fan.spin.rotation.z += dt * 14;
    if (this.pulse > 0) {
      this.pulse = Math.max(0, this.pulse - dt);
      app.pulseHeat(this.pulse > 0 ? 1 + 0.35 * Math.abs(Math.sin(this.pulse * 7)) : 1);
    }

    // Builders and the ghost hand while the first house goes up.
    const building = this.stepId === 'build' || this.stepId === 'room' || this.stepId === 'nursery';
    const spots = building ? app.design.rooms.slice(0, 3).map((r) => [rectCx(r) + 1, rectCz(r) + 1] as [number, number]) : [];
    app.street.setBuilders(building && spots.length > 0 && !isComplete(app.design), spots);
    this.ghost.visible = this.stepId === 'build' && app.design.rooms.length === 0 && app.mode === 'table';
    if (this.ghost.visible) {
      const k = (this.t % 2.4) / 2.4;
      const e = k < 0.25 ? 0 : Math.min(1, (k - 0.25) / 0.55);
      this.ghost.position.set(-4 + e * 7, 0.6, -5 + e * 4);
    }

    // Timed steps.
    if (app.gestures.dragging || app.mode === 'shifting') return;
    const id = this.stepId;
    if (id === 'afternoon' && this.clockGoal === null) {
      if (this.t > 3) app.setHeat(true);
      if (this.t > 6) this.next();
    } else if (id === 'nepa' && this.t > 4.5) {
      this.next();
    } else if (id === 'meet') {
      // The player walks from the gate to the buka; a heart when they meet.
      const me = app.street.placeFamily('player', 0, 0);
      const k = Math.min(1, this.t / 5);
      me.group.position.set(-1.2 + (-16.4 + 1.2) * k, -0.24, 12.6 + (-1 - 12.6) * k);
      me.group.rotation.y = Math.atan2(-15.2, -13.6);
      me.setMode(k < 1 ? 'walk' : 'stand');
      this.heart.mesh.visible = k >= 1;
      this.heart.mesh.position.set(-17, 3.2 + Math.sin(this.t * 3) * 0.2, -1);
      app.headPose(_a, _q);
      this.heart.mesh.lookAt(_a);
      if (this.t > 7.5) {
        this.heart.mesh.visible = false;
        me.setMode('stand');
        this.story.joy = Math.min(100, this.story.joy + 8);
        this.placeFamily();
        app.street.placeFamily('adaeze', 0.4, 12.6, Math.PI);
        this.next();
      }
    } else if (id === 'customers' && this.t > 5) {
      this.next();
    } else if (id === 'match' && this.t > 5) {
      this.placeFamily();
      this.next();
    } else if (id === 'party' && this.clockGoal === null) {
      if (!this.story.extras.party) {
        this.story.extras.party = true;
        const b = bounds(app.design);
        const c = app.design.court ?? b;
        const p = new Vector3(rectCx(c), 0, rectCz(c));
        app.view.group.localToWorld(p);
        app.table.site.worldToLocal(p);
        app.street.setParty(true, [p.x, p.z]);
        app.say('Ẹ ku ilé o! A house full of family and friends.');
        this.story.joy = Math.min(100, this.story.joy + 10);
      }
      if (this.t > 9) this.next();
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
