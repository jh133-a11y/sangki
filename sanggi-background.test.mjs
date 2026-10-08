import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('./sanggi.js', import.meta.url), 'utf8');
test('owned backgrounds add the same bonus to click and automatic rewards', () => {
  const rewards = source.slice(source.indexOf('  const companionBonus ='), source.indexOf('  const autoIntervalMs ='));
  const context = vm.createContext({
    companionUnlocked: false, companionLevel: 1, breathLevel: 1, backgroundBonus: 0n
  });
  vm.runInContext(rewards + '\nglobalThis.click=clickReward;globalThis.auto=autoReward;', context);
  for (const [bonus, expected] of [[0n,1n],[1000n,1001n],[3000n,3001n],[4000n,4001n]]) {
    context.backgroundBonus = bonus;
    assert.equal(context.click(), expected);
    assert.equal(context.auto(), expected);
  }
  context.breathLevel = 2;
  context.companionUnlocked = true;
  assert.equal(context.click(), 4111n);
  assert.equal(context.auto(), 4111n);
});
test('background prices and owned bonuses are server controlled', () => {
  const sql = readFileSync(new URL('./sanggi-backgrounds.sql', import.meta.url), 'utf8');
  assert.match(sql, /when 'old_village' then 1000000000 else 5000000000/);
  assert.match(sql, /when 'old_village' then 1000 else 3000/);
  assert.match(sql, /if not exists\(select 1 from public\.sanggi_backgrounds/);
  assert.match(sql, /update public\.sanggi_backgrounds set client_id=v_account_id/);
});
