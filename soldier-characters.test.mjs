import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, existsSync } from 'node:fs';
import { CHARACTERS, characterCard, characterStats, characterLevelLabel, ownedCharacterLevel, evadesAttack, CHARACTER_MAX_LEVEL, CHARACTER_UPGRADE_COST } from './soldier-characters.mjs';
import { characterInventoryStats } from './soldier-inventory.mjs';
import { SUPPLY_PRODUCTS } from './soldier-shop.mjs';

test('shop products use reference prices and separate portrait assets', () => {
  assert.deepEqual(SUPPLY_PRODUCTS.filter(({ id }) => ['special', 'advanced', 'normal'].includes(id))
    .map(({ id, price }) => [id, price]), [['special', 300], ['advanced', 30], ['normal', 3]]);
  for (const id of ['normal','advanced','special']) assert.ok(readFileSync(`soldier-supply-${id}.webp`).length);
  for (const id of Object.keys(CHARACTERS)) {
    assert.ok(readFileSync(CHARACTERS[id].image).length);
  }
  assert.ok(readFileSync('soldier-character-frame.webp').length);
  for (const id of ['fighter', 'thief', 'korean-girl', 'rks-girl', 'military-police', 'office-worker']) {
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
  assert.equal(CHARACTER_UPGRADE_COST, 20000);
  const specs = { 'black-water': [110,5,4,.1],
    fighter: [115,6,6,.1], thief: [98,5,20,1], 'korean-girl': [92,5,10,1], 'roka-swc': [125,8,4,.1],
    'rks-girl': [115,8,8,.1], 'military-police': [110,6,9,.1], 'office-worker': [108,6,15,1] };
  for (const id of Object.keys(CHARACTERS)) {
    const [health, healthStep, evade, evadeStep] = specs[id];
    for (let level = 1; level <= 10; level++) {
      const stats = characterStats(id, level);
      assert.equal(stats.hp, health + healthStep * (level - 1));
      assert.ok(Math.abs(stats.evasion * 100 - (evade + evadeStep * (level - 1))) < 1e-10);
      assert.equal(stats.damageBonus, id === 'korean-girl' ? level === 10 ? 3 : 1 : 0);
      assert.equal(stats.criticalBonus, id === 'military-police' ? 1 : stats.damageBonus);
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
        assert.equal(card.children[3].textContent, level === 10 ? 'MAX' : String(level));
        assert.equal(card.children[3].attributes['aria-label'], `레벨 ${level}`);
      }
    }
    assert.deepEqual(Object.keys(CHARACTERS), ['black-water', 'fighter', 'thief', 'korean-girl', 'roka-swc',
      'rks-girl', 'military-police', 'office-worker']);
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
    assert.equal(CHARACTERS['rks-girl'].price, 125);
    assert.equal(CHARACTERS['rks-girl'].ability, '높은 체력과 준수한 회피율');
    assert.equal(CHARACTERS['military-police'].price, 150);
    assert.equal(CHARACTERS['military-police'].ability, '밸런스 / 크리티컬 확률 증가');
    assert.equal(CHARACTERS['office-worker'].price, 150);
    assert.equal(CHARACTERS['office-worker'].ability, '높은 회피율');
    assert.throws(() => characterCard('invalid'), /캐릭터/);
  } finally { globalThis.document = previous; }
});

test('roster SQL charges listed prices and removes only retired FSB ownership and references', () => {
  const shopSql = readFileSync('soldier-shop.sql', 'utf8');
  const migration = readFileSync('soldier-character-upgrade.sql', 'utf8');
  assert.match(shopSql, /when 'korean-girl' then 250 when 'roka-swc' then 125 else 150 end/);
  assert.match(migration, /when 'korean-girl' then 250 when 'roka-swc' then 125 when 'rks-girl' then 125 else 150 end/);
  assert.match(migration, /health:=110\+\(p_level-1\)\*5; evasion:=\(40\+p_level-1\)::numeric\/1000/);
  assert.match(migration, /p_character not in \('black-water','fighter','thief','korean-girl','roka-swc','rks-girl','military-police','office-worker'\)/);
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

test('new characters retain ownership and levels without changing the free default', () => {
  const state = { defaultLevel: 7, characters: {
    fighter: { level: 4 }, 'korean-girl': { level: 10 }, 'rks-girl': { level: 6 },
    'military-police': { level: 9 }, 'office-worker': { level: 3 }
  } };
  const before = structuredClone(state);
  assert.equal(ownedCharacterLevel(state, 'black-water'), 7);
  for (const [id, { level }] of Object.entries(state.characters)) assert.equal(ownedCharacterLevel(state, id), level);
  assert.equal(ownedCharacterLevel(state, 'thief'), 1);
  assert.deepEqual(state, before);
  for (let level = 1; level <= 10; level++) {
    assert.equal(characterStats('roka-swc', level).hp - characterStats('rks-girl', level).hp, 10);
    assert.ok(Math.abs(characterStats('rks-girl', level).evasion - characterStats('roka-swc', level).evasion - .04) < 1e-10);
    assert.deepEqual(characterInventoryStats('military-police', level).slice(2).map(([name, value]) => [name, value]),
      [['위력 증가', '+0'], ['크리티컬 확률 증가', '+1%']]);
  }
});

test('SQL supports every roster ID for stats, ownership, equipment, combat and upgrades', () => {
  const sql = readFileSync('soldier-character-upgrade.sql', 'utf8');
  const roster = "'black-water','fighter','thief','korean-girl','roka-swc','rks-girl','military-police','office-worker'";
  assert.ok(sql.includes(`check (equipped_character in (${roster}))`));
  assert.ok(sql.includes(`check (character in (${roster}))`));
  assert.ok(sql.includes(`check (character in (${roster.replace("'black-water',", '')}))`));
  assert.equal(sql.split(`p_character not in (${roster})`).length - 1, 3);
  for (const formula of [
    'health:=92+(p_level-1)*5; evasion:=(10+p_level-1)::numeric/100',
    'health:=115+(p_level-1)*8; evasion:=(80+p_level-1)::numeric/1000',
    'health:=110+(p_level-1)*6; evasion:=(90+p_level-1)::numeric/1000',
    'health:=108+(p_level-1)*6; evasion:=(15+p_level-1)::numeric/100'
  ]) assert.ok(sql.includes(formula), formula);
  assert.match(sql, /critical_bonus:=1;/);
  assert.match(sql, /balance<20000/);
  assert.match(sql, /필요한 골드: 20000/);
  assert.match(sql, /set gold=gold-20000/);
  assert.doesNotMatch(sql, /10000/);
  assert.match(sql, /p_level not between 1 and 9/);
  assert.match(sql, /current_level<>p_level/);
  assert.match(sql, /이미 보유한 캐릭터입니다/);
  assert.match(sql, /보유하지 않은 캐릭터입니다/);
  assert.match(sql, /기본 캐릭터는 구매할 필요가 없습니다/);
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
