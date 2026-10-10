import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { GOLD_PRODUCTS } from './soldier-shop.mjs';

const read = file => readFileSync(new URL(file, import.meta.url), 'utf8');

test('gold shop packs use the requested gem costs and bonus totals', () => {
  assert.deepEqual(GOLD_PRODUCTS.map(({ price, gold }) => [price, gold]), [
    [10, 5000], [50, 30000], [100, 65000]
  ]);
  assert.match(GOLD_PRODUCTS[1].description, /25,000.*5,000/);
  assert.match(GOLD_PRODUCTS[2].description, /50,000.*15,000/);
});

test('gold purchases are server-priced, atomic, and idempotent', () => {
  const sql = read('./soldier-shop.sql');
  const client = read('./soldier.js');
  assert.match(sql, /soldier_gold_exchange_api/);
  assert.match(sql, /'gold-5000' then 10 when 'gold-30000' then 50 else 100/);
  assert.match(sql, /'gold-5000' then 5000 when 'gold-30000' then 30000 else 65000/);
  assert.match(sql, /where client_id=owner_id for update/);
  assert.match(sql, /primary key \(client_id,request_id\)/);
  assert.match(sql, /gold_exchange_version',1/);
  assert.match(read('./soldier-character-upgrade.sql'), /gold_exchange_version',1/);
  assert.match(client, /soldier_gold_exchange_api/);
  assert.match(client, /sanggi-gold-exchange-pending-/);
});
