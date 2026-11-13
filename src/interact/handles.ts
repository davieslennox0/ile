/**
 * Sculpting handles: the small glowing grips on the miniature that hands
 * pinch and pull. Each one maps a gesture onto one design parameter, snapped
 * to the grid by the state model.
 *
 *   wall grip (per side)   pinch + drag            push / pull the outer wall
 *   roof spire             pinch + pull up/down    wall height
 *   eave grip (per side)   pinch + twist or drag   roof overhang depth
 *   courtyard              two-hand spread, or     courtyard size
 *                          drag the corner grip
 *   ring knob              pinch + drag around     orientation (15° snaps)
 *   opening panels         pinch                   toggle window / doorway
 *   sun                    pinch + drag on its arc time of day
 *   room floor             point + pinch           step inside (ScaleShift)
 */

import {
  BoxGeometry,
  ConeGeometry,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  SphereGeometry,
  Vector3,
} from '@iwsdk/core';
import type { App } from '../app.ts';
import { slotPlacements } from '../model/building.ts';
import {
  LIMITS,
  ROOM_IDS,
  SIDES,
  SIDE_NORMAL,
  outerWallValue,
  rectCx,
  rectCz,
  rectD,
  rectW,
  setCourtSize,
  setOpening,
  setOuterWall,
  setOverhang,
  setRotation,
  setWallHeight,
  slotKey,
  type Design,
  type Side,
} from '../model/state.ts';
import { sunPoint } from '../scene/table.ts';
import type { DragInfo } from './gestures.ts';

const knobGeo = new SphereGeometry(1, 18, 12);
const _a = new Vector3();
const _b = new Vector3();

function knob(color: number, radius: number): Mesh<SphereGeometry, MeshStandardMaterial> {
  const m = new Mesh(
    knobGeo,
    new MeshStandardMaterial({
      color,
      emissive: color,
      emissiveIntensity: 0.3,
      roughness: 0.45,
    }),
  );
  m.scale.setScalar(radius);
  m.userData.baseScale = radius;
  return m;
}

/** Standard hover feedback: swell and brighten. */
function hoverFx(mesh: Mesh) {
  return (on: boolean) => {
    const base = (mesh.userData.baseScale as number | undefined) ?? 1;
    if (mesh.userData.baseScale !== undefined) mesh.scale.setScalar(base * (on ? 1.45 : 1));
    const mat = mesh.material as MeshStandardMaterial | MeshBasicMaterial;
    if ('emissiveIntensity' in mat) mat.emissiveIntensity = on ? 1 : 0.3;
  };
}

export class Handles {
  readonly wall = {} as Record<Side, Mesh<SphereGeometry, MeshStandardMaterial>>;
  private readonly eave = {} as Record<Side, Mesh<SphereGeometry, MeshStandardMaterial>>;
  private readonly spire: Mesh<ConeGeometry, MeshStandardMaterial>;
  private readonly corner: Mesh<SphereGeometry, MeshStandardMaterial>;
  private readonly slots = new Map<string, Mesh<BoxGeometry, MeshBasicMaterial>>();
  private readonly doors: Mesh<SphereGeometry, MeshStandardMaterial>[] = [];
  private readonly app: App;
  private start: Design;
  private hoveredSlot: string | null = null;

  constructor(app: App) {
    this.app = app;
    this.start = app.design;
    const g = app.view.group;
    const table = () => app.mode === 'table' && !app.compareOn;

    for (const side of SIDES) {
      // Wall grips.
      const w = knob(0xff8a3c, 0.55);
      this.wall[side] = w;
      g.add(w);
      app.gestures.add({
        id: `wall-${side}`,
        object: w,
        radius: 1.7,
        enabled: table,
        onHover: hoverFx(w),
        onDragStart: () => this.begin(),
        onDrag: (i) => {
          const n = SIDE_NORMAL[side];
          const d = this.localDelta(i);
          const along = d.x * n.x + d.z * n.z;
          // Outer coordinate grows along +x / +z, so flip for west and north.
          const sign = side === 'east' || side === 'south' ? 1 : -1;
          app.preview(
            setOuterWall(this.start, side, outerWallValue(this.start, side) + sign * along),
          );
        },
        onDragEnd: () => app.endEdit('wall'),
      });

      // Eave grips: twist the wrist (or drag outward) to deepen the overhang.
      const e = knob(0xf2c14e, 0.42);
      this.eave[side] = e;
      g.add(e);
      app.gestures.add({
        id: `eave-${side}`,
        object: e,
        radius: 1.5,
        enabled: table,
        onHover: hoverFx(e),
        onDragStart: () => this.begin(),
        onDrag: (i) => {
          const n = SIDE_NORMAL[side];
          const d = this.localDelta(i);
          const pull = d.x * n.x + d.z * n.z;
          const twist = Math.abs(i.twist) / (Math.PI / 2); // quarter turn = 1 m
          const twistSigned = i.twist >= 0 ? twist : -twist;
          app.preview(
            setOverhang(this.start, side, this.start.overhang[side] + pull + twistSigned),
          );
        },
        onDragEnd: () => app.endEdit('eave'),
      });
    }

    // Roof spire: pull up or down for wall height.
    this.spire = new Mesh(
      new ConeGeometry(0.45, 1.3, 12),
      new MeshStandardMaterial({
        color: 0xf7ead0,
        emissive: 0xf7ead0,
        emissiveIntensity: 0.3,
      }),
    );
    g.add(this.spire);
    app.gestures.add({
      id: 'height',
      object: this.spire,
      radius: 1.6,
      enabled: table,
      onHover: hoverFx(this.spire),
      onDragStart: () => this.begin(),
      onDrag: (i) =>
        app.preview(setWallHeight(this.start, this.start.wallHeight + this.localDelta(i).y)),
      onDragEnd: () => app.endEdit('height'),
    });

    // Courtyard: corner grip for one hand…
    this.corner = knob(0x4fc3c9, 0.48);
    g.add(this.corner);
    const courtDrag = (i: DragInfo) => {
      const w0 = rectW(this.start.court);
      const d0 = rectD(this.start.court);
      if (i.twoHands) {
        app.preview(setCourtSize(this.start, w0 * i.spread, d0 * i.spread));
      } else {
        const d = this.localDelta(i);
        app.preview(setCourtSize(this.start, w0 + 2 * d.x, d0 + 2 * d.z));
      }
    };
    app.gestures.add({
      id: 'court-corner',
      object: this.corner,
      radius: 1.6,
      enabled: table,
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
      enabled: table,
      onHover: (on) => {
        app.view.courtFloor.material.emissive.setHex(on ? 0x4fc3c9 : 0x000000);
        app.view.courtFloor.material.emissiveIntensity = on ? 0.35 : 0;
      },
      onDragStart: () => this.begin(),
      onDrag: (i) => {
        if (i.twoHands) courtDrag(i);
      },
      onDragEnd: () => app.endEdit('court'),
    });

    // Orientation knob on the plot ring.
    const k = app.table.knob;
    k.userData.baseScale = 1;
    app.gestures.add({
      id: 'rotate',
      object: k,
      radius: 1.8,
      enabled: table,
      onHover: hoverFx(k),
      onDragStart: () => this.begin(),
      onDrag: (i) => {
        const site = app.table.site;
        const p0 = site.worldToLocal(_a.copy(i.start));
        const p1 = site.worldToLocal(_b.copy(i.position));
        // Anchor the bearing to the knob so the turn follows the hand.
        const t0 = (this.start.rotation * Math.PI) / 180;
        const kx = Math.sin(t0) * 12.2 + (p1.x - p0.x);
        const kz = -Math.cos(t0) * 12.2 + (p1.z - p0.z);
        const bearing = (Math.atan2(kx, -kz) * 180) / Math.PI;
        const twistDeg = (i.twist * 180) / Math.PI;
        app.preview(setRotation(this.start, bearing - twistDeg));
      },
      onDragEnd: () => app.endEdit('rotate'),
    });

    // Opening panels: pinch to toggle.
    const slotGeo = new BoxGeometry(1, 1, 1);
    for (const s of slotPlacements(app.design)) {
      const key = slotKey(s.room, s.side);
      const m = new Mesh(
        slotGeo,
        new MeshBasicMaterial({ color: 0x8fd3ff, transparent: true, opacity: 0.4, depthWrite: false }),
      );
      m.renderOrder = 6;
      this.slots.set(key, m);
      g.add(m);
      app.gestures.add({
        id: `slot-${key}`,
        object: m,
        radius: 0.75,
        enabled: table,
        onHover: (on) => {
          this.hoveredSlot = on ? key : this.hoveredSlot === key ? null : this.hoveredSlot;
          this.paintSlots(app.design);
        },
        onClick: () => {
          const next = setOpening(app.design, s.room, s.side, !app.design.openings[key]);
          app.commit(next, 'opening');
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
      onDrag: (i) => {
        // The hand moves freely; the sun follows the nearest point of its arc.
        const site = app.table.site;
        const want = site
          .worldToLocal(_a.copy(i.position))
          .sub(site.worldToLocal(_b.copy(i.start)))
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

    // Room floors: point + pinch to step inside.
    for (const id of ROOM_IDS) {
      const floor = app.view.floors.get(id);
      if (!floor) continue;
      app.gestures.add({
        id: `room-${id}`,
        object: floor,
        radius: 1,
        surface: true,
        enabled: table,
        onHover: (on) => app.setRoomHover(id, on),
        onClick: () => app.enterRoom(id),
      });
    }

    // Doorway lights: at full scale, pinch one to walk into the next room.
    for (let n = 0; n < 8; n += 1) {
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
          const to = d.userData.to as (typeof ROOM_IDS)[number] | undefined;
          if (to) app.shift.hop(to);
        },
      });
    }
  }

  private begin(): void {
    this.start = this.app.design;
    this.app.beginEdit();
  }

  /** Hand movement since the grab, in building-local metres. */
  private localDelta(i: DragInfo): Vector3 {
    const g = this.app.view.group;
    g.updateWorldMatrix(true, false);
    const p0 = g.worldToLocal(_a.copy(i.start));
    const p1 = g.worldToLocal(_b.copy(i.position));
    return p1.sub(p0);
  }

  /** Reposition every handle after the design changed. */
  layout(d: Design): void {
    const o = d.outer;
    const c = d.court;
    const h = d.wallHeight;
    const mid = { x: rectCx(o), z: rectCz(o) };
    for (const side of SIDES) {
      const n = SIDE_NORMAL[side];
      const edge = outerWallValue(d, side);
      const alongX = side === 'north' || side === 'south';
      const wx = alongX ? mid.x : edge + n.x * 0.9;
      const wz = alongX ? edge + n.z * 0.9 : mid.z;
      this.wall[side].position.set(wx, h * 0.45, wz);
      const reach = d.overhang[side] + 0.35;
      // Offset eave grips along the wall so they never hide the wall grip.
      const slide = alongX ? rectW(o) * 0.28 : rectD(o) * 0.28;
      this.eave[side].position.set(
        alongX ? mid.x + slide : edge + n.x * reach,
        h + 0.1,
        alongX ? edge + n.z * reach : mid.z + slide,
      );
    }
    this.spire.position.set(rectCx(c), h + 2.4, (o.z0 + c.z0) / 2);
    this.corner.position.set(c.x1, 0.7, c.z1);

    for (const s of slotPlacements(d)) {
      const m = this.slots.get(slotKey(s.room, s.side));
      if (!m) continue;
      m.position.set(s.x, s.y, s.z);
      m.scale.set(s.alongX ? s.width : 0.7, s.height, s.alongX ? 0.7 : s.width);
    }
    this.paintSlots(d);
  }

  private paintSlots(d: Design): void {
    for (const [key, m] of this.slots) {
      const open = d.openings[key];
      const hot = this.hoveredSlot === key;
      m.material.color.setHex(open ? 0x8fd3ff : 0x3a2415);
      m.material.opacity = hot ? 0.85 : open ? 0.38 : 0.3;
    }
  }

  /** Show or hide all sculpting grips (hidden at full scale and in compare). */
  setVisible(on: boolean): void {
    const set = (o: Object3D) => {
      o.visible = on;
    };
    SIDES.forEach((s) => {
      set(this.wall[s]);
      set(this.eave[s]);
    });
    set(this.spire);
    set(this.corner);
    this.slots.forEach(set);
  }

  /** Light up the doorways of the room the user is sitting in. */
  showDoors(doors: { x: number; z: number; to: string }[]): void {
    this.doors.forEach((m, i) => {
      const d = doors[i];
      m.visible = !!d;
      if (d) {
        m.position.set(d.x, 1.15, d.z);
        m.userData.to = d.to;
      }
    });
  }
}
