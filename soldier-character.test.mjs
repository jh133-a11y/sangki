import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { Box3, Texture } from './vendor/three.module.min.js';
import { createSoldierModel } from './soldier-character.mjs';

function dispose(model) {
  const materials = new Set();
  model.traverse(object => {
    object.geometry?.dispose();
    if (object.material) for (const mat of Array.isArray(object.material) ? object.material : [object.material]) materials.add(mat);
  });
  for (const mat of materials) mat.dispose();
}

test('fallback is a finite JAMES portrait stand, never the retired default body', () => {
  for (const combat of [false, true]) {
    const model = createSoldierModel(combat);
    try {
      assert.equal(model.userData.character, 'james-portrait');
      const box = new Box3().setFromObject(model);
      assert.ok(Math.abs(box.min.y) < 1e-6 && Math.abs(box.max.y - 2.1) < 1e-6);
      assert.ok(box.min.z < -.1 && box.max.z > .1);
      assert.equal(model.children.length, 1);
      const object = model.children[0];
      for (const attribute of ['position', 'normal', 'uv']) {
        assert.ok(Array.from(object.geometry.getAttribute(attribute).array).every(Number.isFinite));
      }
      assert.equal(object.geometry.groups.filter(group => group.materialIndex === 0).length, 1);
    } finally { dispose(model); }
  }
  const source = readFileSync('soldier-character.mjs', 'utf8');
  assert.match(source, /CHARACTERS\['black-water'\]\.image/);
  for (const file of ['soldier-home-character.png', 'soldier-character-card.png']) {
    assert.equal(existsSync(file), false);
    assert.equal(source.includes(file), false);
  }
});

test('models own materials while reusing persistent portrait maps safely', () => {
  const textures = { front: new Texture(), back: new Texture() };
  for (const texture of Object.values(textures)) texture.userData.persistent = true;
  const home = createSoldierModel(false, textures), combat = createSoldierModel(true, textures);
  try {
    assert.notEqual(home.children[0].material[0], combat.children[0].material[0]);
    assert.equal(home.children[0].material[0].map, textures.front);
    assert.equal(combat.children[0].material[1].map, textures.back);
    let disposed = false;
    textures.front.addEventListener('dispose', () => { disposed = true; });
    dispose(combat);
    assert.equal(disposed, false);
  } finally { dispose(home); for (const texture of Object.values(textures)) texture.dispose(); }
});
