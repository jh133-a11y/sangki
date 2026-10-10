import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { WEAPONS, WEAPON_COLORS, weaponStats, applyWeaponSetBonuses, weaponSetColor } from './soldier-core.mjs';
import { materialCost, weaponLevelXp, weaponGradeArtwork } from './soldier-weapon-items.mjs';
import { weaponInventoryStats, formatWeaponSetStats } from './soldier-inventory.mjs';

test('every S+ Lv1 stat equals S MAX, then gains 3 damage and 1 critical each level', () => {
  for (const id of Object.keys(WEAPONS)) for (const color of WEAPON_COLORS) {
    const { grade: oldGrade, level: oldLevel, ...max } = weaponStats(id,'S',7,color);
    const { grade, level, ...next } = weaponStats(id,'S+',1,color);
    assert.deepEqual(next,max,`${id}/${color}`);
    for (let lv=2;lv<=7;lv++) {
      const grown=weaponStats(id,'S+',lv,color);
      assert.equal(grown.damage,next.damage+(lv-1)*3);
      assert.equal(grown.critical,next.critical+lv-1);
      for (const key of ['accuracy','recoilControl','weight']) assert.equal(grown[key],next[key]);
    }
  }
  assert.equal(materialCost('S+'),32000);
  assert.equal(weaponLevelXp('S+'),800);
  assert.equal(weaponGradeArtwork('S+'),'soldier-grade-s-plus.webp?v=2');
});

test('set effects require all slots matching both grade and color', () => {
  for (const color of ['gold','red','silver']) {
    const set={primary:weaponStats('k2','S+',1,color),secondary:weaponStats('shotgun','S+',1,color),melee:weaponStats('stick','S+',1,color)};
    assert.equal(weaponSetColor(set),color);
    const enhanced=applyWeaponSetBonuses(set);
    if (color==='gold') assert.equal(enhanced.primary.damage,set.primary.damage+4);
    if (color==='red') assert.equal(enhanced.primary.critical,set.primary.critical+6);
    if (color==='silver') assert.equal(enhanced.primary.weight,Math.round(set.primary.weight*.8));
    set.melee=weaponStats('stick','S',7,color);
    assert.equal(weaponSetColor(set),null);
    assert.deepEqual(applyWeaponSetBonuses(set),set);
  }
});

test('all six grades apply exact set bonuses while preserving base color effects', () => {
  const grades = ['D','C','B','A','S','S+'];
  for (const [index,grade] of grades.entries()) for (const color of ['gold','red','silver']) {
    const base = { primary:weaponStats('k2',grade,1,color), secondary:weaponStats('shotgun',grade,1,color), melee:weaponStats('stick',grade,1,color) };
    const actual = applyWeaponSetBonuses(base);
    for (const slot of Object.keys(base)) {
      assert.equal(actual[slot].damage, base[slot].damage + (color === 'gold' ? [1,1,2,2,3,4][index] : 0));
      assert.equal(actual[slot].critical, base[slot].critical + (color === 'red' ? index + 1 : 0));
      assert.equal(actual[slot].weight, color === 'silver' && Number.isInteger(base[slot].weight)
        ? Math.round(base[slot].weight * (90 - index * 2) / 100) : base[slot].weight);
    }
    const preview = weaponInventoryStats('k2',grade,1,color,{grade,color});
    assert.equal(preview[1][1], actual.primary.damage);
    assert.equal(preview[5][1], actual.primary.weight);
    assert.equal(preview[6][1], `${actual.primary.critical}%`);
  }
});

test('equipped stat display separates the base from the set bonus', () => {
  const values = [['위력',40],['크리티컬 확률','22%'],['무게',3000],['정확도',80]];
  assert.deepEqual(formatWeaponSetStats(values,{grade:'S',color:'red'}).map(row=>row[1]),[40,'22% + 5%',3000,80]);
  assert.equal(formatWeaponSetStats(values,{grade:'S+',color:'gold'})[0][1],'40 + 4');
  assert.equal(formatWeaponSetStats(values,{grade:'C',color:'silver'})[2][1],'3000 - 12%');
  assert.equal(formatWeaponSetStats(values,null),values);
  assert.equal(values[1][1],'22%');
});

test('S+ migration extends existing constraints, recipes and material progression', () => {
  const rewards=readFileSync(new URL('./soldier-weapon-rewards.sql',import.meta.url),'utf8');
  const materials=readFileSync(new URL('./soldier-weapon-material-upgrade.sql',import.meta.url),'utf8');
  const equipment=readFileSync(new URL('./soldier-equipment-upgrade.sql',import.meta.url),'utf8');
  assert.match(rewards,/drop constraint if exists soldier_weapon_items_grade_check/);
  assert.match(equipment,/drop constraint if exists soldier_equipment_grade_check/);
  assert.match(rewards,/when 'S' then 100 end/);
  assert.match(rewards,/when 'A' then 'S' else 'S\+' end/);
  assert.match(rewards,/if cost is null then raise exception 'S\+급 무기는 조합할 수 없습니다.'/);
  assert.match(rewards,/when 'S\+' then 'S' else 'A' end/);
  assert.match(materials,/when 'S\+' then 800/);
  assert.match(materials,/when 'S\+' then 32000/);
});
