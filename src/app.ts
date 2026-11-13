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
  ROOM_LABEL,
  cloneDesign,
  defaultDesign,
  designChanged,
  deserialize,
  serialize,
  setHour as withHour,
  setMaterial,
  type Design,
  type RoomId,
} from './model/state.ts';
import { ScaleShift } from './scaleshift/shift.ts';
import { Table } from './scene/table.ts';
import { Compare } from './ui/compare.ts';
import { Label, PALETTE } from './ui/label.ts';
import { PalmMenu, type MenuItem } from './ui/menu.ts';
import { FREE_HINT, Onboarding } from './ui/onboarding.ts';

export type Mode = 'table' | 'shifting' | 'inside';

const STORAGE_KEY = 'ile.design.v1';
const TABLE_ROOF = 0.5;
const HEAT_ROOF = 0.14;

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

export class App {
  readonly world: World;
  readonly gestures: Gestures;
  readonly root = new Group();
  readonly table = new Table();
  readonly view = new BuildingView({ shadows: true });
  readonly handles: Handles;
  readonly shift: ScaleShift;

  design: Design;
  mode: Mode = 'table';
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
  private readonly before: Design;
  private editStart: Design | null = null;
  private now: DesignScore;
  private day: DayScore;

  private readonly sun = new DirectionalLight(0xfff0d0, 2.6);
  private readonly hud = new Group();
  private readonly badge: Label;
  private readonly subtitle: Label;
  private readonly hint: Label;
  private readonly accept: Label;
  private readonly reject: Label;
  private readonly back: Label;
  private readonly skip: Label;
  private readonly menuToken: Label;
  private readonly elder = new Group();
  private readonly halo: Mesh<TorusGeometry, MeshBasicMaterial>;

  private proposal: ElderReply | null = null;
  private elderBusy = false;
  private hintText = FREE_HINT;
  private toastTime = 0;
  private badgePulse = 0;
  private clock = 0;
  private anchoredInXR = false;
  private started = false;
  private readonly listeners: ((event: string) => void)[] = [];
  private readonly eventLog: string[] = [];

  constructor(world: World) {
    this.world = world;
    this.gestures = new Gestures(world);
    world.createTransformEntity(this.root, { persistent: true });
    // Software renderers (headless CI, remote desktops) cannot afford shadows.
    const lowGfx = isSoftwareRenderer(world);
    world.renderer.shadowMap.enabled = !lowGfx;

    // Light: a warm sky fill plus the sun, which follows the hour.
    this.root.add(new HemisphereLight(0xfff1d6, 0x8a6a4a, 0.85));
    this.sun.castShadow = !lowGfx;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0004;
    this.root.add(this.sun, this.sun.target);

    this.root.add(this.table.group);
    this.design = this.load() ?? defaultDesign();
    this.before = cloneDesign(this.design);
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

    // HUD: score badge, the Elder's subtitles, the current hint, and tokens.
    this.root.add(this.hud);
    this.badge = new Label({ width: 0.27, height: 0.078, fontScale: 0.34, bold: true, border: PALETTE.gold });
    this.badge.mesh.position.y = 0.108;
    this.subtitle = new Label({ width: 0.5, height: 0.11, fontScale: 0.25 });
    this.hint = new Label({
      width: 0.5,
      height: 0.052,
      fontScale: 0.4,
      bg: 'rgba(247, 234, 208, 0.92)',
      fg: PALETTE.ink,
    });
    this.hint.mesh.position.y = -0.092;
    const token = (text: string, bg: string, x: number, y: number, size = 0.074) => {
      const l = new Label({ width: size, height: size, ppm: 2600, fontScale: 0.3, round: true, bold: true, bg, border: PALETTE.cream });
      l.setText(text);
      l.mesh.position.set(x, y, 0.004);
      l.mesh.visible = false;
      this.hud.add(l.mesh);
      return l;
    };
    this.accept = token('✓\nAccept', PALETTE.leaf, -0.305, 0);
    this.reject = token('✕\nNo', PALETTE.clay, 0.305, 0);
    this.back = token('Table', PALETTE.sky, 0, -0.175);
    this.skip = new Label({ width: 0.1, height: 0.034, fontScale: 0.46, bg: PALETTE.panel });
    this.skip.setText('Skip intro');
    this.skip.mesh.position.set(0.315, -0.092, 0.004);
    this.skip.mesh.visible = false;
    this.hud.add(this.badge.mesh, this.subtitle.mesh, this.hint.mesh, this.skip.mesh);
    this.subtitle.setText('');
    this.subtitle.mesh.visible = false;

    // Table tokens: the Elder figure and the Menu button.
    this.halo = this.buildElder();
    this.elder.position.set(-0.225, 0, 0.235);
    this.table.furniture.add(this.elder);
    this.menuToken = new Label({ width: 0.064, height: 0.064, ppm: 2600, fontScale: 0.3, round: true, bold: true, border: PALETTE.gold });
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
    this.registerTokens();

    this.gestures.onPalmUp = (hand, above) => this.openMenu(above, hand);
    this.gestures.onFlick = (direction) => {
      if (this.proposal) this.rejectProposal();
      else if (direction === 'left' && this.mode === 'table') this.undo();
    };
    this.gestures.onPinch = (hit) => {
      if (!hit && this.menu.isOpen) this.menu.close();
      if (!this.started) this.begin();
    };

    // Desktop preview shortcuts (never needed in the headset).
    const keys: Record<string, () => void> = {
      h: () => this.setHeat(!this.heatOn),
      e: () => this.askElder(),
      c: () => this.toggleCompare(),
      u: () => this.undo(),
      m: () => this.cycleMaterial(),
      r: () => this.reset(),
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
    this.setHint('Pinch anywhere to begin.');
    // Without a tap, browsers block audio; start the intro anyway after a beat.
    window.setTimeout(() => this.begin(), 2500);
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
    const swell = (label: Label) => (on: boolean) => label.mesh.scale.setScalar(on ? 1.18 : 1);
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
      radius: 0.036,
      enabled: () => this.mode === 'table',
      onHover: swell(this.menuToken),
      onClick: () => {
        this.menuToken.mesh.getWorldPosition(_v);
        _v.y += 0.12;
        this.openMenu(_v.clone());
      },
    });
    this.gestures.add({
      id: 'accept',
      object: this.accept.mesh,
      radius: 0.04,
      enabled: () => this.accept.mesh.visible && this.hud.visible,
      onHover: swell(this.accept),
      onClick: () => this.acceptProposal(),
    });
    this.gestures.add({
      id: 'reject',
      object: this.reject.mesh,
      radius: 0.04,
      enabled: () => this.reject.mesh.visible && this.hud.visible,
      onHover: swell(this.reject),
      onClick: () => this.rejectProposal(),
    });
    this.gestures.add({
      id: 'back',
      object: this.back.mesh,
      radius: 0.04,
      enabled: () => this.back.mesh.visible && this.mode === 'inside',
      onHover: swell(this.back),
      onClick: () => this.shift.exit(),
    });
    this.gestures.add({
      id: 'skip',
      object: this.skip.mesh,
      radius: 0.045,
      enabled: () => this.skip.mesh.visible && this.hud.visible,
      onHover: swell(this.skip),
      onClick: () => this.onboarding.skip(),
    });
  }

  private begin(): void {
    if (this.started) return;
    this.started = true;
    this.onboarding.start();
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
    if (this.mode !== 'table') return;
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
      this.hud.position.copy(_pos).addScaledVector(_dir, 0.85);
      this.hud.position.y = _pos.y - 0.1;
    } else {
      this.table.group.updateMatrixWorld(true);
      this.hud.position.copy(this.table.group.localToWorld(_v.set(0, 0.3, -0.33)));
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
  }

  endEdit(kind: string): void {
    const start = this.editStart;
    this.editStart = null;
    if (!start || !designChanged(start, this.design)) return;
    this.history.commit(start);
    this.save();
    this.emit(`edit:${kind}`);
  }

  /** One-shot edit with an undo entry (toggles, menu actions). */
  commit(next: Design, kind: string): void {
    if (!designChanged(next, this.design)) return;
    this.history.commit(this.design);
    this.design = next;
    this.clearProposal();
    this.refresh();
    this.save();
    Sfx.tick();
    this.emit(`edit:${kind}`);
  }

  setHour(hour: number): void {
    const next = withHour(this.design, hour);
    if (next.hour === this.design.hour) return;
    this.design = next;
    this.refresh(false);
    Sfx.tick();
  }

  undo(): void {
    const prev = this.history.undo();
    if (!prev) {
      this.toast('Nothing to undo');
      return;
    }
    this.design = withHour(prev, this.design.hour);
    this.clearProposal();
    this.refresh();
    this.save();
    Sfx.dismiss();
    this.toast('Undone');
  }

  reset(): void {
    this.commit(withHour(defaultDesign(), this.design.hour), 'reset');
    this.toast('Back to the first compound');
  }

  cycleMaterial(): void {
    const i = MATERIALS.indexOf(this.design.material);
    const next = MATERIALS[(i + 1) % MATERIALS.length];
    this.commit(setMaterial(this.design, next), 'material');
    const names = { earth: 'thick earth, thatch roof', block: 'sandcrete block, tile roof', zinc: 'zinc sheet' };
    this.toast(`Walls: ${names[next]}`);
  }

  setHeat(on: boolean): void {
    if (this.heatOn === on) return;
    this.heatOn = on;
    this.refresh(false);
    if (on) this.emit('heat');
  }

  toggleCompare(): void {
    if (this.mode !== 'table') return;
    this.compareOn = !this.compareOn;
    this.compare.group.visible = this.compareOn;
    this.hud.visible = !this.compareOn;
    this.handles.setVisible(!this.compareOn);
    if (this.compareOn) this.compare.update(this.before, this.design);
  }

  setRoomHover(room: RoomId, on: boolean): void {
    this.overlay.setHover(room, on);
    this.overlay.update(this.view, this.design, this.now, this.heatOn, this.mode === 'table');
    if (on && this.mode === 'table') {
      const s = this.now.rooms[room];
      this.toast(`${ROOM_LABEL[room]} · ${s.feel.toFixed(0)}°C feel · ${s.breeze} — pinch to step inside`, 1.2);
    }
  }

  enterRoom(room: RoomId): void {
    if (this.compareOn) this.toggleCompare();
    this.menu.close();
    this.shift.enter(room);
  }

  /** Recompute scores and redraw everything that depends on the design. */
  refresh(rebuild = true): void {
    const d = this.design;
    if (rebuild) {
      this.view.rebuild(d);
      this.day = scoreDay(d);
      this.shift?.reseat();
    }
    this.now = scoreDesign(d);
    this.handles?.layout(d);
    this.table.setRotation(d.rotation);
    this.table.setHour(d.hour);
    this.overlay.update(this.view, d, this.now, this.heatOn, this.mode === 'table');
    if (this.mode === 'table') {
      this.view.setRoofOpacity(this.heatOn ? HEAT_ROOF : TABLE_ROOF);
    }
    this.updateSun();
    this.updateBadge();
    if (this.compareOn) this.compare.update(this.before, d);
  }

  private updateBadge(): void {
    if (this.mode === 'inside' && this.room) {
      const s = this.now.rooms[this.room];
      this.badge.setText(
        `${ROOM_LABEL[this.room]} · comfort ${s.comfort}\n${s.feel.toFixed(0)}°C feel · ${s.breeze}`,
      );
      Sfx.wind(s.breeze === 'breezy' ? 1 : s.breeze === 'some air' ? 0.45 : 0.1);
    } else {
      this.badge.setText(
        `Ilé Score  ${this.day.overall}\n${formatHour(this.design.hour)} · right now ${this.now.overall}`,
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
    if (this.elderBusy || this.mode === 'shifting') return;
    if (this.proposal) {
      this.say(this.proposal.say);
      return;
    }
    this.elderBusy = true;
    this.subtitle.mesh.visible = true;
    this.subtitle.setText('The Elder studies your house…');
    const asked = serialize(this.design);
    void askElder(this.design).then((reply) => {
      this.elderBusy = false;
      // The house changed while he was thinking: his advice no longer fits.
      if (serialize(this.design) !== asked) {
        this.subtitle.setText('You changed the house while I was looking. Ask me again.');
        return;
      }
      this.say(reply.say);
      if (reply.actions.length > 0) this.showProposal(reply);
    });
  }

  say(text: string): void {
    this.subtitle.mesh.visible = true;
    this.subtitle.setText(text);
    speak(text);
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
    this.subtitle.setText(
      `${reply.say}\n\u2192 ${reply.actions.map(describeAction).join('  +  ')}`,
    );
    if (!this.onboarding.active) {
      this.setHint('Pinch \u2713 to accept, or swipe your hand to wave it away.');
    }
    this.emit('proposal');
  }

  private clearProposal(): void {
    if (!this.proposal) return;
    this.proposal = null;
    this.ghost.group.visible = false;
    this.accept.mesh.visible = false;
    this.reject.mesh.visible = false;
    if (!this.onboarding.active) this.setHint(FREE_HINT);
  }

  acceptProposal(): void {
    const p = this.proposal;
    if (!p) return;
    const beforeScore = this.day.overall;
    this.history.commit(this.design);
    this.design = applyActions(this.design, p.actions);
    this.clearProposal();
    this.refresh();
    this.save();
    Sfx.chime();
    this.badgePulse = 1;
    const gain = this.day.overall - beforeScore;
    this.toast(`Accepted · Ilé Score ${gain >= 0 ? '+' : ''}${gain}`, 3.5);
    this.emit('accepted');
  }

  rejectProposal(): void {
    if (!this.proposal) return;
    this.clearProposal();
    stopSpeaking();
    Sfx.dismiss();
    this.subtitle.setText('As you wish. It is your house.');
    this.emit('rejected');
  }

  // --------------------------------------------------------------------- ui

  setHint(text: string): void {
    this.hintText = text;
    if (this.toastTime <= 0) this.hint.setText(text);
  }

  toast(text: string, seconds = 2.4): void {
    this.toastTime = seconds;
    this.hint.setText(text);
  }

  onboardingChanged(): void {
    this.skip.mesh.visible = this.onboarding.active;
  }

  private openMenu(at: Vector3, _hand?: Hand): void {
    if (this.mode === 'shifting') return;
    const items: MenuItem[] =
      this.mode === 'inside'
        ? [
            { label: 'Back to\ntable', run: () => this.shift.exit() },
            { label: this.heatOn ? 'Heat\noff' : 'Heat\non', run: () => this.setHeat(!this.heatOn) },
            { label: 'Ask\nElder', run: () => this.askElder() },
            { label: 'Undo', run: () => this.undo() },
          ]
        : [
            { label: this.heatOn ? 'Heat\noff' : 'Heat\non', run: () => this.setHeat(!this.heatOn) },
            { label: 'Ask\nElder', run: () => this.askElder() },
            { label: this.compareOn ? 'Close\ncompare' : 'Compare', run: () => this.toggleCompare() },
            { label: 'Undo', run: () => this.undo() },
            { label: `Walls:\n${this.design.material}`, run: () => this.cycleMaterial() },
            { label: 'Reset', run: () => this.reset() },
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
      return raw ? deserialize(raw) : null;
    } catch {
      return null;
    }
  }

  // ------------------------------------------------------------------- tick

  update(delta: number, _time: number): void {
    const dt = Math.min(delta, 0.1);
    this.clock += dt;

    // Seat the table in front of the user once their head pose is known.
    const inXR = !!this.world.session;
    if (inXR !== this.anchoredInXR && this.mode === 'table') {
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

    this.headPose(_pos, _quat);
    this.table.faceLabels(_pos);
    this.overlay.faceLabels(_pos);

    if (this.toastTime > 0) {
      this.toastTime -= dt;
      if (this.toastTime <= 0) this.hint.setText(this.hintText);
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
