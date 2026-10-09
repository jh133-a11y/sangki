import test from 'node:test';
import assert from 'node:assert/strict';
import { WEAPONS } from './soldier-core.mjs';
import { weaponInventoryStats, inventoryWeapons, inventoryCharacters, characterInventoryCount, INVENTORY_LIMIT } from './soldier-inventory.mjs';
import { readFileSync } from 'node:fs';

test('character slots swap without duplicating the equipped character or losing the default', () => {
  const characters = { 'fsb-agent': { level: 1 }, 'roka-swc': { level: 1 } };
  assert.deepEqual(inventoryCharacters({ characters: {}, equipped: 'black-water' }), []);
  assert.deepEqual(inventoryCharacters({ characters: { 'fsb-agent': { level: 1 } }, equipped: 'fsb-agent' }), ['black-water']);
  assert.deepEqual(inventoryCharacters({ characters, equipped: 'black-water' }), ['fsb-agent', 'roka-swc']);
  assert.deepEqual(inventoryCharacters({ characters, equipped: 'fsb-agent' }), ['black-water', 'roka-swc']);
  assert.deepEqual(inventoryCharacters({ characters, equipped: 'roka-swc' }), ['black-water', 'fsb-agent']);
  assert.equal(Object.keys(characters).length, 2);
  assert.equal(characterInventoryCount({ characters: {} }), 1);
  assert.equal(characterInventoryCount({ characters }), 3);
  assert.doesNotMatch(readFileSync('soldier-inventory.mjs','utf8'), /기본 D급 무기 장착|기본 캐릭터 장착/);
});

test('legacy equipment lookup does not fabricate default items supplied by the item API', () => {
  assert.equal(INVENTORY_LIMIT, 50);
  for (const slot of ['primary', 'secondary', 'melee', 'character']) {
    assert.deepEqual(inventoryWeapons({}, slot), []);
  }
  assert.deepEqual(inventoryWeapons({ k2: { grade: 'D', level: 1 }, shotgun: { grade: 'D', level: 1 } }, 'primary'), ['k2']);
});

test('every weapon exposes the seven reference inventory fields using actual game values', () => {
  const labels = ['탄창/보유탄환', '위력', '연사속도', '정확도', '반동제어', '무게', '크리티컬 확률'];
  for (const [id, weapon] of Object.entries(WEAPONS)) {
    const stats = weaponInventoryStats(id);
    assert.deepEqual(stats.map(([label]) => label), labels);
    assert.equal(stats[0][1], weapon.magazine ? `${weapon.magazine} / 미설정` : '해당 없음');
    assert.equal(stats[1][1], weapon.damage);
    assert.equal(stats[2][1], Math.round(60 / weapon.delay));
    assert.ok(stats.slice(3).every(([, value, explanation]) => value === '미설정' && explanation.length > 0));
  }
  assert.throws(() => weaponInventoryStats('invalid'), /무기/);
});
