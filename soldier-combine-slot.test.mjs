import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('same-slot combination restricts random candidates', () => {
  const sql=readFileSync('soldier-weapon-rewards.sql','utf8');
  const filter="public.soldier_weapon(item_a.weapon)->>'slot'<>public.soldier_weapon(item_b.weapon)->>'slot'";
  assert.equal(sql.split(filter).length,2);
  assert.match(sql,/or public\.soldier_weapon\(candidate\)->>'slot'=public\.soldier_weapon\(item_a\.weapon\)->>'slot'/);
  assert.ok(sql.indexOf(filter)<sql.indexOf("if item_a.grade not in ('S','S+')"));
});

test('disassembly restricts both rewards to the original weapon category', () => {
  const sql=readFileSync('soldier-weapon-rewards.sql','utf8');
  const disassembly=sql.slice(sql.indexOf('for i in 1..2 loop'));
  assert.match(disassembly,/where public\.soldier_weapon\(candidate\)->>'slot'=public\.soldier_weapon\(item_a\.weapon\)->>'slot'/);
  assert.match(disassembly,/\) < 50/);
});
