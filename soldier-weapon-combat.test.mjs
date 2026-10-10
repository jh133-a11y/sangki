import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { WEAPONS, WEAPON_COLORS, DEFAULT_LOADOUT, weaponStats, applyWeaponSetBonuses, initialWeaponAmmo, reloadWeaponAmmo, weaponHitDamage, validateCombatWeapons } from './soldier-core.mjs';

test('grade Lv1 inherits combat growth and firearm accuracy, recoil, and weight scale by grade', () => {
  const grades=['D','C','B','A','S'];
  for(const id of Object.keys(WEAPONS)) {
    for(let index=1;index<grades.length;index++) {
      const previous=weaponStats(id,grades[index-1],7),next=weaponStats(id,grades[index],1);
      for(const key of ['damage','critical','magazine','reserve','delay']) {
        assert.equal(next[key],previous[key],`${id}.${grades[index]}.${key}`);
      }
    }
    const firearms=Object.keys(WEAPONS).filter(id=>WEAPONS[id].slot!=='melee');
    for(const id of firearms) {
      const base=weaponStats(id,'D',1);
      for(const [tier,grade] of grades.entries()) {
        const stats=weaponStats(id,grade,1);
        assert.equal(stats.accuracy,base.accuracy+tier*3,`${id}.${grade}.accuracy`);
        assert.equal(stats.recoilControl,base.recoilControl+tier*3,`${id}.${grade}.recoilControl`);
        assert.equal(stats.weight,Math.round(base.weight*[1,.95,.9025,.857375,.81450625][tier]),`${id}.${grade}.weight`);
      }
    }
    for(const id of Object.keys(WEAPONS).filter(id=>WEAPONS[id].slot==='melee')) {
      const base=weaponStats(id,'D',1);
      for(const grade of grades) {
        const stats=weaponStats(id,grade,1);
        assert.equal(stats.accuracy,base.accuracy,`${id}.${grade}.accuracy`);
        assert.equal(stats.recoilControl,base.recoilControl,`${id}.${grade}.recoilControl`);
        assert.equal(stats.weight,base.weight,`${id}.${grade}.weight`);
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
  assert.deepEqual(fresh,{primary:30,primary_reserve:90,secondary:4,secondary_reserve:16,melee:0});
  let ammo={...fresh,primary:20};
  ammo=reloadWeaponAmmo(ammo,'primary',WEAPONS.k2);
  assert.equal(ammo.primary,30);assert.equal(ammo.primary_reserve,80);
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
  assert.equal(spec.damage,67);assert.equal(spec.critical,14);
  assert.deepEqual(weaponHitDamage(spec,()=>.1399),{damage:134,critical:true});
  assert.deepEqual(weaponHitDamage(spec,()=>.14),{damage:67,critical:false});
  assert.deepEqual(weaponHitDamage(weaponStats('shotgun'),()=>0),{damage:90,critical:true});
  assert.deepEqual(weaponHitDamage(weaponStats('stick'),()=>.31),{damage:135,critical:false});
});

test('requested D Lv1 base stats are used for every supported weapon', () => {
  const requested={
    k2:[19,650,30,90,76,86,4040,5],
    shotgun:[45,20,4,16,61,4,3550,6],
    stick:[135,80,0,undefined,null,null,null,31],
    psg1:[90,500,5,15,100,70,8100,1],
    m249:[68,600,100,100,68,86,9460,1],
    p90:[58,620,50,100,63,72,3900,1],
    auga3:[40,620,30,90,78,83,3800,14],
    g36c:[26,700,30,90,76,86,3400,4],
    akm:[53,600,30,90,74,54,3950,12]
  };
  for(const [id,[damage,rate,magazine,reserve,accuracy,recoil,weight,critical]] of Object.entries(requested)) {
    const stats=weaponStats(id);
    assert.equal(stats.damage,damage,id);
    assert.equal(Math.round(60/stats.delay),rate,id);
    assert.equal(stats.magazine,magazine,id);
    assert.equal(stats.reserve,reserve,id);
    assert.equal(stats.accuracy,accuracy,id);
    assert.equal(stats.recoilControl,recoil,id);
    assert.equal(stats.weight,weight,id);
    assert.equal(stats.critical,critical,id);
  }
});

test('weapon colors apply individual modifiers and same-color equipment set bonuses', () => {
  assert.deepEqual(WEAPON_COLORS, ['standard','gold','red','silver']);
  const base=weaponStats('k2','D',1);
  assert.equal(weaponStats('k2','D',1,'gold').damage,base.damage+5);
  assert.equal(weaponStats('k2','D',1,'red').critical,base.critical+5);
  assert.equal(weaponStats('k2','D',1,'silver').weight,Math.round(base.weight*.9));
  assert.equal(weaponStats('stick','D',1,'silver').weight,null);
  assert.throws(()=>weaponStats('k2','D',1,'blue'),RangeError);
  const gold=applyWeaponSetBonuses(Object.fromEntries(Object.entries(DEFAULT_LOADOUT)
    .map(([slot,id])=>[slot,weaponStats(id,'D',1,'gold')])));
  for(const [slot,id] of Object.entries(DEFAULT_LOADOUT)) {
    assert.equal(gold[slot].damage,weaponStats(id,'D',1,'gold').damage+3);
  }
  const mixed=applyWeaponSetBonuses({...Object.fromEntries(Object.entries(DEFAULT_LOADOUT)
    .map(([slot,id])=>[slot,weaponStats(id,'D',1,'gold')])),melee:weaponStats('stick','D',1,'red')});
  assert.equal(mixed.primary.damage,weaponStats('k2','D',1,'gold').damage);
  assert.equal(mixed.primary.critical,weaponStats('k2','D',1,'gold').critical);
  const silver=applyWeaponSetBonuses(Object.fromEntries(Object.entries(DEFAULT_LOADOUT)
    .map(([slot,id])=>[slot,weaponStats(id,'D',1,'silver')])));
  assert.equal(silver.primary.weight,Math.round(weaponStats('k2','D',1,'silver').weight*.9));
  assert.equal(silver.melee.weight,null);
});

test('combat snapshots require server-owned loadout stats and bounded finite ammo', () => {
  const state={weapon_version:1,weapon_stats:{},ammo:initialWeaponAmmo(DEFAULT_LOADOUT)};
  for(const [slot,id] of Object.entries(DEFAULT_LOADOUT)) {
    const {name,automatic,...spec}=weaponStats(id,'A',3);
    state.weapon_stats[slot]={...spec,weapon:id};
  }
  assert.equal(validateCombatWeapons(state,DEFAULT_LOADOUT).primary.damage,41);
  assert.throws(()=>validateCombatWeapons({...state,weapon_version:0},DEFAULT_LOADOUT),/서버/);
  assert.throws(()=>validateCombatWeapons({...state,ammo:{...state.ammo,primary_reserve:101}},DEFAULT_LOADOUT),/탄환/);
  assert.throws(()=>validateCombatWeapons({...state,weapon_stats:{...state.weapon_stats,primary:{...state.weapon_stats.primary,damage:10000}}},DEFAULT_LOADOUT),/능력치/);
  const goldStats=applyWeaponSetBonuses(Object.fromEntries(Object.entries(DEFAULT_LOADOUT)
    .map(([slot,id])=>[slot,{...weaponStats(id,'D',1,'gold'),weapon:id}])));
  const goldState={...state,weapon_stats:goldStats};
  assert.equal(validateCombatWeapons(goldState,DEFAULT_LOADOUT).primary.damage,27);
  assert.throws(()=>validateCombatWeapons({...goldState,weapon_stats:{...goldStats,melee:{...goldStats.melee,color:'red'}}},DEFAULT_LOADOUT),/능력치/);
});

test('combat migration preserves base specs and captures trusted stats instead of client-provided grade/level', () => {
  const schema=readFileSync('soldier-schema.sql','utf8'),migration=readFileSync('soldier-weapon-combat.sql','utf8');
  const weapon=/create or replace function public\.soldier_weapon\([\s\S]*?\$\$;/;
  assert.equal(migration.match(weapon)[0],schema.match(weapon)[0]);
  assert.match(migration,/where client_id=p_client and weapon=weapon_id and equipped/);
  assert.match(migration,/soldier_weapon_item_managed\(weapon_id\)/);
  assert.match(migration,/grade_steps\*3/);
  assert.match(migration,/round\(\(spec->>'weight'\)::numeric\*weight_factor\)/);
  assert.match(migration,/spec:=me\.weapon_stats->slot_name/);
  assert.match(migration,/ammo=public\.soldier_initial_ammo\(weapon_stats\)/);
  assert.match(migration,/ammo=public\.soldier_reload_ammo\(ammo,reload_slot,weapon_stats->reload_slot\)/);
  assert.match(migration,/damage:=damage\*2/);
  assert.match(migration,/grant execute on function public\.soldier_api/);
  assert.match(migration,/p_color not in \('standard','gold','red','silver'\)/);
  assert.match(migration,/item_color text/);
  assert.match(migration,/stats->'primary'->>'color'/);
});
