import test from 'node:test';
import assert from 'node:assert/strict';
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

test('photo model has closed finite volumes, UVs and separate front/back materials', () => {
  for (const combat of [false, true]) {
    const model = createSoldierModel(combat);
    try {
      assert.equal(model.userData.character, 'black-water-photo');
      const box = new Box3().setFromObject(model);
      assert.ok(box.min.y >= 0 && box.max.y > 2 && box.max.y <= 2.1);
      assert.ok(box.min.z < -.1 && box.max.z > .1);
      assert.ok(model.children.length <= 15);
      for (const object of model.children) {
        for (const attribute of ['position','normal','uv']) {
          assert.ok(Array.from(object.geometry.getAttribute(attribute).array).every(Number.isFinite));
        }
        if (!Array.isArray(object.material)) continue;
        assert.equal(object.geometry.groups.length, 2);
        assert.deepEqual(object.geometry.groups.map(g => g.materialIndex), [0,1]);
        const uv = object.geometry.getAttribute('uv').array;
        assert.ok(Array.from(uv).every(value => value >= 0 && value <= 1));
        const position = object.geometry.getAttribute('position'), normal = object.geometry.getAttribute('normal');
        // The first vertex of each top ring faces forward, not inward.
        assert.ok(normal.getZ(0) > 0);
        assert.ok(position.getZ(0) >= 0);
      }
    } finally { dispose(model); }
  }
});

test('models own materials while reusing persistent photo maps safely', () => {
  const textures = { front: new Texture(), back: new Texture() };
  for (const texture of Object.values(textures)) texture.userData.persistent = true;
  const home = createSoldierModel(false,textures), combat = createSoldierModel(true,textures);
  try {
    assert.notEqual(home.children[0].material[0],combat.children[0].material[0]);
    assert.equal(home.children[0].material[0].map,textures.front);
    assert.equal(combat.children[0].material[1].map,textures.back);
    let disposed = false;
    textures.front.addEventListener('dispose',()=>{disposed=true;});
    dispose(combat);
    assert.equal(disposed,false);
  } finally { dispose(home); for(const texture of Object.values(textures))texture.dispose(); }
});
