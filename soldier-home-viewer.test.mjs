import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from './vendor/three.module.min.js';
import { createHomeRig, idlePose, textureWeights } from './soldier-home-rig.mjs';

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

test('texture placement is fixed to the surface and never switches when rotating the model', () => {
    const rig = createHomeRig();
    const shaders = { uniforms: {}, vertexShader: '#include <uv_vertex>', fragmentShader: '#include <map_fragment>' };
    rig.materials[0].onBeforeCompile(shaders);
    assert.equal(shaders.uniforms.viewDirection, undefined);
    assert.ok(!shaders.fragmentShader.includes('viewDirection'));
    assert.deepEqual(textureWeights(0, 1), [1, 0, 0]);
    assert.deepEqual(textureWeights(0, -1), [0, 1, 0]);
    for (let angle=0;angle<Math.PI*2;angle+=.01) {
      const weights=textureWeights(Math.sin(angle),Math.cos(angle));
      assert.ok(Math.abs(weights.reduce((a,b)=>a+b,0)-1)<1e-10);
    }
  });

test('head has a nose profile, narrow chin and broader skull rather than a sphere', () => {
    const rig=createHomeRig();
    const head=rig.root.getObjectByName('head');
    const p=head.geometry.attributes.position;
    head.updateWorldMatrix(true,false);
    const pivot=head.parent.getWorldPosition(new THREE.Vector3());
    const rows=new Map();
    for(let i=0;i<p.count;i++){
      const y=p.getY(i)-pivot.y, key=y.toFixed(5);
      const row=rows.get(key)||{y,width:0,front:-Infinity,back:Infinity};
      row.width=Math.max(row.width,Math.abs(p.getX(i)));
      row.front=Math.max(row.front,p.getZ(i));row.back=Math.min(row.back,p.getZ(i));
      rows.set(key,row);
    }
    const nearest=y=>[...rows.values()].sort((a,b)=>Math.abs(a.y-y)-Math.abs(b.y-y))[0];
    assert.ok(nearest(.148).width<nearest(.077).width*.6);
    assert.ok(nearest(.105).front>nearest(.077).front);
    assert.ok(nearest(.077).back<-.045);
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
