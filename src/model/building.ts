/**
 * Procedural house. Turns a `Design` into Three.js meshes in building-local
 * metres: one merged wall mesh (built per wall line, so shared walls are drawn
 * once), a hipped roof per room, a tintable floor per room, the courtyard and
 * plinths. Rebuilt whenever the design changes — a few hundred boxes, cheap.
 */

import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  Group,
  Mesh,
  MeshLambertMaterial,
  PlaneGeometry,
} from '@iwsdk/core';
import {
  SIDES,
  edgeCoord,
  isOpen,
  rectCx,
  rectCz,
  rectD,
  rectW,
  rooms,
  type Design,
  type Material,
  type Room,
  type RoomId,
  type Side,
  type SideType,
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

/** A doorway from one room into a neighbour, in building-local metres. */
export interface Doorway {
  to: RoomId;
  x: number;
  z: number;
}

/** Where a toggleable opening sits on its wall, in building-local metres. */
export interface SlotPlacement {
  room: RoomId;
  side: Side;
  type: SideType;
  x: number;
  y: number;
  z: number;
  width: number;
  height: number;
  /** True when the wall runs along x (north/south walls). */
  alongX: boolean;
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
/** Height of the kerb that marks a footprint before walls are raised. */
const KERB = 0.14;
const COURT_EAVE = 0.5;

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
    const a = Math.max(cursor, g.center - g.width / 2);
    const b = Math.min(to, g.center + g.width / 2);
    if (b <= a) continue;
    push(cursor, a, 0, height);
    push(a, b, 0, Math.min(g.sill, height));
    push(a, b, Math.min(g.head, height), height);
    cursor = b;
  }
  push(cursor, to, 0, height);
}

function gapFor(type: SideType, center: number, span: number): Gap {
  if (type === 'exterior') return { center, width: Math.min(1.6, span * 0.5), sill: 0.9, head: 2.1 };
  if (type === 'court') return { center, width: Math.min(2.4, span * 0.6), sill: 0, head: 2.3 };
  return { center, width: Math.min(1.1, span * 0.7), sill: 0, head: 2.1 };
}

/** Doorways out of a room into its neighbours (open doors only). */
export function doorways(d: Design, from: RoomId): Doorway[] {
  const room = rooms(d).find((r) => r.id === from);
  if (!room) return [];
  const out: Doorway[] = [];
  for (const side of SIDES) {
    const info = room.sides[side];
    if (info.type !== 'room' || !info.neighbour || !isOpen(d, room, side)) continue;
    const alongX = side === 'north' || side === 'south';
    const c = edgeCoord(room, side);
    out.push({ to: info.neighbour, x: alongX ? info.center : c, z: alongX ? c : info.center });
  }
  return out;
}

/** Placement of every toggleable opening, for handles and ghost markers. */
export function slotPlacements(d: Design): SlotPlacement[] {
  const out: SlotPlacement[] = [];
  for (const room of rooms(d)) {
    for (const side of SIDES) {
      const info = room.sides[side];
      // A door between two rooms gets one panel, owned by the lower id.
      if (info.type === 'room' && info.neighbour !== null && info.neighbour < room.id) continue;
      const alongX = side === 'north' || side === 'south';
      const gap = gapFor(info.type, info.center, info.span);
      const c = edgeCoord(room, side);
      out.push({
        room: room.id,
        side,
        type: info.type,
        x: alongX ? info.center : c,
        y: (gap.sill + gap.head) / 2,
        z: alongX ? c : info.center,
        width: gap.width,
        height: gap.head - gap.sill,
        alongX,
      });
    }
  }
  return out;
}

/** Walls for the whole plan, one pass per shared wall line. */
function planWalls(d: Design, rs: Room[], height: number): Box[] {
  const boxes: Box[] = [];
  const t = WALL_THICKNESS[d.material];
  type Entry = { alongX: boolean; c: number; spans: [number, number][]; gaps: Gap[] };
  const byLine = new Map<string, Entry>();
  for (const room of rs) {
    for (const side of SIDES) {
      const alongX = side === 'north' || side === 'south';
      const c = edgeCoord(room, side);
      const key = `${alongX ? 'z' : 'x'}:${c.toFixed(3)}`;
      let entry = byLine.get(key);
      if (!entry) {
        entry = { alongX, c, spans: [], gaps: [] };
        byLine.set(key, entry);
      }
      entry.spans.push(alongX ? [room.x0, room.x1] : [room.z0, room.z1]);
      if (isOpen(d, room, side)) {
        const info = room.sides[side];
        const gap = gapFor(info.type, info.center, info.span);
        if (!entry.gaps.some((g) => Math.abs(g.center - gap.center) < 0.05)) entry.gaps.push(gap);
      }
    }
  }
  for (const entry of byLine.values()) {
    const spans = entry.spans.sort((a, b) => a[0] - b[0]);
    const merged: [number, number][] = [];
    for (const s of spans) {
      const last = merged[merged.length - 1];
      if (last && s[0] <= last[1] + 1e-6) last[1] = Math.max(last[1], s[1]);
      else merged.push([s[0], s[1]]);
    }
    for (const [from, to] of merged) {
      const gaps = entry.gaps.filter((g) => g.center > from && g.center < to);
      // Run walls half a thickness past the ends so corners close.
      wallBoxes(boxes, entry.alongX, entry.c, from - t / 2, to + t / 2, gaps, t, height);
    }
  }
  return boxes;
}

/** One hipped roof per room; eaves reach out over outside and courtyard walls. */
function roofGeometry(d: Design, rs: Room[], height: number): BufferGeometry {
  type P = [number, number, number];
  const verts: number[] = [];
  const tri = (a: P, b: P, c: P) => verts.push(...a, ...b, ...c);
  const quad = (a: P, b: P, c: P, e: P) => {
    tri(a, b, c);
    tri(a, c, e);
  };
  const eaveY = height - 0.06;
  for (const room of rs) {
    const reach = (side: Side) => {
      const type = room.sides[side].type;
      return type === 'exterior' ? d.overhang[side] : type === 'court' ? COURT_EAVE : 0;
    };
    const x0 = room.x0 - reach('west');
    const x1 = room.x1 + reach('east');
    const z0 = room.z0 - reach('north');
    const z1 = room.z1 + reach('south');
    const w = rectW(room);
    const dp = rectD(room);
    const rise = Math.min(1.25, 0.3 * Math.min(w, dp) + 0.35);
    const y = height + rise;
    const nw: P = [x0, eaveY, z0];
    const ne: P = [x1, eaveY, z0];
    const se: P = [x1, eaveY, z1];
    const sw: P = [x0, eaveY, z1];
    if (w >= dp) {
      const inset = Math.min(dp / 2, w / 2 - 0.01);
      const a: P = [room.x0 + inset, y, rectCz(room)];
      const b: P = [room.x1 - inset, y, rectCz(room)];
      quad(nw, ne, b, a);
      quad(se, sw, a, b);
      tri(ne, se, b);
      tri(sw, nw, a);
    } else {
      const inset = Math.min(w / 2, dp / 2 - 0.01);
      const a: P = [rectCx(room), y, room.z0 + inset];
      const b: P = [rectCx(room), y, room.z1 - inset];
      quad(ne, se, b, a);
      quad(sw, nw, a, b);
      tri(nw, ne, a);
      tri(se, sw, b);
    }
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
  readonly floors = new Map<RoomId, Mesh<PlaneGeometry, MeshLambertMaterial>>();
  readonly courtFloor: Mesh<PlaneGeometry, MeshLambertMaterial>;
  readonly roofMaterial: MeshLambertMaterial;
  readonly wallMaterial: MeshLambertMaterial;
  private readonly walls: Mesh<BufferGeometry, MeshLambertMaterial>;
  private readonly roof: Mesh<BufferGeometry, MeshLambertMaterial> | null;
  private readonly plinth: Mesh<BufferGeometry, MeshLambertMaterial>;
  private readonly opts: BuildingViewOptions;
  private readonly floorGeo = new PlaneGeometry(1, 1);
  private roofOpacity = 1;

  constructor(opts: BuildingViewOptions = {}) {
    this.opts = opts;
    const ghost = !!opts.ghost;
    const shadows = !!opts.shadows && !ghost;
    this.wallMaterial = new MeshLambertMaterial({
      color: ghost ? 0x7fe3ff : WALL_COLOR.earth,
      transparent: ghost,
      opacity: ghost ? 0.28 : 1,
      depthWrite: !ghost,
    });
    this.roofMaterial = new MeshLambertMaterial({
      color: ghost ? 0x7fe3ff : ROOF_COLOR.earth,
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

    this.plinth = new Mesh(new BufferGeometry(), new MeshLambertMaterial({ color: 0x8a5a3a }));
    this.plinth.receiveShadow = shadows;
    this.plinth.visible = !ghost;
    this.group.add(this.plinth);

    this.courtFloor = new Mesh(new PlaneGeometry(1, 1), new MeshLambertMaterial({ color: 0xe2c79a }));
    this.courtFloor.rotation.x = -Math.PI / 2;
    this.courtFloor.receiveShadow = shadows;
    this.courtFloor.visible = false;
    this.group.add(this.courtFloor);
  }

  /**
   * Rebuild from a design. `shownHeight` lets the app animate walls growing
   * from the floor; it defaults to the design's wall height.
   */
  rebuild(d: Design, shownHeight: number = d.wallHeight): void {
    this.group.rotation.y = (-d.rotation * Math.PI) / 180;
    const rs = rooms(d);
    const height = Math.max(KERB, shownHeight);

    this.walls.geometry.dispose();
    this.walls.geometry = mergeBoxes(planWalls(d, rs, height));

    if (this.roof) {
      this.roof.geometry.dispose();
      const show = d.roof && shownHeight >= 2;
      this.roof.geometry = show ? roofGeometry(d, rs, height) : new BufferGeometry();
      this.roof.visible = show && this.roofOpacity > 0.02;
    }
    if (!this.opts.ghost) {
      this.wallMaterial.color.setHex(WALL_COLOR[d.material]);
      this.roofMaterial.color.setHex(ROOF_COLOR[d.material]);
    }

    const m = 0.4;
    const pads: Box[] = rs.map((r) => ({
      cx: rectCx(r),
      cy: -0.12,
      cz: rectCz(r),
      sx: rectW(r) + m * 2,
      sy: 0.24,
      sz: rectD(r) + m * 2,
    }));
    if (d.court) {
      pads.push({ cx: rectCx(d.court), cy: -0.125, cz: rectCz(d.court), sx: rectW(d.court), sy: 0.23, sz: rectD(d.court) });
    }
    this.plinth.geometry.dispose();
    this.plinth.geometry = mergeBoxes(pads);

    this.courtFloor.visible = !!d.court && !this.opts.ghost;
    if (d.court) {
      this.courtFloor.scale.set(rectW(d.court), rectD(d.court), 1);
      this.courtFloor.position.set(rectCx(d.court), 0.012, rectCz(d.court));
    }

    const keep = new Set(rs.map((r) => r.id));
    for (const [id, floor] of this.floors) {
      if (keep.has(id)) continue;
      this.group.remove(floor);
      floor.material.dispose();
      this.floors.delete(id);
    }
    for (const room of rs) this.placeFloor(room);
  }

  private placeFloor(room: Room): void {
    let floor = this.floors.get(room.id);
    if (!floor) {
      floor = new Mesh(
        this.floorGeo,
        new MeshLambertMaterial({
          color: FLOOR_BASE,
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
    this.roofOpacity = opacity;
    this.roofMaterial.opacity = opacity;
    this.roofMaterial.depthWrite = opacity > 0.95;
    const hasRoof = (this.roof.geometry.getAttribute('position')?.count ?? 0) > 0;
    this.roof.visible = hasRoof && opacity > 0.02;
  }

  dispose(): void {
    this.walls.geometry.dispose();
    this.roof?.geometry.dispose();
    this.plinth.geometry.dispose();
    this.wallMaterial.dispose();
    this.roofMaterial.dispose();
    this.floorGeo.dispose();
    for (const f of this.floors.values()) f.material.dispose();
  }
}
