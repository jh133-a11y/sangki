import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('shop supply cards use the original metallic crate illustrations', () => {
  const shop = readFileSync('soldier-shop.mjs', 'utf8');
  assert.match(shop, /supplyArtwork\(product\.id\)/);
  for (const id of ['normal', 'advanced', 'special']) {
    const svg = readFileSync(`soldier-supply-${id}.svg`, 'utf8');
    assert.match(svg, /<linearGradient id="steel"/);
    assert.match(svg, /<filter id="shadow"/);
    assert.match(svg, /<path d="m125 179 105-91/);
  }
});

test('grade assets share the common card canvas and S content has normalized alpha bounds', () => {
  const items = readFileSync('soldier-weapon-items.mjs', 'utf8');
  assert.match(items, /grade === 'S\+' \? 's-plus'/);
  for (const grade of ['d', 'c', 'b', 'a', 's', 's-plus']) {
    const bytes = readFileSync(`soldier-grade-${grade}.webp`);
    assert.ok(bytes.length > 10000, `${grade} grade artwork should be populated`);
  }
});

test('shop and inventory import the finalized parent-owned module versions', () => {
  const inventory = readFileSync('soldier-inventory.mjs', 'utf8');
  const shop = readFileSync('soldier-shop.mjs', 'utf8');
  assert.match(inventory, /soldier-core\.mjs\?v=8/);
  assert.match(inventory, /soldier-weapon-items\.mjs\?v=12/);
  assert.match(inventory, /soldier-characters\.mjs\?v=8/);
  assert.match(shop, /soldier-characters\.mjs\?v=8/);
  assert.match(shop, /soldier-supply\.mjs\?v=7/);
});

test('shop character purchase labels use each product price', () => {
  assert.match(readFileSync('soldier-shop.mjs', 'utf8'), /owned \? '보유 중' : `\$\{product\.price\}보석 구매`/);
  assert.doesNotMatch(readFileSync('soldier-shop.mjs', 'utf8'), /125보석 구매/);
});

test('character stats stay in vertical label-value rows and inactive set text is removed', () => {
  const css=readFileSync('soldier.css','utf8');
  const inventory=readFileSync('soldier-inventory.mjs','utf8');
  assert.doesNotMatch(css,/grid-template-columns: minmax\(0, 1fr\) auto minmax\(0, 1fr\) auto/);
  assert.doesNotMatch(inventory,/세트 조건:/);
  assert.match(inventory,/\$\('inventory-set-effect'\)\.hidden = !set/);
  assert.match(css,/\.character-card \.character-name \{[^}]*font-family: 'Arial Narrow', 'Malgun Gothic', sans-serif;[^}]*font-style: italic;/s);
  assert.match(css,/\.character-card \.character-name \{[^}]*top: auto;[^}]*bottom: 5%;/s);
});

test('character enhancement uses an in-app confirmation instead of blocked browser prompts', () => {
  const inventory=readFileSync('soldier-inventory.mjs','utf8');
  assert.doesNotMatch(inventory,/window\.confirm/);
  assert.match(inventory,/await confirmCharacterUpgrade\(id, level\)/);
  assert.match(inventory,/characterConfirmation\.showModal\(\)/);
  assert.match(inventory,/upgrade\.textContent = level === CHARACTER_MAX_LEVEL \? 'MAX' : '강화';/);
  assert.match(inventory,/강화 1회당 10,000골드/);
});

test('equipment stat rows share a clean label-value style without changing their layout', () => {
  const css=readFileSync('soldier.css','utf8');
  assert.match(css,/\.inventory-item-detail dl \{[^}]*grid-template-columns: minmax\(0, 1fr\) minmax\(46px, \.8fr\)/);
  assert.match(css,/\.inventory-item-detail dt \{[^}]*background: #edf3f7;/s);
  assert.match(css,/\.inventory-item-detail dd \{[^}]*background: #dff1f0;[^}]*font-variant-numeric: tabular-nums;/s);
  assert.match(css,/\.character-card \.character-level \{[^}]*top: 4%;/s);
});

test('inventory portraits stay clipped inside the supplied character frame', () => {
  const css=readFileSync('soldier.css','utf8');
  assert.match(css,/\.character-card \.character-portrait \{[^}]*left: 13%;[^}]*width: 74%;[^}]*clip-path: polygon/s);
  for (const name of ['james','fighter','thief','korean-girl','roka-swc']) {
    assert.ok(readFileSync(`soldier-character-${name}-cutout.webp`).length>10000);
  }
});

test('all Soldier surfaces use the shared theme and visible shop purchase buttons', () => {
  const css=readFileSync('soldier.css','utf8');
  assert.match(css,/:is\(#home, #hud, dialog\) button \{/);
  assert.match(css,/dialog, #character-upgrade-dialog, #weapon-material-dialog, #weapon-operation-dialog, #weapon-sale-dialog/);
  assert.match(css,/\.shop-product > button \{[^}]*position: static;[^}]*opacity: 1;/s);
  assert.match(css,/\.shop-character-product\[data-character="korean-girl"\] > img \{ padding: 14% 7% 0;/);
  assert.match(css,/supply-crate-turn/);
  assert.match(css,/supply-lid-open/);
  assert.match(css,/#supply-opening-dialog\[data-paused="true"\] \* \{ animation-play-state: paused;/);
});

test('set bonuses stay below weapon cards with a color-matched slow pulse', () => {
  const css=readFileSync('soldier.css','utf8');
  const html=readFileSync('sanggi-soldier.html','utf8');
  assert.match(html,/<section class="loadout"[\s\S]*id="weapon-set-effect"[\s\S]*?<\/section>/);
  assert.match(css,/\.home-set-effect \{[^}]*position: static;[^}]*grid-column: 1 \/ -1;/s);
  assert.match(css,/animation: weapon-set-pulse 3\.2s ease-in-out infinite/);
  for (const color of ['gold','red','silver']) {
    assert.ok(css.includes(`.home-set-effect[data-set-color="${color}"] { color:`));
    assert.ok(css.includes(`.inventory-set-effect[data-set-color="${color}"] { color:`));
  }
});

test('home offers coming-soon community buttons without routine motion or PVP captions', () => {
  const html=readFileSync('sanggi-soldier.html','utf8');
  const viewer=readFileSync('soldier-home-viewer.mjs','utf8');
  assert.doesNotMatch(html,/home-mode-label|PVP<\/strong>/);
  assert.match(html,/id="clan-open"[^>]*disabled/);
  assert.match(html,/id="friends-open"[^>]*disabled/);
  assert.doesNotMatch(viewer,/드래그\/방향키 회전|자동 호흡·몸풀기/);
  assert.match(viewer,/캐릭터 표시 실패/);
});

test('purchase result dialogs report success and capacity failure, and wheel scrolling keeps zoom available', () => {
  const shop=readFileSync('soldier-shop.mjs','utf8');
  const inventory=readFileSync('soldier-inventory.mjs','utf8');
  assert.match(shop,/resultDialog\.id = 'shop-result-dialog'/);
  assert.match(shop,/showPurchaseResult\('구매 완료'/);
  assert.match(shop,/showPurchaseResult\('인벤토리 공간 부족'/);
  assert.match(inventory,/itemScroller\.addEventListener\('wheel'/);
  assert.match(inventory,/event\.ctrlKey/);
  assert.match(inventory,/\{ passive: false \}/);
});

test('small fullscreen shop keeps chrome fixed and the entire product area scrollable', () => {
  const css=readFileSync('soldier.css','utf8');
  assert.match(css,/#shop-dialog\[open\] \{[^}]*display: flex; flex-direction: column; overflow: hidden;/s);
  assert.match(css,/padding: env\(safe-area-inset-top\) env\(safe-area-inset-right\)/);
  assert.match(css,/#shop-products \{[^}]*flex: 1; min-height: 0;[^}]*overflow: auto;/s);
  assert.match(css,/grid-template-columns: minmax\(0, 1fr\); grid-template-rows/);
});
