import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { CHARACTERS, characterCard } from './soldier-characters.mjs';
import { characterInventoryStats } from './soldier-inventory.mjs';
import { SUPPLY_PRODUCTS } from './soldier-shop.mjs';

test('shop products use reference prices and separate portrait assets', () => {
  assert.deepEqual(SUPPLY_PRODUCTS.map(({ id, price }) => [id, price]), [['normal', 3], ['advanced', 30]]);
  for (const id of ['normal', 'advanced', 'fsb-agent', 'roka-swc']) assert.ok(readFileSync(`soldier-shop-${id}.webp`).length);
});

test('character stats use actual health and do not invent evasion bonuses', () => {
  for (const id of Object.keys(CHARACTERS)) {
    const stats = characterInventoryStats(id);
    assert.deepEqual(stats.map(([name, value]) => [name, value]), [['체력', 100], ['회피율', '미설정']]);
  }
  assert.match(readFileSync('soldier-schema.sql', 'utf8'), /hp integer not null default 100/);
  assert.throws(() => characterInventoryStats('invalid'), /캐릭터/);
});

test('numeric level outline scales with the card and does not cover the white fill', () => {
  const css = readFileSync('soldier.css', 'utf8');
  assert.match(css, /font-family: 'Arial Black', Arial, sans-serif/);
  assert.match(css, /font-size: 20\.5cqw/);
  assert.match(css, /-webkit-text-stroke: 1\.5cqw #080808; paint-order: stroke fill; text-shadow: none/);
});

test('character cards retain artwork names and Lv lettering, overlaying only numeric levels', () => {
  const previous = globalThis.document;
  globalThis.document = {
    createElement(tag) {
      return { tag, children: [], attributes: {}, append(...children) { this.children.push(...children); },
        setAttribute(key, value) { this.attributes[key] = value; } };
    }
  };
  try {
    for (const [id, character] of Object.entries(CHARACTERS)) {
      for (const level of [1, 2, 7]) {
        const card = characterCard(id, level);
        assert.equal(card.children.length, 2);
        assert.equal(card.children[0].src, character.image);
        assert.equal(card.children[0].alt, character.name);
        assert.equal(card.children[1].textContent, String(level));
        assert.equal(card.children[1].attributes['aria-label'], `레벨 ${level}`);
      }
      assert.ok(readFileSync(character.image).length > 0);
    }
    assert.equal(CHARACTERS['fsb-agent'].price, 125);
    assert.equal(CHARACTERS['roka-swc'].price, 125);
    assert.throws(() => characterCard('invalid'), /캐릭터/);
  } finally { globalThis.document = previous; }
});
