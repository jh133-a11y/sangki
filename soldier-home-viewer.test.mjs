import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import * as THREE from './vendor/three.module.min.js';
import { createHomeRig, idlePose } from './soldier-home-rig.mjs';
import { CHARACTERS } from './soldier-characters.mjs';

const fixtures = [
  ['soldier-home-model.glb', '748b0eed0398103e7c6b96e0a4fb645c33c6ef8ca091f5d313978d712cd44acd'],
  ['soldier-fsb-agent.glb', '3531ede18be5887aaf6bfc9a364dfde876c4c06e9d315b080c4d818d68982bba'],
  ['soldier-roka-swc.glb', '56b70c4d3ab69a5099dde824172e1607da8e57895eb53088e0b19eaa05886a54']
];

function suppliedScene(file) {
  const binary = readFileSync(file), length = binary.readUInt32LE(12);
  const gltf = JSON.parse(binary.subarray(20, 20 + length)), base = 28 + length;
  function attribute(index) {
    const accessor = gltf.accessors[index], view = gltf.bufferViews[accessor.bufferView];
    const size = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 }[accessor.type];
    const [ArrayType, bytes, read] = {
      5121: [Uint8Array, 1, 'readUInt8'], 5123: [Uint16Array, 2, 'readUInt16LE'],
      5125: [Uint32Array, 4, 'readUInt32LE'], 5126: [Float32Array, 4, 'readFloatLE']
    }[accessor.componentType];
    const values = new ArrayType(accessor.count * size);
    const offset = base + (view.byteOffset || 0) + (accessor.byteOffset || 0);
    for (let i = 0; i < accessor.count; i++) {
      for (let j = 0; j < size; j++) values[i * size + j] = binary[read](offset + i * (view.byteStride || size * bytes) + j * bytes);
    }
    return new THREE.BufferAttribute(values, size, accessor.normalized || false);
  }
  const boneIds = new Set(gltf.skins.flatMap(skin => skin.joints));
  const nodes = gltf.nodes.map((node, index) => {
    let object = boneIds.has(index) ? new THREE.Bone() : new THREE.Object3D();
    if (node.mesh !== undefined) {
      const primitive = gltf.meshes[node.mesh].primitives[0], geometry = new THREE.BufferGeometry();
      for (const [name, index] of Object.entries(primitive.attributes)) {
        geometry.setAttribute({ POSITION: 'position', NORMAL: 'normal', TEXCOORD_0: 'uv', JOINTS_0: 'skinIndex', WEIGHTS_0: 'skinWeight' }[name], attribute(index));
      }
      geometry.setIndex(attribute(primitive.indices));
      object = new THREE.SkinnedMesh(geometry, new THREE.MeshStandardMaterial());
    }
    object.name = node.name;
    if (node.matrix) new THREE.Matrix4().fromArray(node.matrix).decompose(object.position, object.quaternion, object.scale);
    if (node.translation) object.position.fromArray(node.translation);
    if (node.rotation) object.quaternion.fromArray(node.rotation);
    if (node.scale) object.scale.fromArray(node.scale);
    return object;
  });
  gltf.nodes.forEach((node, index) => node.children?.forEach(child => nodes[index].add(nodes[child])));
  const scene = new THREE.Group();
  gltf.scenes[gltf.scene || 0].nodes.forEach(index => scene.add(nodes[index]));
  scene.updateMatrixWorld(true);
  gltf.nodes.forEach((node, index) => {
    if (node.skin === undefined) return;
    const skin = gltf.skins[node.skin], inverse = attribute(skin.inverseBindMatrices);
    const matrices = skin.joints.map((_, i) => new THREE.Matrix4().fromArray(inverse.array, i * 16));
    nodes[index].bind(new THREE.Skeleton(skin.joints.map(index => nodes[index]), matrices), new THREE.Matrix4());
  });
  return { scene, gltf };
}

for (const [file, hash] of fixtures) {
  test(`${file} is the exact supplied rigged asset with embedded textures and original weights`, () => {
    assert.equal(createHash('sha256').update(readFileSync(file)).digest('hex'), hash);
    const { scene, gltf } = suppliedScene(file);
    assert.equal(gltf.skins.length, 1);
    assert.equal(gltf.skins[0].joints.length, 65);
    assert.ok(gltf.images.every(image => image.bufferView !== undefined && !image.uri));
    const rig = createHomeRig(scene), other = createHomeRig(scene);
    const original = scene.getObjectByProperty('isSkinnedMesh', true), mesh = rig.meshes[0];
    assert.equal(rig.skeleton.bones.length, 65);
    for (const name of ['position', 'normal', 'uv', 'skinIndex', 'skinWeight']) {
      assert.deepEqual(mesh.geometry.attributes[name].array, original.geometry.attributes[name].array);
    }
    assert.deepEqual(mesh.geometry.index.array, original.geometry.index.array);
    assert.deepEqual(mesh.skeleton.boneInverses.map(matrix => matrix.elements), original.skeleton.boneInverses.map(matrix => matrix.elements));
    assert.notEqual(rig.skeleton, other.skeleton);
    assert.ok(rig.skeleton.bones.every((bone, index) => bone !== other.skeleton.bones[index] && bone !== original.skeleton.bones[index]));
    assert.equal(rig.joints.LeftForeArm.parent, rig.joints.LeftArm);
    assert.equal(rig.joints.LeftHand.parent, rig.joints.LeftForeArm);
    assert.equal(rig.joints.RightHand.parent, rig.joints.RightForeArm);
    rig.dispose(); other.dispose();
  });

  test(`${file} animates supplied shoulder/elbow/wrist joints without changing bone lengths, scales or weights`, () => {
    const { scene } = suppliedScene(file), rig = createHomeRig(scene), other = createHomeRig(scene);
    rig.root.updateMatrixWorld(true); rig.skeleton.update();
    const bones = rig.skeleton.bones;
    const rest = bones.map(bone => ({ position: bone.position.clone(), scale: bone.scale.clone(), quaternion: bone.quaternion.clone() }));
    const pivotRest = Object.fromEntries(['LeftForeArm', 'RightForeArm', 'LeftHand', 'RightHand']
      .map(name => [name, rig.joints[name].getWorldPosition(new THREE.Vector3())]));
    const mesh = rig.meshes[0], positions = mesh.geometry.attributes.position;
    const start = Array.from({ length: positions.count }, (_, index) => mesh.getVertexPosition(index, new THREE.Vector3()));
    const weights = mesh.geometry.attributes.skinWeight, ids = mesh.geometry.attributes.skinIndex;
    for (const time of [1.125, 3.375, 7, 17, 0]) {
      rig.animate(time); rig.root.updateMatrixWorld(true); rig.skeleton.update();
      bones.forEach((bone, i) => {
        assert.deepEqual(bone.position.toArray(), rest[i].position.toArray());
        assert.deepEqual(bone.scale.toArray(), rest[i].scale.toArray());
        if (/UpLeg|Leg|Foot|Toe|Hips/.test(bone.name)) assert.deepEqual(bone.quaternion.toArray(), rest[i].quaternion.toArray());
      });
      for (const side of ['Left', 'Right']) {
        for (const name of ['Shoulder', 'Arm', 'ForeArm', 'Hand']) {
          const bone = rig.joints[side + name], bind = rest[bones.indexOf(bone)];
          const changed = bone.quaternion.toArray().some((value, index) => Math.abs(value - bind.quaternion.toArray()[index]) > 1e-6);
          assert.equal(changed, time !== 0, `${side}${name} at ${time}`);
        }
        if (time === 1.125) {
          for (const name of ['ForeArm', 'Hand']) {
            assert.ok(rig.joints[side + name].getWorldPosition(new THREE.Vector3()).y > pivotRest[side + name].y + .001,
              'inhalation must raise both elbow and hand');
          }
        }
      }
      let moved = 0, fixedLeg = 0, rigidHand = 0;
      for (let i = 0; i < positions.count; i++) {
        const current = mesh.getVertexPosition(i, new THREE.Vector3());
        assert.ok(current.toArray().every(Number.isFinite));
        if (current.distanceTo(start[i]) > .00001) moved++;
        const influences = [];
        for (let j = 0; j < 4; j++) if (weights.getComponent(i, j) > .001) influences.push(bones[ids.getComponent(i, j)].name);
        if (influences.every(name => /UpLeg|Leg|Foot|Toe|Hips/.test(name))) {
          assert.ok(current.distanceTo(start[i]) < 1e-6, 'legs stay independent of breathing arms');
          fixedLeg++;
        }
        if (weights.getX(i) > .99999 && /Hand/.test(bones[ids.getX(i)].name)) rigidHand++;
        if (time === 0) assert.ok(current.distanceTo(start[i]) < 1e-6);
      }
      if (time !== 0) assert.ok(moved > 100);
      assert.ok(fixedLeg > 100); assert.ok(rigidHand > 20);
      const anchors = {};
      let measured = 0;
      for (let i = 0; i < positions.count; i++) {
        if (weights.getX(i) < .99999) continue;
        const side = bones[ids.getX(i)].name.match(/(Left|Right)Hand/)?.[1];
        if (!side) continue;
        const a = anchors[side];
        if (a === undefined) { anchors[side] = i; continue; }
        const length = start[a].distanceTo(start[i]);
        const movedLength = mesh.getVertexPosition(a, new THREE.Vector3()).distanceTo(mesh.getVertexPosition(i, new THREE.Vector3()));
        assert.ok(Math.abs(length - movedLength) < 1e-5, 'palm/finger distances must remain rigid across the wrist rotation');
        measured++;
      }
      assert.ok(measured > 15, 'measure actual hand geometry as well as bone lengths');
      assert.deepEqual(other.joints.LeftArm.quaternion.toArray(), rest[bones.indexOf(rig.joints.LeftArm)].quaternion.toArray());
    }
    rig.dispose(); other.dispose();
  });
}

test('rig instances release their geometry, materials and skeleton without disposing shared source', () => {
  const { scene } = suppliedScene(fixtures[0][0]), rig = createHomeRig(scene);
  let disposed = 0;
  rig.meshes[0].geometry.addEventListener('dispose', () => disposed++);
  rig.materials[0].addEventListener('dispose', () => disposed++);
  scene.getObjectByProperty('isSkinnedMesh', true).geometry.addEventListener('dispose', () => assert.fail('shared source must survive'));
  const parent = new THREE.Group(); parent.add(rig.root);
  rig.dispose();
  assert.equal(disposed, 2); assert.equal(rig.root.parent, null);
});

test('unrigged models fail explicitly instead of generating approximate joints', () => {
  assert.throws(() => createHomeRig(), /장면/);
  assert.throws(() => createHomeRig(new THREE.Group()), /리깅된 GLB/);
});

test('all character IDs select new assets and automatic motion remains continuous', () => {
  assert.deepEqual(Object.values(CHARACTERS).map(character => character.model.split('?')[0]).sort(), fixtures.map(([file]) => file).sort());
  for (let time = 0; time < 48; time += .02) assert.ok(Math.abs(idlePose(time).stretch - idlePose(time + .02).stretch) < .02);
  assert.equal(idlePose(7).stretch, 1);
  const viewer = readFileSync('soldier-home-viewer.mjs', 'utf8');
  assert.ok(viewer.includes('rig.animate(seconds);'));
  assert.ok(viewer.includes('const active = () => visible();'));
  assert.ok(!readFileSync('sanggi-soldier.html', 'utf8').includes('id="home-character-preview"'));
});
