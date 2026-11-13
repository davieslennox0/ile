/**
 * Ilé design state — a pure, serialisable description of one courtyard
 * compound (agbo ilé). No Three.js in here: the heat score, the Elder and the
 * unit tests all work on this plain data.
 *
 * Coordinates are building-local metres: +x is east, +z is south (so north is
 * -z), y is up. `rotation` is a compass bearing in degrees, clockwise seen
 * from above, applied to the whole building on the plot.
 */

export type Side = 'north' | 'east' | 'south' | 'west';
export type Material = 'earth' | 'block' | 'zinc';
export type RoomId =
  | 'parlour'
  | 'gate'
  | 'bed1'
  | 'bed2'
  | 'kitchen'
  | 'store'
  | 'bed3'
  | 'bed4';

export const SIDES: readonly Side[] = ['north', 'east', 'south', 'west'];
export const MATERIALS: readonly Material[] = ['earth', 'block', 'zinc'];
export const ROOM_IDS: readonly RoomId[] = [
  'parlour',
  'gate',
  'bed1',
  'bed2',
  'kitchen',
  'store',
  'bed3',
  'bed4',
];

export const OPPOSITE: Record<Side, Side> = {
  north: 'south',
  south: 'north',
  east: 'west',
  west: 'east',
};

/** Unit normals in building-local (x, z). */
export const SIDE_NORMAL: Record<Side, { x: number; z: number }> = {
  north: { x: 0, z: -1 },
  south: { x: 0, z: 1 },
  east: { x: 1, z: 0 },
  west: { x: -1, z: 0 },
};

export interface Rect {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}

export interface Design {
  v: 1;
  outer: Rect;
  court: Rect;
  wallHeight: number;
  overhang: Record<Side, number>;
  rotation: number;
  material: Material;
  /** Keyed `${room}:${side}`; only keys from `slotKeys()` are meaningful. */
  openings: Record<string, boolean>;
  hour: number;
}

export interface Room extends Rect {
  id: RoomId;
  label: string;
  /** Sides of this room that are outside walls. */
  exterior: Side[];
  /** Side that faces the courtyard (wings only; corner rooms have none). */
  courtSide: Side | null;
}

export const LIMITS = {
  grid: 0.5,
  minWing: 2.5,
  minCourt: 2,
  maxHalf: 10,
  wallHeight: { min: 2.4, max: 4.5, step: 0.1 },
  overhang: { min: 0, max: 2, step: 0.1 },
  rotationStep: 15,
  hour: { min: 8, max: 18, step: 0.25 },
} as const;

export const ROOM_LABEL: Record<RoomId, string> = {
  parlour: 'Parlour',
  gate: 'Gate hall',
  bed1: 'East bedroom',
  bed2: 'West bedroom',
  kitchen: 'Kitchen',
  store: 'Store',
  bed3: 'South-east room',
  bed4: 'South-west room',
};

const clamp = (v: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, v));
const snap = (v: number, step: number) => Math.round(v / step) * step;
const round2 = (v: number) => Math.round(v * 100) / 100;

export const slotKey = (room: RoomId, side: Side) => `${room}:${side}`;

/**
 * The start template: a Yoruba courtyard compound with deliberate, fixable
 * flaws — shallow eaves, a tight courtyard, long sides facing east and west,
 * and bedrooms that cannot cross-ventilate.
 */
export function defaultDesign(): Design {
  return normalize({
    v: 1,
    outer: { x0: -5, x1: 5, z0: -7, z1: 7 },
    court: { x0: -1.5, x1: 1.5, z0: -2.5, z1: 2.5 },
    wallHeight: 3,
    overhang: { north: 0.3, east: 0.3, south: 0.3, west: 0.3 },
    rotation: 0,
    material: 'earth',
    openings: {
      'parlour:north': true,
      'parlour:south': true,
      'gate:south': true,
      'gate:north': true,
      'bed1:east': true,
      'bed1:west': false,
      'bed2:west': true,
      'bed2:east': false,
      'kitchen:north': false,
      'kitchen:east': true,
      'store:north': false,
      'store:west': false,
      'bed3:south': false,
      'bed3:east': true,
      'bed4:south': false,
      'bed4:west': true,
    },
    hour: 15,
  });
}

export function cloneDesign(d: Design): Design {
  return {
    v: 1,
    outer: { ...d.outer },
    court: { ...d.court },
    wallHeight: d.wallHeight,
    overhang: { ...d.overhang },
    rotation: d.rotation,
    material: d.material,
    openings: { ...d.openings },
    hour: d.hour,
  };
}

/** Rooms derived from the outer and courtyard rectangles. */
export function rooms(d: Design): Room[] {
  const o = d.outer;
  const c = d.court;
  const mk = (
    id: RoomId,
    x0: number,
    x1: number,
    z0: number,
    z1: number,
    exterior: Side[],
    courtSide: Side | null,
  ): Room => ({
    id,
    label: ROOM_LABEL[id],
    x0,
    x1,
    z0,
    z1,
    exterior,
    courtSide,
  });
  return [
    mk('parlour', c.x0, c.x1, o.z0, c.z0, ['north'], 'south'),
    mk('gate', c.x0, c.x1, c.z1, o.z1, ['south'], 'north'),
    mk('bed1', c.x1, o.x1, c.z0, c.z1, ['east'], 'west'),
    mk('bed2', o.x0, c.x0, c.z0, c.z1, ['west'], 'east'),
    mk('kitchen', c.x1, o.x1, o.z0, c.z0, ['north', 'east'], null),
    mk('store', o.x0, c.x0, o.z0, c.z0, ['north', 'west'], null),
    mk('bed3', c.x1, o.x1, c.z1, o.z1, ['south', 'east'], null),
    mk('bed4', o.x0, c.x0, c.z1, o.z1, ['south', 'west'], null),
  ];
}

export function roomById(d: Design, id: RoomId): Room {
  const r = rooms(d).find((room) => room.id === id);
  if (!r) throw new Error(`unknown room ${id}`);
  return r;
}

/** Sides of a room that can carry a toggleable opening. */
export function slotSides(room: Room): Side[] {
  return room.courtSide ? [...room.exterior, room.courtSide] : room.exterior;
}

export function slotKeys(d: Design): string[] {
  return rooms(d).flatMap((r) => slotSides(r).map((s) => slotKey(r.id, s)));
}

export function isValidSlot(room: RoomId, side: Side): boolean {
  const r = rooms(defaultDesign()).find((x) => x.id === room);
  return !!r && slotSides(r).includes(side);
}

export const rectW = (r: Rect) => r.x1 - r.x0;
export const rectD = (r: Rect) => r.z1 - r.z0;
export const rectArea = (r: Rect) => rectW(r) * rectD(r);
export const rectCx = (r: Rect) => (r.x0 + r.x1) / 2;
export const rectCz = (r: Rect) => (r.z0 + r.z1) / 2;

/** Length of a room's wall on the given side. */
export function sideLength(room: Rect, side: Side): number {
  return side === 'north' || side === 'south' ? rectW(room) : rectD(room);
}

export function normalizeRotation(deg: number): number {
  let r = snap(deg, LIMITS.rotationStep) % 360;
  if (r > 180) r -= 360;
  if (r <= -180) r += 360;
  return r === 0 ? 0 : r;
}

/** Clamp and snap every field so any Design that leaves here is buildable. */
export function normalize(input: Design): Design {
  const d = cloneDesign(input);
  const g = LIMITS.grid;
  const M = LIMITS.maxHalf;

  // Courtyard first: snap, keep a minimum size, keep it inside the plot.
  let cx0 = snap(d.court.x0, g);
  let cx1 = snap(d.court.x1, g);
  let cz0 = snap(d.court.z0, g);
  let cz1 = snap(d.court.z1, g);
  if (cx1 - cx0 < LIMITS.minCourt) cx1 = cx0 + LIMITS.minCourt;
  if (cz1 - cz0 < LIMITS.minCourt) cz1 = cz0 + LIMITS.minCourt;
  const inner = M - LIMITS.minWing;
  cx0 = clamp(cx0, -inner, inner - LIMITS.minCourt);
  cx1 = clamp(cx1, cx0 + LIMITS.minCourt, inner);
  cz0 = clamp(cz0, -inner, inner - LIMITS.minCourt);
  cz1 = clamp(cz1, cz0 + LIMITS.minCourt, inner);
  d.court = { x0: cx0, x1: cx1, z0: cz0, z1: cz1 };

  // Outer walls keep at least one wing's thickness around the courtyard.
  d.outer = {
    x0: clamp(snap(d.outer.x0, g), -M, cx0 - LIMITS.minWing),
    x1: clamp(snap(d.outer.x1, g), cx1 + LIMITS.minWing, M),
    z0: clamp(snap(d.outer.z0, g), -M, cz0 - LIMITS.minWing),
    z1: clamp(snap(d.outer.z1, g), cz1 + LIMITS.minWing, M),
  };

  const wh = LIMITS.wallHeight;
  d.wallHeight = round2(clamp(snap(d.wallHeight, wh.step), wh.min, wh.max));
  const oh = LIMITS.overhang;
  for (const s of SIDES) {
    const v = Number.isFinite(d.overhang[s]) ? d.overhang[s] : 0;
    d.overhang[s] = round2(clamp(snap(v, oh.step), oh.min, oh.max));
  }
  d.rotation = normalizeRotation(Number.isFinite(d.rotation) ? d.rotation : 0);
  if (!MATERIALS.includes(d.material)) d.material = 'earth';
  const hr = LIMITS.hour;
  d.hour = clamp(snap(d.hour, hr.step), hr.min, hr.max);

  const openings: Record<string, boolean> = {};
  for (const key of slotKeys(d)) openings[key] = d.openings[key] === true;
  d.openings = openings;
  return d;
}

/** Move one outer wall to a new coordinate along its axis. */
export function setOuterWall(d: Design, side: Side, value: number): Design {
  const n = cloneDesign(d);
  if (side === 'north') n.outer.z0 = value;
  else if (side === 'south') n.outer.z1 = value;
  else if (side === 'east') n.outer.x1 = value;
  else n.outer.x0 = value;
  return normalize(n);
}

export function outerWallValue(d: Design, side: Side): number {
  if (side === 'north') return d.outer.z0;
  if (side === 'south') return d.outer.z1;
  if (side === 'east') return d.outer.x1;
  return d.outer.x0;
}

/**
 * Resize the courtyard about its own centre. If it would push into a wing,
 * the outer walls move out with it so the rooms keep their depth.
 */
export function setCourtSize(d: Design, width: number, depth: number): Design {
  const n = cloneDesign(d);
  const g = LIMITS.grid;
  const maxSpan = 2 * (LIMITS.maxHalf - LIMITS.minWing);
  const w = clamp(snap(width, g), LIMITS.minCourt, maxSpan);
  const dep = clamp(snap(depth, g), LIMITS.minCourt, maxSpan);
  const cx = snap(rectCx(d.court), g / 2);
  const cz = snap(rectCz(d.court), g / 2);
  const wingW = d.court.x0 - d.outer.x0;
  const wingE = d.outer.x1 - d.court.x1;
  const wingN = d.court.z0 - d.outer.z0;
  const wingS = d.outer.z1 - d.court.z1;
  n.court = {
    x0: cx - w / 2,
    x1: cx + w / 2,
    z0: cz - dep / 2,
    z1: cz + dep / 2,
  };
  const c = normalize({ ...n, outer: { x0: -99, x1: 99, z0: -99, z1: 99 } })
    .court;
  n.court = c;
  n.outer = {
    x0: c.x0 - wingW,
    x1: c.x1 + wingE,
    z0: c.z0 - wingN,
    z1: c.z1 + wingS,
  };
  return normalize(n);
}

export function setWallHeight(d: Design, value: number): Design {
  return normalize({ ...cloneDesign(d), wallHeight: value });
}

export function setOverhang(
  d: Design,
  side: Side | 'all',
  value: number,
): Design {
  const n = cloneDesign(d);
  for (const s of SIDES) if (side === 'all' || side === s) n.overhang[s] = value;
  return normalize(n);
}

export function setRotation(d: Design, value: number): Design {
  return normalize({ ...cloneDesign(d), rotation: value });
}

export function setMaterial(d: Design, value: Material): Design {
  return normalize({ ...cloneDesign(d), material: value });
}

export function setOpening(
  d: Design,
  room: RoomId,
  side: Side,
  on: boolean,
): Design {
  const n = cloneDesign(d);
  const key = slotKey(room, side);
  if (key in n.openings) n.openings[key] = on;
  return normalize(n);
}

export function setHour(d: Design, hour: number): Design {
  return normalize({ ...cloneDesign(d), hour });
}

/** True when two designs differ in anything except the sun hour. */
export function designChanged(a: Design, b: Design): boolean {
  return (
    JSON.stringify({ ...a, hour: 0 }) !== JSON.stringify({ ...b, hour: 0 })
  );
}

export function serialize(d: Design): string {
  return JSON.stringify(d);
}

/** Parse untrusted JSON into a valid Design, or null. */
export function deserialize(json: string): Design | null {
  try {
    const raw = JSON.parse(json) as Partial<Design> | null;
    if (!raw || raw.v !== 1 || !raw.outer || !raw.court || !raw.overhang) {
      return null;
    }
    const base = defaultDesign();
    const num = (v: unknown, fallback: number) =>
      typeof v === 'number' && Number.isFinite(v) ? v : fallback;
    const rect = (r: Partial<Rect>, f: Rect): Rect => ({
      x0: num(r.x0, f.x0),
      x1: num(r.x1, f.x1),
      z0: num(r.z0, f.z0),
      z1: num(r.z1, f.z1),
    });
    return normalize({
      v: 1,
      outer: rect(raw.outer, base.outer),
      court: rect(raw.court, base.court),
      wallHeight: num(raw.wallHeight, base.wallHeight),
      overhang: {
        north: num(raw.overhang.north, 0.3),
        east: num(raw.overhang.east, 0.3),
        south: num(raw.overhang.south, 0.3),
        west: num(raw.overhang.west, 0.3),
      },
      rotation: num(raw.rotation, 0),
      material: raw.material ?? 'earth',
      openings:
        raw.openings && typeof raw.openings === 'object' ? raw.openings : {},
      hour: num(raw.hour, base.hour),
    });
  } catch {
    return null;
  }
}

/** Undo stack. `commit` records a finished edit; `undo` steps back. */
export class History {
  private stack: string[] = [];
  private readonly limit: number;

  constructor(limit = 60) {
    this.limit = limit;
  }

  /** Record the state as it was before an edit. */
  commit(before: Design): void {
    const s = serialize(before);
    if (this.stack[this.stack.length - 1] === s) return;
    this.stack.push(s);
    if (this.stack.length > this.limit) this.stack.shift();
  }

  undo(): Design | null {
    const s = this.stack.pop();
    return s ? deserialize(s) : null;
  }

  get size(): number {
    return this.stack.length;
  }

  clear(): void {
    this.stack.length = 0;
  }
}
