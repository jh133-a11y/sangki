import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const app = readFileSync(new URL('./app.js', import.meta.url), 'utf8');
const schema = readFileSync(new URL('./supabase-schema.sql', import.meta.url), 'utf8');
const splitMigration = readFileSync(new URL('./investment-stock-split-fix.sql', import.meta.url), 'utf8');
const resetMigration = readFileSync(new URL('./investment-reset-assets.sql', import.meta.url), 'utf8');
const helpers = app.slice(app.indexOf('const parseExactDecimal ='), app.indexOf('const confirmBackdrop ='));
const context = vm.createContext({});
vm.runInContext(`${helpers}
globalThis.precision = { parseExactDecimal, multiplyPriceByQuantity, sharesAffordable, formatWon, formatStockPrice };`,
context);
const precision = context.precision;

test('portfolio valuation remains unchanged across repeated decimal splits', () => {
  for (const [price, quantity] of [
    ['1500000', '3'],
    ['15000', '300'],
    ['150', '30000'],
    ['1.5', '3000000'],
    ['0.015', '300000000'],
    ['0.00015', '30000000000']
  ]) {
    assert.equal(precision.multiplyPriceByQuantity(price, quantity).toString(), '4500000');
  }
});

test('exact valuation and affordability handle quantities beyond bigint and decimal prices', () => {
  assert.equal(
    precision.multiplyPriceByQuantity('0.00015', '30000000000000000000').toString(),
    '4500000000000000'
  );
  assert.equal(precision.sharesAffordable('100', '0.3').toString(), '333');
  assert.equal(precision.formatWon('4500000000000000'), '₩4,500,000,000,000,000');
  assert.equal(precision.formatStockPrice('0.000150000'), '₩0.00015');
});

test('every installed split function multiplies shares and divides prices without rounding', () => {
  const definitions = [
    ...schema.matchAll(/create or replace function public\.investment_apply_stock_splits\(\)[\s\S]*?\n\$\$;/g)
  ].map(([definition]) => definition);
  assert.equal(definitions.length, 2);
  for (const definition of [...definitions, splitMigration.match(/create or replace function public\.investment_apply_stock_splits\(\)[\s\S]*?\n\$\$;/)?.[0]]) {
    assert.ok(definition);
    assert.match(definition, /set_config\('app\.investment_admin_reset', 'on', true\)/);
    assert.match(definition, /coalesce\(v_previous_admin_reset, 'off'\)/);
    assert.match(definition, /set quantity = quantity \* v_split_factor/);
    assert.match(definition, /set current_price = current_price \/ v_split_factor/);
  }
});

test('stock migration detaches every dependent current-price trigger and restores its definition', () => {
  const captureTriggers = splitMigration.indexOf('create temporary table investment_stock_split_saved_triggers');
  const dropTrigger = splitMigration.indexOf("execute format('drop trigger %I on public.investment_assets'");
  const alterPrice = splitMigration.indexOf('alter column current_price type numeric');
  const recreateTrigger = splitMigration.indexOf('execute trigger_row.trigger_definition');
  assert.ok(captureTriggers >= 0);
  assert.ok(dropTrigger > captureTriggers);
  assert.ok(dropTrigger < alterPrice);
  assert.ok(recreateTrigger > alterPrice);
  assert.match(splitMigration, /d\.refobjsubid = a\.attnum/);
  assert.match(splitMigration, /trigger_enabled = 'R'/);
  assert.match(splitMigration, /trigger_enabled = 'A'/);
});

test('fractional-price trading rounds against value creation and rejects fractional shares', () => {
  for (const sql of [schema, splitMigration]) {
    const trade = sql.match(/create or replace function public\.investment_trade\([\s\S]*?\n\$\$;/)?.[0];
    assert.ok(trade);
    assert.match(trade, /p_quantity <> trunc\(p_quantity\)/);
    assert.match(trade, /when p_side = 'buy' then ceil\(asset_row\.current_price \* p_quantity::numeric\)/);
    assert.match(trade, /else floor\(asset_row\.current_price \* p_quantity::numeric\)/);
  }
});

test('asset reset is one-time and touches only investment holdings and cash', () => {
  const executableSql = resetMigration.replace(/--.*$/gm, '');
  assert.match(executableSql, /migration_key = 'reset_stock_assets_to_5000000_v1'/);
  assert.match(executableSql, /delete from public\.investment_holdings/);
  assert.match(executableSql, /update public\.investment_users\s+set cash = 5000000/);
  assert.doesNotMatch(executableSql, /delete from public\.investment_users/i);
  assert.doesNotMatch(executableSql, /investment_shop_items|sanggi_game_states|inventory/i);
});
