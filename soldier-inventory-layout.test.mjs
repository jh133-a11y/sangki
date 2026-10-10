import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('equipped, selected and owned weapon cards share responsive dimensions', () => {
  const css=readFileSync('soldier.css','utf8');
  assert.match(css,/grid-template-columns: var\(--inventory-weapon-card-width\) minmax\(0, 1fr\)/);
  assert.match(css,/#equipment-dialog:not\(\.character-inventory\) #inventory-items \.inventory-item \{ flex: 0 0 var\(--inventory-weapon-card-width\)/);
  assert.match(css,/@media \(orientation: portrait\) and \(max-width: 900px\)/);
});

test('operation results override dialog-wide card sizing and hide completed inputs', () => {
  const css=readFileSync('soldier.css','utf8');
  assert.match(css,/#weapon-operation-dialog \.weapon-operation-results \.equipment-card \{ flex: 0 0 auto; width: clamp\(64px, 12vw, 120px\)/);
  assert.match(readFileSync('soldier-inventory.mjs','utf8'),/choices\.hidden = true; top\.hidden = true/);
});

test('crafting cost reuses the existing gem SVG icon', () => {
  assert.match(readFileSync('soldier-inventory.mjs','utf8'),/document\.querySelector\('\.currency\.gems svg'\)\.cloneNode\(true\)/);
});

test('mobile inventory lists pan horizontally and dismiss accidental clicks only after a real drag', () => {
  const css=readFileSync('soldier.css','utf8');
  const source=readFileSync('soldier-inventory.mjs','utf8');
  assert.match(css,/#inventory-items \{\s*touch-action: pan-x/);
  assert.match(css,/@media \(orientation: portrait\) and \(max-width: 360px\)/);
  assert.match(source,/Math\.abs\(event\.clientX - drag\.x\) > 8/);
  assert.match(source,/event\.stopImmediatePropagation\(\)/);
  assert.match(readFileSync('sanggi-soldier.html','utf8'),/id="inventory-set-effect"/);
});
