import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { WEAPONS, RANKS, rankName, COVER, SPAWNS, blocked, direction, coverDistance, targetDistance, settingsFrom } from './soldier-core.mjs';
const sql = readFileSync(new URL('./soldier-schema.sql', import.meta.url), 'utf8');
test('all ten weapons match server-authoritative specifications', () => {
  assert.equal(Object.keys(WEAPONS).length, 10);
  for (const [id, spec] of Object.entries(WEAPONS)) {
    const match = sql.match(new RegExp(`when '${id}' then '([^']+)'`));
    assert.ok(match, id);
    for (const [key, value] of Object.entries(JSON.parse(match[1]))) assert.equal(spec[key], value, `${id}.${key}`);
  }
});
test('ranks cover private to marshal with exact XP boundaries', () => {
  assert.equal(RANKS.length, 20);
  assert.equal(rankName(-1), '이등병');
  assert.equal(rankName(199), '이등병');
  assert.equal(rankName(200), '일등병');
  assert.equal(rankName(3799), '대장');
  assert.equal(rankName(3800), '원수');
  assert.equal(rankName(100000), '원수');
});
test('map and server cover geometry match and spawn positions are safe', () => {
  assert.equal(sql.includes(JSON.stringify(COVER)), true);
  for (const [x, z] of SPAWNS) assert.equal(blocked(x, z), false);
  assert.equal(blocked(49, 0), true);
  assert.equal(blocked(-25, -25), true);
  assert.equal(blocked(0, 0), false);
});
test('aim hits front-facing opponents but not behind walls or out of line', () => {
  const origin = { x: 0, y: 1.65, z: 0 }, ray = direction(0, 0);
  assert.deepEqual(ray, { x: -0, y: 0, z: -1 });
  const target = { x: 0, y: 0, z: -15 };
  assert.ok(targetDistance(origin, ray, target) < coverDistance(origin, ray));
  assert.ok(targetDistance(origin, ray, { ...target, z: -40 }) > coverDistance(origin, ray));
  assert.equal(targetDistance(origin, ray, { ...target, x: 3 }), Infinity);
  assert.equal(targetDistance(origin, ray, { ...target, z: 10 }), Infinity);
});
test('control settings clamp invalid values while preserving valid preferences', () => {
  const settings = settingsFrom({ autoFire: true, sensitivity: 20, controls: { fire: { x: 200, y: -20, size: 0 }, jump: { size: NaN } } });
  assert.equal(settings.autoFire, true); assert.equal(settings.sensitivity, 2);
  assert.equal(settings.controls.fire.x, 95); assert.equal(settings.controls.fire.y, 10); assert.equal(settings.controls.fire.size, 44);
  assert.equal(settings.controls.jump.size, 56);
});
