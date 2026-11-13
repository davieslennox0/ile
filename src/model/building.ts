/**
 * Procedural courtyard compound. Turns a `Design` into Three.js meshes in
 * building-local metres: one merged wall mesh, a ring roof, a tintable floor
 * per room, the courtyard and a plinth. Rebuilt whenever the design changes
 * (it is a few hundred boxes — cheap).
 */

import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  Group,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
} from '@iwsdk/core';
import {
  rectCx,
  rectCz,
  rectD,
  rectW,
  rooms,
  slotKey,
  slotSides,
  type Design,
  type Material,
  type Room,
  type RoomId,
  type Side,
} from './state.ts';

interface Box {
  cx: number;
  cy: number;
  cz: number;
  sx: number;
  sy: number;
  sz: number;
}

interface Gap {
  center: number;
  width: number;
  sill: number;
  head: number;
}

/** A doorway between two neighbouring rooms, in building-local metres. */
export interface Doorway {
  a: RoomId;
  b: RoomId;
  x: number;
  z: number;
}

/** Where a toggleable opening sits on its wall, in building-local metres. */
export interface SlotPlacement {
  room: RoomId;
  side: Side;
  x: number;
  y: number;
  z: number;
  width: number;
  height: number;
  /** True when the wall runs along x (north/south walls). */
  alongX: boolean;
  toCourt: boolean;
}

export const WALL_THICKNESS: Record<Material, number> = {
  earth: 0.45,
  block: 0.24,
  zinc: 0.1,
};
const WALL_COLOR: Record<Material, number> = {
  earth: 0xb5693b,
  block: 0xb9b3a6,
  zinc: 0x8d979c,
};
const ROOF_COLOR: Record<Material, number> = {
  earth: 0xb9974f, // thatch
  block: 0x9c5236, // clay tile
  zinc: 0xa9b4ba, // corrugated sheet
};
export const FLOOR_BASE = 0xcaa27a;
const DOOR_HEAD = 2.1;
const INNER_EAVE = 0.5;
export const RIDGE_RISE = 1.2;

const unitBox = new BoxGeometry(1, 1, 1);

function mergeBoxes(boxes: Box[]): BufferGeometry {
  const srcPos = unitBox.getAttribute('position');
  const srcNor = unitBox.getAttribute('normal');
  const srcIdx = unitBox.getIndex();
  const vCount = srcPos.count;
  const iCount = srcIdx ? srcIdx.count : 0;
  const pos = new Float32Array(boxes.length * vCount * 3);
  const nor = new Float32Array(boxes.length * vCount * 3);
  const idx = new Uint32Array(boxes.length * iCount);
  boxes.forEach((b, n) => {
    const vo = n * vCount;
    for (let i = 0; i < vCount; i += 1) {
      pos[(vo + i) * 3] = srcPos.getX(i) * b.sx + b.cx;
      pos[(vo + i) * 3 + 1] = srcPos.getY(i) * b.sy + b.cy;
      pos[(vo + i) * 3 + 2] = srcPos.getZ(i) * b.sz + b.cz;
      nor[(vo + i) * 3] = srcNor.getX(i);
      nor[(vo + i) * 3 + 1] = srcNor.getY(i);
      nor[(vo + i) * 3 + 2] = srcNor.getZ(i);
    }
    if (srcIdx) {
      for (let i = 0; i < iCount; i += 1) idx[n * iCount + i] = srcIdx.getX(i) + vo;
    }
  });
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(pos, 3));
  g.setAttribute('normal', new BufferAttribute(nor, 3));
  g.setIndex(new BufferAttribute(idx, 1));
  return g;
}

/**
 * Emit boxes for one straight wall with gaps cut out of it.
 * `alongX` walls run from `from` to `to` in x at z = `fixed`, and vice versa.
 */
function wallBoxes(
  out: Box[],
  alongX: boolean,
  fixed: number,
  from: number,
  to: number,
  gaps: Gap[],
  thickness: number,
  height: number,
): void {
  const push = (a: number, b: number, y0: number, y1: number) => {
    if (b - a < 0.01 || y1 - y0 < 0.01) return;
    const mid = (a + b) / 2;
    const len = b - a;
    out.push({
      cx: alongX ? mid : fixed,
      cy: (y0 + y1) / 2,
      cz: alongX ? fixed : mid,
      sx: alongX ? len : thickness,
      sy: y1 - y0,
      sz: alongX ? thickness : len,
    });
  };
  let cursor = from;
  for (const g of [...gaps].sort((p, q) => p.center - q.center)) {
    const a = Math.max(from, g.center - g.width / 2);
    const b = Math.min(to, g.center + g.width / 2);
    push(cursor, a, 0, height);
    push(a, b, 0, g.sill);
    push(a, b, Math.min(g.head, height), height);
    cursor = b;
  }
  push(cursor, to, 0, height);
}

function windowGap(center: number, span: number): Gap {
  return { center, width: Math.min(1.6, span * 0.5), sill: 0.9, head: 2.1 };
}
function courtGap(center: number, span: number): Gap {
  return { center, width: Math.min(2.4, span * 0.6), sill: 0, head: 2.3 };
}
function doorGap(center: number): Gap {
  return { center, width: 1.1, sill: 0, head: DOOR_HEAD };
}

/** Fixed internal doorways between neighbouring rooms. */
export function doorways(d: Design): Doorway[] {
  const o = d.outer;
  const c = d.court;
  return [
    { a: 'store', b: 'parlour', x: c.x0, z: (o.z0 + c.z0) / 2 },
    { a: 'parlour', b: 'kitchen', x: c.x1, z: (o.z0 + c.z0) / 2 },
    { a: 'bed4', b: 'gate', x: c.x0, z: (c.z1 + o.z1) / 2 },
    { a: 'gate', b: 'bed3', x: c.x1, z: (c.z1 + o.z1) / 2 },
    { a: 'store', b: 'bed2', x: (o.x0 + c.x0) / 2, z: c.z0 },
    { a: 'kitchen', b: 'bed1', x: (c.x1 + o.x1) / 2, z: c.z0 },
    { a: 'bed2', b: 'bed4', x: (o.x0 + c.x0) / 2, z: c.z1 },
    { a: 'bed1', b: 'bed3', x: (c.x1 + o.x1) / 2, z: c.z1 },
  ];
}

/** Placement of every toggleable opening, for handles and ghost markers. */
export function slotPlacements(d: Design): SlotPlacement[] {
  const out: SlotPlacement[] = [];
  for (const room of rooms(d)) {
    for (const side of slotSides(room)) {
      const toCourt = side === room.courtSide;
      const alongX = side === 'north' || side === 'south';
      const span = alongX ? rectW(room) : rectD(room);
      const gap = toCourt ? courtGap(0, span) : windowGap(0, span);
      const fixed =
        side === 'north'
          ? room.z0
          : side === 'south'
            ? room.z1
            : side === 'east'
              ? room.x1
              : room.x0;
      out.push({
        room: room.id,
        side,
        x: alongX ? rectCx(room) : fixed,
        y: (gap.sill + gap.head) / 2,
        z: alongX ? fixed : rectCz(room),
        width: gap.width,
        height: gap.head - gap.sill,
        alongX,
        toCourt,
      });
    }
  }
  return out;
}

function roofGeometry(d: Design): BufferGeometry {
  const o = d.outer;
  const c = d.court;
  const h = d.wallHeight;
  const eaveY = h - 0.06;
  const ridgeY = h + RIDGE_RISE;
  type P = [number, number, number];
  // Corner order: NW, NE, SE, SW (x0/z0 first, clockwise seen from above).
  const ring = (x0: number, x1: number, z0: number, z1: number, y: number): P[] => [
    [x0, y, z0],
    [x1, y, z0],
    [x1, y, z1],
    [x0, y, z1],
  ];
  const eave = ring(
    o.x0 - d.overhang.west,
    o.x1 + d.overhang.east,
    o.z0 - d.overhang.north,
    o.z1 + d.overhang.south,
    eaveY,
  );
  const ridge = ring(
    (o.x0 + c.x0) / 2,
    (o.x1 + c.x1) / 2,
    (o.z0 + c.z0) / 2,
    (o.z1 + c.z1) / 2,
    ridgeY,
  );
  const ie = Math.min(INNER_EAVE, rectW(c) / 2 - 0.3, rectD(c) / 2 - 0.3);
  const inner = ring(c.x0 + ie, c.x1 - ie, c.z0 + ie, c.z1 - ie, eaveY);
  const verts: number[] = [];
  const quad = (a: P, b: P, c2: P, e: P) => {
    verts.push(...a, ...b, ...c2, ...a, ...c2, ...e);
  };
  for (let i = 0; i < 4; i += 1) {
    const j = (i + 1) % 4;
    quad(eave[i], eave[j], ridge[j], ridge[i]);
    quad(ridge[i], ridge[j], inner[j], inner[i]);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(verts), 3));
  g.computeVertexNormals();
  return g;
}

export interface BuildingViewOptions {
  /** Translucent single-colour preview (the Elder's ghost). */
  ghost?: boolean;
  /** Skip the roof entirely (compare thumbnails show the heat map). */
  noRoof?: boolean;
  shadows?: boolean;
}

export class BuildingView {
  /** Rotates with the design's compass bearing. Children are in metres. */
  readonly group = new Group();
  readonly floors = new Map<RoomId, Mesh<PlaneGeometry, MeshStandardMaterial>>();
  readonly courtFloor: Mesh<PlaneGeometry, MeshStandardMaterial>;
  readonly roofMaterial: MeshStandardMaterial;
  readonly wallMaterial: MeshStandardMaterial;
  private readonly walls: Mesh<BufferGeometry, MeshStandardMaterial>;
  private readonly roof: Mesh<BufferGeometry, MeshStandardMaterial> | null;
  private readonly plinth: Mesh<BoxGeometry, MeshStandardMaterial>;
  private readonly opts: BuildingViewOptions;

  constructor(opts: BuildingViewOptions = {}) {
    this.opts = opts;
    const ghost = !!opts.ghost;
    const shadows = !!opts.shadows && !ghost;
    this.wallMaterial = new MeshStandardMaterial({
      color: ghost ? 0x7fe3ff : WALL_COLOR.earth,
      roughness: 0.95,
      transparent: ghost,
      opacity: ghost ? 0.28 : 1,
      depthWrite: !ghost,
    });
    this.roofMaterial = new MeshStandardMaterial({
      color: ghost ? 0x7fe3ff : ROOF_COLOR.earth,
      roughness: 0.9,
      side: DoubleSide,
      transparent: true,
      opacity: ghost ? 0.34 : 1,
      depthWrite: !ghost,
    });
    this.walls = new Mesh(new BufferGeometry(), this.wallMaterial);
    this.walls.castShadow = shadows;
    this.walls.receiveShadow = shadows;
    this.group.add(this.walls);

    if (opts.noRoof) {
      this.roof = null;
    } else {
      this.roof = new Mesh(new BufferGeometry(), this.roofMaterial);
      this.roof.castShadow = shadows;
      this.roof.renderOrder = 5;
      this.group.add(this.roof);
    }

    this.plinth = new Mesh(
      unitBox,
      new MeshStandardMaterial({ color: 0x8a5a3a, roughness: 1 }),
    );
    this.plinth.receiveShadow = shadows;
    this.plinth.visible = !ghost;
    this.group.add(this.plinth);

    this.courtFloor = new Mesh(
      new PlaneGeometry(1, 1),
      new MeshStandardMaterial({ color: 0xe2c79a, roughness: 1 }),
    );
    this.courtFloor.rotation.x = -Math.PI / 2;
    this.courtFloor.receiveShadow = shadows;
    this.courtFloor.visible = !ghost;
    this.group.add(this.courtFloor);
  }

  rebuild(d: Design): void {
    this.group.rotation.y = (-d.rotation * Math.PI) / 180;
    const o = d.outer;
    const c = d.court;
    const t = WALL_THICKNESS[d.material];
    const h = d.wallHeight;
    const boxes: Box[] = [];
    const open = (room: RoomId, side: Side) => d.openings[slotKey(room, side)];
    const rs = rooms(d);
    const gapsFor = (side: Side, toCourt: boolean): Gap[] =>
      rs
        .filter((r) =>
          toCourt ? r.courtSide === side : r.exterior.includes(side),
        )
        .filter((r) => open(r.id, side))
        .map((r) => {
          const alongX = side === 'north' || side === 'south';
          const center = alongX ? rectCx(r) : rectCz(r);
          const span = alongX ? rectW(r) : rectD(r);
          return toCourt ? courtGap(center, span) : windowGap(center, span);
        });

    // Outer walls.
    wallBoxes(boxes, true, o.z0, o.x0, o.x1, gapsFor('north', false), t, h);
    wallBoxes(boxes, true, o.z1, o.x0, o.x1, gapsFor('south', false), t, h);
    wallBoxes(boxes, false, o.x0, o.z0, o.z1, gapsFor('west', false), t, h);
    wallBoxes(boxes, false, o.x1, o.z0, o.z1, gapsFor('east', false), t, h);
    // Courtyard walls. The parlour's courtyard side is its south, and so on.
    wallBoxes(boxes, true, c.z0, c.x0, c.x1, gapsFor('south', true), t, h);
    wallBoxes(boxes, true, c.z1, c.x0, c.x1, gapsFor('north', true), t, h);
    wallBoxes(boxes, false, c.x0, c.z0, c.z1, gapsFor('east', true), t, h);
    wallBoxes(boxes, false, c.x1, c.z0, c.z1, gapsFor('west', true), t, h);
    // Partitions between rooms, each with a doorway.
    const pt = Math.min(t, 0.25);
    wallBoxes(boxes, false, c.x0, o.z0, c.z0, [doorGap((o.z0 + c.z0) / 2)], pt, h);
    wallBoxes(boxes, false, c.x1, o.z0, c.z0, [doorGap((o.z0 + c.z0) / 2)], pt, h);
    wallBoxes(boxes, false, c.x0, c.z1, o.z1, [doorGap((c.z1 + o.z1) / 2)], pt, h);
    wallBoxes(boxes, false, c.x1, c.z1, o.z1, [doorGap((c.z1 + o.z1) / 2)], pt, h);
    wallBoxes(boxes, true, c.z0, o.x0, c.x0, [doorGap((o.x0 + c.x0) / 2)], pt, h);
    wallBoxes(boxes, true, c.z0, c.x1, o.x1, [doorGap((c.x1 + o.x1) / 2)], pt, h);
    wallBoxes(boxes, true, c.z1, o.x0, c.x0, [doorGap((o.x0 + c.x0) / 2)], pt, h);
    wallBoxes(boxes, true, c.z1, c.x1, o.x1, [doorGap((c.x1 + o.x1) / 2)], pt, h);

    this.walls.geometry.dispose();
    this.walls.geometry = mergeBoxes(boxes);

    if (this.roof) {
      this.roof.geometry.dispose();
      this.roof.geometry = roofGeometry(d);
    }
    if (!this.opts.ghost) {
      this.wallMaterial.color.setHex(WALL_COLOR[d.material]);
      this.roofMaterial.color.setHex(ROOF_COLOR[d.material]);
      this.roofMaterial.metalness = d.material === 'zinc' ? 0.5 : 0;
      this.roofMaterial.roughness = d.material === 'zinc' ? 0.45 : 0.9;
    }

    const m = 0.5;
    this.plinth.scale.set(rectW(o) + m * 2, 0.24, rectD(o) + m * 2);
    this.plinth.position.set(rectCx(o), -0.12, rectCz(o));
    this.courtFloor.scale.set(rectW(c), rectD(c), 1);
    this.courtFloor.position.set(rectCx(c), 0.012, rectCz(c));

    for (const room of rs) this.placeFloor(room);
  }

  private placeFloor(room: Room): void {
    let floor = this.floors.get(room.id);
    if (!floor) {
      floor = new Mesh(
        new PlaneGeometry(1, 1),
        new MeshStandardMaterial({
          color: FLOOR_BASE,
          roughness: 1,
          transparent: !!this.opts.ghost,
          opacity: this.opts.ghost ? 0 : 1,
        }),
      );
      floor.rotation.x = -Math.PI / 2;
      floor.receiveShadow = !!this.opts.shadows && !this.opts.ghost;
      floor.visible = !this.opts.ghost;
      floor.userData.room = room.id;
      this.floors.set(room.id, floor);
      this.group.add(floor);
    }
    floor.scale.set(rectW(room), rectD(room), 1);
    floor.position.set(rectCx(room), 0.02, rectCz(room));
  }

  /** Tint a room floor (heat overlay) or restore the bare earth colour. */
  setFloorColor(room: RoomId, color: Color | null, glow = 0): void {
    const floor = this.floors.get(room);
    if (!floor) return;
    if (color) {
      floor.material.color.copy(color);
      floor.material.emissive.copy(color);
      floor.material.emissiveIntensity = glow;
    } else {
      floor.material.color.setHex(FLOOR_BASE);
      floor.material.emissive.setHex(0x000000);
      floor.material.emissiveIntensity = 0;
    }
  }

  /** Roof opacity: translucent on the table, solid when you sit inside. */
  setRoofOpacity(opacity: number): void {
    if (!this.roof || this.opts.ghost) return;
    this.roofMaterial.opacity = opacity;
    this.roofMaterial.depthWrite = opacity > 0.95;
    this.roof.visible = opacity > 0.02;
  }

  dispose(): void {
    this.walls.geometry.dispose();
    this.roof?.geometry.dispose();
    this.wallMaterial.dispose();
    this.roofMaterial.dispose();
    for (const f of this.floors.values()) {
      f.geometry.dispose();
      f.material.dispose();
    }
  }
}
