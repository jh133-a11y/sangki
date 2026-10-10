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
    assert.equal(stats[0][1], weapon.slot === 'melee' ? '-' : `${weapon.magazine} / ${weapon.reserve ?? '미설정'}`);
    assert.equal(stats[1][1], weapon.damage);
    assert.equal(stats[2][1], Math.round(60 / weapon.delay));
    assert.ok(stats.slice(3).every(([, , explanation]) => explanation.length > 0));
  }
  assert.throws(() => weaponInventoryStats('invalid'), /무기/);
});

test('requested D Lv1 K2, M870 and M9 stats are exact and comparisons use the selected grade/level', () => {
  assert.deepEqual(weaponInventoryStats('k2').map(([,value])=>value), ['30 / 90',19,650,76,86,4040,'5%']);
  assert.deepEqual(weaponInventoryStats('shotgun').map(([,value])=>value), ['4 / 16',45,20,61,4,3550,'6%']);
  assert.deepEqual(weaponInventoryStats('stick').map(([,value])=>value), ['-',135,80,'-','-','-','31%']);
  assert.equal(weaponInventoryStats('k2','A',3)[1][1],41);
  assert.equal(weaponInventoryStats('k2','A',3)[6][1],'6%');
  assert.equal(weaponInventoryStats('stick','S',7)[1][1],183);
  assert.equal(weaponInventoryStats('stick','S',7)[6][1],'40%');
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

test('only unequipped weapons offer the fixed-price sale action', () => {
  const source = readFileSync('soldier-inventory.mjs', 'utf8');
  const sql = readFileSync('soldier-weapon-sale.sql', 'utf8');
  assert.match(source, /판매 · 100 골드/);
  assert.match(source, /filter\(item => !item\.equipped && WEAPONS\[item\.weapon\]\.slot === slot\)/);
  assert.match(source, /\$\('inventory-sell'\)\.addEventListener\('click', openSalePicker\)/);
  assert.doesNotMatch(source, /inventory-comparison'\)\.append\(sellWeaponAction/);
  assert.match(source, /await confirmSale\(id\)/);
  assert.match(source, /saleForm\.method = 'dialog'/);
  assert.doesNotMatch(source, /window\.confirm\(`\$\{WEAPONS\[id\]\.name\}/);
  assert.match(sql, /if item\.equipped then raise exception/);
  assert.match(sql, /gold=gold\+100/);
});

test('selected weapons show their own level and progress using the equipped meter layout', () => {
  const source = readFileSync('soldier-inventory.mjs', 'utf8');
  assert.match(source, /const selectedMeter = meter\.cloneNode\(true\)/);
  assert.match(source, /level === 7 \? 100 : item\?\.upgrade_progress \?\? 0/);
  assert.match(source, /levelLabel\.textContent = weaponLevelLabel\(level\)/);
  assert.match(source, /progress\.setAttribute\('aria-label', '선택한 무기 강화 진행률'\)/);
  assert.match(source, /title\.append\(levelLabel, selectedMeter\)/);
  assert.match(source, /selectedMeter\.removeAttribute\('id'\)/);
  assert.match(source, /selectedMeter\.querySelectorAll\('\[id\]'\)/);
});

test('equipped and default MAX cards can be combined, including as material', () => {
  const source = readFileSync('soldier-inventory.mjs', 'utf8');
  assert.match(source, /combine\.disabled = weaponBusy \|\| item\.level !== 7 \|\| item\.grade === 'S';/);
  assert.match(source, /candidate\.grade === item\.grade\s*&& candidate\.level === 7\)/);
  const sql = readFileSync('soldier-weapon-rewards.sql', 'utf8');
  assert.match(sql, /if item_a\.equipped or item_b\.equipped then/);
  assert.match(sql, /set equipped=true where id=reward_id/);
});

test('weapon art stays centered on every grade and color card', () => {
  const css = readFileSync('soldier.css', 'utf8');
  assert.match(css, /\.weapon-image \{[^}]*top: 50%; transform: translateY\(-50%\)/);
});

test('weapon actions share a vertical stack and compact landscape layout', () => {
  const source = readFileSync('soldier-inventory.mjs', 'utf8');
  const css = readFileSync('soldier.css', 'utf8');
  assert.match(source, /actions\.className = 'inventory-weapon-actions'/);
  assert.match(css, /\.inventory-weapon-actions \{ display: flex; flex-direction: column;/);
  assert.match(css, /@media \(orientation: landscape\) and \(max-height: 600px\)/);
});
