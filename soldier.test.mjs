import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { WEAPONS, DEFAULT_LOADOUT, weaponLevelLabel, weaponUpgradeCost, RANKS, RANK_STEPS, rankName, rankProgress, COVER, SPAWNS, blocked, direction, coverDistance, targetDistance, settingsFrom } from './soldier-core.mjs';
const sql = readFileSync(new URL('./soldier-schema.sql', import.meta.url), 'utf8');
test('default equipment and upgrade prices match D through S progression', () => {
  assert.deepEqual(Object.values(DEFAULT_LOADOUT).map(id => WEAPONS[id].name), ['K2', 'M870', 'M9']);
  for (const [grade, costs] of Object.entries({
    D: [1000,2000,3000,4000,5000,6000], C: [3000,4000,5000,6000,7000,8000],
    B: [5000,7000,9000,11000,13000,15000], A: [10000,15000,20000,25000,30000,35000],
    S: [20000,30000,40000,50000,60000,70000]
  })) {
    assert.deepEqual(costs.map((_, index) => weaponUpgradeCost(grade, index + 1)), costs);
    assert.equal(weaponUpgradeCost(grade, 7), null);
  }
  assert.deepEqual([1,2,3,4,5,6,7].map(weaponLevelLabel), ['Lv.1','Lv.2','Lv.3','Lv.4','Lv.5','Lv.6','MAX']);
  assert.throws(() => weaponUpgradeCost('X', 1), RangeError);
  assert.throws(() => weaponUpgradeCost('D', 0), RangeError);
});
test('home displays weapon cards and saved levels without level-up buttons', () => {
  const html = readFileSync(new URL('./sanggi-soldier.html', import.meta.url), 'utf8');
  const client = readFileSync(new URL('./soldier.js', import.meta.url), 'utf8');
  assert.equal((html.match(/class="equipment-slot"/g) || []).length, 3);
  assert.equal((html.match(/class="weapon-level"/g) || []).length, 3);
  assert.doesNotMatch(html, /weapon-upgrade|>레벨업</);
  assert.doesNotMatch(html, /<select id="(?:primary|secondary|melee)"/);
  assert.doesNotMatch(client, /sanggi-soldier-loadout/);
  assert.match(client, /rpc\('soldier_weapon_items_api'/);
  assert.match(client, /rpc\('soldier_equipment_api', \{ p_token: identity.token \}\)/);
});
test('weapon names use a shared separate label rather than lettering baked into artwork', () => {
  const client = readFileSync(new URL('./soldier-weapon-items.mjs', import.meta.url), 'utf8');
  const css = readFileSync(new URL('./soldier.css', import.meta.url), 'utf8');
  assert.match(client, /card\.querySelector\('\.weapon-name'\)\.textContent = WEAPONS\[weapon\]\.name/);
  const style = css.match(/\.weapon-level, \.weapon-name \{([^}]+)\}/)[1];
  for (const declaration of ['font-weight: 900', 'font-style: italic', 'color: white']) {
    assert.ok(style.includes(declaration));
  }
  const position = css.match(/\n\.weapon-name \{([^}]+)\}/)[1];
  assert.ok(position.includes('text-align: center') && position.includes('bottom: 5%'));
  assert.match(client, /card\.querySelector\('\.weapon-level'\)\.textContent = weaponLevelLabel\(item\.level\)/);
  assert.doesNotMatch(css, /\.weapon-image[^}]+\+\s*\.weapon-name\s*\{\s*display:\s*none/);
  assert.ok(Object.values(WEAPONS).every(weapon => typeof weapon.name === 'string' && weapon.name.length > 0));
});
test('home offers equipment inventory and icon-only initial zero balances', () => {
  const html = readFileSync(new URL('./sanggi-soldier.html', import.meta.url), 'utf8');
  assert.match(html, /id="gold">0</);
  assert.match(html, /id="gems">0</);
  assert.doesNotMatch(html, /class="currency-name"/);
  assert.match(html, /id="equipment-dialog"/);
  for (const slot of ['primary', 'secondary', 'melee', 'character']) {
    assert.ok(html.includes(`data-equipment-tab="${slot}"`));
  }
});
test('all ten weapons match server-authoritative specifications', () => {
  assert.equal(Object.keys(WEAPONS).length, 10);
  for (const [id, spec] of Object.entries(WEAPONS)) {
    const match = sql.match(new RegExp(`when '${id}' then '([^']+)'`));
    assert.ok(match, id);
    for (const [key, value] of Object.entries(JSON.parse(match[1]))) assert.equal(spec[key], value, `${id}.${key}`);
  }
});
test('ranks cover private to marshal with exact XP boundaries', () => {
  assert.equal(RANKS.length, 20);
  assert.equal(rankName(-1), '이등병');
  assert.equal(rankName(199), '이등병');
  assert.equal(rankName(200), '일등병');
  let sum = 0;
  for (let i = 0; i < RANK_STEPS.length; i++) {
    assert.equal(rankName(sum), RANKS[i]);
    assert.equal(rankName(sum + RANK_STEPS[i] - 1), RANKS[i]);
    if (i) assert.ok(RANK_STEPS[i] >= RANK_STEPS[i - 1] * 1.49);
    sum += RANK_STEPS[i];
    assert.equal(rankName(sum), RANKS[i + 1]);
  }
  assert.equal(rankProgress(sum).winsNeeded, 0);
  assert.equal(rankProgress(0).winsNeeded, 2);
  assert.equal(rankProgress(100).winsNeeded, 1);
  assert.equal(rankProgress(200).required, 300);
  assert.equal(rankProgress(200).winsNeeded, 3);
});
test('upgrade preserves the same profile and settlement functions as the full install', () => {
  const upgrade = readFileSync(new URL('./soldier-home-upgrade.sql', import.meta.url), 'utf8');
  for (const name of ['soldier_connect', 'soldier_snapshot', 'soldier_settle_match']) {
    const expression = new RegExp(`create or replace function public\\.${name}\\([\\s\\S]*?\\$\\$;`);
    assert.equal(sql.match(expression)?.[0], upgrade.match(expression)?.[0], name);
  }
});
test('map and server cover geometry match and spawn positions are safe', () => {
  assert.equal(sql.includes(JSON.stringify(COVER)), true);
  for (const [x, z] of SPAWNS) assert.equal(blocked(x, z), false);
  assert.equal(blocked(49, 0), true);
  assert.equal(blocked(-25, -25), true);
  assert.equal(blocked(0, 0), false);
});
test('aim hits front-facing opponents but not behind walls or out of line', () => {
  const origin = { x: 0, y: 1.65, z: 0 }, ray = direction(0, 0);
  assert.deepEqual(ray, { x: -0, y: 0, z: -1 });
  const target = { x: 0, y: 0, z: -15 };
  assert.ok(targetDistance(origin, ray, target) < coverDistance(origin, ray));
  assert.ok(targetDistance(origin, ray, { ...target, z: -40 }) > coverDistance(origin, ray));
  assert.equal(targetDistance(origin, ray, { ...target, x: 3 }), Infinity);
  assert.equal(targetDistance(origin, ray, { ...target, z: 10 }), Infinity);
});
test('control settings clamp invalid values while preserving valid preferences', () => {
  const settings = settingsFrom({ autoFire: true, sensitivity: 20, controls: { fire: { x: 200, y: -20, size: 0 }, jump: { size: NaN } } });
  assert.equal(settings.autoFire, true); assert.equal(settings.sensitivity, 2);
  assert.equal(settings.controls.fire.x, 95); assert.equal(settings.controls.fire.y, 10); assert.equal(settings.controls.fire.size, 44);
  assert.equal(settings.controls.jump.size, 56);
});
