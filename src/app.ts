/**
 * Ilé application core: owns the design state and wires every module
 * together — table, building, hands, heat, ScaleShift, the Elder, compare and
 * onboarding. `IleSystem` in index.ts just constructs this and ticks it.
 */

import {
  BoxGeometry,
  CylinderGeometry,
  DirectionalLight,
  Group,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Quaternion,
  SphereGeometry,
  TorusGeometry,
  Vector3,
  type World,
} from '@iwsdk/core';
import { Sfx, speak, stopSpeaking } from './audio.ts';
import { applyActions, describeAction, type ElderReply } from './elder/actions.ts';
import { askElder } from './elder/client.ts';
import { HeatOverlay } from './heat/overlay.ts';
import {
  formatHour,
  scoreDay,
  scoreDesign,
  sunVector,
  type DayScore,
  type DesignScore,
} from './heat/score.ts';
import { Gestures, type Hand } from './interact/gestures.ts';
import { Handles } from './interact/handles.ts';
import { BuildingView, slotPlacements } from './model/building.ts';
import {
  History,
  MATERIALS,
  cloneDesign,
  defaultDesign,
  designChanged,
  deserialize,
  isComplete,
  roomLabel,
  scratchDesign,
  serialize,
  setHour as withHour,
  setMaterial,
  setRoof,
  type Design,
  type RoomId,
} from './model/state.ts';
import { ScaleShift } from './scaleshift/shift.ts';
import { StoryMode } from './story/mode.ts';
import { naira } from './story/story.ts';
import { Table } from './scene/table.ts';
import { Compare } from './ui/compare.ts';
import { Label, PALETTE } from './ui/label.ts';
import { PalmMenu, type MenuItem } from './ui/menu.ts';
import { FREE_HINT, Onboarding, scratchHint } from './ui/onboarding.ts';

/** `start` is the opening choice between scratch and the compound. */
export type Mode = 'start' | 'table' | 'shifting' | 'inside';

const STORAGE_KEY = 'ile.design.v2';
const TABLE_ROOF = 0.5;
const HEAT_ROOF = 0.14;
/** Metres per second that walls grow when raised. */
const WALL_GROW = 4.5;

const _pos = new Vector3();
const _quat = new Quaternion();
const _v = new Vector3();
const _dir = new Vector3();

function isSoftwareRenderer(world: World): boolean {
  try {
    const gl = world.renderer.getContext();
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const name = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : '';
    return /swiftshader|llvmpipe|software/i.test(name);
  } catch {
    return false;
  }
}

/** Break speech into short pages that fit two large lines. */
function pages(text: string, max = 84): string[] {
  const sentences = text.match(/[^.!?]+[.!?]+|\S[^.!?]*$/g) ?? [text];
  const out: string[] = [];
  for (const raw of sentences) {
    const sentence = raw.trim();
    if (!sentence) continue;
    const last = out[out.length - 1];
    if (last && last.length + sentence.length + 1 <= max) out[out.length - 1] = `${last} ${sentence}`;
    else out.push(sentence);
  }
  return out;
}

export class App {
  readonly world: World;
  readonly gestures: Gestures;
  readonly root = new Group();
  readonly table = new Table();
  readonly view = new BuildingView({ shadows: true });
  readonly handles: Handles;
  readonly shift: ScaleShift;
  /** Story mode: savings, belongings, the beats of the day. */
  readonly story: StoryMode;

  design: Design;
  mode: Mode = 'start';
  room: RoomId | null = null;
  heatOn = false;
  compareOn = false;

  private readonly ghost = new BuildingView({ ghost: true });
  private readonly ghostMarks: Mesh<BoxGeometry, MeshBasicMaterial>[] = [];
  private readonly overlay = new HeatOverlay();
  private readonly menu: PalmMenu;
  private readonly compare = new Compare();
  private readonly onboarding: Onboarding;
  private readonly history = new History();
  /** The design Compare measures against; null until there is a whole house. */
  private before: Design | null = null;
  private fromScratch = false;
  private editStart: Design | null = null;
  private now: DesignScore;
  private day: DayScore;
  private shownHeight = 0;

  private readonly sun = new DirectionalLight(0xfff0d0, 2.6);
  readonly hud = new Group();
  private readonly badge: Label;
  /** The one text panel: Elder speech, else a toast, else the current hint. */
  private readonly panel: Label;
  private readonly accept: Label;
  private readonly reject: Label;
  private readonly back: Label;
  private readonly skip: Label;
  private readonly menuToken: Label;
  private readonly cards: { label: Label; choose: () => void }[] = [];
  private readonly elder = new Group();
  private readonly halo: Mesh<TorusGeometry, MeshBasicMaterial>;

  private proposal: ElderReply | null = null;
  private proposalText = '';
  private elderBusy = false;
  private hintText = 'Pinch a card to begin.';
  private toastText = '';
  private toastTime = 0;
  private speech: string[] = [];
  private speechTime = 0;
  private badgePulse = 0;
  private clock = 0;
  private anchoredInXR = false;
  private readonly listeners: ((event: string) => void)[] = [];
  private readonly eventLog: string[] = [];

  constructor(world: World) {
    this.world = world;
    this.gestures = new Gestures(world);
    world.createTransformEntity(this.root, { persistent: true });
    // Software renderers (headless CI, remote desktops) cannot afford shadows.
    // `?gfx=high` forces full quality (used for offline frame capture).
    const lowGfx = !/[?&]gfx=high/.test(location.search) && isSoftwareRenderer(world);
    world.renderer.shadowMap.enabled = !lowGfx;

    // Light: a warm sky fill plus the sun, which follows the hour.
    this.root.add(new HemisphereLight(0xfff1d6, 0x8a6a4a, 0.85));
    this.sun.castShadow = !lowGfx;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0004;
    this.root.add(this.sun, this.sun.target);

    this.root.add(this.table.group);
    this.design = scratchDesign();
    this.now = scoreDesign(this.design);
    this.day = scoreDay(this.design);
    this.view.rebuild(this.design);
    this.table.site.add(this.view.group, this.ghost.group);
    this.view.group.add(this.overlay.labels);
    this.ghost.group.visible = false;
    for (let i = 0; i < 2; i += 1) {
      const mark = new Mesh(
        new BoxGeometry(1, 1, 1),
        new MeshBasicMaterial({ color: 0x7fe3ff, transparent: true, opacity: 0.8, depthWrite: false }),
      );
      mark.visible = false;
      mark.renderOrder = 8;
      this.ghostMarks.push(mark);
      this.ghost.group.add(mark);
    }

    // HUD: the score badge above one large text panel, plus pinch tokens.
    this.root.add(this.hud);
    this.badge = new Label({ width: 0.36, height: 0.1, fontScale: 0.36, bold: true, border: PALETTE.gold, maxLines: 2 });
    this.badge.mesh.position.y = 0.128;
    this.panel = new Label({
      width: 0.74,
      height: 0.13,
      fontScale: 0.36,
      bold: true,
      bg: 'rgba(24, 14, 8, 0.94)',
      fg: '#ffffff',
      maxLines: 2,
    });
    const token = (text: string, bg: string, x: number, y: number, size = 0.085) => {
      const l = new Label({ width: size, height: size, ppm: 2400, fontScale: 0.3, round: true, bold: true, bg, border: PALETTE.cream });
      l.setText(text);
      l.mesh.position.set(x, y, 0.004);
      l.mesh.visible = false;
      this.hud.add(l.mesh);
      return l;
    };
    this.accept = token('✓\nAccept', PALETTE.leaf, -0.43, 0);
    this.reject = token('✕\nNo', PALETTE.clay, 0.43, 0);
    this.back = token('Table', PALETTE.sky, 0, -0.125);
    this.skip = new Label({ width: 0.13, height: 0.044, fontScale: 0.5, bold: true, bg: PALETTE.panel });
    this.skip.setText('Skip intro');
    this.skip.mesh.position.set(0.3, -0.098, 0.004);
    this.skip.mesh.visible = false;
    this.hud.add(this.badge.mesh, this.panel.mesh, this.skip.mesh);

    // Start cards: build from scratch, or start from the compound.
    const card = (text: string, x: number, y: number, choose: () => void, w = 0.33, h = 0.17, fs = 0.2) => {
      const label = new Label({ width: w, height: h, fontScale: fs, bold: true, bg: 'rgba(24, 14, 8, 0.94)', border: PALETTE.gold, maxLines: 2 });
      label.setText(text);
      label.mesh.position.set(x, y, 0.004);
      this.hud.add(label.mesh);
      this.cards.push({ label, choose });
    };
    card('Your first home in Lagos', 0, -0.122, () => this.startWith('story'), 0.74, 0.092, 0.4);
    const row = -0.222;
    let storySave = false;
    try {
      storySave = !!localStorage.getItem('ile.story.v1');
    } catch {
      // Storage blocked: no saved home to offer.
    }
    const resume = storySave
      ? { text: 'Continue\nmy home', run: () => this.startWith('story-resume') }
      : this.load()
        ? { text: 'Continue my\nlast house', run: () => this.startWith('saved') }
        : null;
    // One row of cards under the story card; three across if there is a save.
    const w = resume ? 0.238 : 0.36;
    const xs = resume ? [-0.251, 0, 0.251] : [-0.19, 0.19];
    card('Build from\nscratch', xs[0], row, () => this.startWith('scratch'), w, 0.092, 0.27);
    card('Start from a\nYoruba compound', xs[1], row, () => this.startWith('compound'), w, 0.092, 0.27);
    if (resume) card(resume.text, xs[2], row, resume.run, w, 0.092, 0.27);

    // Table tokens: the Elder figure and the Menu button.
    this.halo = this.buildElder();
    this.elder.position.set(-0.225, 0, 0.235);
    this.table.furniture.add(this.elder);
    this.menuToken = new Label({ width: 0.07, height: 0.07, ppm: 2400, fontScale: 0.32, round: true, bold: true, border: PALETTE.gold });
    this.menuToken.setText('Menu');
    this.menuToken.mesh.position.set(0.225, 0.035, 0.24);
    this.menuToken.mesh.rotation.x = -0.9;
    this.table.furniture.add(this.menuToken.mesh);

    this.compare.group.position.set(0, 0.21, -0.2);
    this.compare.group.rotation.x = 0.3;
    this.table.group.add(this.compare.group);

    this.handles = new Handles(this);
    this.shift = new ScaleShift(this);
    this.root.add(this.shift.vignette);
    this.menu = new PalmMenu(this);
    this.root.add(this.menu.group);
    this.onboarding = new Onboarding(this);
    this.story = new StoryMode(this);
    this.registerTokens();

    this.gestures.onPalmUp = (hand, above) => this.openMenu(above, hand);
    this.gestures.onFlick = (direction) => {
      if (this.proposal) this.rejectProposal();
      else if (direction === 'left' && this.mode === 'table') this.undo();
    };
    this.gestures.onPinch = (hit) => {
      if (!hit && this.menu.isOpen) this.menu.close();
    };

    // Desktop preview shortcuts (never needed in the headset).
    const keys: Record<string, () => void> = {
      '0': () => this.startWith('story'),
      k: () => this.story.skip(),
      '1': () => this.startWith('scratch'),
      '2': () => this.startWith('compound'),
      h: () => this.setHeat(!this.heatOn),
      e: () => this.askElder(),
      c: () => this.toggleCompare(),
      u: () => this.undo(),
      f: () => this.toggleRoof(),
      m: () => this.cycleMaterial(),
      r: () => this.newHouse(),
      y: () => this.acceptProposal(),
      n: () => this.rejectProposal(),
      b: () => this.shift.exit(),
      s: () => this.onboarding.skip(),
    };
    window.addEventListener('keydown', (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      keys[e.key.toLowerCase()]?.();
    });

    this.headPose(_pos, _quat);
    this.table.anchor(_pos, _quat);
    this.placeHud();
    this.refresh();
    this.showStart(true);
  }

  // ------------------------------------------------------------------ setup

  private buildElder(): Mesh<TorusGeometry, MeshBasicMaterial> {
    const wood = new MeshStandardMaterial({ color: 0x5b3418, roughness: 0.6 });
    const cloth = new MeshStandardMaterial({ color: 0x2f5fa8, roughness: 0.9 });
    const body = new Mesh(new CylinderGeometry(0.012, 0.022, 0.058, 14), cloth);
    body.position.y = 0.029;
    const head = new Mesh(new SphereGeometry(0.013, 14, 10), wood);
    head.position.y = 0.071;
    const cap = new Mesh(new CylinderGeometry(0.011, 0.013, 0.012, 14), cloth);
    cap.position.set(0.002, 0.086, 0);
    cap.rotation.z = -0.25;
    const staff = new Mesh(new CylinderGeometry(0.002, 0.002, 0.09, 6), wood);
    staff.position.set(0.024, 0.045, 0.006);
    const base = new Mesh(new CylinderGeometry(0.028, 0.03, 0.006, 20), wood);
    base.position.y = 0.003;
    const halo = new Mesh(
      new TorusGeometry(0.036, 0.0035, 8, 40),
      new MeshBasicMaterial({ color: 0xf2b23e, transparent: true, opacity: 0.7 }),
    );
    halo.rotation.x = Math.PI / 2;
    halo.position.y = 0.006;
    for (const m of [body, head, cap, staff, base]) m.castShadow = true;
    this.elder.add(body, head, cap, staff, base, halo);
    return halo;
  }

  private registerTokens(): void {
    const swell = (label: Label) => (on: boolean) => label.mesh.scale.setScalar(on ? 1.15 : 1);
    const body = new Group();
    body.position.y = 0.045;
    this.elder.add(body);
    this.gestures.add({
      id: 'elder',
      object: body,
      radius: 0.05,
      enabled: () => this.mode === 'table',
      onHover: (on) => this.elder.scale.setScalar(on ? 1.2 : 1),
      onClick: () => this.askElder(),
    });
    this.gestures.add({
      id: 'menu-token',
      object: this.menuToken.mesh,
      radius: 0.04,
      enabled: () => this.mode === 'table',
      onHover: swell(this.menuToken),
      onClick: () => {
        this.menuToken.mesh.getWorldPosition(_v);
        _v.y += 0.12;
        this.openMenu(_v.clone());
      },
    });
    const hudToken = (id: string, label: Label, radius: number, run: () => void, extra = () => true) =>
      this.gestures.add({
        id,
        object: label.mesh,
        radius,
        enabled: () => label.mesh.visible && this.hud.visible && extra(),
        onHover: swell(label),
        onClick: run,
      });
    hudToken('accept', this.accept, 0.046, () => this.acceptProposal());
    hudToken('reject', this.reject, 0.046, () => this.rejectProposal());
    hudToken('back', this.back, 0.046, () => this.shift.exit(), () => this.mode === 'inside');
    hudToken('skip', this.skip, 0.06, () => (this.story.scripted ? this.story.skip() : this.onboarding.skip()));
    this.cards.forEach((card, i) => {
      this.gestures.add({
        id: `card-${i}`,
        object: card.label.mesh,
        radius: 1,
        surface: true,
        enabled: () => this.mode === 'start' && this.hud.visible,
        onHover: swell(card.label),
        onClick: card.choose,
      });
    });
  }

  // ------------------------------------------------------------ start screen

  private showStart(on: boolean): void {
    for (const card of this.cards) card.label.mesh.visible = on;
    this.badge.mesh.visible = !on;
    // The sun arc would sit behind the cards; it appears with the plot.
    this.table.gizmos.visible = !on;
    if (on) {
      this.mode = 'start';
      this.handles.setVisible(false);
      this.setHint('Welcome to Ilé. Pinch a card to begin.');
    }
  }

  /** Leave the start screen with an empty plot, the compound, or a saved house. */
  startWith(kind: 'scratch' | 'compound' | 'saved' | 'story' | 'story-resume'): void {
    if (this.mode !== 'start') return;
    const isStory = kind === 'story' || kind === 'story-resume';
    if (!isStory) this.story.end();
    const hour = this.design.hour;
    const saved = kind === 'saved' ? this.load() : null;
    this.fromScratch = kind === 'scratch' || isStory;
    this.design = withHour(saved ?? (kind === 'compound' ? defaultDesign() : scratchDesign()), hour);
    this.before = isComplete(this.design) ? cloneDesign(this.design) : null;
    this.shownHeight = this.design.wallHeight;
    this.history.clear();
    this.mode = 'table';
    this.showStart(false);
    this.handles.setVisible(true);
    this.refresh();
    Sfx.chime();
    if (isStory) {
      // A returning player gets their own house back; a new one, an empty plot.
      const home = this.story.begin(kind === 'story-resume');
      if (home) {
        this.design = withHour(home, 8);
        this.before = isComplete(this.design) ? cloneDesign(this.design) : null;
        this.shownHeight = this.design.wallHeight;
        this.refresh();
      }
      this.setHint(scratchHint(this.design));
    } else if (kind === 'compound') this.onboarding.start();
    else this.setHint(scratchHint(this.design));
    this.emit(`start:${kind}`);
  }

  /** Back to the start screen for a new house. */
  newHouse(): void {
    if (this.mode !== 'table') return;
    if (this.compareOn) this.toggleCompare();
    this.clearProposal();
    this.onboarding.skip(true);
    this.story.end();
    this.setHeat(false);
    this.design = withHour(scratchDesign(), this.design.hour);
    this.shownHeight = 0;
    this.refresh();
    this.speech = [];
    this.showStart(true);
  }

  // ----------------------------------------------------------------- events

  on(listener: (event: string) => void): void {
    this.listeners.push(listener);
  }

  private emit(event: string): void {
    console.info(`[ile] ${event} · score ${this.day.overall} · ${this.mode}`);
    this.eventLog.push(event);
    this.root.name = `ile-state|${this.mode}|${this.room ?? '-'}|${this.day.overall}|${this.eventLog.slice(-6).join(',')}`;
    for (const l of this.listeners) l(event);
  }

  // ------------------------------------------------------------------ pose

  /** Viewer pose: the XR head in a session, the preview camera otherwise. */
  headPose(pos: Vector3, quat: Quaternion): void {
    const source = this.world.session ? this.world.player.head : this.world.camera;
    source.updateWorldMatrix(true, false);
    source.getWorldPosition(pos);
    source.getWorldQuaternion(quat);
  }

  recenter(): void {
    if (this.mode !== 'table' && this.mode !== 'start') return;
    this.headPose(_pos, _quat);
    this.table.anchor(_pos, _quat);
    this.placeHud();
  }

  private placeHud(): void {
    this.headPose(_pos, _quat);
    if (this.mode === 'inside') {
      _dir.set(0, 0, -1).applyQuaternion(_quat);
      _dir.y = 0;
      _dir.normalize();
      this.hud.position.copy(_pos).addScaledVector(_dir, 0.95);
      this.hud.position.y = _pos.y - 0.2;
    } else {
      this.table.group.updateMatrixWorld(true);
      this.hud.position.copy(this.table.group.localToWorld(_v.set(0, 0.29, -0.36)));
    }
    this.hud.lookAt(_pos);
  }

  // ---------------------------------------------------------------- editing

  beginEdit(): void {
    this.editStart = this.design;
  }

  /** Live preview while a handle is dragged; no undo entry yet. */
  preview(next: Design): void {
    if (serialize(next) === serialize(this.design)) return;
    this.design = next;
    this.clearProposal();
    this.refresh();
    Sfx.tick();
    if (this.editStart) this.quote(next, this.editStart);
  }

  /** In story mode, show what a change would cost before it is confirmed. */
  quote(to: Design | null, from: Design = this.design): void {
    if (!to || !this.story.active) return;
    const cost = this.story.cost(from, to);
    if (cost <= 0) return;
    this.toast(
      this.story.canAfford(cost) ? `${naira(cost)}. Let go to build.` : `${naira(cost)}. More than your savings.`,
      1.4,
    );
  }

  /** Pay for a change, or say why not. */
  private pay(from: Design, to: Design): boolean {
    const cost = this.story.cost(from, to);
    if (!this.story.canAfford(cost)) {
      this.toast(`That costs ${naira(cost)}. You have ${this.story.savingsText()}.`, 3);
      Sfx.dismiss();
      return false;
    }
    this.story.spend(cost);
    return true;
  }

  endEdit(kind: string): void {
    const start = this.editStart;
    this.editStart = null;
    if (!start || !designChanged(start, this.design)) return;
    if (!this.pay(start, this.design)) {
      this.design = start;
      this.refresh();
      return;
    }
    this.history.commit(start);
    this.afterEdit(kind);
  }

  /** One-shot edit with an undo entry (toggles, menu actions, new rooms). */
  commit(next: Design, kind: string): void {
    if (!designChanged(next, this.design)) return;
    if (!this.pay(this.design, next)) return;
    this.history.commit(this.design);
    this.design = next;
    this.clearProposal();
    this.refresh();
    Sfx.tick();
    this.afterEdit(kind);
  }

  private afterEdit(kind: string): void {
    this.save();
    // A scratch-built house gets its "before" the first time it is whole.
    if (!this.before && isComplete(this.design)) {
      this.before = cloneDesign(this.design);
      this.toast('Your house stands. Now make it cool.', 3);
      Sfx.chime();
    }
    if (this.fromScratch && !this.onboarding.active) this.setHint(scratchHint(this.design));
    this.emit(`edit:${kind}`);
  }

  setHour(hour: number, quiet = false): void {
    const next = withHour(this.design, hour);
    if (next.hour === this.design.hour) return;
    this.design = next;
    this.refresh(false);
    if (!quiet) Sfx.tick();
  }

  /** The design as JSON, and back (used by the story save). */
  exportDesign(): string {
    return serialize(this.design);
  }

  importDesign(json: string): Design | null {
    return deserialize(json);
  }

  /** Make the heat numbers throb (the power cut). */
  pulseHeat(scale: number): void {
    for (const label of this.overlay.labels.children) label.scale.setScalar(scale);
  }

  /** The story moved to another beat: update what the Skip token does. */
  storyChanged(): void {
    this.skip.mesh.visible = this.onboarding.active || this.story.scripted;
    this.refresh(false);
  }

  undo(): void {
    const prev = this.history.undo();
    if (!prev) {
      this.toast('Nothing to undo');
      return;
    }
    this.story.refund(this.story.cost(prev, this.design));
    this.design = withHour(prev, this.design.hour);
    this.clearProposal();
    this.refresh();
    this.save();
    if (this.fromScratch && !this.onboarding.active) this.setHint(scratchHint(this.design));
    Sfx.dismiss();
    this.toast('Undone');
  }

  toggleRoof(): void {
    if (this.design.rooms.length === 0 || this.design.wallHeight === 0) {
      this.toast('Raise the walls first.');
      return;
    }
    this.commit(setRoof(this.design, !this.design.roof), 'roof');
    this.toast(this.design.roof ? 'Roof on. Twist a gold grip for deeper eaves.' : 'Roof off.');
  }

  cycleMaterial(): void {
    const i = MATERIALS.indexOf(this.design.material);
    const next = MATERIALS[(i + 1) % MATERIALS.length];
    this.commit(setMaterial(this.design, next), 'material');
    const names = { earth: 'thick earth, thatch roof', block: 'sandcrete block, tile roof', zinc: 'zinc sheet' };
    this.toast(`Walls: ${names[next]}`);
  }

  setHeat(on: boolean): void {
    if (on && !isComplete(this.design)) {
      this.toast('The heat map needs walls and a roof.');
      return;
    }
    if (this.heatOn === on) return;
    this.heatOn = on;
    this.refresh(false);
    if (on) this.emit('heat');
  }

  toggleCompare(): void {
    if (this.mode !== 'table') return;
    if (!this.compareOn && !this.before) {
      this.toast('Finish the walls and roof first.');
      return;
    }
    this.compareOn = !this.compareOn;
    this.compare.group.visible = this.compareOn;
    this.hud.visible = !this.compareOn;
    this.overlay.labels.visible = this.overlay.labels.visible && !this.compareOn;
    this.handles.setVisible(!this.compareOn);
    this.table.gizmos.visible = !this.compareOn;
    if (this.compareOn && this.before) this.compare.update(this.before, this.design);
    else this.refresh(false);
  }

  setRoomHover(room: RoomId, on: boolean): void {
    this.overlay.setHover(room, on);
    this.overlay.update(this.view, this.design, this.now, this.heatOn, this.mode === 'table' && !this.compareOn);
    const s = this.now.rooms[room];
    if (on && s && this.mode === 'table' && isComplete(this.design)) {
      this.toast(`${roomLabel(this.design, room)}: ${s.feel.toFixed(0)}°C, ${s.breeze}. Pinch to step inside.`, 1.2);
    }
  }

  enterRoom(room: RoomId): void {
    if (this.design.wallHeight === 0) {
      this.toast('Raise the walls before stepping inside.');
      return;
    }
    if (this.compareOn) this.toggleCompare();
    this.menu.close();
    this.shift.enter(room);
  }

  /** Recompute scores and redraw everything that depends on the design. */
  refresh(rebuild = true): void {
    const d = this.design;
    if (rebuild) {
      this.view.rebuild(d, this.shownHeight);
      this.day = scoreDay(d, this.story?.comfort());
      this.shift?.reseat();
    }
    this.now = scoreDesign(d, d.hour, this.story?.comfort());
    if (this.heatOn && !isComplete(d)) this.heatOn = false;
    this.handles?.layout(d);
    this.table.setRotation(d.rotation);
    this.table.setHour(d.hour);
    this.overlay.update(this.view, d, this.now, this.heatOn, this.mode === 'table' && !this.compareOn);
    if (this.mode === 'table' || this.mode === 'start') {
      this.view.setRoofOpacity(this.heatOn ? HEAT_ROOF : TABLE_ROOF);
    }
    this.updateSun();
    this.updateBadge();
    if (this.compareOn && this.before) this.compare.update(this.before, d);
  }

  private updateBadge(): void {
    const d = this.design;
    const money = this.story?.active ? this.story.savingsText() : '';
    const s = this.room ? this.now.rooms[this.room] : undefined;
    if (this.mode === 'inside' && this.room && s) {
      this.badge.setText(`${roomLabel(d, this.room)}\n${s.feel.toFixed(0)}°C · ${s.breeze} · comfort ${s.comfort}`);
      Sfx.wind(s.breeze === 'breezy' ? 1 : s.breeze === 'some air' ? 0.45 : 0.1);
    } else if (!isComplete(d)) {
      const n = d.rooms.length;
      const what = `${n} room${n === 1 ? '' : 's'} · ${d.wallHeight ? 'needs a roof' : 'no walls yet'}`;
      this.badge.setText(money ? `${what}\nSavings ${money}` : what.replace(' · ', '\n'));
    } else {
      this.badge.setText(
        `Ilé Score  ${this.day.overall}\n${money ? `Savings ${money}` : `${formatHour(d.hour)} · now ${this.now.overall}`}`,
      );
    }
  }

  private updateSun(): void {
    const site = this.table.site;
    site.updateWorldMatrix(true, false);
    const scale = site.getWorldScale(_v).x;
    const s = sunVector(this.design.hour);
    _dir.set(s.x, Math.max(0.05, s.y), s.z).normalize();
    this.table.group.getWorldQuaternion(_quat);
    _dir.applyQuaternion(_quat);
    site.getWorldPosition(this.sun.target.position);
    this.sun.position.copy(this.sun.target.position).addScaledVector(_dir, 45 * scale);
    this.sun.intensity = 1.1 + 2.1 * Math.max(0, s.y);
    this.sun.color.setHSL(0.1, 0.9, 0.62 + 0.3 * Math.max(0, s.y));
    const cam = this.sun.shadow.camera;
    const half = 19 * scale;
    cam.left = -half;
    cam.right = half;
    cam.top = half;
    cam.bottom = -half;
    cam.near = 2 * scale;
    cam.far = 90 * scale;
    cam.updateProjectionMatrix();
    this.sun.shadow.normalBias = 0.04 * scale;
  }

  // ------------------------------------------------------------------ modes

  /** Called by ScaleShift as the transition runs and when it lands. */
  setMode(mode: Mode, room: RoomId | null): void {
    const was = this.mode;
    this.mode = mode;
    this.room = room;
    const atTable = mode === 'table';
    this.handles.setVisible(atTable && !this.compareOn);
    this.back.mesh.visible = mode === 'inside';
    this.hud.visible = mode !== 'shifting' && !this.compareOn;
    if (mode === 'shifting') {
      this.menu.close();
    } else {
      this.table.furniture.visible = atTable;
      this.table.gizmos.visible = atTable;
      this.table.ground.visible = !atTable;
      this.view.setRoofOpacity(atTable ? (this.heatOn ? HEAT_ROOF : TABLE_ROOF) : 1);
      this.placeHud();
      this.refresh(false);
      if (atTable) Sfx.wind(0);
      if (mode !== was) this.emit(mode);
    }
  }

  /** 0 at the table, 1 inside: cross-fades the things that differ. */
  setShiftProgress(e: number): void {
    const base = this.heatOn ? HEAT_ROOF : TABLE_ROOF;
    this.view.setRoofOpacity(base + (1 - base) * e);
    this.table.furniture.visible = e < 0.12;
    this.table.gizmos.visible = e < 0.12;
    this.table.ground.visible = e >= 0.12;
    this.updateSun();
  }

  // ------------------------------------------------------------------ elder

  askElder(): void {
    if (this.elderBusy || this.mode === 'shifting' || this.mode === 'start') return;
    if (!isComplete(this.design)) {
      this.say('Build me a house first. Rooms, walls and a roof. Then I will tell you how the sun treats it.');
      return;
    }
    if (this.proposal) {
      this.say(this.proposal.say);
      return;
    }
    this.elderBusy = true;
    this.speech = ['The Elder studies your house…'];
    this.speechTime = 30;
    this.updatePanel();
    const asked = serialize(this.design);
    void askElder(this.design).then((reply) => {
      this.elderBusy = false;
      // The house changed while he was thinking: his advice no longer fits.
      if (serialize(this.design) !== asked) {
        this.say('You changed the house while I was looking. Ask me again.');
        return;
      }
      if (reply.actions.length > 0) this.showProposal(reply);
      this.say(reply.say);
    });
  }

  /** Speak a line: voiced, and shown a sentence or two at a time. */
  say(text: string): void {
    this.speech = pages(text);
    this.speechTime = 0;
    this.nextSpeechPage(true);
    speak(text);
  }

  private nextSpeechPage(first = false): void {
    if (!first) this.speech.shift();
    const page = this.speech[0];
    this.speechTime = page ? Math.max(2.4, page.length * 0.062) : 0;
    this.updatePanel();
  }

  private showProposal(reply: ElderReply): void {
    this.proposal = reply;
    const next = applyActions(this.design, reply.actions);
    this.ghost.rebuild(next);
    this.ghost.group.visible = true;
    const places = slotPlacements(next);
    const openings = reply.actions.filter(
      (a) => a.type === 'add_opening' || a.type === 'remove_opening',
    );
    this.ghostMarks.forEach((mark, i) => {
      const a = openings[i];
      const p = a && 'room' in a ? places.find((s) => s.room === a.room && s.side === a.side) : undefined;
      mark.visible = !!p;
      if (p) {
        mark.position.set(p.x, p.y, p.z);
        mark.scale.set(p.alongX ? p.width : 0.9, p.height, p.alongX ? 0.9 : p.width);
      }
    });
    this.accept.mesh.visible = true;
    this.reject.mesh.visible = true;
    this.proposalText = reply.actions.map((a) => describeAction(a, this.design)).join(' + ');
    const cost = this.story.cost(this.design, next);
    if (cost > 0) this.proposalText += ` (${naira(cost)})`;
    this.emit('proposal');
  }

  private clearProposal(): void {
    if (!this.proposal) return;
    this.proposal = null;
    this.proposalText = '';
    this.ghost.group.visible = false;
    this.accept.mesh.visible = false;
    this.reject.mesh.visible = false;
    this.updatePanel();
  }

  acceptProposal(): void {
    const p = this.proposal;
    if (!p) return;
    const beforeScore = this.day.overall;
    const accepted = applyActions(this.design, p.actions);
    if (!this.pay(this.design, accepted)) return;
    this.history.commit(this.design);
    this.design = accepted;
    this.clearProposal();
    this.speech = [];
    stopSpeaking();
    this.refresh();
    this.save();
    Sfx.chime();
    this.badgePulse = 1;
    const gain = this.day.overall - beforeScore;
    this.toast(`Accepted. Ilé Score ${gain >= 0 ? '+' : ''}${gain}`, 3.5);
    this.emit('accepted');
  }

  rejectProposal(): void {
    if (!this.proposal) return;
    this.clearProposal();
    stopSpeaking();
    Sfx.dismiss();
    this.say('As you wish. It is your house.');
    this.emit('rejected');
  }

  // --------------------------------------------------------------------- ui

  /** Elder speech wins, then a toast, then a pending proposal, then the hint. */
  private updatePanel(): void {
    const speaking = this.speech.length > 0;
    const text = speaking
      ? this.speech[0]
      : this.toastTime > 0
        ? this.toastText
        : this.proposal
          ? `${this.proposalText}. Pinch ✓ to accept.`
          : this.hintText;
    this.panel.setText(
      text,
      speaking ? PALETTE.gold : '#ffffff',
      speaking ? 'rgba(46, 22, 8, 0.96)' : 'rgba(24, 14, 8, 0.94)',
    );
  }

  setHint(text: string): void {
    this.hintText = text;
    this.updatePanel();
  }

  toast(text: string, seconds = 2.4): void {
    this.toastText = text;
    this.toastTime = seconds;
    this.updatePanel();
  }

  onboardingChanged(): void {
    this.skip.mesh.visible = this.onboarding.active || this.story.scripted;
    if (!this.onboarding.active && this.fromScratch) this.setHint(scratchHint(this.design));
  }

  private openMenu(at: Vector3, _hand?: Hand): void {
    if (this.mode === 'shifting' || this.mode === 'start') return;
    const heat = { label: this.heatOn ? 'Heat\noff' : 'Heat\non', run: () => this.setHeat(!this.heatOn) };
    const elder = { label: 'Ask\nElder', run: () => this.askElder() };
    const items: MenuItem[] =
      this.mode === 'inside'
        ? [
            { label: 'Back to\ntable', run: () => this.shift.exit() },
            heat,
            elder,
            { label: 'Undo', run: () => this.undo() },
          ]
        : [
            heat,
            elder,
            { label: this.compareOn ? 'Close\ncompare' : 'Compare', run: () => this.toggleCompare() },
            { label: 'Undo', run: () => this.undo() },
            { label: this.design.roof ? 'Roof\noff' : 'Roof', run: () => this.toggleRoof() },
            { label: `Walls:\n${this.design.material}`, run: () => this.cycleMaterial() },
            { label: 'New\nhouse', run: () => this.newHouse() },
            { label: 'Re-\ncentre', run: () => this.recenter() },
          ];
    // Keep the menu inside the VR Glasses' narrow view: pull it toward the
    // centre line and never closer than a comfortable reading distance.
    this.headPose(_pos, _quat);
    _dir.set(0, 0, -1).applyQuaternion(_quat);
    _dir.y = 0;
    _dir.normalize();
    const side = _v.set(-_dir.z, 0, _dir.x);
    const rel = at.clone().sub(_pos);
    const forward = Math.max(0.42, rel.dot(_dir));
    const limit = Math.tan((9 * Math.PI) / 180) * forward;
    const lateral = Math.min(limit, Math.max(-limit, rel.dot(side)));
    const height = Math.min(_pos.y - 0.05, Math.max(_pos.y - 0.32, at.y));
    at.copy(_pos).addScaledVector(_dir, forward).addScaledVector(side, lateral);
    at.y = height;
    this.menu.open(items, at, _pos);
  }

  // ------------------------------------------------------------ persistence

  private save(): void {
    try {
      localStorage.setItem(STORAGE_KEY, serialize(this.design));
    } catch {
      // Storage can be blocked (private mode, glasses browser); not fatal.
    }
  }

  private load(): Design | null {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const d = raw ? deserialize(raw) : null;
      return d && d.rooms.length > 0 ? d : null;
    } catch {
      return null;
    }
  }

  // ------------------------------------------------------------------- tick

  update(delta: number, _time: number): void {
    // Offline frame capture: advance exactly one fixed tick per video frame,
    // however many frames the emulator happens to run in between.
    const step = (globalThis as { __ileStep?: { pending: number; dt: number } }).__ileStep;
    if (step) {
      if (step.pending <= 0) return;
      step.pending -= 1;
    }
    const dt = step ? step.dt : Math.min(delta, 0.1);
    this.clock += dt;

    // Seat the table in front of the user once their head pose is known.
    const inXR = !!this.world.session;
    if (inXR !== this.anchoredInXR && (this.mode === 'table' || this.mode === 'start')) {
      this.headPose(_pos, _quat);
      if (!inXR || _pos.lengthSq() > 0.01) {
        this.anchoredInXR = inXR;
        this.table.anchor(_pos, _quat);
        this.placeHud();
        this.updateSun();
      }
    }

    this.gestures.update(dt, this.clock);
    this.shift.update(dt);
    this.menu.update(dt);
    this.onboarding.update(dt);
    this.story.update(dt);

    // Walls grow from the floor when raised.
    const target = this.design.wallHeight;
    if (Math.abs(this.shownHeight - target) > 1e-3) {
      const step = WALL_GROW * dt;
      this.shownHeight =
        Math.abs(target - this.shownHeight) <= step
          ? target
          : this.shownHeight + Math.sign(target - this.shownHeight) * step;
      this.view.rebuild(this.design, this.shownHeight);
    }

    this.headPose(_pos, _quat);
    this.table.faceLabels(_pos);
    this.overlay.faceLabels(_pos);

    if (this.speech.length > 0 && !this.elderBusy) {
      this.speechTime -= dt;
      if (this.speechTime <= 0) this.nextSpeechPage();
    }
    if (this.toastTime > 0) {
      this.toastTime -= dt;
      if (this.toastTime <= 0) this.updatePanel();
    }
    // Small living details: the Elder's halo, the ghost's breath, the badge.
    const pulse = 0.5 + 0.5 * Math.sin(this.clock * (this.elderBusy ? 9 : 2.2));
    this.halo.material.opacity = this.elderBusy || this.proposal ? 0.45 + 0.55 * pulse : 0.35;
    this.halo.scale.setScalar(this.elderBusy ? 1 + 0.25 * pulse : 1);
    if (this.proposal) {
      const breath = 0.5 + 0.5 * Math.sin(this.clock * 3.2);
      this.ghost.wallMaterial.opacity = 0.18 + 0.2 * breath;
      this.ghost.roofMaterial.opacity = 0.22 + 0.24 * breath;
      for (const m of this.ghostMarks) m.material.opacity = 0.45 + 0.5 * breath;
    }
    if (this.badgePulse > 0) {
      this.badgePulse = Math.max(0, this.badgePulse - dt * 1.4);
      this.badge.mesh.scale.setScalar(1 + 0.35 * Math.sin(this.badgePulse * Math.PI));
    }
  }
}
