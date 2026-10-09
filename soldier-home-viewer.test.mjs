import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from './vendor/three.module.min.js';
import { createHomeRig, idlePose } from './soldier-home-rig.mjs';

test('home character has independent limbs and a joint hierarchy, not a blending sheet', () => {
  const rig = createHomeRig();
  assert.equal(Object.keys(rig.joints).length, 11);
  assert.equal(rig.joints.leftElbow.parent, rig.joints.leftShoulder);
  assert.equal(rig.joints.rightKnee.parent, rig.joints.rightHip);
  const names = [];
  rig.root.traverse(part => {
    if (!part.isMesh) return;
    names.push(part.name);
    assert.ok(Array.from(part.geometry.attributes.position.array).every(Number.isFinite));
    assert.ok(part.geometry.attributes.sideUv);
    assert.equal(part.geometry.groups.length, 0);
  });
  assert.ok(names.includes('leftThigh') && names.includes('rightForearm'));
  for (const yaw of [0, Math.PI / 4, Math.PI / 2, Math.PI, Math.PI * 3 / 2]) {
    rig.root.rotation.y = yaw;
    const box = new THREE.Box3().setFromObject(rig.root);
    assert.ok(box.max.y - box.min.y > .9);
    assert.ok(box.max.x - box.min.x > .1);
  }
});

test('automatic breathing and stretching move joints with fixed feet and repeat continuously', () => {
  const rig = createHomeRig();
  const feet = new THREE.Box3().setFromObject(rig.joints.leftKnee);
  rig.animate(1);
  assert.notEqual(rig.joints.spine.scale.z, 1);
  rig.animate(15);
  assert.equal(rig.root.userData.motion, 'stretch');
  assert.ok(Math.abs(rig.joints.leftShoulder.rotation.z) > .1);
  assert.ok(rig.joints.leftElbow.rotation.x > .1);
  assert.deepEqual(new THREE.Box3().setFromObject(rig.joints.leftKnee), feet);
  for (let time = 0; time < 48; time += .02) {
    assert.ok(Math.abs(idlePose(time).stretch - idlePose(time + .02).stretch) < .02);
  }
  assert.equal(idlePose(39).stretch, 1);
});
