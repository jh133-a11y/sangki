import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_LOADOUT, weaponStats, applyWeaponSetBonuses, applyCharacterBonuses, initialWeaponAmmo, validateCombatWeapons } from './soldier-core.mjs';

test('character power and critical bonuses stack with weapon color sets on every slot', () => {
  const base=Object.fromEntries(Object.entries(DEFAULT_LOADOUT).map(([slot,id])=>[slot,weaponStats(id,'S+',7,'red')]));
  const set=applyWeaponSetBonuses(base);
  for (const bonus of [0,1,3]) {
    const character={damageBonus:bonus,criticalBonus:bonus};
    const weapons=applyCharacterBonuses(set,character);
    for(const slot of Object.keys(DEFAULT_LOADOUT)) {
      assert.equal(weapons[slot].damage,base[slot].damage+bonus);
      assert.equal(weapons[slot].critical,base[slot].critical+6+bonus);
      assert.equal(weapons[slot].weight,base[slot].weight);
      assert.equal(base[slot].critical,weaponStats(DEFAULT_LOADOUT[slot],'S+',7,'red').critical);
    }
    const state={weapon_version:1,ammo:initialWeaponAmmo(DEFAULT_LOADOUT),weapon_stats:Object.fromEntries(
      Object.entries(weapons).map(([slot,stats])=>[slot,{...stats,weapon:DEFAULT_LOADOUT[slot]}]))};
    assert.deepEqual(validateCombatWeapons(state,DEFAULT_LOADOUT,character),weapons);
    state.weapon_stats.primary.damage++;
    assert.throws(()=>validateCombatWeapons(state,DEFAULT_LOADOUT,character),/능력치/);
  }
  for(const character of [null,{}, {damageBonus:-1,criticalBonus:0},{damageBonus:1,criticalBonus:1.5}]) {
    assert.throws(()=>applyCharacterBonuses(set,character),RangeError);
  }
});
