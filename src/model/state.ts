/**
 * Ilé design state — a pure, serialisable description of one house on the
 * plot. No Three.js in here: the heat score, the Elder and the unit tests all
 * work on this plain data.
 *
 * A house is a set of rectangular rooms on a half-metre grid, optionally
 * around a courtyard. The Yoruba courtyard compound (agbo ilé) is one
 * template of that; "build from scratch" starts with no rooms at all.
 *
 * Coordinates are building-local metres: +x is east, +z is south (so north is
 * -z), y is up. `rotation` is a compass bearing in degrees, clockwise seen
 * from above, applied to the whole building on the plot.
 */

export type Side = 'north' | 'east' | 'south' | 'west';
export type Material = 'earth' | 'block' | 'zinc';
/** Rooms have free-form ids ("r3", or "parlour" in the template). */
export type RoomId = string;
export type Axis = 'x' | 'z';
export type SideType = 'exterior' | 'court' | 'room';

export const SIDES: readonly Side[] = ['north', 'east', 'south', 'west'];
export const MATERIALS: readonly Material[] = ['earth', 'block', 'zinc'];

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

export interface RoomSpec extends Rect {
  id: RoomId;
  /** Fixed name (template rooms). Scratch rooms are named automatically. */
  name?: string;
}

export interface Design {
  v: 2;
  rooms: RoomSpec[];
  court: Rect | null;
  /** 0 while only footprints are laid; otherwise 2.4–4.5 m. */
  wallHeight: number;
  roof: boolean;
  overhang: Record<Side, number>;
  rotation: number;
  material: Material;
  /** Keyed `${room}:${side}`. */
  openings: Record<string, boolean>;
  hour: number;
}

/** What one side of a room faces, and where an opening on it would sit. */
export interface SideInfo {
  type: SideType;
  /** Metres of this side that are outside wall. */
  exteriorLength: number;
  /** Centre of the stretch an opening goes in, along the wall's axis. */
  center: number;
  /** Length of that stretch. */
  span: number;
  /** The room on the other side, for `room` sides. */
  neighbour: RoomId | null;
}

export interface Room extends RoomSpec {
  label: string;
  sides: Record<Side, SideInfo>;
  /** Sides with any outside wall. */
  exterior: Side[];
  /** Sides facing the courtyard. */
  courtSides: Side[];
}

/** A wall line: every room and courtyard edge sharing one coordinate. */
export interface Line {
  axis: Axis;
  /** The shared coordinate (x for 'x' lines, which run north–south). */
  c: number;
  from: number;
  to: number;
}

export const LIMITS = {
  grid: 0.5,
  minRoom: 1,
  minCourt: 1.5,
  maxHalf: 12,
  wallHeight: { min: 2.4, max: 4.5, step: 0.1 },
  overhang: { min: 0, max: 2, step: 0.1 },
  rotationStep: 15,
  hour: { min: 8, max: 18, step: 0.25 },
} as const;

const EPS = 1e-6;
const clamp = (v: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, v));
const snap = (v: number, step: number) => Math.round(v / step) * step;
const round2 = (v: number) => Math.round(v * 100) / 100;

export const slotKey = (room: RoomId, side: Side) => `${room}:${side}`;

export const rectW = (r: Rect) => r.x1 - r.x0;
export const rectD = (r: Rect) => r.z1 - r.z0;
export const rectArea = (r: Rect) => rectW(r) * rectD(r);
export const rectCx = (r: Rect) => (r.x0 + r.x1) / 2;
export const rectCz = (r: Rect) => (r.z0 + r.z1) / 2;
export const rectsOverlap = (a: Rect, b: Rect) =>
  a.x0 < b.x1 - EPS && b.x0 < a.x1 - EPS && a.z0 < b.z1 - EPS && b.z0 < a.z1 - EPS;
export const rectContains = (r: Rect, x: number, z: number) =>
  x > r.x0 && x < r.x1 && z > r.z0 && z < r.z1;

/** Length of a rectangle's wall on the given side. */
export function sideLength(room: Rect, side: Side): number {
  return side === 'north' || side === 'south' ? rectW(room) : rectD(room);
}

/** The coordinate of a rectangle's edge on the given side. */
export function edgeCoord(r: Rect, side: Side): number {
  if (side === 'north') return r.z0;
  if (side === 'south') return r.z1;
  if (side === 'east') return r.x1;
  return r.x0;
}

const DEFAULT_OVERHANG = { north: 0.3, east: 0.3, south: 0.3, west: 0.3 };

/**
 * The start template: a Yoruba courtyard compound with deliberate, fixable
 * flaws — shallow eaves, a tight courtyard, long sides facing east and west,
 * and bedrooms that cannot cross-ventilate.
 */
export function defaultDesign(): Design {
  const o = { x0: -5, x1: 5, z0: -7, z1: 7 };
  const c = { x0: -1.5, x1: 1.5, z0: -2.5, z1: 2.5 };
  const room = (id: string, name: string, x0: number, x1: number, z0: number, z1: number) => ({
    id,
    name,
    x0,
    x1,
    z0,
    z1,
  });
  const open = [
    // Windows and courtyard doorways.
    'parlour:north',
    'parlour:south',
    'gate:south',
    'gate:north',
    'bed1:east',
    'bed2:west',
    'kitchen:east',
    'bed3:east',
    'bed4:west',
    // Doors between neighbouring rooms.
    'store:east',
    'kitchen:west',
    'bed4:east',
    'bed3:west',
    'store:south',
    'kitchen:south',
    'bed4:north',
    'bed3:north',
  ];
  return normalize({
    v: 2,
    rooms: [
      room('parlour', 'Parlour', c.x0, c.x1, o.z0, c.z0),
      room('gate', 'Gate hall', c.x0, c.x1, c.z1, o.z1),
      room('bed1', 'East bedroom', c.x1, o.x1, c.z0, c.z1),
      room('bed2', 'West bedroom', o.x0, c.x0, c.z0, c.z1),
      room('kitchen', 'Kitchen', c.x1, o.x1, o.z0, c.z0),
      room('store', 'Store', o.x0, c.x0, o.z0, c.z0),
      room('bed3', 'South-east room', c.x1, o.x1, c.z1, o.z1),
      room('bed4', 'South-west room', o.x0, c.x0, c.z1, o.z1),
    ],
    court: c,
    wallHeight: 3,
    roof: true,
    overhang: { ...DEFAULT_OVERHANG },
    rotation: 0,
    material: 'earth',
    openings: Object.fromEntries(open.map((k) => [k, true])),
    hour: 15,
  });
}

/** "Build from scratch": an empty plot. */
export function scratchDesign(): Design {
  return {
    v: 2,
    rooms: [],
    court: null,
    wallHeight: 0,
    roof: false,
    overhang: { ...DEFAULT_OVERHANG },
    rotation: 0,
    material: 'earth',
    openings: {},
    hour: 15,
  };
}

export function cloneDesign(d: Design): Design {
  return {
    v: 2,
    rooms: d.rooms.map((r) => ({ ...r })),
    court: d.court ? { ...d.court } : null,
    wallHeight: d.wallHeight,
    roof: d.roof,
    overhang: { ...d.overhang },
    rotation: d.rotation,
    material: d.material,
    openings: { ...d.openings },
    hour: d.hour,
  };
}

/** True once the house can be lived in: rooms, walls and a roof. */
export function isComplete(d: Design): boolean {
  return d.rooms.length > 0 && d.wallHeight > 0 && d.roof;
}

/** Bounding rectangle of everything built (rooms and courtyard). */
export function bounds(d: Design): Rect {
  const all: Rect[] = d.court ? [...d.rooms, d.court] : d.rooms;
  if (all.length === 0) return { x0: -3, x1: 3, z0: -3, z1: 3 };
  return {
    x0: Math.min(...all.map((r) => r.x0)),
    x1: Math.max(...all.map((r) => r.x1)),
    z0: Math.min(...all.map((r) => r.z0)),
    z1: Math.max(...all.map((r) => r.z1)),
  };
}

// ------------------------------------------------------------------ naming

/** Names for rooms without a fixed one, by size: big room first. */
function autoNames(specs: RoomSpec[]): Map<RoomId, string> {
  const out = new Map<RoomId, string>();
  const free = specs
    .filter((r) => !r.name)
    .sort((a, b) => rectArea(b) - rectArea(a) || a.id.localeCompare(b.id));
  const n = free.length;
  let bedroom = 0;
  free.forEach((r, i) => {
    if (i === 0) out.set(r.id, 'Parlour');
    else if (i === n - 1 && n >= 3) out.set(r.id, 'Kitchen');
    else if (i === n - 2 && n >= 5) out.set(r.id, 'Store');
    else out.set(r.id, `Bedroom ${(bedroom += 1)}`);
  });
  return out;
}

// --------------------------------------------------------------- adjacency

/** Subtract covered intervals from [a, b]; returns what is left, sorted. */
function subtract(a: number, b: number, covered: [number, number][]): [number, number][] {
  let free: [number, number][] = [[a, b]];
  for (const [c0, c1] of covered) {
    free = free.flatMap(([f0, f1]): [number, number][] => {
      if (c1 <= f0 + EPS || c0 >= f1 - EPS) return [[f0, f1]];
      const parts: [number, number][] = [];
      if (c0 > f0 + EPS) parts.push([f0, c0]);
      if (c1 < f1 - EPS) parts.push([c1, f1]);
      return parts;
    });
  }
  return free;
}

function sideInfo(d: Design, room: RoomSpec, side: Side): SideInfo {
  const alongX = side === 'north' || side === 'south';
  const c = edgeCoord(room, side);
  const a = alongX ? room.x0 : room.z0;
  const b = alongX ? room.x1 : room.z1;
  const facing = OPPOSITE[side];
  const overlap = (r: Rect): [number, number] | null => {
    if (Math.abs(edgeCoord(r, facing) - c) > EPS) return null;
    const lo = Math.max(a, alongX ? r.x0 : r.z0);
    const hi = Math.min(b, alongX ? r.x1 : r.z1);
    return hi - lo > EPS ? [lo, hi] : null;
  };
  const roomSegs: { seg: [number, number]; id: RoomId }[] = [];
  for (const other of d.rooms) {
    if (other.id === room.id) continue;
    const seg = overlap(other);
    if (seg) roomSegs.push({ seg, id: other.id });
  }
  const courtSeg = d.court ? overlap(d.court) : null;
  const covered = roomSegs.map((s) => s.seg);
  if (courtSeg) covered.push(courtSeg);
  const exterior = subtract(a, b, covered);
  const exteriorLength = exterior.reduce((s, [p, q]) => s + (q - p), 0);
  const longest = (segs: [number, number][]) =>
    segs.reduce((best, s) => (s[1] - s[0] > best[1] - best[0] ? s : best), segs[0]);

  if (exteriorLength >= LIMITS.minRoom - EPS) {
    const s = longest(exterior);
    return { type: 'exterior', exteriorLength, center: (s[0] + s[1]) / 2, span: s[1] - s[0], neighbour: null };
  }
  if (courtSeg && courtSeg[1] - courtSeg[0] >= LIMITS.minRoom - EPS) {
    return {
      type: 'court',
      exteriorLength,
      center: (courtSeg[0] + courtSeg[1]) / 2,
      span: courtSeg[1] - courtSeg[0],
      neighbour: null,
    };
  }
  if (roomSegs.length > 0) {
    const best = roomSegs.reduce((p, q) => (q.seg[1] - q.seg[0] > p.seg[1] - p.seg[0] ? q : p));
    return {
      type: 'room',
      exteriorLength,
      center: (best.seg[0] + best.seg[1]) / 2,
      span: best.seg[1] - best.seg[0],
      neighbour: best.id,
    };
  }
  return { type: 'exterior', exteriorLength: b - a, center: (a + b) / 2, span: b - a, neighbour: null };
}

/** Rooms with their names and what each side faces. */
export function rooms(d: Design): Room[] {
  const names = autoNames(d.rooms);
  return d.rooms.map((spec) => {
    const sides = {} as Record<Side, SideInfo>;
    for (const s of SIDES) sides[s] = sideInfo(d, spec, s);
    return {
      ...spec,
      label: spec.name ?? names.get(spec.id) ?? 'Room',
      sides,
      exterior: SIDES.filter((s) => sides[s].exteriorLength > EPS && sides[s].type === 'exterior'),
      courtSides: SIDES.filter((s) => sides[s].type === 'court'),
    };
  });
}

export function roomById(d: Design, id: RoomId): Room {
  const r = rooms(d).find((room) => room.id === id);
  if (!r) throw new Error(`unknown room ${id}`);
  return r;
}

export function roomLabel(d: Design, id: RoomId): string {
  return rooms(d).find((r) => r.id === id)?.label ?? 'Room';
}

/** Every side of every room can carry an opening. */
export function slotKeys(d: Design): string[] {
  return d.rooms.flatMap((r) => SIDES.map((s) => slotKey(r.id, s)));
}

export function isValidSlot(d: Design, room: RoomId, side: Side): boolean {
  return d.rooms.some((r) => r.id === room) && SIDES.includes(side);
}

/**
 * Is there an opening on this side? A door between two rooms is open if
 * either room says so.
 */
export function isOpen(d: Design, room: Room, side: Side): boolean {
  if (d.openings[slotKey(room.id, side)]) return true;
  const info = room.sides[side];
  return (
    info.type === 'room' &&
    info.neighbour !== null &&
    d.openings[slotKey(info.neighbour, OPPOSITE[side])] === true
  );
}

// ------------------------------------------------------------------- lines

/** Every wall line in the plan (shared edges appear once). */
export function lines(d: Design): Line[] {
  const map = new Map<string, Line>();
  const add = (axis: Axis, c: number, from: number, to: number) => {
    const key = `${axis}:${c.toFixed(3)}`;
    const line = map.get(key);
    if (line) {
      line.from = Math.min(line.from, from);
      line.to = Math.max(line.to, to);
    } else {
      map.set(key, { axis, c, from, to });
    }
  };
  const rects: Rect[] = d.court ? [...d.rooms, d.court] : d.rooms;
  for (const r of rects) {
    add('x', r.x0, r.z0, r.z1);
    add('x', r.x1, r.z0, r.z1);
    add('z', r.z0, r.x0, r.x1);
    add('z', r.z1, r.x0, r.x1);
  }
  return [...map.values()];
}

function planValid(d: Design): boolean {
  const M = LIMITS.maxHalf;
  const rects: Rect[] = d.court ? [...d.rooms, d.court] : d.rooms;
  for (const r of rects) {
    const min = r === d.court ? LIMITS.minCourt : LIMITS.minRoom;
    if (rectW(r) < min - EPS || rectD(r) < min - EPS) return false;
    if (r.x0 < -M - EPS || r.x1 > M + EPS || r.z0 < -M - EPS || r.z1 > M + EPS) return false;
  }
  for (let i = 0; i < rects.length; i += 1) {
    for (let j = i + 1; j < rects.length; j += 1) {
      if (rectsOverlap(rects[i], rects[j])) return false;
    }
  }
  return true;
}

/**
 * Drag a wall line: every room and courtyard edge on that line moves with it,
 * so shared walls stay shared. Stops at the last valid grid position.
 */
export function moveLine(d: Design, axis: Axis, c: number, to: number): Design {
  const g = LIMITS.grid;
  let target = snap(to, g);
  const step = target > c ? -g : g;
  for (let guard = 0; guard < 200 && Math.abs(target - c) > EPS; guard += 1) {
    const n = cloneDesign(d);
    const shift = (r: Rect) => {
      if (axis === 'x') {
        if (Math.abs(r.x0 - c) < EPS) r.x0 = target;
        if (Math.abs(r.x1 - c) < EPS) r.x1 = target;
      } else {
        if (Math.abs(r.z0 - c) < EPS) r.z0 = target;
        if (Math.abs(r.z1 - c) < EPS) r.z1 = target;
      }
    };
    n.rooms.forEach(shift);
    if (n.court) shift(n.court);
    if (planValid(n)) return normalize(n);
    target += step;
  }
  return d;
}

/** Lay a new room. Returns null if it is too small or overlaps something. */
export function addRoom(d: Design, rect: Rect): Design | null {
  const g = LIMITS.grid;
  const r = {
    x0: snap(Math.min(rect.x0, rect.x1), g),
    x1: snap(Math.max(rect.x0, rect.x1), g),
    z0: snap(Math.min(rect.z0, rect.z1), g),
    z1: snap(Math.max(rect.z0, rect.z1), g),
  };
  let n = 1;
  while (d.rooms.some((room) => room.id === `r${n}`)) n += 1;
  const next = cloneDesign(d);
  next.rooms.push({ id: `r${n}`, ...r });
  return planValid(next) ? normalize(next) : null;
}

/**
 * The room a drag from `anchor` to `to` should lay: the dragged corner is
 * pulled back off anything it would overlap, so a new room butts up against
 * its neighbours instead of being refused. Null if nothing valid is left.
 */
export function fitRoom(
  d: Design,
  anchor: { x: number; z: number },
  to: { x: number; z: number },
): Rect | null {
  const g = LIMITS.grid;
  const M = LIMITS.maxHalf;
  const ax = clamp(snap(anchor.x, g), -M, M);
  const az = clamp(snap(anchor.z, g), -M, M);
  let tx = clamp(snap(to.x, g), -M, M);
  let tz = clamp(snap(to.z, g), -M, M);
  const taken: Rect[] = d.court ? [...d.rooms, d.court] : d.rooms;
  for (let guard = 0; guard < 40; guard += 1) {
    const r = { x0: Math.min(ax, tx), x1: Math.max(ax, tx), z0: Math.min(az, tz), z1: Math.max(az, tz) };
    if (rectW(r) < LIMITS.minRoom - EPS || rectD(r) < LIMITS.minRoom - EPS) return null;
    const hit = taken.find((o) => rectsOverlap(o, r));
    if (!hit) return r;
    // Pull the dragged corner back along whichever axis keeps more room.
    const nx = tx > ax ? Math.min(tx, hit.x0) : Math.max(tx, hit.x1);
    const nz = tz > az ? Math.min(tz, hit.z0) : Math.max(tz, hit.z1);
    const keepX = Math.abs(nx - ax) * Math.abs(tz - az);
    const keepZ = Math.abs(tx - ax) * Math.abs(nz - az);
    const canX = nx !== tx && Math.abs(nx - ax) >= LIMITS.minRoom - EPS && (tx > ax ? nx > ax : nx < ax);
    const canZ = nz !== tz && Math.abs(nz - az) >= LIMITS.minRoom - EPS && (tz > az ? nz > az : nz < az);
    if (canX && (!canZ || keepX >= keepZ)) tx = nx;
    else if (canZ) tz = nz;
    else return null;
  }
  return null;
}

/**
 * The empty rectangle around a point that rooms enclose on all four sides —
 * the natural courtyard. Null if the point is inside a room or not enclosed.
 */
export function enclosedGap(d: Design, x: number, z: number): Rect | null {
  if (d.rooms.some((r) => rectContains(r, x, z))) return null;
  let x0 = -Infinity;
  let x1 = Infinity;
  let z0 = -Infinity;
  let z1 = Infinity;
  for (const r of d.rooms) {
    if (r.z0 < z && r.z1 > z) {
      if (r.x1 <= x + EPS) x0 = Math.max(x0, r.x1);
      if (r.x0 >= x - EPS) x1 = Math.min(x1, r.x0);
    }
    if (r.x0 < x && r.x1 > x) {
      if (r.z1 <= z + EPS) z0 = Math.max(z0, r.z1);
      if (r.z0 >= z - EPS) z1 = Math.min(z1, r.z0);
    }
  }
  if (![x0, x1, z0, z1].every(Number.isFinite)) return null;
  const gap = { x0, x1, z0, z1 };
  if (rectW(gap) < LIMITS.minCourt || rectD(gap) < LIMITS.minCourt) return null;
  if (d.rooms.some((r) => rectsOverlap(r, gap))) return null;
  return gap;
}

/** The largest enclosed gap anywhere in the plan, if there is one. */
export function findEnclosedGap(d: Design): Rect | null {
  const b = bounds(d);
  let best: Rect | null = null;
  for (let x = b.x0 + 0.25; x < b.x1; x += 0.5) {
    for (let z = b.z0 + 0.25; z < b.z1; z += 0.5) {
      const gap = enclosedGap(d, x, z);
      if (gap && (!best || rectArea(gap) > rectArea(best))) best = gap;
    }
  }
  return best;
}

export function setCourt(d: Design, court: Rect | null): Design {
  const n = cloneDesign(d);
  n.court = court ? { ...court } : null;
  return planValid(n) ? normalize(n) : d;
}

/**
 * Resize the courtyard about its centre by moving its four wall lines; the
 * rooms on those lines move with them.
 */
export function setCourtSize(d: Design, width: number, depth: number): Design {
  if (!d.court) return d;
  const g = LIMITS.grid;
  const dw = snap((width - rectW(d.court)) / 2, g);
  const dd = snap((depth - rectD(d.court)) / 2, g);
  let n = d;
  const c = () => n.court as Rect;
  if (dw !== 0) {
    n = moveLine(n, 'x', c().x0, c().x0 - dw);
    n = moveLine(n, 'x', c().x1, c().x1 + dw);
  }
  if (dd !== 0) {
    n = moveLine(n, 'z', c().z0, c().z0 - dd);
    n = moveLine(n, 'z', c().z1, c().z1 + dd);
  }
  return n;
}

export function normalizeRotation(deg: number): number {
  let r = snap(deg, LIMITS.rotationStep) % 360;
  if (r > 180) r -= 360;
  if (r <= -180) r += 360;
  return r === 0 ? 0 : r;
}

/** Clamp and snap the scalar fields; drop openings for rooms that are gone. */
export function normalize(input: Design): Design {
  const d = cloneDesign(input);
  const g = LIMITS.grid;
  for (const r of d.rooms) {
    r.x0 = snap(r.x0, g);
    r.x1 = snap(r.x1, g);
    r.z0 = snap(r.z0, g);
    r.z1 = snap(r.z1, g);
  }
  const wh = LIMITS.wallHeight;
  d.wallHeight =
    d.wallHeight < wh.min / 2
      ? 0
      : round2(clamp(snap(d.wallHeight, wh.step), wh.min, wh.max));
  const oh = LIMITS.overhang;
  for (const s of SIDES) {
    const v = Number.isFinite(d.overhang[s]) ? d.overhang[s] : 0;
    d.overhang[s] = round2(clamp(snap(v, oh.step), oh.min, oh.max));
  }
  d.rotation = normalizeRotation(Number.isFinite(d.rotation) ? d.rotation : 0);
  if (!MATERIALS.includes(d.material)) d.material = 'earth';
  d.roof = d.roof === true;
  const hr = LIMITS.hour;
  d.hour = clamp(snap(d.hour, hr.step), hr.min, hr.max);
  const openings: Record<string, boolean> = {};
  for (const key of slotKeys(d)) if (d.openings[key] === true) openings[key] = true;
  d.openings = openings;
  return d;
}

export function setWallHeight(d: Design, value: number): Design {
  return normalize({ ...cloneDesign(d), wallHeight: value });
}

export function setRoof(d: Design, on: boolean): Design {
  return normalize({ ...cloneDesign(d), roof: on });
}

export function setOverhang(d: Design, side: Side | 'all', value: number): Design {
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

export function setOpening(d: Design, room: RoomId, side: Side, on: boolean): Design {
  const n = cloneDesign(d);
  if (!isValidSlot(d, room, side)) return d;
  const key = slotKey(room, side);
  if (on) {
    n.openings[key] = true;
  } else {
    delete n.openings[key];
    // Closing a shared door closes it from both rooms.
    const info = roomById(d, room).sides[side];
    if (info.type === 'room' && info.neighbour) {
      delete n.openings[slotKey(info.neighbour, OPPOSITE[side])];
    }
  }
  return normalize(n);
}

export function setHour(d: Design, hour: number): Design {
  return normalize({ ...cloneDesign(d), hour });
}

/** True when two designs differ in anything except the sun hour. */
export function designChanged(a: Design, b: Design): boolean {
  return JSON.stringify({ ...a, hour: 0 }) !== JSON.stringify({ ...b, hour: 0 });
}

export function serialize(d: Design): string {
  return JSON.stringify(d);
}

/** Parse untrusted JSON into a valid Design, or null. */
export function deserialize(json: string): Design | null {
  try {
    const raw = JSON.parse(json) as Partial<Design> | null;
    if (!raw || raw.v !== 2 || !Array.isArray(raw.rooms) || !raw.overhang) return null;
    const num = (v: unknown, fallback: number) =>
      typeof v === 'number' && Number.isFinite(v) ? v : fallback;
    const rect = (r: Partial<Rect>): Rect | null =>
      [r.x0, r.x1, r.z0, r.z1].every((v) => typeof v === 'number' && Number.isFinite(v))
        ? { x0: r.x0 as number, x1: r.x1 as number, z0: r.z0 as number, z1: r.z1 as number }
        : null;
    const specs: RoomSpec[] = [];
    for (const r of raw.rooms) {
      const box = r && typeof r === 'object' ? rect(r) : null;
      if (!box || typeof r.id !== 'string' || !/^[a-z0-9_-]{1,24}$/i.test(r.id)) return null;
      if (specs.some((s) => s.id === r.id)) return null;
      specs.push({ id: r.id, ...(typeof r.name === 'string' ? { name: r.name.slice(0, 40) } : {}), ...box });
    }
    const d = normalize({
      v: 2,
      rooms: specs,
      court: raw.court ? rect(raw.court) : null,
      wallHeight: num(raw.wallHeight, 0),
      roof: raw.roof === true,
      overhang: {
        north: num(raw.overhang.north, 0.3),
        east: num(raw.overhang.east, 0.3),
        south: num(raw.overhang.south, 0.3),
        west: num(raw.overhang.west, 0.3),
      },
      rotation: num(raw.rotation, 0),
      material: raw.material ?? 'earth',
      openings: raw.openings && typeof raw.openings === 'object' ? raw.openings : {},
      hour: num(raw.hour, 15),
    });
    return planValid(d) ? d : null;
  } catch {
    return null;
  }
}

/** Undo stack. `commit` records a finished edit; `undo` steps back. */
export class History {
  private stack: string[] = [];
  private readonly limit: number;

  constructor(limit = 80) {
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
