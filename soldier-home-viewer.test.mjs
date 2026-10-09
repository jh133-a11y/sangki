import test from 'node:test';
import assert from 'node:assert/strict';
import { CHARACTER_VIEWS, viewIndex } from './soldier-home-viewer.mjs';

test('each supplied view is distinct and cycles without mirroring or synthesized angles', () => {
  assert.equal(CHARACTER_VIEWS.length, 3);
  assert.equal(new Set(CHARACTER_VIEWS.map(view => view.src)).size, 3);
  const step = Math.PI * 2 / 3;
  for (let i = -12; i <= 12; i++) assert.equal(viewIndex(i * step), ((i % 3) + 3) % 3);
  assert.equal(viewIndex(step * .49), 0);
  assert.equal(viewIndex(step * .51), 1);
  assert.equal(viewIndex(-step * .51), 2);
});
