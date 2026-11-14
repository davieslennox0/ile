/**
 * "Your first home in Lagos" — the light story wrapper around Ilé.
 *
 * Pure data and rules only: savings and what building costs, belongings, the
 * afternoon power cut, the evening journal and Baba's return-visit prompts.
 * Two characters: the player, and Baba (the Elder, as the neighbour).
 */

import { scoreDay, scoreDesign, type ComfortContext } from '../heat/score.ts';
import {
  SIDES,
  lines,
  rectArea,
  roomLabel,
  rooms,
  type Design,
  type Material,
  type RoomId,
} from '../model/state.ts';
import prompts from './prompts.json' with { type: 'json' };
import { NO_EXTRAS, type Extras } from '../world/extras.ts';

export const START_SAVINGS = 600_000;
export const BELONGINGS = ['mattress', 'fan', 'pot', 'photo', 'rug', 'lantern'] as const;
export const START_ENERGY = 100;
export const START_JOY = 25;
export type ItemId = (typeof BELONGINGS)[number];

export const ITEM_LABEL: Record<ItemId, string> = {
  mattress: 'Mattress',
  fan: 'Standing fan',
  pot: 'Cooking pot',
  photo: 'Family photo',
  rug: 'Rug',
  lantern: 'Lantern',
};

/** Where a belonging sits: building-local metres, in a room. */
export interface Placed {
  item: ItemId;
  room: RoomId;
  x: number;
  y: number;
  z: number;
  /** Rotation about the vertical axis, radians. */
  rot: number;
}

export interface Story {
  v: 2;
  day: number;
  savings: number;
  movedIn: boolean;
  items: Placed[];
  /** Mains power; false during the afternoon cut. */
  power: boolean;
  /** The standing fan's switch. */
  fanOn: boolean;
  energy: number;
  joy: number;
  extras: Extras;
}

export function newStory(): Story {
  return {
    v: 2, day: 1, savings: START_SAVINGS, movedIn: false, items: [], power: true, fanOn: false,
    energy: START_ENERGY, joy: START_JOY, extras: { ...NO_EXTRAS },
  };
}

export function naira(amount: number): string {
  return `\u20A6${Math.round(amount).toLocaleString('en-NG')}`;
}

// ------------------------------------------------------------------ costs

const WALL_COST: Record<Material, number> = { earth: 400, block: 620, zinc: 300 };
const RATES = { floor: 1500, roof: 1200, opening: 6000, eave: 25_000, court: 15_000 };

function quantities(d: Design) {
  const floor = d.rooms.reduce((s, r) => s + rectArea(r), 0);
  // Courtyard edges that no room touches carry no wall, so count room lines only.
  const wallLength = lines({ ...d, court: null }).reduce((s, l) => s + (l.to - l.from), 0);
  return {
    floor,
    wall: wallLength * d.wallHeight * WALL_COST[d.material],
    roof: d.roof ? floor : 0,
    openings: Object.values(d.openings).filter(Boolean).length,
    eaves: d.roof ? SIDES.reduce((s, side) => s + Math.max(0, d.overhang[side] - 0.3), 0) : 0,
    court: d.court ? 1 : 0,
  };
}

/** What it costs to get from one design to another. Removing things is free. */
export function buildCost(from: Design, to: Design): number {
  const a = quantities(from);
  const b = quantities(to);
  const more = (x: number, y: number) => Math.max(0, y - x);
  const cost =
    more(a.floor, b.floor) * RATES.floor +
    more(a.wall, b.wall) +
    more(a.roof, b.roof) * RATES.roof +
    more(a.openings, b.openings) * RATES.opening +
    more(a.eaves, b.eaves) * RATES.eave +
    more(a.court, b.court) * RATES.court;
  return Math.round(cost / 500) * 500;
}

// ---------------------------------------------------------------- comfort

/** Fans only help in rooms that have one, and only while there is power. */
export function comfortContext(story: Story | null): ComfortContext {
  if (!story) return {};
  return {
    fans: story.fanOn ? story.items.filter((i) => i.item === 'fan').map((i) => i.room) : [],
    power: story.power,
  };
}

// ---------------------------------------------------------------- journal

export interface Journal {
  title: string;
  lines: string[];
}

/** The evening card: how the house did today. */
export function journal(d: Design, story: Story): Journal {
  const ctx = comfortContext({ ...story, power: false });
  const afternoon = scoreDesign(d, 15, ctx);
  const ranked = rooms(d)
    .map((r) => ({ label: r.label, feel: afternoon.rooms[r.id].feel }))
    .sort((p, q) => p.feel - q.feel);
  const out: string[] = [];
  if (ranked.length > 0) {
    const cool = ranked[0];
    out.push(`Coolest room: ${cool.label}, ${cool.feel.toFixed(0)}\u00B0C at 3 PM.`);
    const hot = ranked[ranked.length - 1];
    if (ranked.length > 1) out.push(`Hottest: ${hot.label}, ${hot.feel.toFixed(0)}\u00B0C.`);
  }
  out.push(`Il\u00E9 Score ${scoreDay(d, ctx).overall} without the fan. Savings ${naira(story.savings)}.`);
  return { title: `Day ${story.day} in Lagos`, lines: out };
}

// ------------------------------------------------------------------ baba

export const BABA = {
  arrival: prompts.arrival,
  moveIn: prompts.moveIn,
  afternoon: prompts.afternoon,
  nepa: prompts.nepa,
  afterNepa: prompts.afterNepa,
  evening: prompts.evening,
};

/** Baba's one small prompt at the start of a return visit, if any. */
export function visitPrompt(day: number): string | null {
  return prompts.visits.find((v) => v.day === day)?.text ?? null;
}

/** The room a belonging is in, for labels. */
export function itemRoomLabel(d: Design, item: Placed): string {
  return roomLabel(d, item.room);
}

// ------------------------------------------------------------ persistence

export function serializeStory(s: Story): string {
  return JSON.stringify(s);
}

export function deserializeStory(json: string): Story | null {
  try {
    const raw = JSON.parse(json) as Partial<Story> | null;
    if (!raw || raw.v !== 2 || !Array.isArray(raw.items)) return null;
    const num = (v: unknown, f: number) => (typeof v === 'number' && Number.isFinite(v) ? v : f);
    const items: Placed[] = [];
    for (const i of raw.items) {
      if (!i || !BELONGINGS.includes(i.item) || typeof i.room !== 'string') continue;
      items.push({ item: i.item, room: i.room, x: num(i.x, 0), y: num(i.y, 0), z: num(i.z, 0), rot: num(i.rot, 0) });
    }
    const e = (raw.extras ?? {}) as Partial<Extras>;
    return {
      v: 2,
      day: Math.max(1, Math.round(num(raw.day, 1))),
      savings: Math.max(0, num(raw.savings, START_SAVINGS)),
      movedIn: raw.movedIn === true,
      items,
      power: true,
      fanOn: raw.fanOn === true,
      energy: Math.max(0, Math.min(100, num(raw.energy, START_ENERGY))),
      joy: Math.max(0, Math.min(100, num(raw.joy, START_JOY))),
      extras: {
        floors: Math.max(1, Math.min(3, Math.round(num(e.floors, 1)))),
        garden: e.garden === true,
        solar: e.solar === true,
        shop: Math.max(0, Math.min(2, Math.round(num(e.shop, 0)))),
        car: e.car === true,
        party: e.party === true,
      },
    };
  } catch {
    return null;
  }
}
