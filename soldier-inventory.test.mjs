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
    assert.equal(stats[0][1], weapon.magazine ? `${weapon.magazine} / ${weapon.reserve ?? '미설정'}` : '무한대');
    assert.equal(stats[1][1], weapon.damage);
    assert.equal(stats[2][1], Math.round(60 / weapon.delay));
    assert.ok(stats.slice(3).every(([, , explanation]) => explanation.length > 0));
  }
  assert.throws(() => weaponInventoryStats('invalid'), /무기/);
});

test('requested D Lv1 K2, M870 and M9 stats are exact and comparisons use the selected grade/level', () => {
  assert.deepEqual(weaponInventoryStats('k2').map(([,value])=>value), ['25 / 100',24,375,85,90,1800,'4%']);
  assert.deepEqual(weaponInventoryStats('shotgun').map(([,value])=>value), ['6 / 24',75,67,75,60,2500,'1%']);
  assert.deepEqual(weaponInventoryStats('stick').map(([,value])=>value), ['무한대',70,200,100,'없음',900,'10%']);
  assert.equal(weaponInventoryStats('k2','A',3)[1][1],46);
  assert.equal(weaponInventoryStats('k2','A',3)[6][1],'5%');
  assert.equal(weaponInventoryStats('stick','S',7)[1][1],118);
  assert.equal(weaponInventoryStats('stick','S',7)[6][1],'19%');
});

test('enhancement UI keeps XP internal and exposes level-adjacent progress and a plain upgrade button', () => {
  const source = readFileSync('soldier-inventory.mjs','utf8');
  assert.doesNotMatch(source, /경험치|강화재료 선택 · 개당/);
  assert.match(source, /button\.textContent = '강화'/);
  assert.match(source, /targetHeading\.append\(title, nextLevel, meter\)/);
  assert.match(source, /nextLevel\.textContent = `LV\$\{preview\.level\}`/);
  assert.match(source, /rows\.forEach/);
  assert.match(source, /선택초기화/);
  assert.match(source, /input\.dataset\.grade === grade/);
});

test('progress is in the equipped heading next to the level, never on item artwork', () => {
  const html=readFileSync('sanggi-soldier.html','utf8');
  assert.doesNotMatch(html,/weapon-card-progress/);
  assert.match(html,/id="inventory-level"><\/span><span id="inventory-progress" class="weapon-material-meter"/);
  const helper=readFileSync('soldier-weapon-items.mjs','utf8');
  assert.doesNotMatch(helper,/weapon-card-progress/);
  const source=readFileSync('soldier-inventory.mjs','utf8');
  assert.match(source,/level === 7 \? 100/);
  assert.match(source,/meter\.hidden = slot === 'character'/);
});
