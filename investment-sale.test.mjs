import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

test('fresh installation and repair use the identical authoritative trade function', () => {
  const extract = file => readFileSync(file,'utf8').match(/create or replace function public\.investment_trade\([\s\S]*?\n\$\$;/)[0];
  assert.equal(extract('supabase-schema.sql'),extract('investment-sale-fix.sql'));
});

test('unowned and excessive sales do not submit an RPC; legitimate sales still submit', async () => {
  const source=readFileSync('app.js','utf8');
  const trade=source.slice(source.indexOf('const tradeInvestment ='),source.indexOf("investorForm.addEventListener('submit'"));
  const calls=[],alerts=[];
  const context=vm.createContext({
    investmentState:{holdings:[]},
    window:{alert:message=>alerts.push(message)},
    investorStatus:{},
    getInvestmentClientId:()=> 'owner',
    callInvestmentRpc:async(name,data)=> { calls.push(data); return {}; },
    hydrateInvestmentRankingLevels:async state=>state,
    renderInvestmentState:()=>{}
  });
  vm.runInContext(`${trade}\nglobalThis.trade=tradeInvestment;`,context);
  const input={value:'1',disabled:false};
  await context.trade('AAA','sell',input);
  assert.equal(calls.length,0);
  assert.match(alerts[0],/보유 주식/);
  context.investmentState.holdings=[{symbol:'AAA',quantity:2}];
  input.value='3';
  await context.trade('AAA','sell',input);
  assert.equal(calls.length,0);
  input.value='2';
  await context.trade('AAA','sell',input);
  assert.equal(calls.length,1);
  assert.equal(input.disabled,false);
  input.disabled=true;
  await context.trade('AAA','sell',input);
  assert.equal(calls.length,1);
});
