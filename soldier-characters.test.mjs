import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { CHARACTERS, characterCard, characterStats, characterLevelLabel, evadesAttack, CHARACTER_MAX_LEVEL, CHARACTER_UPGRADE_COST } from './soldier-characters.mjs';
import { characterInventoryStats } from './soldier-inventory.mjs';
import { SUPPLY_PRODUCTS } from './soldier-shop.mjs';

test('shop products use reference prices and separate portrait assets', () => {
  assert.deepEqual(SUPPLY_PRODUCTS.map(({ id, price }) => [id, price]), [['special', 300], ['advanced', 30], ['normal', 3]]);
  for (const id of ['normal','advanced','special']) assert.ok(readFileSync(`soldier-supply-${id}.webp`).length);
  for (const id of ['fsb-agent', 'roka-swc']) assert.ok(readFileSync(`soldier-shop-${id}.webp`).length);
});

test('all character levels follow the requested health and evasion progression', () => {
  assert.equal(CHARACTER_MAX_LEVEL, 10);
  assert.equal(CHARACTER_UPGRADE_COST, 10000);
  const specs = { 'black-water': [110, 5, 4, .1], 'roka-swc': [125, 8, 4, .1], 'fsb-agent': [98, 5, 20, 1] };
  for (const id of Object.keys(CHARACTERS)) {
    const [health, healthStep, evade, evadeStep] = specs[id];
    for (let level = 1; level <= 10; level++) {
      const stats = characterStats(id, level);
      assert.equal(stats.hp, health + healthStep * (level - 1));
      assert.ok(Math.abs(stats.evasion * 100 - (evade + evadeStep * (level - 1))) < 1e-10);
      assert.deepEqual(characterInventoryStats(id, level).map(([name, value]) => [name, value]), [
        ['체력', stats.hp], ['회피율', `${Number((stats.evasion * 100).toFixed(1))}%`]
      ]);
      assert.equal(characterLevelLabel(level), level === 10 ? 'MAX' : `Lv.${level}`);
      assert.equal(evadesAttack(stats.evasion, 0), true);
      assert.equal(evadesAttack(stats.evasion, stats.evasion), false);
      assert.equal(evadesAttack(stats.evasion, .999), false);
    }
  }
  assert.throws(() => characterInventoryStats('invalid'), /캐릭터/);
  for (const level of [0,11,1.5,NaN]) assert.throws(() => characterStats('black-water',level), /레벨/);
  assert.throws(() => evadesAttack(-.1), /회피/);
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
      for (const level of [1, 2, 7, 9, 10]) {
        const card = characterCard(id, level);
        assert.equal(card.children.length, 2);
        assert.equal(card.children[0].src, `${character.image}?v=2`);
        assert.equal(card.children[0].alt, character.name);
        assert.equal(card.children[1].textContent, level === 10 ? 'MAX' : String(level));
        assert.equal(card.children[1].attributes['aria-label'], `레벨 ${level}`);
      }
      assert.ok(readFileSync(character.image).length > 0);
    }
    assert.equal(CHARACTERS['fsb-agent'].price, 125);
    assert.equal(CHARACTERS['roka-swc'].price, 125);
    assert.throws(() => characterCard('invalid'), /캐릭터/);
  } finally { globalThis.document = previous; }
});

test('shop purchase confirmation uses an app dialog, not a browser prompt', () => {
  const shop = readFileSync('soldier-shop.mjs','utf8'), html = readFileSync('sanggi-soldier.html','utf8');
  assert.doesNotMatch(shop, /window\.(confirm|prompt)/);
  assert.match(html, /id="shop-confirm-dialog"/);
  assert.match(html, /id="shop-confirm-cancel"/);
  assert.match(html, /id="shop-confirm-buy"/);
  assert.match(shop, /confirmation\.showModal\(\)/);
});
