import test from 'node:test';
import assert from 'node:assert/strict';
import { Box3 } from './vendor/three.module.min.js';
import { createSoldierModel } from './soldier-character.mjs';

// Geometry tests need only the drawing surface; browser checks cover rendered textures.
function withCanvas(callback) {
  const previous = globalThis.document;
  globalThis.document = {
    createElement(tag) {
      assert.equal(tag, 'canvas');
      return {
        width: 0, height: 0,
        getContext: () => ({
          fillRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, closePath() {}, fill() {}
        })
      };
    }
  };
  try { callback(); }
  finally {
    if (previous === undefined) delete globalThis.document;
    else globalThis.document = previous;
  }
}

function resources(model) {
  const geometries = new Set(), materials = new Set(), maps = new Set();
  model.traverse(object => {
    if (!object.isMesh) return;
    geometries.add(object.geometry);
    materials.add(object.material);
    if (object.material.map) maps.add(object.material.map);
  });
  return { geometries, materials, maps };
}

function dispose(model) {
  const all = resources(model);
  for (const set of Object.values(all)) for (const resource of set) resource.dispose();
}

test('home and playable models have complete finite 3D geometry with matching bounds', () => withCanvas(() => {
  const home = createSoldierModel(), combat = createSoldierModel(true);
  try {
    for (const model of [home, combat]) {
      assert.equal(model.userData.character, 'black-water');
      const box = new Box3().setFromObject(model);
      assert.ok(box.min.y >= 0 && box.max.y > 2 && box.max.y < 2.2);
      assert.ok(box.min.z < -.1 && box.max.z > .1);
      model.traverse(object => {
        if (!object.isMesh) return;
        for (const attribute of ['position', 'normal', 'uv']) {
          assert.ok(Array.from(object.geometry.getAttribute(attribute).array).every(Number.isFinite));
        }
      });
    }
    assert.ok(combat.children.length <= 16, 'combat meshes should be batched by material');
    assert.ok(home.children.length > combat.children.length);
  } finally { dispose(home); dispose(combat); }
}));

test('separate players own their resources so leaving a match cannot dispose the home model', () => withCanvas(() => {
  const home = createSoldierModel(), combat = createSoldierModel(true);
  try {
    const a = resources(home), b = resources(combat);
    for (const key of Object.keys(a)) {
      assert.ok([...a[key]].every(resource => !b[key].has(resource)));
    }
  } finally { dispose(home); dispose(combat); }
}));
