/**
 * The built-in Elder. When the model endpoint is unreachable or returns
 * something unusable, this rule-based advisor answers instead, so the agentic
 * loop (propose → ghost preview → accept/reject) never dead-ends.
 *
 * It tries every sensible single move, scores each with the same heuristic
 * the heat map uses, and proposes the one or two that help most.
 */

import { scoreDay, scoreDesign } from '../heat/score.ts';
import {
  LIMITS,
  SIDES,
  isOpen,
  normalizeRotation,
  rectD,
  rectW,
  roomLabel,
  rooms,
  type Design,
} from '../model/state.ts';
import {
  MAX_ACTIONS,
  actionChanges,
  applyAction,
  type ElderAction,
  type ElderReply,
} from './actions.ts';

/** Blend of "right now" and whole-day comfort, so advice fits the hour. */
function value(d: Design): number {
  return 0.5 * scoreDesign(d).overall + 0.5 * scoreDay(d).overall;
}

function candidates(d: Design): ElderAction[] {
  const out: ElderAction[] = [];
  for (const side of SIDES) {
    if (d.overhang[side] < 1.2) {
      out.push({ type: 'set_overhang', side, value: 1.2 });
    }
  }
  for (const room of rooms(d)) {
    for (const side of SIDES) {
      if (room.sides[side].type !== 'room' && !isOpen(d, room, side)) {
        out.push({ type: 'add_opening', room: room.id, side });
      }
    }
  }
  out.push({ type: 'set_rotation', value: normalizeRotation(d.rotation + 90) });
  if (d.court) {
    out.push({ type: 'resize_courtyard', width: rectW(d.court) + 1, depth: rectD(d.court) + 1 });
  }
  if (d.wallHeight < LIMITS.wallHeight.max - 0.4) {
    out.push({
      type: 'set_wall_height',
      value: Math.round((d.wallHeight + 0.4) * 10) / 10,
    });
  }
  if (d.material !== 'earth') out.push({ type: 'set_material', value: 'earth' });
  return out.filter((a) => actionChanges(d, a));
}

function best(
  d: Design,
  skipTypes: string[],
): { action: ElderAction; gain: number } | null {
  const base = value(d);
  let top: { action: ElderAction; gain: number } | null = null;
  for (const action of candidates(d)) {
    if (skipTypes.includes(action.type)) continue;
    const gain = value(applyAction(d, action)) - base;
    if (gain > 0.4 && (!top || gain > top.gain)) top = { action, gain };
  }
  return top;
}

function line(d: Design, a: ElderAction): string {
  const hot = roomLabel(d, scoreDesign(d).hottest).toLowerCase();
  switch (a.type) {
    case 'set_overhang':
      return `The ${a.side} wall stands naked in the sun. Our builders let the roof reach far past the wall, so the wall rests in shade.`;
    case 'add_opening':
      return `The ${roomLabel(d, a.room).toLowerCase()} holds its breath. Open it to the ${a.side}, so air can enter one side and leave by the other.`;
    case 'remove_opening':
      return `That ${a.side} opening lets the sun walk straight in. Close it and let the wall do its work.`;
    case 'set_rotation':
      return `Your long walls face the rising and setting sun. Turn the house, so only the short ends meet the low sun.`;
    case 'resize_courtyard':
      return `The courtyard is the lungs of the compound. Give it more room, and every room around it breathes easier.`;
    case 'set_wall_height':
      return `Warm air rises. Lift the walls, and the heat gathers above your head, not around it.`;
    case 'set_material':
      return `Thick earth drinks the day's heat slowly and gives it back at night. Build the ${hot} in earth again.`;
  }
}

export function localElder(d: Design): ElderReply {
  const first = best(d, []);
  if (!first) {
    return {
      say: 'This house already sits well under the sun. Deep eaves, moving air, an open courtyard. Step inside and feel it.',
      actions: [],
      source: 'local',
    };
  }
  const actions: ElderAction[] = [first.action];
  const after = applyAction(d, first.action);
  const second = best(after, [first.action.type]);
  if (second && actions.length < MAX_ACTIONS) actions.push(second.action);
  return { say: line(d, first.action), actions, source: 'local' };
}

/** Spoken when the Elder is opened for the first time. */
export const ELDER_GREETING =
  'Ẹ káàbọ̀. Welcome. This is ilé, a home. Shape it with your hands, and I will tell you how the sun treats it.';
