import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = file => readFileSync(file, 'utf8');

test('all un equipped weapon cards can be sold for a fixed 100 gold with an idempotent receipt', () => {
  const sql = read('soldier-weapon-sale.sql');
  assert.match(sql, /create or replace function public\.soldier_weapon_sell_api/);
  assert.match(sql, /if item\.equipped then raise exception '장착한 무기는 판매할 수 없습니다\.'/);
  assert.match(sql, /p_weapon in \('k2','shotgun','stick','psg1','m249','p90','auga3','g36c','akm'\)/);
  assert.match(sql, /gold=gold\+100/);
  assert.match(sql, /gold_awarded','100'/);
  assert.match(sql, /primary key \(client_id,request_id\)/);
  assert.doesNotMatch(sql, /source='default'/);
  const client = read('soldier.js');
  assert.match(client, /soldier_weapon_sell_api/);
  assert.match(client, /sanggi-weapon-sale-pending-/);
  const inventory = read('soldier-inventory.mjs');
  assert.match(inventory, /판매 · 100 골드/);
  assert.match(inventory, /item \? !item\.equipped : id !== current/);
});
