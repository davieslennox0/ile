/**
 * Sculpting handles: the small glowing grips on the miniature that hands
 * pinch and pull. Each one maps a gesture onto the design, snapped to the
 * grid by the state model.
 *
 *   empty plot            pinch + drag            lay a room footprint
 *   enclosed empty middle pinch, or two-hand      mark it as the courtyard
 *                         spread
 *   wall-line grip        pinch + drag            move that wall (and every
 *                                                 room edge that shares it)
 *   spire                 pinch + pull up/down    raise walls / wall height
 *   eave grip (per side)  pinch + twist or drag   roof overhang depth
 *   courtyard             two-hand spread, or     courtyard size
 *                         drag the corner grip
 *   ring knob             pinch + drag around     orientation (15° snaps)
 *   wall panels           pinch                   cut / close a window or door
 *   sun                   pinch + drag on its arc time of day
 *   room floor            point + pinch           step inside (ScaleShift)
 */

import {
  BoxGeometry,
  ConeGeometry,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  SphereGeometry,
  Vector3,
} from '@iwsdk/core';
import type { App } from '../app.ts';
import { doorways, slotPlacements, type SlotPlacement } from '../model/building.ts';
import {
  LIMITS,
  SIDES,
  SIDE_NORMAL,
  addRoom,
  bounds,
  edgeCoord,
  enclosedGap,
  fitRoom,
  isOpen,
  lines,
  moveLine,
  rectArea,
  rectCx,
  rectCz,
  rectD,
  rectW,
  rooms,
  setCourt,
  setCourtSize,
  setOpening,
  setOverhang,
  setRotation,
  setWallHeight,
  type Axis,
  type Design,
  type Rect,
  type RoomId,
  type Side,
} from '../model/state.ts';
import { KNOB_RADIUS, sunPoint } from '../scene/table.ts';
import type { DragInfo, Target } from './gestures.ts';

const LINE_POOL = 28;
const SLOT_POOL = 72;
const DOOR_POOL = 6;

const knobGeo = new SphereGeometry(1, 18, 12);
const unitBox = new BoxGeometry(1, 1, 1);
const _a = new Vector3();
const _b = new Vector3();

type Knob = Mesh<SphereGeometry, MeshStandardMaterial>;

function knob(color: number, radius: number): Knob {
  const m = new Mesh(
    knobGeo,
    new MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.3, roughness: 0.45 }),
  );
  m.scale.setScalar(radius);
  m.userData.baseScale = radius;
  return m;
}

/** Standard hover feedback: swell and brighten. */
function hoverFx(mesh: Mesh) {
  return (on: boolean) => {
    const base = mesh.userData.baseScale as number | undefined;
    if (base !== undefined) mesh.scale.setScalar(base * (on ? 1.45 : 1));
    const mat = mesh.material as MeshStandardMaterial | MeshBasicMaterial;
    if ('emissiveIntensity' in mat) mat.emissiveIntensity = on ? 1 : 0.3;
  };
}

export class Handles {
  /** Wall-line grips; `lineGrips[0]` is what the tutorial points at. */
  readonly lineGrips: Knob[] = [];
  readonly spire: Mesh<ConeGeometry, MeshStandardMaterial>;
  readonly eave = {} as Record<Side, Knob>;
  private readonly corner: Knob;
  private readonly slots: Mesh<BoxGeometry, MeshBasicMaterial>[] = [];
  private readonly doors: Knob[] = [];
  private readonly rect: Mesh<BoxGeometry, MeshBasicMaterial>;
  private readonly roomTargets = new Map<RoomId, Target>();
  private readonly app: App;
  private start: Design;
  private hoveredSlot = -1;
  private visible = true;
  private laying: Rect | null = null;

  constructor(app: App) {
    this.app = app;
    this.start = app.design;
    const g = app.view.group;
    const table = () => app.mode === 'table' && !app.compareOn;
    const shown = (m: Mesh) => () => table() && m.visible;

    // Wall-line grips.
    for (let i = 0; i < LINE_POOL; i += 1) {
      const w = knob(0xff8a3c, 0.5);
      w.visible = false;
      this.lineGrips.push(w);
      g.add(w);
      app.gestures.add({
        id: `line-${i}`,
        object: w,
        radius: 1.1,
        enabled: shown(w),
        onHover: hoverFx(w),
        onDragStart: () => this.begin(),
        onDrag: (info) => {
          const axis = w.userData.axis as Axis;
          const c = w.userData.c as number;
          const d = this.localDelta(info);
          app.preview(moveLine(this.start, axis, c, c + (axis === 'x' ? d.x : d.z)));
        },
        onDragEnd: () => app.endEdit('wall'),
      });
    }

    // Eave grips: twist the wrist (or drag outward) to deepen the overhang.
    for (const side of SIDES) {
      const e = knob(0xf2c14e, 0.42);
      this.eave[side] = e;
      g.add(e);
      app.gestures.add({
        id: `eave-${side}`,
        object: e,
        radius: 1.5,
        enabled: shown(e),
        onHover: hoverFx(e),
        onDragStart: () => this.begin(),
        onDrag: (info) => {
          const n = SIDE_NORMAL[side];
          const d = this.localDelta(info);
          const pull = d.x * n.x + d.z * n.z;
          const twist = info.twist / (Math.PI / 2); // quarter turn = 1 m
          app.preview(setOverhang(this.start, side, this.start.overhang[side] + pull + twist));
        },
        onDragEnd: () => app.endEdit('eave'),
      });
    }

    // Spire: pull up to raise the walls from the floor, or change their height.
    this.spire = new Mesh(
      new ConeGeometry(0.45, 1.3, 12),
      new MeshStandardMaterial({ color: 0xf7ead0, emissive: 0xf7ead0, emissiveIntensity: 0.3 }),
    );
    g.add(this.spire);
    app.gestures.add({
      id: 'height',
      object: this.spire,
      radius: 1.7,
      enabled: shown(this.spire),
      onHover: hoverFx(this.spire),
      onDragStart: () => this.begin(),
      onDrag: (info) => {
        const up = this.localDelta(info).y;
        const h0 = this.start.wallHeight;
        // From bare footprints, a real pull stands the walls up.
        const target = h0 > 0 ? h0 + up : up > 0.5 ? LIMITS.wallHeight.min + (up - 0.5) : 0;
        app.preview(setWallHeight(this.start, target));
      },
      onDragEnd: () => app.endEdit('height'),
    });

    // Courtyard: corner grip for one hand…
    this.corner = knob(0x4fc3c9, 0.48);
    g.add(this.corner);
    const courtDrag = (info: DragInfo) => {
      const court = this.start.court;
      if (!court) return;
      const w0 = rectW(court);
      const d0 = rectD(court);
      if (info.twoHands) {
        app.preview(setCourtSize(this.start, w0 * info.spread, d0 * info.spread));
      } else {
        const d = this.localDelta(info);
        app.preview(setCourtSize(this.start, w0 + 2 * d.x, d0 + 2 * d.z));
      }
    };
    app.gestures.add({
      id: 'court-corner',
      object: this.corner,
      radius: 1.6,
      enabled: shown(this.corner),
      onHover: hoverFx(this.corner),
      onDragStart: () => this.begin(),
      onDrag: courtDrag,
      onDragEnd: () => app.endEdit('court'),
    });
    // …and the courtyard floor itself for a two-hand spread.
    app.gestures.add({
      id: 'court-floor',
      object: app.view.courtFloor,
      radius: 1,
      surface: true,
      flat: true,
      enabled: () => table() && app.view.courtFloor.visible,
      onHover: (on) => {
        app.view.courtFloor.material.emissive.setHex(on ? 0x4fc3c9 : 0x000000);
        app.view.courtFloor.material.emissiveIntensity = on ? 0.35 : 0;
      },
      onDragStart: () => this.begin(),
      onDrag: (info) => {
        if (info.twoHands) courtDrag(info);
      },
      onDragEnd: () => app.endEdit('court'),
    });

    // The plot itself: drag out rooms; mark the enclosed middle as courtyard.
    this.rect = new Mesh(
      unitBox,
      new MeshBasicMaterial({ color: 0xffd45a, transparent: true, opacity: 0.55, depthWrite: false }),
    );
    this.rect.visible = false;
    this.rect.renderOrder = 7;
    g.add(this.rect);
    app.gestures.add({
      id: 'plot',
      object: app.table.plot,
      radius: 1,
      surface: true,
      flat: true,
      enabled: table,
      onDragStart: () => {
        this.begin();
        this.laying = null;
      },
      onDrag: (info) => {
        this.lastGrab.copy(info.grab);
        const p0 = this.local(info.grab);
        if (info.twoHands) {
          // Two hands spreading over the open middle: that is the courtyard.
          this.showRect(null);
          const gap = enclosedGap(this.start, p0.x, p0.z);
          if (gap && info.spread > 1.2 && !this.start.court) app.preview(setCourt(this.start, gap));
          return;
        }
        const d = this.localDelta(info);
        // The room butts up against its neighbours rather than overlapping.
        this.laying = fitRoom(this.start, p0, { x: p0.x + d.x, z: p0.z + d.z });
        this.showRect(this.laying);
      },
      onDragEnd: () => {
        const rect = this.laying;
        this.laying = null;
        this.showRect(null);
        if (app.design !== this.start) {
          app.endEdit('court'); // a two-hand spread already marked it
          return;
        }
        app.endEdit('none');
        if (rect) {
          const next = addRoom(app.design, rect);
          if (next) app.commit(next, 'room');
          return;
        }
        // A plain pinch on the enclosed middle marks the courtyard.
        const p = this.local(this.lastGrab);
        const gap = app.design.court ? null : enclosedGap(app.design, p.x, p.z);
        if (gap) app.commit(setCourt(app.design, gap), 'court');
      },
    });
    // Orientation knob on the plot ring.
    const k = app.table.knob;
    k.userData.baseScale = 1;
    app.gestures.add({
      id: 'rotate',
      object: k,
      radius: 1.8,
      enabled: shown(k),
      onHover: hoverFx(k),
      onDragStart: () => this.begin(),
      onDrag: (info) => {
        const site = app.table.site;
        const p0 = site.worldToLocal(_a.copy(info.start));
        const p1 = site.worldToLocal(_b.copy(info.position));
        // Anchor the bearing to the knob so the turn follows the hand.
        const t0 = (this.start.rotation * Math.PI) / 180;
        const kx = Math.sin(t0) * KNOB_RADIUS + (p1.x - p0.x);
        const kz = -Math.cos(t0) * KNOB_RADIUS + (p1.z - p0.z);
        const bearing = (Math.atan2(kx, -kz) * 180) / Math.PI;
        app.preview(setRotation(this.start, bearing - (info.twist * 180) / Math.PI));
      },
      onDragEnd: () => app.endEdit('rotate'),
    });

    // Wall panels: pinch to cut or close an opening.
    for (let i = 0; i < SLOT_POOL; i += 1) {
      const m = new Mesh(
        unitBox,
        new MeshBasicMaterial({ color: 0x8fd3ff, transparent: true, opacity: 0.4, depthWrite: false }),
      );
      m.renderOrder = 6;
      m.visible = false;
      this.slots.push(m);
      g.add(m);
      app.gestures.add({
        id: `slot-${i}`,
        object: m,
        radius: 0.75,
        surface: true,
        near: true,
        enabled: shown(m),
        onHover: (on) => {
          this.hoveredSlot = on ? i : this.hoveredSlot === i ? -1 : this.hoveredSlot;
          this.paintSlots(app.design);
        },
        onClick: () => {
          const s = m.userData.slot as SlotPlacement | undefined;
          if (!s) return;
          const room = rooms(app.design).find((r) => r.id === s.room);
          if (!room) return;
          app.commit(setOpening(app.design, s.room, s.side, !isOpen(app.design, room, s.side)), 'opening');
        },
      });
    }

    // Sun: drag along the arc to change the hour.
    const sun = app.table.sunBall;
    const sunStart = new Vector3();
    const probe = new Vector3();
    app.gestures.add({
      id: 'sun',
      object: sun,
      radius: 1.9,
      enabled: () => app.mode === 'table',
      onHover: (on) => sun.scale.setScalar(on ? 1.4 : 1),
      onDragStart: () => {
        sunPoint(app.design.hour, sunStart);
      },
      onDrag: (info) => {
        // The hand moves freely; the sun follows the nearest point of its arc.
        const site = app.table.site;
        const want = site
          .worldToLocal(_a.copy(info.position))
          .sub(site.worldToLocal(_b.copy(info.start)))
          .add(sunStart);
        let best = app.design.hour;
        let bestD = Infinity;
        for (let h = LIMITS.hour.min; h <= LIMITS.hour.max + 1e-6; h += LIMITS.hour.step) {
          const dist = sunPoint(h, probe).distanceToSquared(want);
          if (dist < bestD) {
            bestD = dist;
            best = h;
          }
        }
        app.setHour(best);
      },
    });

    // Doorway lights: at full scale, pinch one to walk into the next room.
    for (let n = 0; n < DOOR_POOL; n += 1) {
      const d = knob(0xffe2a0, 0.16);
      d.visible = false;
      this.doors.push(d);
      g.add(d);
      app.gestures.add({
        id: `door-${n}`,
        object: d,
        radius: 2.6,
        enabled: () => d.visible && app.mode === 'inside',
        onHover: hoverFx(d),
        onClick: () => {
          const to = d.userData.to as RoomId | undefined;
          if (to) app.shift.hop(to);
        },
      });
    }
  }

  private readonly lastGrab = new Vector3();

  private begin(): void {
    this.start = this.app.design;
    this.app.beginEdit();
  }

  /** A world point in building-local metres. */
  private local(world: Vector3): Vector3 {
    const g = this.app.view.group;
    g.updateWorldMatrix(true, false);
    return g.worldToLocal(new Vector3().copy(world));
  }

  /** Hand movement since the grab, in building-local metres. */
  private localDelta(info: DragInfo): Vector3 {
    const g = this.app.view.group;
    g.updateWorldMatrix(true, false);
    const p0 = g.worldToLocal(_a.copy(info.start));
    const p1 = g.worldToLocal(_b.copy(info.position));
    return p1.sub(p0);
  }

  private showRect(r: Rect | null): void {
    this.rect.visible = !!r && rectW(r) > 0 && rectD(r) > 0;
    if (!r) return;
    this.rect.scale.set(Math.max(0.1, rectW(r)), 0.12, Math.max(0.1, rectD(r)));
    this.rect.position.set(rectCx(r), 0.08, rectCz(r));
  }

  /** Reposition every handle after the design changed. */
  layout(d: Design): void {
    const h = d.wallHeight;
    const built = d.rooms.length > 0;
    const on = this.visible;

    // Wall-line grips: one per shared wall line.
    const all = lines(d);
    this.lineGrips.forEach((grip, i) => {
      const line = all[i];
      grip.visible = on && !!line;
      if (!line) return;
      const mid = (line.from + line.to) / 2;
      grip.userData.axis = line.axis;
      grip.userData.c = line.c;
      grip.position.set(line.axis === 'x' ? line.c : mid, Math.max(0.6, h * 0.45), line.axis === 'x' ? mid : line.c);
    });

    const b = bounds(d);
    const roofed = d.roof && h > 0;
    for (const side of SIDES) {
      const n = SIDE_NORMAL[side];
      const alongX = side === 'north' || side === 'south';
      const edge = edgeCoord(b, side);
      const reach = d.overhang[side] + 0.35;
      const slide = (alongX ? rectW(b) : rectD(b)) * 0.3;
      this.eave[side].visible = on && roofed;
      this.eave[side].position.set(
        alongX ? rectCx(b) + slide : edge + n.x * reach,
        h + 0.1,
        alongX ? edge + n.z * reach : rectCz(b) + slide,
      );
    }

    // The spire stands over the largest room.
    const big = d.rooms.reduce<Rect | null>((p, r) => (!p || rectArea(r) > rectArea(p) ? r : p), null);
    this.spire.visible = on && built;
    if (big) this.spire.position.set(rectCx(big), h + (roofed ? 2.6 : 1.4), rectCz(big));

    this.corner.visible = on && !!d.court;
    if (d.court) this.corner.position.set(d.court.x1, 0.7, d.court.z1);
    this.app.table.knob.visible = built;

    const places = h > 0 ? slotPlacements(d) : [];
    this.slots.forEach((m, i) => {
      const s = places[i];
      m.visible = on && !!s;
      m.userData.slot = s;
      if (!s) return;
      m.position.set(s.x, s.y, s.z);
      m.scale.set(s.alongX ? s.width : 0.7, s.height, s.alongX ? 0.7 : s.width);
    });
    this.paintSlots(d);
    this.syncRooms();
  }

  /** Keep one "step inside" target per room floor. */
  private syncRooms(): void {
    const app = this.app;
    for (const [id, target] of this.roomTargets) {
      if (app.view.floors.has(id)) continue;
      app.gestures.remove(target);
      this.roomTargets.delete(id);
    }
    for (const [id, floor] of app.view.floors) {
      if (this.roomTargets.has(id)) continue;
      this.roomTargets.set(
        id,
        app.gestures.add({
          id: `room-${id}`,
          object: floor,
          radius: 1,
          surface: true,
          flat: true,
          enabled: () => app.mode === 'table' && !app.compareOn,
          onHover: (on) => app.setRoomHover(id, on),
          onClick: () => app.enterRoom(id),
        }),
      );
    }
  }

  private paintSlots(d: Design): void {
    const rs = rooms(d);
    this.slots.forEach((m, i) => {
      const s = m.userData.slot as SlotPlacement | undefined;
      if (!s || !m.visible) return;
      const room = rs.find((r) => r.id === s.room);
      const open = !!room && isOpen(d, room, s.side);
      const hot = this.hoveredSlot === i;
      m.material.color.setHex(open ? 0x8fd3ff : 0x3a2415);
      m.material.opacity = hot ? 0.85 : open ? 0.38 : 0.3;
    });
  }

  /** Show or hide all sculpting grips (hidden at full scale and in compare). */
  setVisible(on: boolean): void {
    this.visible = on;
    this.layout(this.app.design);
  }

  /** Light up the doorways of the room the user is sitting in. */
  showDoors(room: RoomId | null): void {
    const list = room ? doorways(this.app.design, room) : [];
    this.doors.forEach((m, i) => {
      const d = list[i];
      m.visible = !!d;
      if (d) {
        m.position.set(d.x, 1.15, d.z);
        m.userData.to = d.to;
      }
    });
  }
}
