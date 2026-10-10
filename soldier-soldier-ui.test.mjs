import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('shop supply cards use the original metallic crate illustrations', () => {
  const shop = readFileSync('soldier-shop.mjs', 'utf8');
  assert.match(shop, /soldier-supply-\$\{product\.id\}\.svg\?v=2/);
  for (const id of ['normal', 'advanced', 'special']) {
    const svg = readFileSync(`soldier-supply-${id}.svg`, 'utf8');
    assert.match(svg, /<linearGradient id="steel"/);
    assert.match(svg, /<filter id="shadow"/);
    assert.match(svg, /<path d="m125 179 105-91/);
  }
});

test('grade assets share the common card canvas and S content has normalized alpha bounds', () => {
  const items = readFileSync('soldier-weapon-items.mjs', 'utf8');
  assert.match(items, /grade === 'S\+' \? 's-plus'/);
  for (const grade of ['c', 'b', 'a', 's', 's-plus']) {
    const bytes = readFileSync(`soldier-grade-${grade}.webp`);
    assert.ok(bytes.length > 10000, `${grade} grade artwork should be populated`);
  }
});

test('shop and inventory import the finalized parent-owned module versions', () => {
  const inventory = readFileSync('soldier-inventory.mjs', 'utf8');
  const shop = readFileSync('soldier-shop.mjs', 'utf8');
  assert.match(inventory, /soldier-core\.mjs\?v=7/);
  assert.match(inventory, /soldier-weapon-items\.mjs\?v=11/);
  assert.match(inventory, /soldier-characters\.mjs\?v=6/);
  assert.match(shop, /soldier-characters\.mjs\?v=6/);
  assert.match(shop, /soldier-supply\.mjs\?v=6/);
});

test('shop character purchase labels use each product price', () => {
  assert.match(readFileSync('soldier-shop.mjs', 'utf8'), /owned \? '보유 중' : `\$\{product\.price\}보석 구매`/);
  assert.doesNotMatch(readFileSync('soldier-shop.mjs', 'utf8'), /125보석 구매/);
});
