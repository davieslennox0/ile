/**
 * The Elder's vocabulary: the small set of structured actions the agent may
 * propose, plus validation of untrusted model output and pure application.
 * The agent proposes; the user's hands decide.
 */

import {
  LIMITS,
  MATERIALS,
  SIDES,
  isOpen,
  isValidSlot,
  rectD,
  rectW,
  bounds,
  roomLabel,
  rooms,
  setCourtSize,
  setMaterial,
  setOpening,
  setOverhang,
  setRotation,
  setWallHeight,
  type Design,
  type Material,
  type RoomId,
  type Side,
} from '../model/state.ts';

export type ElderAction =
  | { type: 'set_overhang'; side: Side | 'all'; value: number }
  | { type: 'add_opening'; room: RoomId; side: Side }
  | { type: 'remove_opening'; room: RoomId; side: Side }
  | { type: 'set_rotation'; value: number }
  | { type: 'resize_courtyard'; width: number; depth: number }
  | { type: 'set_wall_height'; value: number }
  | { type: 'set_material'; value: Material };

export interface ElderReply {
  say: string;
  actions: ElderAction[];
  /** Where the advice came from: the language-model endpoint or the built-in rules. */
  source: 'model' | 'local';
}

export const MAX_ACTIONS = 2;
export const MAX_SAY = 320;

const isNum = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v);
const isSide = (v: unknown): v is Side => SIDES.includes(v as Side);

/** Validate one untrusted action against a design. Returns a clean copy or null. */
export function validateAction(raw: unknown, d: Design): ElderAction | null {
  if (!raw || typeof raw !== 'object') return null;
  const a = raw as Record<string, unknown>;
  switch (a.type) {
    case 'set_overhang': {
      if (!(isSide(a.side) || a.side === 'all') || !isNum(a.value)) return null;
      const { min, max } = LIMITS.overhang;
      if (a.value < min || a.value > max) return null;
      return { type: 'set_overhang', side: a.side, value: a.value };
    }
    case 'add_opening':
    case 'remove_opening': {
      if (typeof a.room !== 'string' || !isSide(a.side)) return null;
      if (!isValidSlot(d, a.room, a.side)) return null;
      return { type: a.type, room: a.room, side: a.side };
    }
    case 'set_rotation': {
      if (!isNum(a.value) || Math.abs(a.value) > 360) return null;
      return { type: 'set_rotation', value: a.value };
    }
    case 'resize_courtyard': {
      if (!isNum(a.width) || !isNum(a.depth)) return null;
      if (!d.court || a.width < LIMITS.minCourt || a.depth < LIMITS.minCourt) return null;
      if (a.width > 15 || a.depth > 15) return null;
      return { type: 'resize_courtyard', width: a.width, depth: a.depth };
    }
    case 'set_wall_height': {
      const { min, max } = LIMITS.wallHeight;
      if (!isNum(a.value) || a.value < min || a.value > max) return null;
      return { type: 'set_wall_height', value: a.value };
    }
    case 'set_material': {
      if (!MATERIALS.includes(a.value as Material)) return null;
      return { type: 'set_material', value: a.value as Material };
    }
    default:
      return null;
  }
}

export function applyAction(d: Design, a: ElderAction): Design {
  switch (a.type) {
    case 'set_overhang':
      return setOverhang(d, a.side, a.value);
    case 'add_opening':
      return setOpening(d, a.room, a.side, true);
    case 'remove_opening':
      return setOpening(d, a.room, a.side, false);
    case 'set_rotation':
      return setRotation(d, a.value);
    case 'resize_courtyard':
      return setCourtSize(d, a.width, a.depth);
    case 'set_wall_height':
      return setWallHeight(d, a.value);
    case 'set_material':
      return setMaterial(d, a.value);
  }
}

export function applyActions(d: Design, actions: ElderAction[]): Design {
  return actions.reduce(applyAction, d);
}

/** True when applying the action would actually change the design. */
export function actionChanges(d: Design, a: ElderAction): boolean {
  return JSON.stringify(applyAction(d, a)) !== JSON.stringify(d);
}

/**
 * Validate a whole untrusted reply against the current design. Drops invalid
 * or no-op actions, caps the count, and returns null when nothing usable is
 * left — the caller then falls back to the built-in Elder.
 */
export function validateReply(
  raw: unknown,
  d: Design,
): { say: string; actions: ElderAction[] } | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.say !== 'string') return null;
  const say = r.say.replace(/\s+/g, ' ').trim().slice(0, MAX_SAY);
  if (!say) return null;
  if (!Array.isArray(r.actions)) return null;
  const actions: ElderAction[] = [];
  let working = d;
  for (const item of r.actions) {
    const a = validateAction(item, working);
    if (!a || !actionChanges(working, a)) continue;
    actions.push(a);
    working = applyAction(working, a);
    if (actions.length >= MAX_ACTIONS) break;
  }
  return actions.length > 0 ? { say, actions } : null;
}

/** Short human label for a proposed action, shown beside its ghost preview. */
export function describeAction(a: ElderAction, d: Design): string {
  switch (a.type) {
    case 'set_overhang':
      return a.side === 'all'
        ? `Deepen all eaves to ${a.value.toFixed(1)} m`
        : `Deepen the ${a.side} eaves to ${a.value.toFixed(1)} m`;
    case 'add_opening':
      return `Open the ${roomLabel(d, a.room).toLowerCase()} to the ${a.side}`;
    case 'remove_opening':
      return `Close the ${a.side} opening of the ${roomLabel(d, a.room).toLowerCase()}`;
    case 'set_rotation':
      return `Turn the house to ${a.value}°`;
    case 'resize_courtyard':
      return `Widen the courtyard to ${a.width} × ${a.depth} m`;
    case 'set_wall_height':
      return `Raise the walls to ${a.value.toFixed(1)} m`;
    case 'set_material':
      return `Build the walls in ${a.value}`;
  }
}

/** Compact state the Elder endpoint receives. */
export function elderPayload(
  d: Design,
  scores: {
    now: {
      overall: number;
      rooms: Record<string, { comfort: number; feel: number; breeze: string; hotSide: string | null }>;
      hottest: string;
    };
    day: { overall: number };
  },
) {
  const b = bounds(d);
  return {
    hour: d.hour,
    rotation: d.rotation,
    material: d.material,
    wallHeight: d.wallHeight,
    overhang: d.overhang,
    footprint: { width: rectW(b), depth: rectD(b) },
    courtyard: d.court ? { width: rectW(d.court), depth: rectD(d.court) } : null,
    rooms: rooms(d).map((room) => ({
      id: room.id,
      name: room.label,
      comfort: scores.now.rooms[room.id].comfort,
      feelsLikeC: scores.now.rooms[room.id].feel,
      breeze: scores.now.rooms[room.id].breeze,
      sunniestWall: scores.now.rooms[room.id].hotSide,
      // Only sides that face outside or the courtyard can move air.
      openings: SIDES.filter((s) => room.sides[s].type !== 'room').map((s) => ({
        side: s,
        faces: room.sides[s].type === 'court' ? 'courtyard' : 'outside',
        open: isOpen(d, room, s),
      })),
    })),
    hottestRoom: scores.now.hottest,
    scoreNow: scores.now.overall,
    scoreDay: scores.day.overall,
  };
}
