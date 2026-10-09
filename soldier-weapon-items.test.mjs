import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { WEAPON_REWARDS, validateWeaponItems, fillWeaponCard, materialCost, upgradeMaterials, weaponLevelXp, weaponMaterialXp, weaponUpgradePreview } from './soldier-weapon-items.mjs';

test('all fifteen weapon-grade rewards reuse the same artwork, names and card layout', () => {
  assert.equal(WEAPON_REWARDS.length, 15);
  assert.equal(new Set(WEAPON_REWARDS.map(item => item.id)).size, 15);
  for (const weapon of ['k2', 'shotgun', 'stick']) {
    const variants = WEAPON_REWARDS.filter(item => item.weapon === weapon);
    assert.deepEqual(variants.map(item => item.grade), ['D', 'C', 'B', 'A', 'S']);
    assert.equal(new Set(variants.map(item => item.image)).size, 1);
    for (const variant of variants) {
      assert.ok(existsSync(variant.image.split('?')[0]));
      assert.ok(existsSync(variant.frame));
      const elements = Object.fromEntries(['.grade-frame', '.weapon-level', '.weapon-image', '.weapon-name'].map(key => [key, {}]));
      const card = { dataset: {}, querySelector: key => elements[key] };
      fillWeaponCard(card, weapon, { grade: variant.grade, level: 3 });
      assert.equal(card.dataset.grade, variant.grade);
      assert.equal(elements['.grade-frame'].src, variant.frame);
      assert.equal(elements['.weapon-level'].textContent, 'Lv.3');
      assert.equal(elements['.weapon-name'].textContent, variant.name);
      fillWeaponCard(card, weapon, { grade: variant.grade, level: 7 });
      assert.equal(elements['.weapon-level'].textContent, 'MAX');
    }
  }
});

test('duplicate rewards are separate items and capacity is per category', () => {
  const items = Array.from({ length: 50 }, (_, index) => ({
    id: String(index), weapon: 'k2', grade: 'S', level: 1, equipped: false
  }));
  assert.equal(validateWeaponItems({ gold: '0', items }).length, 50);
  assert.equal(validateWeaponItems({ gold: '0', items: [...items, { ...items[0], id: 'secondary', weapon: 'shotgun' }] }).length, 51);
  assert.throws(() => validateWeaponItems({ gold: '0', items: [...items, { ...items[0], id: 'extra' }] }), /50/);
  assert.throws(() => validateWeaponItems({ gold: '0', items: [items[0], items[0]] }), /서버/);
  assert.throws(() => validateWeaponItems({ gold: '0', items: [{ ...items[0], grade: 'X' }] }), /등급/);
  assert.throws(() => validateWeaponItems({ gold: '0', items: [{ ...items[0], equipped: true }, { ...items[1], equipped: true }] }), /중복/);
  assert.throws(() => validateWeaponItems({ gold: '-1', items: [] }), /서버/);
});

test('default weapons remain ordinary owned items and card reuse clears previous item metadata', () => {
  const items = ['k2', 'shotgun', 'stick'].map(weapon => ({
    id: `default-${weapon}`, weapon, grade: 'D', level: 2, equipped: true, source: 'default'
  }));
  assert.deepEqual(validateWeaponItems({ gold: '0', items }), items);
  const elements = Object.fromEntries(['.grade-frame', '.weapon-level', '.weapon-image', '.weapon-name'].map(key => [key, {}]));
  const card = { dataset: {}, querySelector: key => elements[key] };
  fillWeaponCard(card, 'k2', items[0]);
  assert.equal(card.dataset.source, 'default');
  assert.equal(card.dataset.itemId, 'default-k2');
  assert.equal(elements['.weapon-level'].textContent, 'Lv.2');
  fillWeaponCard(card, 'shotgun');
  assert.equal(card.dataset.source, '');
  assert.equal(card.dataset.itemId, '');
});

test('rewards are administrator-only, durable and idempotent', () => {
  const sql = readFileSync('soldier-weapon-rewards.sql', 'utf8');
  assert.match(sql, /unique \(client_id,reward_key\)/);
  assert.match(sql, /revoke all on function public\.soldier_grant_weapon\(uuid,text,text,text,text\) from public,anon,authenticated/);
  assert.match(sql, /enable row level security/);
  assert.match(sql, /item\.level<>p_level/);
  assert.match(sql, /total>=50/);
});

test('default inventory migration issues idempotent real items for existing and new profiles without replacing equipped rewards', () => {
  const sql = readFileSync('soldier-default-inventory.sql', 'utf8');
  assert.match(sql, /soldier_grant_weapon\(p_client,weapon_id,'D','default','default-'\|\|weapon_id\)/);
  assert.match(sql, /where client_id=p_client and weapon=weapon_id and equipped/);
  assert.match(sql, /after insert on public\.soldier_profiles/);
  assert.match(sql, /select client_id from public\.soldier_profiles/);
  assert.match(sql, /revoke all on function public\.soldier_default_weapons\(uuid\) from public,anon,authenticated/);
  assert.doesNotMatch(sql, /\bdelete\s+from\b/i);
});

test('material upgrades use requested per-card gold costs and protect equipped/default/target cards', () => {
  assert.deepEqual(['D','C','B','A','S'].map(materialCost), [0,2000,4000,8000,16000]);
  assert.throws(() => materialCost('X'));
  const target = { id:'target', weapon:'k2', grade:'C', level:1, equipped:true };
  const spare = { ...target, id:'spare', equipped:false, source:'event', upgrade_progress:20 };
  assert.deepEqual(upgradeMaterials([target, spare, {...spare,id:'default',source:'default'}, {...spare,id:'worn',equipped:true},
    {...spare,id:'other-grade',grade:'S'}, {...spare,id:'secondary',weapon:'shotgun'}],target).map(item=>item.id),['spare','other-grade','secondary']);
  const state = { gold:'1000', material_version:2, items:[{...spare,upgrade_xp:20,upgrade_progress:40}] };
  assert.equal(validateWeaponItems(state)[0].materialReady, true);
  for (const xp of [-1, 50, 1.5, undefined]) {
    assert.throws(()=>validateWeaponItems({...state,items:[{...spare,upgrade_xp:xp,upgrade_progress:40}]}),/진행률/);
  }
  assert.throws(()=>validateWeaponItems({...state,items:[{...state.items[0],level:7}]}),/진행률/);
  assert.throws(()=>validateWeaponItems({...state,items:[{...state.items[0],upgrade_progress:20}]}),/진행률/);
  assert.equal(validateWeaponItems({...state,material_version:1})[0].materialReady, undefined);
});

test('material XP preserves invested levels and percentages with multi-level carry and MAX overflow', () => {
  assert.deepEqual(['D','C','B','A','S'].map(weaponLevelXp), [25,50,100,200,400]);
  const target = { grade:'A',level:1,upgrade_xp:0 };
  const material = { grade:'A',level:2,upgrade_xp:100 };
  assert.equal(weaponMaterialXp(material), 500);
  assert.deepEqual(weaponUpgradePreview(target,[material]),
    { added:500,level:3,xp:100,percent:50,overflow:0,cost:8000 });
  assert.deepEqual(weaponUpgradePreview({...target,level:6},[material]),
    { added:500,level:7,xp:0,percent:0,overflow:300,cost:8000 });
  assert.deepEqual(weaponUpgradePreview(target,[{grade:'D',level:1,upgrade_xp:0}]),
    { added:25,level:1,xp:25,percent:12.5,overflow:0,cost:8000 });
  assert.equal(weaponUpgradePreview({...target,upgrade_xp:175},[{grade:'D',level:1,upgrade_xp:0}]).level,2);
});
