import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('equipment repair keeps every item and guards all writes by weapon slot', () => {
  const sql = readFileSync('soldier-equipped-slot-fix.sql', 'utf8');
  assert.match(sql, /partition by client_id,public\.soldier_weapon\(weapon\)->>'slot'/);
  assert.match(sql, /before insert or update of equipped,weapon,client_id/);
  assert.match(sql, /for update/);
  assert.match(sql, /create unique index if not exists soldier_weapon_items_equipped_slot/);
  assert.match(sql, /create or replace function public\.soldier_default_weapons/);
  assert.doesNotMatch(sql, /delete from/i);
  for (const file of ['soldier-weapon-rewards.sql','soldier-weapon-material-upgrade.sql']) {
    assert.match(readFileSync(file,'utf8'), /public\.soldier_weapon\(weapon\)->>'slot'=public\.soldier_weapon\(item\.weapon\)->>'slot'/);
  }
});

test('inventory loading failures are not presented as an empty owned inventory', () => {
  const js = readFileSync('soldier.js','utf8');
  const ui = readFileSync('soldier-inventory.mjs','utf8');
  assert.match(js, /weaponItemsError = error\.message/);
  assert.match(js, /weaponItemsError = null; identity\.gold/);
  assert.match(ui, /loadError \? `장비 목록을 불러오지 못했습니다:/);
  assert.match(ui, /loadError \? '\?' : count/);
});
