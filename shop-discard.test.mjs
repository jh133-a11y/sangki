import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const definition = /create or replace function public\.shop_discard_item\([\s\S]*?\n\$\$;/;
const read = (file) => readFileSync(new URL(file, import.meta.url), 'utf8');
const patch = read('./fix-gambling-box-discard.sql');

test('gambling box discard fix stays consistent across site migrations', () => {
  const expected = patch.match(definition)?.[0];
  assert.ok(expected);
  for (const file of ['./supabase-schema.sql', './add-china-missile.sql']) {
    assert.equal(read(file).match(definition)?.[0], expected);
  }
  assert.match(expected, /when 'gambling_box' then '도박 중독자 상자'/);
  assert.doesNotMatch(expected, /shop_use_gambling_box|set cash|set gambling_box_quantity/);
});
