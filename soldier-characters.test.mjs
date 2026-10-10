import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, existsSync } from 'node:fs';
import { CHARACTERS, characterCard, characterStats, characterLevelLabel, evadesAttack, CHARACTER_MAX_LEVEL, CHARACTER_UPGRADE_COST } from './soldier-characters.mjs';
import { characterInventoryStats } from './soldier-inventory.mjs';
import { SUPPLY_PRODUCTS } from './soldier-shop.mjs';

test('shop products use reference prices and separate portrait assets', () => {
  assert.deepEqual(SUPPLY_PRODUCTS.map(({ id, price }) => [id, price]), [['special', 300], ['advanced', 30], ['normal', 3]]);
  for (const id of ['normal','advanced','special']) assert.ok(readFileSync(`soldier-supply-${id}.webp`).length);
  for (const id of ['black-water', 'fighter', 'thief', 'korean-girl', 'roka-swc']) {
    assert.ok(readFileSync(CHARACTERS[id].image).length);
  }
  assert.ok(readFileSync('soldier-character-frame.webp').length);
  for (const id of ['fighter', 'thief', 'korean-girl']) {
    const image = readFileSync(CHARACTERS[id].image);
    assert.ok(readFileSync(`soldier-shop-${id}.webp`).length);
    assert.equal(image.toString('ascii', 0, 4), 'RIFF');
    assert.equal(image.toString('ascii', 8, 12), 'WEBP');
  }
});

test('legacy cards use text-free portrait derivatives, preserving original card assets', () => {
  for (const id of ['roka-swc']) {
    assert.equal(CHARACTERS[id].image, `soldier-character-${id}-portrait.webp`);
    assert.ok(readFileSync(CHARACTERS[id].image).length);
    assert.ok(readFileSync(`soldier-character-${id}.webp`).length);
  }
});

test('JAMES is the canonical free default and existing growth is retained', () => {
  assert.equal(CHARACTERS.james, undefined);
  assert.equal(CHARACTERS['black-water'].image, 'soldier-character-james.webp');
  assert.equal(CHARACTERS['black-water'].price, 0);
  const sql = readFileSync('soldier-character-upgrade.sql', 'utf8');
  assert.match(sql, /default_character_level=greatest\(s\.default_character_level,c\.level\)/);
  assert.match(sql, /set equipped_character='black-water' where equipped_character='james'/);
  assert.match(sql, /delete from public\.soldier_characters where character='james'/);
});

test('all character levels follow the requested health and evasion progression', () => {
  assert.equal(CHARACTER_MAX_LEVEL, 10);
  assert.equal(CHARACTER_UPGRADE_COST, 10000);
  const specs = { 'black-water': [110,5,4,.1],
    fighter: [115,6,6,.1], thief: [98,5,20,1], 'korean-girl': [105,7,10,1], 'roka-swc': [125,8,4,.1] };
  for (const id of Object.keys(CHARACTERS)) {
    const [health, healthStep, evade, evadeStep] = specs[id];
    for (let level = 1; level <= 10; level++) {
      const stats = characterStats(id, level);
      assert.equal(stats.hp, health + healthStep * (level - 1));
      assert.ok(Math.abs(stats.evasion * 100 - (evade + evadeStep * (level - 1))) < 1e-10);
      assert.equal(stats.damageBonus, id === 'korean-girl' ? level === 10 ? 3 : 1 : 0);
      assert.equal(stats.criticalBonus, stats.damageBonus);
      assert.deepEqual(characterInventoryStats(id, level).slice(0,2).map(([name, value]) => [name, value]), [
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

test('character cards layer the common frame, portrait, name, and complete level label', () => {
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
        assert.equal(card.children.length, 4);
        assert.equal(card.children[0].className, 'character-background');
        assert.equal(card.children[0].src, 'soldier-character-frame.webp');
        assert.equal(card.children[0].attributes['aria-hidden'], 'true');
        assert.equal(card.children[1].className, 'character-portrait');
        assert.equal(card.children[1].src, `${character.cardImage}?v=1`);
        assert.equal(card.children[1].alt, character.name.replace('\n', ' '));
        assert.equal(card.children[2].className, 'character-name');
        assert.equal(card.children[2].textContent, character.name);
        assert.equal(card.children[3].textContent, characterLevelLabel(level));
        assert.equal(card.children[3].attributes['aria-label'], `레벨 ${level}`);
      }
    }
    assert.deepEqual(Object.keys(CHARACTERS), ['black-water', 'fighter', 'thief', 'korean-girl', 'roka-swc']);
    assert.equal(CHARACTERS['black-water'].name, 'JAMES');
    assert.equal(CHARACTERS['black-water'].price, 0);
    assert.equal(CHARACTERS['black-water'].model, 'soldier-james.glb?v=1');
    assert.equal(CHARACTERS.fighter.price, 150);
    assert.equal(CHARACTERS.thief.price, 150);
    assert.equal(CHARACTERS['korean-girl'].price, 250);
    assert.equal(CHARACTERS['korean-girl'].name, 'KOREAN\nGIRL');
    assert.equal(CHARACTERS['roka-swc'].price, 125);
    assert.equal(CHARACTERS['roka-swc'].name, 'RKS');
    assert.equal(CHARACTERS.fighter.ability, '밸런스');
    assert.equal(CHARACTERS.thief.ability, '높은 회피율');
    assert.throws(() => characterCard('invalid'), /캐릭터/);
  } finally { globalThis.document = previous; }
});

test('roster SQL charges listed prices and removes only retired FSB ownership and references', () => {
  const shopSql = readFileSync('soldier-shop.sql', 'utf8');
  const migration = readFileSync('soldier-character-upgrade.sql', 'utf8');
  assert.match(shopSql, /when 'korean-girl' then 250 when 'roka-swc' then 125 else 150 end/);
  assert.match(migration, /when 'korean-girl' then 250 when 'roka-swc' then 125 else 150 end/);
  assert.match(migration, /health:=110\+\(p_level-1\)\*5; evasion:=\(40\+p_level-1\)::numeric\/1000/);
  assert.match(migration, /p_character not in \('black-water','fighter','thief','korean-girl','roka-swc'\)/);
  assert.match(migration, /health:=98\+\(p_level-1\)\*5; evasion:=\(20\+p_level-1\)::numeric\/100/);
  assert.match(migration, /delete from public\.soldier_characters where character='fsb-agent';/);
  assert.match(migration, /set equipped_character='black-water' where equipped_character='fsb-agent'/);
  assert.match(migration, /where p\.client_id=s\.client_id and p\.character in \('fsb-agent','james'\)/);
  assert.match(migration, /hp=least\(p\.hp,/);
  assert.doesNotMatch(migration, /set (?:equipped_character|character)='thief'/);
  assert.match(migration, /'damageBonus',damage_bonus,'criticalBonus',critical_bonus/);
  assert.match(migration, /damage_bonus:=case when p_level=10 then 3 else 1 end/);
  assert.match(migration, /function public\.soldier_owned_character_stats\(p_client uuid\)/);
});

test('retired FSB is absent from roster and obsolete assets', () => {
  assert.equal(CHARACTERS['fsb-agent'], undefined);
  assert.throws(() => characterStats('fsb-agent'), /캐릭터/);
  for (const file of ['soldier-fsb-agent.glb', 'soldier-character-fsb-agent.webp',
    'soldier-character-fsb-agent-portrait.webp', 'soldier-shop-fsb-agent.webp']) assert.equal(existsSync(file), false);
});

test('shop purchase confirmation uses an app dialog, not a browser prompt', () => {
  const shop = readFileSync('soldier-shop.mjs','utf8'), html = readFileSync('sanggi-soldier.html','utf8');
  assert.doesNotMatch(shop, /window\.(confirm|prompt)/);
  assert.match(html, /id="shop-confirm-dialog"/);
  assert.match(html, /id="shop-confirm-cancel"/);
  assert.match(html, /id="shop-confirm-buy"/);
  assert.match(shop, /confirmation\.showModal\(\)/);
});
