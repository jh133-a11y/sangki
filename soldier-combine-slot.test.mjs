import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('same-slot combination restricts random candidates but does not change disassembly', () => {
  const sql=readFileSync('soldier-weapon-rewards.sql','utf8');
  const filter="public.soldier_weapon(item_a.weapon)->>'slot'<>public.soldier_weapon(item_b.weapon)->>'slot'";
  assert.equal(sql.split(filter).length,2);
  assert.match(sql,/or public\.soldier_weapon\(candidate\)->>'slot'=public\.soldier_weapon\(item_a\.weapon\)->>'slot'/);
  assert.ok(sql.indexOf(filter)<sql.indexOf("if item_a.grade<>'S'"));
});
