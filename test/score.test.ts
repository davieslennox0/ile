import assert from 'node:assert/strict';
import { test } from 'node:test';

import { applyActions, validateAction, validateReply } from '../src/elder/actions.ts';
import { localElder } from '../src/elder/local.ts';
import {
  ambientTemp,
  comfortColor,
  litFraction,
  scoreDay,
  scoreDesign,
  sunVector,
} from '../src/heat/score.ts';
import {
  START_SAVINGS,
  buildCost,
  comfortContext,
  deserializeStory,
  journal,
  naira,
  newStory,
  serializeStory,
  visitPrompt,
} from '../src/story/story.ts';
import {
  History,
  addRoom,
  fitRoom,
  defaultDesign,
  deserialize,
  enclosedGap,
  findEnclosedGap,
  isComplete,
  lines,
  moveLine,
  rectD,
  rectW,
  roomById,
  rooms,
  scratchDesign,
  serialize,
  setCourt,
  setCourtSize,
  setMaterial,
  setOpening,
  setOverhang,
  setRoof,
  setRotation,
  setWallHeight,
  type Design,
} from '../src/model/state.ts';

/** Four rooms around an open middle, laid one by one as a user would. */
function scratchRing(): Design {
  let d = scratchDesign();
  for (const r of [
    { x0: -5, x1: 5, z0: -6, z1: -2 }, // north
    { x0: -5, x1: 5, z0: 2, z1: 6 }, // south
    { x0: -5, x1: -2, z0: -2, z1: 2 }, // west
    { x0: 2, x1: 5, z0: -2, z1: 2 }, // east
  ]) {
    const next = addRoom(d, r);
    assert.ok(next, 'room fits');
    d = next;
  }
  return d;
}

test('sun: east in the morning, west in the afternoon, high at noon', () => {
  const am = sunVector(8);
  const noon = sunVector(12);
  const pm = sunVector(16);
  assert.ok(am.x > 0.5, 'morning sun is in the east');
  assert.ok(pm.x < -0.5, 'afternoon sun is in the west');
  assert.ok(noon.y > 0.85, 'noon sun is high over Lagos');
  assert.ok(noon.z > 0, 'November sun sits to the south');
  for (const v of [am, noon, pm]) {
    assert.ok(Math.abs(Math.hypot(v.x, v.y, v.z) - 1) < 1e-9);
  }
});

test('ambient temperature peaks mid-afternoon', () => {
  assert.ok(ambientTemp(15) > ambientTemp(9));
  assert.ok(ambientTemp(15) > ambientTemp(18));
});

test('deeper eaves leave less wall in the sun', () => {
  assert.ok(litFraction(1.5, 3, 0.67, 0.63) < litFraction(0.3, 3, 0.67, 0.63));
  assert.equal(litFraction(1, 3, 0, 0.5), 0);
  assert.equal(litFraction(0, 3, 0.5, 0.5), 1);
});

test('the compound template: eight named rooms around a courtyard', () => {
  const d = defaultDesign();
  const rs = rooms(d);
  assert.equal(rs.length, 8);
  assert.ok(isComplete(d));
  const parlour = roomById(d, 'parlour');
  assert.equal(parlour.label, 'Parlour');
  assert.deepEqual(parlour.exterior, ['north']);
  assert.deepEqual(parlour.courtSides, ['south']);
  assert.equal(parlour.sides.east.type, 'room');
  assert.equal(parlour.sides.east.neighbour, 'kitchen');
  assert.deepEqual(roomById(d, 'kitchen').exterior, ['north', 'east']);
});

test('all scores stay within 0–100 for every hour', () => {
  const d = defaultDesign();
  for (let h = 8; h <= 18; h += 0.5) {
    const s = scoreDesign(d, h);
    assert.ok(s.overall >= 0 && s.overall <= 100);
    for (const r of Object.values(s.rooms)) {
      assert.ok(r.comfort >= 0 && r.comfort <= 100);
      assert.ok(r.exposure >= 0 && r.exposure <= 1);
    }
  }
});

test('the west bedroom is the afternoon problem in the template', () => {
  const s = scoreDesign(defaultDesign(), 15);
  assert.equal(s.rooms.bed2.hotSide, 'west');
  assert.ok(s.rooms.bed2.comfort < s.rooms.bed1.comfort);
});

test('west eaves help the west bedroom in the afternoon', () => {
  const d = defaultDesign();
  const before = scoreDesign(d, 15).rooms.bed2.comfort;
  assert.ok(scoreDesign(setOverhang(d, 'west', 1.5), 15).rooms.bed2.comfort > before);
});

test('cross-ventilation raises comfort and reads as breezy', () => {
  const d = defaultDesign();
  const before = scoreDesign(d, 15).rooms.bed2;
  const after = scoreDesign(setOpening(d, 'bed2', 'east', true), 15).rooms.bed2;
  assert.equal(before.breeze, 'some air');
  assert.equal(after.breeze, 'breezy');
  assert.ok(after.comfort > before.comfort);
});

test('doors between rooms do not count as ventilation', () => {
  const d = defaultDesign();
  // The store only has doors to its neighbours: still air.
  assert.equal(scoreDesign(d, 15).rooms.store.breeze, 'still');
});

test('earth beats block beats zinc', () => {
  const d = defaultDesign();
  const earth = scoreDay(d).overall;
  const block = scoreDay(setMaterial(d, 'block')).overall;
  const zinc = scoreDay(setMaterial(d, 'zinc')).overall;
  assert.ok(earth > block && block > zinc);
});

test('a bigger courtyard improves the day score and keeps rooms attached', () => {
  const d = defaultDesign();
  const bigger = setCourtSize(d, 5, 7);
  assert.equal(rectW(bigger.court!), 5);
  assert.equal(rectD(bigger.court!), 7);
  assert.equal(roomById(bigger, 'parlour').sides.south.type, 'court');
  assert.ok(scoreDay(bigger).overall > scoreDay(d).overall);
});

test('turning the house moves the west bedroom out of the afternoon sun', () => {
  const d = defaultDesign();
  const turned = scoreDesign(setRotation(d, 90), 15).rooms.bed2;
  assert.equal(turned.hotSide, null, 'its outside wall now faces north');
  assert.ok(turned.comfort > scoreDesign(d, 15).rooms.bed2.comfort);
});

test('dragging a wall line moves every room that shares it', () => {
  const d = defaultDesign();
  const moved = moveLine(d, 'x', 5, 6.26);
  for (const id of ['kitchen', 'bed1', 'bed3']) assert.equal(roomById(moved, id).x1, 6.5);
  assert.equal(roomById(moved, 'parlour').x1, 1.5, 'inner rooms stay put');
  // A line cannot be dragged through the rooms beside it.
  const squeezed = moveLine(d, 'x', 5, -20);
  assert.ok(rectW(roomById(squeezed, 'bed1')) >= 1);
  assert.equal(lines(d).length, 8);
});

test('scratch: rooms snap to the grid and cannot overlap or be tiny', () => {
  let d = scratchDesign();
  assert.equal(isComplete(d), false);
  const one = addRoom(d, { x0: -4.9, x1: 0.1, z0: -3.2, z1: 0.26 });
  assert.ok(one);
  d = one;
  assert.deepEqual(
    { x0: d.rooms[0].x0, x1: d.rooms[0].x1, z0: d.rooms[0].z0, z1: d.rooms[0].z1 },
    { x0: -5, x1: 0, z0: -3, z1: 0.5 },
  );
  assert.equal(addRoom(d, { x0: -1, x1: 3, z0: -1, z1: 2 }), null, 'overlap is refused');
  assert.equal(addRoom(d, { x0: 2, x1: 2.5, z0: 2, z1: 6 }), null, 'too thin is refused');
  assert.ok(addRoom(d, { x0: 0, x1: 3, z0: -3, z1: 0.5 }), 'touching is fine');
});

test('scratch: a dragged room butts up against its neighbours', () => {
  const d = addRoom(addRoom(scratchDesign(), { x0: -5, x1: 5, z0: -6, z1: -2 })!, { x0: -5, x1: 5, z0: 2, z1: 6 })!;
  // Dragged a little too far south: pulled back to the south room's edge.
  assert.deepEqual(fitRoom(d, { x: -5, z: -2 }, { x: -1.8, z: 2.3 }), { x0: -5, x1: -2, z0: -2, z1: 2 });
  // Dragged up into the north room from below.
  assert.deepEqual(fitRoom(d, { x: 5, z: 2 }, { x: 2, z: -2.6 }), { x0: 2, x1: 5, z0: -2, z1: 2 });
  assert.equal(fitRoom(d, { x: 0, z: -4 }, { x: 3, z: -3 }), null, 'starting inside a room');
  assert.equal(fitRoom(d, { x: 0, z: 0 }, { x: 0.2, z: 0.3 }), null, 'too small');
});

test('scratch: the enclosed middle is found and becomes the courtyard', () => {
  let d = scratchRing();
  assert.equal(enclosedGap(d, 0, 0)?.x0, -2);
  assert.deepEqual(findEnclosedGap(d), { x0: -2, x1: 2, z0: -2, z1: 2 });
  assert.equal(enclosedGap(d, -3, 0), null, 'inside a room');
  assert.equal(enclosedGap(d, 8, 0), null, 'not enclosed');
  d = setCourt(d, findEnclosedGap(d));
  const west = rooms(d).find((r) => r.x1 === -2);
  assert.ok(west);
  assert.deepEqual(west.courtSides, ['east']);
  assert.deepEqual(west.exterior, ['west']);
});

test('scratch: rooms are named by size, and a finished house scores', () => {
  let d = setCourt(scratchRing(), { x0: -2, x1: 2, z0: -2, z1: 2 });
  const labels = rooms(d).map((r) => r.label).sort();
  assert.deepEqual(labels, ['Bedroom 1', 'Bedroom 2', 'Kitchen', 'Parlour']);
  d = setWallHeight(d, 3);
  assert.equal(isComplete(d), false, 'no roof yet');
  const roofless = scoreDay(d).overall;
  d = setRoof(d, true);
  assert.ok(isComplete(d));
  assert.ok(scoreDay(d).overall > roofless, 'a roof helps');
  // Opening the rooms to the courtyard and the outside cools the house.
  let open = d;
  for (const r of rooms(d)) {
    for (const s of [...r.exterior.slice(0, 1), ...r.courtSides]) open = setOpening(open, r.id, s, true);
  }
  assert.ok(scoreDay(open).overall > scoreDay(d).overall + 5);
});

test('wall height is 0 until raised, then clamps to 2.4–4.5 m', () => {
  const d = scratchRing();
  assert.equal(setWallHeight(d, 0.8).wallHeight, 0);
  assert.equal(setWallHeight(d, 1.6).wallHeight, 2.4);
  assert.equal(setWallHeight(d, 99).wallHeight, 4.5);
});

test('serialize round-trips and rejects junk', () => {
  const d = setOverhang(defaultDesign(), 'west', 1.2);
  assert.deepEqual(deserialize(serialize(d)), d);
  const s = setCourt(scratchRing(), { x0: -2, x1: 2, z0: -2, z1: 2 });
  assert.deepEqual(deserialize(serialize(s)), s);
  assert.equal(deserialize('not json'), null);
  assert.equal(deserialize('{"v":1}'), null);
  const overlapping = JSON.parse(serialize(d));
  overlapping.rooms[0].x1 = 9;
  assert.equal(deserialize(JSON.stringify(overlapping)), null);
});

test('history undoes edits in order', () => {
  const h = new History();
  const a = defaultDesign();
  const b = setOverhang(a, 'west', 1);
  h.commit(a);
  h.commit(b);
  assert.deepEqual(h.undo(), b);
  assert.deepEqual(h.undo(), a);
  assert.equal(h.undo(), null);
});

test('action validation rejects anything outside the vocabulary', () => {
  const d = defaultDesign();
  assert.ok(validateAction({ type: 'set_overhang', side: 'west', value: 1.2 }, d));
  assert.equal(validateAction({ type: 'set_overhang', side: 'up', value: 1 }, d), null);
  assert.equal(validateAction({ type: 'set_overhang', side: 'west', value: 9 }, d), null);
  assert.equal(validateAction({ type: 'add_opening', room: 'attic', side: 'north' }, d), null);
  assert.ok(validateAction({ type: 'add_opening', room: 'bed2', side: 'east' }, d));
  assert.equal(validateAction({ type: 'resize_courtyard', width: 5, depth: 5 }, scratchRing()), null);
  assert.equal(validateAction({ type: 'demolish' }, d), null);
  assert.equal(validateAction(null, d), null);
});

test('reply validation drops no-ops and caps the action count', () => {
  const d = defaultDesign();
  const reply = validateReply(
    {
      say: '  Shade the west wall.  ',
      actions: [
        { type: 'add_opening', room: 'bed2', side: 'west' }, // already open
        { type: 'set_overhang', side: 'west', value: 1.2 },
        { type: 'nonsense' },
        { type: 'add_opening', room: 'bed2', side: 'east' },
        { type: 'set_rotation', value: 90 },
      ],
    },
    d,
  );
  assert.ok(reply);
  assert.equal(reply.say, 'Shade the west wall.');
  assert.equal(reply.actions.length, 2);
  assert.equal(validateReply({ say: 'hi', actions: [] }, d), null);
  assert.equal(validateReply({ actions: [] }, d), null);
});

test('the built-in elder only proposes moves that raise the score', () => {
  for (const start of [
    defaultDesign(),
    setRoof(setWallHeight(setCourt(scratchRing(), { x0: -2, x1: 2, z0: -2, z1: 2 }), 3), true),
  ]) {
    let d = start;
    for (let i = 0; i < 6; i += 1) {
      const reply = localElder(d);
      assert.ok(reply.say.length > 0);
      if (reply.actions.length === 0) break;
      assert.ok(reply.actions.length <= 2);
      const next = applyActions(d, reply.actions);
      assert.ok(scoreDay(next).overall >= scoreDay(d).overall);
      d = next;
    }
    assert.ok(scoreDay(d).overall > scoreDay(start).overall + 8);
  }
});

test('heat colours run from red (hot) to blue (cool)', () => {
  const hot = comfortColor(0);
  const cool = comfortColor(100);
  assert.ok(hot[0] > hot[2]);
  assert.ok(cool[2] > cool[0]);
});

// ----------------------------------------------------------------- story

function finishedRing(): Design {
  return setRoof(setWallHeight(setCourt(scratchRing(), { x0: -2, x1: 2, z0: -2, z1: 2 }), 3), true);
}

test('story: a modest house fits the starting savings, with money left to improve it', () => {
  const total = buildCost(scratchDesign(), finishedRing());
  assert.ok(total > 200_000 && total < START_SAVINGS - 100_000, naira(total));
  assert.equal(naira(600000), '\u20A6600,000');
});

test('story: every kind of building work costs something; undoing it is free', () => {
  const d = finishedRing();
  const id = d.rooms[0].id;
  assert.ok(buildCost(d, setOverhang(d, 'west', 1.2)) > 0);
  assert.ok(buildCost(d, setOpening(d, id, 'north', true)) > 0);
  assert.ok(buildCost(d, setWallHeight(d, 3.6)) > 0);
  assert.ok(buildCost(d, addRoom(d, { x0: 5, x1: 8, z0: -2, z1: 2 })!) > 0);
  assert.equal(buildCost(setOverhang(d, 'west', 1.2), d), 0);
  assert.equal(buildCost(d, setRotation(d, 90)), 0, 'turning the plan on paper is free');
});

test('story: a fan cools its room until NEPA takes light', () => {
  const d = finishedRing();
  const story = newStory();
  const room = d.rooms[0].id;
  story.items.push({ item: 'fan', room, x: 0, y: 0, z: 0, rot: 0 });
  story.fanOn = true;
  const bare = scoreDesign(d, 15).rooms[room].comfort;
  const fanned = scoreDesign(d, 15, comfortContext(story)).rooms[room].comfort;
  assert.ok(fanned > bare + 10, 'the fan helps');
  story.power = false;
  assert.equal(scoreDesign(d, 15, comfortContext(story)).rooms[room].comfort, bare, 'not without power');
  // Other rooms never had the fan.
  const other = d.rooms[1].id;
  assert.equal(scoreDesign(d, 15, comfortContext({ ...story, power: true })).rooms[other].comfort, scoreDesign(d, 15).rooms[other].comfort);
});

test('story: the journal names the coolest room, and visits bring a prompt', () => {
  const j = journal(finishedRing(), newStory());
  assert.equal(j.title, 'Day 1 in Lagos');
  assert.match(j.lines[0], /^Coolest room: /);
  assert.match(j.lines[j.lines.length - 1], /Savings \u20A6600,000/);
  assert.equal(visitPrompt(1), null);
  assert.match(visitPrompt(2) ?? '', /sister/);
});

test('story: saves and loads, and survives junk', () => {
  const s = newStory();
  s.day = 3;
  s.savings = 123_500;
  s.movedIn = true;
  s.items.push({ item: 'photo', room: 'r1', x: 1, y: 1.5, z: -2, rot: 0 });
  s.fanOn = true;
  s.joy = 70;
  s.extras = { ...s.extras, floors: 2, shop: 1 };
  assert.deepEqual(deserializeStory(serializeStory(s)), s);
  assert.equal(deserializeStory('{"v":9}'), null);
  assert.equal(deserializeStory('{"v":1,"items":[]}'), null);
  assert.equal(deserializeStory('nope'), null);
});
