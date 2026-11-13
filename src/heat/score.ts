/**
 * Comfort heuristic for Ilé. This is a believable rule of thumb, NOT a thermal
 * simulation: it rewards the things West African builders actually did —
 * shade the wall, thicken it, let air cross the room, open onto a courtyard.
 *
 * Pure functions only, so they can be unit-tested and reused by the Elder.
 */

import {
  OPPOSITE,
  SIDES,
  SIDE_NORMAL,
  bounds,
  isOpen,
  rectArea,
  rectD,
  rectW,
  rooms,
  type Design,
  type Material,
  type Room,
  type RoomId,
  type Side,
} from '../model/state.ts';

export const LAGOS_LATITUDE = 6.5;
/** Mid-November: the sun tracks a little south of overhead in Lagos. */
export const SUN_DECLINATION = -18;

const RAD = Math.PI / 180;
const clamp = (v: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, v));

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/**
 * Unit vector pointing from the ground toward the sun, in plot coordinates
 * (+x east, +y up, +z south), for a solar hour of the day.
 */
export function sunVector(
  hour: number,
  latDeg = LAGOS_LATITUDE,
  declDeg = SUN_DECLINATION,
): Vec3 {
  const H = (hour - 12) * 15 * RAD;
  const lat = latDeg * RAD;
  const dec = declDeg * RAD;
  const east = -Math.cos(dec) * Math.sin(H);
  const north =
    Math.cos(lat) * Math.sin(dec) - Math.sin(lat) * Math.cos(dec) * Math.cos(H);
  const up =
    Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.cos(H);
  return { x: east, y: up, z: -north };
}

/** Rotate a building-local (x, z) direction by the compass bearing. */
export function rotateXZ(
  v: { x: number; z: number },
  bearingDeg: number,
): { x: number; z: number } {
  const t = bearingDeg * RAD;
  return {
    x: v.x * Math.cos(t) - v.z * Math.sin(t),
    z: v.x * Math.sin(t) + v.z * Math.cos(t),
  };
}

/** Outside air temperature through the day, peaking mid-afternoon (°C). */
export function ambientTemp(hour: number): number {
  return 28.5 + 4.5 * Math.exp(-(((hour - 15) / 3.2) ** 2));
}

/** How readily each wall material passes the sun's heat indoors. */
export const WALL_FACTOR: Record<Material, number> = {
  earth: 0.5,
  block: 0.9,
  zinc: 1.3,
};
/** Roof heat gain that goes with each construction (thatch / tile / zinc). */
export const ROOF_FACTOR: Record<Material, number> = {
  earth: 0.25,
  block: 0.55,
  zinc: 1,
};

export type Breeze = 'breezy' | 'some air' | 'still';

export interface RoomScore {
  id: RoomId;
  /** 0–100, higher is more comfortable. */
  comfort: number;
  /** "Feels like" temperature in °C. */
  feel: number;
  breeze: Breeze;
  /** 0–1: how hard the sun is hitting this room's outside walls right now. */
  exposure: number;
  /** Outside side taking the most sun right now, if any. */
  hotSide: Side | null;
}

export interface DesignScore {
  hour: number;
  /** Area-weighted comfort across all rooms, 0–100. */
  overall: number;
  rooms: Record<RoomId, RoomScore>;
  hottest: RoomId;
}

/**
 * Fraction (0–1) of a wall's height that the eave leaves in direct sun.
 * `cosInc` is the sun's horizontal push onto the wall, `sunUp` its height.
 */
export function litFraction(
  overhang: number,
  wallHeight: number,
  cosInc: number,
  sunUp: number,
): number {
  if (cosInc <= 1e-6) return 0;
  const shadowDrop = (overhang * sunUp) / cosInc;
  return 1 - clamp(shadowDrop / wallHeight, 0, 1);
}

export function courtRatio(d: Design): number {
  return d.court ? rectArea(d.court) / rectArea(bounds(d)) : 0;
}

/** Things outside the building itself that change how a room feels. */
export interface ComfortContext {
  /** Rooms with a standing fan in them. */
  fans?: RoomId[];
  /** Mains power; fans do nothing during a cut. Defaults to on. */
  power?: boolean;
}

/** Degrees of relief from a running fan. */
export const FAN_COOL = 2.4;

/** Roof gain when there is no roof at all: the sun comes straight in. */
const NO_ROOF_FACTOR = 2;

function ventilation(d: Design, room: Room): { cool: number; breeze: Breeze } {
  // Only openings to the outside or the courtyard move air through a room.
  const open = SIDES.filter((s) => room.sides[s].type !== 'room' && isOpen(d, room, s));
  if (open.length === 0) return { cool: -0.8, breeze: 'still' };
  const opposite = open.some((s) => open.includes(OPPOSITE[s]));
  if (opposite) return { cool: 3.2, breeze: 'breezy' };
  if (open.length >= 2) return { cool: 2.4, breeze: 'breezy' };
  return { cool: 1, breeze: 'some air' };
}

export function scoreRoom(
  d: Design,
  room: Room,
  hour: number,
  ctx: ComfortContext = {},
): RoomScore {
  const sun = sunVector(hour);
  const sunUp = Math.max(0, sun.y);
  const height = Math.max(2.4, d.wallHeight);

  let wallGain = 0;
  let hotSide: Side | null = null;
  let hotGain = 0;
  if (sunUp > 0.02) {
    for (const side of room.exterior) {
      const n = rotateXZ(SIDE_NORMAL[side], d.rotation);
      const cosInc = n.x * sun.x + n.z * sun.z;
      if (cosInc <= 0) continue;
      const lit = litFraction(d.roof ? d.overhang[side] : 0, height, cosInc, sunUp);
      const opening = isOpen(d, room, side) ? 1.8 : 1;
      const gain = cosInc * lit * room.sides[side].exteriorLength * opening;
      wallGain += gain;
      if (gain > hotGain) {
        hotGain = gain;
        hotSide = side;
      }
    }
  }
  const perimeter = 2 * (rectW(room) + rectD(room));
  const exposure = clamp((wallGain / perimeter) * 2, 0, 1);

  const roofFactor = d.roof ? ROOF_FACTOR[d.material] : NO_ROOF_FACTOR;
  const roofGain = sunUp * roofFactor * clamp(3 / height, 0.6, 1.25);
  const solar = 6 * exposure * WALL_FACTOR[d.material] + 3 * roofGain;

  const vent = ventilation(d, room);
  const court = clamp(courtRatio(d) / 0.22, 0, 1);
  const opensToCourt = room.courtSides.some((s) => isOpen(d, room, s));
  const courtCool = court * (opensToCourt ? 2 : 0.7);
  const heightCool = (height - 2.4) * 0.5;
  const fanOn = ctx.power !== false && !!ctx.fans?.includes(room.id);
  const fanCool = fanOn ? FAN_COOL : 0;

  const feel =
    ambientTemp(hour) + solar - vent.cool - courtCool - heightCool - fanCool;
  const comfort = Math.round(clamp(100 - (feel - 24) * 7, 0, 100));
  return {
    id: room.id,
    comfort,
    feel: Math.round(feel * 10) / 10,
    breeze: vent.breeze,
    exposure,
    hotSide,
  };
}

export function scoreDesign(
  d: Design,
  hour: number = d.hour,
  ctx: ComfortContext = {},
): DesignScore {
  const out: Record<RoomId, RoomScore> = {};
  let weighted = 0;
  let area = 0;
  let hottest: RoomId = '';
  let worst = Infinity;
  for (const room of rooms(d)) {
    const s = scoreRoom(d, room, hour, ctx);
    out[room.id] = s;
    const a = rectArea(room);
    weighted += s.comfort * a;
    area += a;
    if (s.comfort < worst) {
      worst = s.comfort;
      hottest = room.id;
    }
  }
  return { hour, overall: area > 0 ? Math.round(weighted / area) : 0, rooms: out, hottest };
}

export interface DayScore {
  /** The Ilé Score: mean comfort over the whole day, 0–100. */
  overall: number;
  rooms: Record<RoomId, number>;
}

/** Whole-day score, 8 AM to 6 PM. This is the number the badge shows. */
export function scoreDay(d: Design, ctx: ComfortContext = {}): DayScore {
  const acc: Record<RoomId, number> = {};
  let overall = 0;
  let n = 0;
  for (let h = 8; h <= 18; h += 1) {
    const s = scoreDesign(d, h, ctx);
    overall += s.overall;
    for (const id of Object.keys(s.rooms)) acc[id] = (acc[id] ?? 0) + s.rooms[id].comfort;
    n += 1;
  }
  const out: Record<RoomId, number> = {};
  for (const id of Object.keys(acc)) out[id] = Math.round(acc[id] / n);
  return { overall: Math.round(overall / n), rooms: out };
}

/** Heat-map colour for a comfort value: red (hot) → orange → green → blue. */
export function comfortColor(comfort: number): [number, number, number] {
  const stops: [number, [number, number, number]][] = [
    [0, [0.82, 0.13, 0.1]],
    [35, [0.95, 0.5, 0.12]],
    [60, [0.45, 0.72, 0.3]],
    [85, [0.2, 0.55, 0.85]],
    [100, [0.16, 0.42, 0.9]],
  ];
  const c = clamp(comfort, 0, 100);
  for (let i = 1; i < stops.length; i += 1) {
    const [t1, c1] = stops[i];
    const [t0, c0] = stops[i - 1];
    if (c <= t1) {
      const k = (c - t0) / (t1 - t0);
      return [
        c0[0] + (c1[0] - c0[0]) * k,
        c0[1] + (c1[1] - c0[1]) * k,
        c0[2] + (c1[2] - c0[2]) * k,
      ];
    }
  }
  return stops[stops.length - 1][1];
}

export function formatHour(hour: number): string {
  const h = Math.floor(hour);
  const m = Math.round((hour - h) * 60);
  const suffix = h >= 12 ? 'PM' : 'AM';
  const h12 = ((h + 11) % 12) + 1;
  return `${h12}:${String(m).padStart(2, '0')} ${suffix}`;
}
