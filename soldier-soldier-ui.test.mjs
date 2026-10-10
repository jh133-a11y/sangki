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
  assert.match(inventory, /soldier-characters\.mjs\?v=7/);
  assert.match(shop, /soldier-characters\.mjs\?v=7/);
  assert.match(shop, /soldier-supply\.mjs\?v=6/);
});

test('shop character purchase labels use each product price', () => {
  assert.match(readFileSync('soldier-shop.mjs', 'utf8'), /owned \? '보유 중' : `\$\{product\.price\}보석 구매`/);
  assert.doesNotMatch(readFileSync('soldier-shop.mjs', 'utf8'), /125보석 구매/);
});

test('character stats stay in vertical label-value rows and inactive set text is removed', () => {
  const css=readFileSync('soldier.css','utf8');
  const inventory=readFileSync('soldier-inventory.mjs','utf8');
  assert.doesNotMatch(css,/grid-template-columns: minmax\(0, 1fr\) auto minmax\(0, 1fr\) auto/);
  assert.doesNotMatch(inventory,/세트 조건:/);
  assert.match(inventory,/\$\('inventory-set-effect'\)\.hidden = !set/);
  assert.match(css,/\.character-card \.character-name \{[^}]*font-family: 'Arial Narrow', 'Malgun Gothic', sans-serif;[^}]*font-style: italic;/s);
  assert.match(css,/\.character-card \.character-name \{[^}]*top: auto;[^}]*bottom: 5%;/s);
});

test('character enhancement uses an in-app confirmation instead of blocked browser prompts', () => {
  const inventory=readFileSync('soldier-inventory.mjs','utf8');
  assert.doesNotMatch(inventory,/window\.confirm/);
  assert.match(inventory,/await confirmCharacterUpgrade\(id, level\)/);
  assert.match(inventory,/characterConfirmation\.showModal\(\)/);
  assert.match(inventory,/upgrade\.textContent = level === CHARACTER_MAX_LEVEL \? 'MAX' : '강화';/);
  assert.match(inventory,/강화 1회당 10,000골드/);
});

test('equipment stat rows share a clean label-value style without changing their layout', () => {
  const css=readFileSync('soldier.css','utf8');
  assert.match(css,/\.inventory-item-detail dl \{[^}]*grid-template-columns: minmax\(0, 1fr\) minmax\(46px, \.8fr\)/);
  assert.match(css,/\.inventory-item-detail dt \{[^}]*background: #edf3f7;/s);
  assert.match(css,/\.inventory-item-detail dd \{[^}]*background: #dff1f0;[^}]*font-variant-numeric: tabular-nums;/s);
  assert.match(css,/\.character-card \.character-level \{[^}]*top: 4%;/s);
});

test('inventory portraits stay clipped inside the supplied character frame', () => {
  const css=readFileSync('soldier.css','utf8');
  assert.match(css,/\.character-card \.character-portrait \{[^}]*left: 13%;[^}]*width: 74%;[^}]*clip-path: polygon/s);
  for (const name of ['james','fighter','thief','korean-girl','roka-swc']) {
    assert.ok(readFileSync(`soldier-character-${name}-cutout.webp`).length>10000);
  }
});
