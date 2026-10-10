import test from 'node:test';
import assert from 'node:assert/strict';
import { sortInventoryEntries } from './soldier-inventory.mjs';

test('inventory defaults to descending grade, then name without mutating source', () => {
  const entries = [
    { id:'k2',item:{grade:'D'} },
    { id:'p90',item:{grade:'A'} },
    { id:'akm',item:{grade:'A'} },
    { id:'psg1',item:{grade:'S'} },
    { id:'stick',item:{grade:'S+'} },
    { id:'m249',item:{grade:'B'} },
    { id:'g36c',item:{grade:'C'} }
  ];
  assert.deepEqual(sortInventoryEntries(entries,{}).map(x=>x.id),
    ['stick','psg1','akm','p90','m249','g36c','k2']);
  assert.equal(entries[0].id,'k2');
  assert.deepEqual(sortInventoryEntries(entries,{},'name').map(x=>x.id),
    ['akm','g36c','k2','m249','stick','psg1','p90']);
});

test('grade sorting includes legacy equipment and characters sort by name', () => {
  assert.deepEqual(sortInventoryEntries([{id:'k2'},{id:'p90'}],{k2:{grade:'S'},p90:{grade:'D'}}).map(x=>x.id),['k2','p90']);
  const entries=[{id:'z'},{id:'a'}];
  assert.deepEqual(sortInventoryEntries(entries,{}).map(x=>x.id),['a','z']);
});
