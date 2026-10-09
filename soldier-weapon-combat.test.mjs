import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { WEAPONS, DEFAULT_LOADOUT, weaponStats, initialWeaponAmmo, reloadWeaponAmmo, weaponHitDamage, validateCombatWeapons } from './soldier-core.mjs';

test('grade Lv1 inherits every previous grade MAX stat, with exact damage and critical growth', () => {
  const grades=['D','C','B','A','S'];
  for(const id of ['k2','shotgun','stick']) {
    for(let index=1;index<grades.length;index++) {
      const previous=weaponStats(id,grades[index-1],7),next=weaponStats(id,grades[index],1);
      for(const key of ['damage','critical','magazine','reserve','accuracy','recoilControl','weight','delay']) {
        assert.equal(next[key],previous[key],`${id}.${grades[index]}.${key}`);
      }
    }
    for(const [grade,step,criticalStep] of [['D',1,0],['C',1,0],['B',1,0],['A',2,1],['S',3,2]]) {
      const base=weaponStats(id,grade,1);
      for(let level=1;level<=7;level++) {
        const stats=weaponStats(id,grade,level);
        assert.equal(stats.damage,base.damage+(level-1)*step);
        assert.equal(stats.critical,base.critical+Math.floor((level-1)/2)*criticalStep);
      }
    }
  }
  for(const [grade,level] of [['X',1],['constructor',1],['D',0],['D',8],['D',1.5]]) {
    assert.throws(()=>weaponStats('k2',grade,level),RangeError);
  }
  assert.throws(()=>weaponStats('constructor'),RangeError);
  assert.throws(()=>initialWeaponAmmo({primary:'constructor'}),RangeError);
});

test('finite reserves support partial reloads, empty reserves and unlimited melee without creating ammo', () => {
  const fresh=initialWeaponAmmo(DEFAULT_LOADOUT);
  assert.deepEqual(fresh,{primary:25,primary_reserve:100,secondary:6,secondary_reserve:24,melee:0});
  let ammo={...fresh,primary:20};
  ammo=reloadWeaponAmmo(ammo,'primary',WEAPONS.k2);
  assert.equal(ammo.primary,25);assert.equal(ammo.primary_reserve,95);
  const partial=reloadWeaponAmmo({...ammo,primary:0,primary_reserve:3},'primary',WEAPONS.k2);
  assert.equal(partial.primary,3);assert.equal(partial.primary_reserve,0);
  assert.deepEqual(reloadWeaponAmmo(partial,'primary',WEAPONS.k2),partial);
  assert.deepEqual(reloadWeaponAmmo(fresh,'melee',WEAPONS.stick),fresh);
  assert.equal(reloadWeaponAmmo({secondary:0},'secondary',WEAPONS.pistol).secondary,12);
  assert.throws(()=>reloadWeaponAmmo({primary:0},'primary',WEAPONS.k2),/보유탄환/);
  assert.deepEqual(fresh,initialWeaponAmmo(DEFAULT_LOADOUT),'reload must not mutate its input');
});

test('critical hit thresholds and damage use the equipped grade/level', () => {
  const spec=weaponStats('k2','S',7);
  assert.equal(spec.damage,72);assert.equal(spec.critical,13);
  assert.deepEqual(weaponHitDamage(spec,()=>.1299),{damage:144,critical:true});
  assert.deepEqual(weaponHitDamage(spec,()=>.13),{damage:72,critical:false});
  assert.deepEqual(weaponHitDamage(weaponStats('shotgun'),()=>0),{damage:150,critical:true});
  assert.deepEqual(weaponHitDamage(weaponStats('stick'),()=>.1),{damage:70,critical:false});
});

test('combat snapshots require server-owned loadout stats and bounded finite ammo', () => {
  const state={weapon_version:1,weapon_stats:{},ammo:initialWeaponAmmo(DEFAULT_LOADOUT)};
  for(const [slot,id] of Object.entries(DEFAULT_LOADOUT)) {
    const {name,automatic,...spec}=weaponStats(id,'A',3);
    state.weapon_stats[slot]={...spec,weapon:id};
  }
  assert.equal(validateCombatWeapons(state,DEFAULT_LOADOUT).primary.damage,46);
  assert.throws(()=>validateCombatWeapons({...state,weapon_version:0},DEFAULT_LOADOUT),/서버/);
  assert.throws(()=>validateCombatWeapons({...state,ammo:{...state.ammo,primary_reserve:101}},DEFAULT_LOADOUT),/탄환/);
  assert.throws(()=>validateCombatWeapons({...state,weapon_stats:{...state.weapon_stats,primary:{...state.weapon_stats.primary,damage:10000}}},DEFAULT_LOADOUT),/능력치/);
});

test('combat migration preserves base specs and captures trusted stats instead of client-provided grade/level', () => {
  const schema=readFileSync('soldier-schema.sql','utf8'),migration=readFileSync('soldier-weapon-combat.sql','utf8');
  const weapon=/create or replace function public\.soldier_weapon\([\s\S]*?\$\$;/;
  assert.equal(migration.match(weapon)[0],schema.match(weapon)[0]);
  assert.match(migration,/where client_id=p_client and weapon=weapon_id and equipped/);
  assert.match(migration,/spec:=me\.weapon_stats->slot_name/);
  assert.match(migration,/ammo=public\.soldier_initial_ammo\(weapon_stats\)/);
  assert.match(migration,/ammo=public\.soldier_reload_ammo\(ammo,reload_slot,weapon_stats->reload_slot\)/);
  assert.match(migration,/damage:=damage\*2/);
  assert.match(migration,/grant execute on function public\.soldier_api/);
});
