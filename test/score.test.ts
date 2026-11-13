import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  applyActions,
  validateAction,
  validateReply,
} from '../src/elder/actions.ts';
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
  History,
  defaultDesign,
  deserialize,
  normalize,
  rectD,
  rectW,
  rooms,
  serialize,
  setCourtSize,
  setMaterial,
  setOpening,
  setOuterWall,
  setOverhang,
  setRotation,
  slotKeys,
} from '../src/model/state.ts';

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
  const shallow = litFraction(0.3, 3, 0.67, 0.63);
  const deep = litFraction(1.5, 3, 0.67, 0.63);
  assert.ok(deep < shallow);
  assert.equal(litFraction(1, 3, 0, 0.5), 0);
  assert.equal(litFraction(0, 3, 0.5, 0.5), 1);
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

test('the west bedroom is the afternoon problem in the start template', () => {
  const s = scoreDesign(defaultDesign(), 15);
  assert.equal(s.rooms.bed2.hotSide, 'west');
  assert.ok(s.rooms.bed2.comfort < s.rooms.bed1.comfort);
});

test('west eaves help the west bedroom in the afternoon', () => {
  const d = defaultDesign();
  const before = scoreDesign(d, 15).rooms.bed2.comfort;
  const after = scoreDesign(setOverhang(d, 'west', 1.5), 15).rooms.bed2.comfort;
  assert.ok(after > before);
});

test('cross-ventilation raises comfort and reads as breezy', () => {
  const d = defaultDesign();
  const before = scoreDesign(d, 15).rooms.bed2;
  const after = scoreDesign(setOpening(d, 'bed2', 'east', true), 15).rooms.bed2;
  assert.equal(before.breeze, 'some air');
  assert.equal(after.breeze, 'breezy');
  assert.ok(after.comfort > before.comfort);
});

test('earth beats block beats zinc', () => {
  const d = defaultDesign();
  const earth = scoreDay(d).overall;
  const block = scoreDay(setMaterial(d, 'block')).overall;
  const zinc = scoreDay(setMaterial(d, 'zinc')).overall;
  assert.ok(earth > block && block > zinc);
});

test('a bigger courtyard improves the day score', () => {
  const d = defaultDesign();
  assert.ok(scoreDay(setCourtSize(d, 5, 7)).overall > scoreDay(d).overall);
});

test('turning the house moves the west bedroom out of the afternoon sun', () => {
  const d = defaultDesign();
  const turned = scoreDesign(setRotation(d, 90), 15).rooms.bed2;
  assert.equal(turned.hotSide, null, 'its outside wall now faces north');
  assert.ok(turned.comfort > scoreDesign(d, 15).rooms.bed2.comfort);
});

test('normalize keeps the compound buildable', () => {
  const d = normalize({
    ...defaultDesign(),
    outer: { x0: -0.2, x1: 50, z0: 3, z1: 3.1 },
    wallHeight: 99,
    rotation: 367,
  });
  for (const r of rooms(d)) {
    assert.ok(rectW(r) >= 2 && rectD(r) >= 2, `${r.id} has room`);
  }
  assert.ok(d.outer.x1 <= 10);
  assert.equal(d.wallHeight, 4.5);
  assert.equal(d.rotation, 0);
  assert.equal(Object.keys(d.openings).length, slotKeys(d).length);
});

test('walls snap to the half-metre grid', () => {
  const d = setOuterWall(defaultDesign(), 'east', 6.26);
  assert.equal(d.outer.x1, 6.5);
});

test('serialize round-trips and rejects junk', () => {
  const d = setOverhang(defaultDesign(), 'west', 1.2);
  assert.deepEqual(deserialize(serialize(d)), d);
  assert.equal(deserialize('not json'), null);
  assert.equal(deserialize('{"v":2}'), null);
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
  assert.ok(validateAction({ type: 'set_overhang', side: 'west', value: 1.2 }));
  assert.equal(validateAction({ type: 'set_overhang', side: 'up', value: 1 }), null);
  assert.equal(validateAction({ type: 'set_overhang', side: 'west', value: 9 }), null);
  assert.equal(validateAction({ type: 'add_opening', room: 'bed2', side: 'north' }), null);
  assert.ok(validateAction({ type: 'add_opening', room: 'bed2', side: 'east' }));
  assert.equal(validateAction({ type: 'demolish' }), null);
  assert.equal(validateAction(null), null);
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

test('the built-in elder always proposes moves that raise the score', () => {
  let d = defaultDesign();
  for (let i = 0; i < 6; i += 1) {
    const reply = localElder(d);
    assert.ok(reply.say.length > 0);
    if (reply.actions.length === 0) break;
    assert.ok(reply.actions.length <= 2);
    const next = applyActions(d, reply.actions);
    assert.ok(scoreDay(next).overall >= scoreDay(d).overall);
    d = next;
  }
  assert.ok(scoreDay(d).overall > scoreDay(defaultDesign()).overall + 8);
});

test('heat colours run from red (hot) to blue (cool)', () => {
  const hot = comfortColor(0);
  const cool = comfortColor(100);
  assert.ok(hot[0] > hot[2]);
  assert.ok(cool[2] > cool[0]);
});
