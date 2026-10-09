import test from 'node:test';
import assert from 'node:assert/strict';
import { WEAPONS } from './soldier-core.mjs';
import { weaponInventoryStats, inventoryWeapons, INVENTORY_LIMIT } from './soldier-inventory.mjs';

test('empty inventory stays empty and only stored equipment counts toward the 50-item limit', () => {
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
