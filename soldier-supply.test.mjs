import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SUPPLY_PRODUCTS, validateSupply } from './soldier-supply.mjs';

const owner='00000000-0000-0000-0000-000000000001';
function receipt(product,grades) {
  const rewards=grades.map((grade,i) => ({id:`item-${i}`,weapon:'k2',grade,level:1}));
  return {supply_version:1,client_id:owner,replayed:false,gems:'100',product,request:owner,rewards,
    inventory:{gold:'0',material_version:2,items:rewards.map(item => ({...item,equipped:false,
      source:`supply-${product}`,upgrade_xp:0,upgrade_progress:0}))}};
}
test('three supply products disclose exact prices, quantities and requested odds',() => {
  assert.deepEqual(SUPPLY_PRODUCTS.map(p => [p.id,p.price,p.count]),[['special',300,11],['advanced',30,1],['normal',3,1]]);
  assert.match(SUPPLY_PRODUCTS[0].odds,/첫 번째: A 95% · S 5%/);
  assert.match(SUPPLY_PRODUCTS[1].odds,/C 60% · B 25% · A 10% · S 5%/);
  assert.match(SUPPLY_PRODUCTS[2].odds,/D 60% · C 30% · B 6% · A 3% · S 1%/);
});
test('supply response validates quantities, ownership and first special guaranteed grade',() => {
  const single=receipt('normal',['D']);
  assert.equal(validateSupply(single,'normal',owner).length,1);
  const special=receipt('special',['A',...Array(10).fill('C')]);
  assert.equal(validateSupply(special,'special',owner).length,11);
  for (const broken of [
    {...single,request:'wrong'}, {...single,gems:'-1'}, {...single,rewards:[]},
    {...single,inventory:{gold:'0',items:[]}}, {...single,client_id:undefined}
  ]) assert.throws(() => validateSupply(broken,'normal',owner));
  assert.throws(() => validateSupply(receipt('advanced',['D']),'advanced',owner),/최소/);
  assert.throws(() => validateSupply(receipt('special',['C','A',...Array(9).fill('C')]),'special',owner),/보장/);
  assert.throws(() => validateSupply({...special,rewards:[special.rewards[0],...Array(10).fill(special.rewards[1])]},'special',owner));
  assert.equal(validateSupply({...single,replayed:true,inventory:{gold:'0',items:[]}},'normal',owner).length,0);
});
test('purchase SQL is transactional, session-verified, server-priced and durable on replay',() => {
  const sql=readFileSync('soldier-supply.sql','utf8');
  assert.match(sql,/perform public\.soldier_equipment_api\(p_token\)/);
  assert.match(sql,/primary key \(client_id,request_id\)/);
  assert.match(sql,/for update/);
  assert.match(sql,/soldier_grant_weapon/);
  assert.match(sql,/enable row level security/);
  assert.match(sql,/p_product='special' and p_index=1/);
  assert.doesNotMatch(sql,/p_(price|grade|weapon)\b/);
});
test('opening matches reference timing and includes reduced motion, skipping and sound controls',() => {
  const source=readFileSync('soldier-supply-opening.mjs','utf8');
  assert.match(source,/turn: 200, lid: 360, flash: 400, reveal: 780, finish: 1300/);
  assert.match(source,/prefers-reduced-motion/);
  assert.match(source,/연출 건너뛰기/);
  assert.match(source,/forceContextLoss/);
  assert.match(source,/효과음 꺼짐/);
});
