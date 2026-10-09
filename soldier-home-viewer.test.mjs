import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import * as THREE from './vendor/three.module.min.js';
import { createHomeRig, idlePose, jointWeights, HOME_MODEL } from './soldier-home-rig.mjs';

function fixture() {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([
    0, 0, 0, -.18, .5, .02, -.16, .65, .01, .16, .65, .01, 0, .75, .04, 0, 1, 0
  ], 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(18).fill(1), 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(new Array(12).fill(.5), 2));
  const source = new THREE.Group();
  source.add(new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: 0x827466 })));
  return source;
}

test('supplied GLB is embedded, intact and unrigged, with original PBR maps', () => {
  const binary = readFileSync(HOME_MODEL);
  assert.equal(createHash('sha256').update(binary).digest('hex'), 'aeb250d7666092dd0a0c02e3e8cf524d080444b15d072368a5d8e3fcb6bad702');
  assert.equal(binary.readUInt32LE(0), 0x46546c67);
  assert.equal(binary.readUInt32LE(4), 2);
  assert.equal(binary.readUInt32LE(8), binary.length);
  const gltf = JSON.parse(binary.subarray(20, 20 + binary.readUInt32LE(12)));
  assert.equal(gltf.skins?.length || 0, 0);
  assert.equal(gltf.animations?.length || 0, 0);
  assert.equal(gltf.meshes.length, 1);
  assert.ok(gltf.images.every(image => image.bufferView !== undefined && !image.uri));
  const material = gltf.materials[0];
  assert.ok(material.pbrMetallicRoughness.baseColorTexture);
  assert.ok(material.pbrMetallicRoughness.metallicRoughnessTexture);
  assert.ok(material.normalTexture);
});

test('new basic model receives fresh bones and actual breathing/stretch deformations', () => {
  const binary = readFileSync(HOME_MODEL);
  const jsonLength = binary.readUInt32LE(12);
  const gltf = JSON.parse(binary.subarray(20, 20 + jsonLength));
  const binaryOffset = 20 + jsonLength + 8;
  const geometry = new THREE.BufferGeometry();
  const primitive = gltf.meshes[0].primitives[0];
  for (const [name, index] of Object.entries(primitive.attributes)) {
    const accessor = gltf.accessors[index], view = gltf.bufferViews[accessor.bufferView];
    const size = { VEC3: 3, VEC2: 2 }[accessor.type];
    const offset = binaryOffset + (view.byteOffset || 0) + (accessor.byteOffset || 0);
    const values = new Float32Array(accessor.count * size);
    for (let i = 0; i < values.length; i++) values[i] = binary.readFloatLE(offset + i * 4);
    geometry.setAttribute({ POSITION: 'position', NORMAL: 'normal', TEXCOORD_0: 'uv' }[name], new THREE.BufferAttribute(values, size));
  }
  const accessor = gltf.accessors[primitive.indices], view = gltf.bufferViews[accessor.bufferView];
  const offset = binaryOffset + (view.byteOffset || 0) + (accessor.byteOffset || 0);
  const indices = new Uint32Array(accessor.count);
  for (let i = 0; i < indices.length; i++) indices[i] = binary.readUInt32LE(offset + i * 4);
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  const source = new THREE.Group();
  source.add(new THREE.Mesh(geometry, new THREE.MeshStandardMaterial()));
  const rig = createHomeRig(source), mesh = rig.meshes[0];
  const secondRig = createHomeRig(source);
  assert.notEqual(rig.skeleton, secondRig.skeleton);
  assert.ok(rig.skeleton.bones.every((bone, i) => bone !== secondRig.skeleton.bones[i]));
  assert.equal(mesh.geometry.attributes.position.count, 17701);
  assert.deepEqual(mesh.geometry.index.array, indices);
  assert.deepEqual(mesh.geometry.attributes.uv.array, geometry.attributes.uv.array);
  const rest = [];
  rig.root.updateMatrixWorld(true); rig.skeleton.update();
  for (let i = 0; i < 17701; i++) {
    rest.push(mesh.applyBoneTransform(i, new THREE.Vector3().fromBufferAttribute(mesh.geometry.attributes.position, i)));
  }
  for (const time of [1.125, 7]) {
    rig.animate(time); rig.root.updateMatrixWorld(true); rig.skeleton.update();
    const moved = { chest: 0, leftArm: 0, rightArm: 0, head: 0 };
    for (let i = 0; i < rest.length; i++) {
      const position = new THREE.Vector3().fromBufferAttribute(mesh.geometry.attributes.position, i);
      const actual = mesh.applyBoneTransform(i, position.clone());
      const displacement = actual.distanceTo(rest[i]);
      assert.ok(Number.isFinite(displacement));
      if (position.y < .4) assert.ok(displacement < 1e-6);
      if (displacement <= .001) continue;
      if (position.y > .86) moved.head++;
      else if (position.y > .5 && position.y < .75) {
        if (position.x < -.14) moved.leftArm++;
        else if (position.x > .14) moved.rightArm++;
        else if (Math.abs(position.x) < .08) moved.chest++;
      }
    }
    for (const region of ['chest', 'leftArm', 'rightArm']) assert.ok(moved[region] > 20, `${time}: ${region}=${moved[region]}`);
    if (time === 7) assert.ok(moved.head > 20);
  }
});

test('runtime rig preserves supplied vertices, UVs, indices and material while adding seven bones', () => {
  const source = fixture(), original = source.children[0];
  const rig = createHomeRig(source), mesh = rig.meshes[0];
  assert.ok(mesh.isSkinnedMesh);
  assert.equal(rig.skeleton.bones.length, 7);
  assert.equal(rig.joints.leftElbow.parent, rig.joints.leftShoulder);
  const bounds = new THREE.Box3().setFromObject(source), center = bounds.getCenter(new THREE.Vector3());
  for (let i = 0; i < original.geometry.attributes.position.count; i++) {
    const expected = new THREE.Vector3().fromBufferAttribute(original.geometry.attributes.position, i);
    expected.sub(new THREE.Vector3(center.x, bounds.min.y, center.z));
    const actual = new THREE.Vector3().fromBufferAttribute(mesh.geometry.attributes.position, i);
    assert.ok(actual.distanceTo(expected) < 1e-7);
  }
  assert.deepEqual(mesh.geometry.attributes.uv.array, original.geometry.attributes.uv.array);
  assert.equal(mesh.geometry.index, original.geometry.index);
  assert.equal(mesh.material.color.getHex(), original.material.color.getHex());
  assert.notEqual(mesh.material, original.material);
  for (let i = 0; i < mesh.geometry.attributes.position.count; i++) {
    const weights = mesh.geometry.attributes.skinWeight;
    assert.ok(Math.abs(weights.getX(i) + weights.getY(i) + weights.getZ(i) + weights.getW(i) - 1) < 1e-6);
  }
});

test('weight regions keep feet fixed, separate left/right arms and blend smoothly at joints', () => {
  assert.deepEqual(jointWeights(.1, .25), [[0, 1]]);
  assert.deepEqual(jointWeights(0, .96), [[2, 1]]);
  assert.deepEqual(jointWeights(-.18, .55), [[4, 1]]);
  assert.deepEqual(jointWeights(.18, .55), [[6, 1]]);
  for (const x of [-.18, -.12, 0, .12, .18]) {
    let previous = new Array(7).fill(0);
    for (let y = 0; y <= 1; y += .001) {
      const values = new Array(7).fill(0);
      const weights = jointWeights(x, y);
      assert.ok(weights.length <= 4);
      assert.ok(Math.abs(weights.reduce((sum, [, weight]) => sum + weight, 0) - 1) < 1e-10);
      for (const [index, weight] of weights) {
        assert.ok(weight >= 0 && Number.isFinite(weight)); values[index] = weight;
      }
      if (y > 0) assert.ok(values.every((value, i) => Math.abs(value - previous[i]) < .04));
      previous = values;
    }
  }
});

test('automatic breathing/stretching are continuous, deform the supplied mesh and leave feet fixed', () => {
  const rig = createHomeRig(fixture()), mesh = rig.meshes[0];
  function vertex(index) {
    rig.root.updateMatrixWorld(true); rig.skeleton.update();
    const p = new THREE.Vector3().fromBufferAttribute(mesh.geometry.attributes.position, index);
    return mesh.applyBoneTransform(index, p);
  }
  const foot = vertex(0), chest = vertex(4), head = vertex(5), arm = vertex(2);
  rig.animate(1);
  assert.ok(vertex(4).distanceTo(chest) > .003);
  assert.ok(vertex(2).distanceTo(arm) > .003);
  assert.ok(Math.abs(rig.joints.leftShoulder.rotation.x) > .02);
  assert.ok(Math.abs(rig.joints.leftElbow.rotation.x) > .015);
  assert.ok(vertex(0).distanceTo(foot) < 1e-7);
  rig.animate(17);
  assert.equal(rig.root.userData.motion, 'stretch');
  assert.ok(vertex(5).distanceTo(head) > .0001);
  assert.ok(vertex(2).distanceTo(arm) > .0001);
  assert.ok(rig.joints.leftElbow.rotation.x > .1);
  assert.ok(vertex(0).distanceTo(foot) < 1e-7);
  for (let time = 0; time < 48; time += .02) {
    assert.ok(Math.abs(idlePose(time).stretch - idlePose(time + .02).stretch) < .02);
  }
  rig.animate(0);
  assert.ok(vertex(5).distanceTo(head) < 1e-7);
  rig.setYaw(Math.PI); assert.equal(rig.root.rotation.y, Math.PI);
  for (const seconds of [0, 4, 5, 7, 9.99]) {
    assert.ok(Math.abs(idlePose(seconds).stretch - idlePose(seconds + 10).stretch) < 1e-10);
  }
  assert.equal(idlePose(7).stretch, 1);
  assert.equal(idlePose(17).stretch, 1);
});

test('invalid model input produces an explicit error', () => {
  assert.throws(() => createHomeRig(), /장면/);
  assert.throws(() => createHomeRig(new THREE.Group()), /크기/);
});

test('home has automatic motion without pose or motion buttons', () => {
  const html = readFileSync('sanggi-soldier.html', 'utf8');
  assert.ok(!html.includes('data-character-view'));
  assert.ok(!html.includes('character-motion-toggle'));
  const viewer = readFileSync('soldier-home-viewer.mjs', 'utf8');
  assert.ok(viewer.includes('const active = () => visible();'));
  assert.ok(viewer.includes('rig.animate(seconds);'));
  assert.ok(!viewer.includes('reduced'));
  assert.ok(!viewer.includes('matchMedia'));
  assert.ok(!viewer.includes('motionButton'));
  const css = readFileSync('soldier.css', 'utf8');
  assert.ok(css.includes('.home-character:focus { outline: none; }'));
  assert.ok(!css.includes('.home-character:focus-visible { outline:'));
});

test('home starts loading the model without displaying a stationary preview', () => {
  const html = readFileSync('sanggi-soldier.html', 'utf8');
  assert.ok(!html.includes('id="home-character-preview"'));
  assert.ok(!html.includes('soldier-home-model-preview.webp'));
  assert.ok(html.includes('as="fetch" href="soldier-home-model.glb?v=2" crossorigin'));
});
