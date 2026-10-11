import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { WEAPONS, EQUIPMENT_GRADES, WEAPON_ENCHANTMENTS, weaponStats, applyWeaponEnchantment, applyWeaponSetBonuses } from './soldier-core.mjs';
import { ATTENDANCE_TABLES, ROULETTE_PRIZES, rewardItemName, rewardQuantity, validateDaily } from './soldier-daily.mjs';
import { weaponInventoryStats, formatWeaponSetStats } from './soldier-inventory.mjs';
import { validateWeaponItems } from './soldier-weapon-items.mjs';
import { SUPPLY_PRODUCTS, validateSupply } from './soldier-supply.mjs';

test('blue and green individual effects stack separately with set effects and accuracy caps at 100',()=>{
  assert.deepEqual(['magazine','reserve','damage','accuracy','recoilControl','weight','critical'].map(key=>WEAPONS.utsbp[key]),[7,14,20,65,30,2900,1]);
  assert.equal(60/WEAPONS.utsbp.delay,40);
  for(const [index,grade] of EQUIPMENT_GRADES.entries()) {
    const blueAmount=index+1, greenAmount=[1,2,2,3,3,4][index];
    const base=weaponStats('k2',grade), blueWeapon=weaponStats('k2',grade,1,'blue');
    assert.equal(blueWeapon.magazine,base.magazine);
    assert.equal(blueWeapon.accuracy,Math.min(100,base.accuracy+blueAmount));
    const mixedLoadout={
      primary:blueWeapon,
      secondary:weaponStats('utsbp',grade,1,'standard'),
      melee:weaponStats('stick',grade,1,'standard')
    };
    assert.equal(applyWeaponSetBonuses(mixedLoadout).primary.accuracy,blueWeapon.accuracy,
      'blue individual bonus applies without a matching set');
    const inventoryBlueAccuracy=weaponInventoryStats('k2',grade,1,'blue')[3][1];
    assert.equal(inventoryBlueAccuracy,blueWeapon.accuracy,'individual blue accuracy appears in weapon stats');
    const blueSet=applyWeaponSetBonuses({
      primary:weaponStats('k2',grade,1,'blue'),
      secondary:weaponStats('utsbp',grade,1,'blue'),
      melee:weaponStats('stick',grade,1,'blue')
    });
    assert.equal(blueSet.primary.magazine,base.magazine);
    assert.equal(blueSet.primary.accuracy,Math.min(100,weaponStats('k2',grade,1,'blue').accuracy+blueAmount));
    assert.equal(weaponInventoryStats('k2',grade,1,'blue',{grade,color:'blue'})[3][1],blueSet.primary.accuracy,
      'blue set accuracy appears in weapon stats once, capped at 100');
    assert.equal(formatWeaponSetStats(weaponInventoryStats('k2',grade,1,'blue'),{grade,color:'blue'})[3][1],
      `${blueSet.primary.accuracy} (세트 +${blueAmount} · 최대 100)`);
    const greenBase=weaponStats('utsbp',grade), greenWeapon=weaponStats('utsbp',grade,1,'green');
    assert.equal(greenWeapon.recoilControl,Math.min(100,greenBase.recoilControl+greenAmount));
    assert.equal(weaponInventoryStats('utsbp',grade,1,'green')[4][1],greenWeapon.recoilControl,
      'individual green recoil control appears in weapon stats');
    const greenSet=applyWeaponSetBonuses({
      primary:weaponStats('k2',grade,1,'green'),
      secondary:weaponStats('utsbp',grade,1,'green'),
      melee:weaponStats('stick',grade,1,'green')
    });
    assert.equal(greenSet.secondary.recoilControl,Math.min(100,greenBase.recoilControl+2*greenAmount));
    assert.equal(weaponInventoryStats('utsbp',grade,1,'green',{grade,color:'green'})[4][1],greenSet.secondary.recoilControl,
      'green set recoil control is added separately with its cap');
    assert.equal(formatWeaponSetStats(weaponInventoryStats('utsbp',grade,1,'green'),{grade,color:'green'})[4][1],
      `${greenSet.secondary.recoilControl} (세트 +${greenAmount} · 최대 100)`);
    assert.equal(greenSet.melee.accuracy,null);
    for(const id of Object.keys(WEAPONS)) {
      for(const color of ['standard','gold','red','silver','blue','green']) {
        const accuracy=weaponStats(id,grade,1,color).accuracy;
        if(Number.isFinite(accuracy)) assert.ok(accuracy<=100,`${id} ${grade} ${color} accuracy is capped`);
      }
    }
  }
  assert.equal(applyWeaponEnchantment({...weaponStats('k2','S+',7),accuracy:100},'accuracy-2').accuracy,100);
  assert.equal(applyWeaponEnchantment({...weaponStats('k2','S+',7),recoilControl:100},'recoil-2').recoilControl,100);
});
test('all ten enchantments alter only the requested numeric stat and require S+ MAX',()=>{
  assert.equal(WEAPON_ENCHANTMENTS.length,10);
  const base=weaponStats('utsbp','S+',7);
  for(const option of WEAPON_ENCHANTMENTS) {
    const result=applyWeaponEnchantment(base,option.id);
    assert.equal(result[option.stat],option.stat==='weight' ? Math.round(base.weight*(100+option.value)/100)
      : ['recoilControl','accuracy'].includes(option.stat) ? Math.min(100,base[option.stat]+option.value) : base[option.stat]+option.value);
    assert.equal(base.damage,86);
    assert.throws(()=>applyWeaponEnchantment(weaponStats('k2','S+',6),option.id));
    assert.throws(()=>applyWeaponEnchantment(weaponStats('k2','S',7),option.id));
  }
  assert.throws(()=>validateWeaponItems({gold:'0',items:[{id:'1',weapon:'k2',grade:'D',level:1,equipped:false,enchantment:'damage-1'}]}),/부여/);
});
test('roulette exact weights sum to 100% and three attendance tables retain all 60 ordered rewards',()=>{
  assert.equal(ROULETTE_PRIZES.length,17);
  assert.deepEqual(ROULETTE_PRIZES.map(prize=>prize.weight),[1500,1000,300,100,500,300,300,100,10,1,50,39,1500,1000,300,2000,1000]);
  assert.equal(ROULETTE_PRIZES.reduce((sum,prize)=>sum+prize.weight,0),10000);
  assert.deepEqual(ATTENDANCE_TABLES.map(table=>table.length),[20,20,20]);
  assert.equal(ATTENDANCE_TABLES[0][19].product,'guaranteed-b');
  assert.equal(ATTENDANCE_TABLES[1][19].product,'special');
  assert.equal(ATTENDANCE_TABLES[2][19].product,'guaranteed-a');
  assert.deepEqual(ATTENDANCE_TABLES[2].slice(16,19).map(reward=>reward.amount),[1,2,3]);
  assert.match(readFileSync('soldier-daily-rewards.sql','utf8'),/Asia\/Seoul/);
});
test('experience reward artwork is an accessible standalone SVG',()=>{
  const artwork=readFileSync('soldier-xp-icon.svg','utf8');
  const daily=readFileSync('soldier-daily.mjs','utf8');
  assert.match(artwork,/aria-label="경험치"/);
  assert.match(artwork,/<svg\b/);
  assert.match(artwork,/<path\b/);
  assert.match(daily,/rewardDetailsDisplay\(reward,'attendance-reward'\)/);
  assert.match(daily,/rewardDetailsDisplay\(prize,'roulette-reward'\)/);
  assert.match(daily,/supplyArtwork\(reward\.product\)/);
  assert.match(daily,/soldier-xp-icon\.svg/);
});
test('attendance and roulette reward details separate item names from quantities',()=>{
  assert.equal(rewardItemName({kind:'gems'}),'보석');
  assert.equal(rewardItemName({kind:'gold'}),'골드');
  assert.equal(rewardItemName({kind:'xp'}),'경험치');
  assert.equal(rewardItemName({kind:'crate',product:SUPPLY_PRODUCTS[0].id}),SUPPLY_PRODUCTS[0].name);
  assert.equal(rewardQuantity({amount:1}),'× 1');
  assert.equal(rewardQuantity({amount:1000}),'× 1,000');
});
test('new crates reject impossible guarantee responses and daily responses reject invalid balances/prizes',()=>{
  const owner='00000000-0000-0000-0000-000000000001';
  const result={daily_version:1,client_id:owner,action:'spin',request:owner,replayed:false,gems:'0',gold:'0',xp:'0',
    free_spins:2,attendance_table:null,attendance_step:0,attendance_available:true,can_select:true,mail:[],
    outcome:{mail_id:owner,reward:{kind:'gems',amount:1,index:0}}};
  assert.equal(validateDaily(result,owner,'spin',owner),result);
  assert.throws(()=>validateDaily({...result,gems:'-1'},owner,'spin',owner));
  assert.throws(()=>validateDaily({...result,outcome:{...result.outcome,reward:{kind:'gems',amount:100,index:0}}},owner,'spin',owner));
  for(const [product,grades] of [['guaranteed-b',['C']],['guaranteed-a',['B']],['premium',['A','B','B']]]) {
    const rewards=grades.map((grade,index)=>({id:String(index),weapon:'k2',color:'standard',grade,level:1}));
    const receipt={supply_version:1,client_id:owner,replayed:true,gems:'0',product,request:owner,rewards,inventory:{gold:'0',items:[]}};
    assert.throws(()=>validateSupply(receipt,product,owner),/보장/);
  }
});
