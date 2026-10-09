import * as THREE from './vendor/three.module.min.js';
import { GLTFLoader } from './vendor/GLTFLoader.js';
import { CHARACTERS } from './soldier-characters.mjs?v=3';

export const HOME_MODEL = 'soldier-home-model.glb';

export function idlePose(seconds) {
  const cycle = seconds % 10;
  const stretch = cycle >= 4 ? Math.sin((cycle - 4) / 6 * Math.PI) ** 2 : 0;
  return { breath: Math.sin(seconds * Math.PI * 2 / 4.5), stretch };
}

const sources = new Map();
export async function loadCharacterSource(id = 'black-water') {
  const character = CHARACTERS[id];
  if (!character) throw new Error('3D 캐릭터가 올바르지 않습니다.');
  if (!sources.has(id)) {
    const pending = new GLTFLoader().loadAsync(character.model).then(gltf => {
      gltf.scene.traverse(part => {
        if (!part.isMesh) return;
        for (const material of Array.isArray(part.material) ? part.material : [part.material]) {
          for (const value of Object.values(material)) {
            if (value?.isTexture) value.userData.persistent = true;
          }
        }
      });
      return gltf.scene;
    }).catch(error => {
      sources.delete(id);
      throw new Error(`${character.name} 3D 모델을 불러오지 못했습니다. 다시 장착하거나 새로고침하세요.`, { cause: error });
    });
    sources.set(id, pending);
  }
  return sources.get(id);
}

export async function loadHomeRig(id = 'black-water') {
  const rig = createHomeRig(await loadCharacterSource(id));
  rig.root.userData.character = id;
  return rig;
}

const smooth = (min, max, value) => THREE.MathUtils.smoothstep(value, min, max);

export function chestExpansion(x, y, z, width = 1) {
  const mask = smooth(.62, .69, y) * (1 - smooth(.78, .83, y))
    * (1 - smooth(.07 * width, .115 * width, Math.abs(x)));
  return [x * .008 * mask, 0, THREE.MathUtils.clamp(z * .03, -.0025, .0025) * mask];
}

// The supplied GLB has no skin. Blend inferred joints across all mesh regions,
// rather than cutting its geometry or replacing the supplied silhouette/textures.
export const JOINT_NAMES = ['hips', 'spine', 'chest', 'neck', 'head',
  'leftShoulder', 'leftElbow', 'leftWrist', 'rightShoulder', 'rightElbow', 'rightWrist',
  'leftHip', 'leftKnee', 'leftAnkle', 'leftToe', 'rightHip', 'rightKnee', 'rightAnkle', 'rightToe'];

export function jointWeights(x, y, z = 0, width = 1) {
  const neck = smooth(.81, .86, y);
  const head = smooth(.89, .94, y);
  const torso = smooth(.49, .59, y);
  const chest = smooth(.66, .73, y);
  const arm = smooth(.097 * width, .137 * width, Math.abs(x)) * (1 - smooth(.79, .83, y)) * smooth(.42, .48, y);
  const elbow = 1 - smooth(.60, .67, y);
  const wrist = 1 - smooth(.53, .59, y);
  const leg = (1 - neck) * (1 - arm) * (1 - smooth(.42, .49, y));
  const knee = 1 - smooth(.26, .34, y);
  const ankle = 1 - smooth(.10, .18, y);
  const toe = (1 - smooth(.04, .08, y)) * smooth(.02, .07, z);
  const body = (1 - neck) * (1 - arm) - leg;
  const shoulderIndex = x < 0 ? 5 : 8;
  const hipIndex = x < 0 ? 11 : 15;
  const weights = [
    [0, body * (1 - torso)],
    [1, body * torso * (1 - chest)],
    [2, body * torso * chest],
    [3, neck * (1 - head)],
    [4, neck * head],
    [shoulderIndex, (1 - neck) * arm * (1 - elbow)],
    [shoulderIndex + 1, (1 - neck) * arm * elbow * (1 - wrist)],
    [shoulderIndex + 2, (1 - neck) * arm * elbow * wrist],
    [hipIndex, leg * (1 - knee)],
    [hipIndex + 1, leg * knee * (1 - ankle)],
    [hipIndex + 2, leg * knee * ankle * (1 - toe)],
    [hipIndex + 3, leg * knee * ankle * toe]
  ].filter(([, weight]) => weight > 0).sort((a, b) => b[1] - a[1]).slice(0, 4);
  const sum = weights.reduce((total, [, weight]) => total + weight, 0);
  return weights.map(([index, weight]) => [index, weight / sum]);
}

export function createHomeRig(source) {
  if (!source?.isObject3D) throw new Error('3D 캐릭터 장면이 필요합니다.');
  source.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(source);
  const height = bounds.max.y - bounds.min.y;
  if (!Number.isFinite(height) || height <= 0) throw new Error('3D 캐릭터 크기가 올바르지 않습니다.');
  const center = bounds.getCenter(new THREE.Vector3());
  const width = (bounds.max.x - bounds.min.x) / height / .41;
  const root = new THREE.Group(); root.name = 'supplied-home-character';
  const joints = {}, bones = [], meshes = [], materials = new Set();
  function joint(name, parent, x, y, z = 0) {
    const bone = new THREE.Bone(); bone.name = name; bone.position.set(x, y, z);
    parent.add(bone); bones.push(bone); joints[name] = bone; return bone;
  }
  const hips = joint('hips', root, 0, .5);
  const spine = joint('spine', hips, 0, .12);
  const chest = joint('chest', spine, 0, .09);
  const neck = joint('neck', chest, 0, .13);
  joint('head', neck, 0, .09);
  for (const sign of [-1, 1]) {
    const side = sign < 0 ? 'left' : 'right';
    const shoulder = joint(`${side}Shoulder`, chest, sign * .125 * width, .05, -.02);
    const elbow = joint(`${side}Elbow`, shoulder, sign * .04 * width, -.135);
    joint(`${side}Wrist`, elbow, sign * .015 * width, -.105, .005);
  }
  for (const sign of [-1, 1]) {
    const side = sign < 0 ? 'left' : 'right';
    const hip = joint(`${side}Hip`, hips, sign * .075 * width, -.05);
    const knee = joint(`${side}Knee`, hip, sign * .015 * width, -.18);
    const ankle = joint(`${side}Ankle`, knee, sign * .01 * width, -.195);
    joint(`${side}Toe`, ankle, 0, -.05, .06);
  }
  root.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(bones);
  source.traverse(part => {
    if (!part.isMesh) return;
    const geometry = part.geometry.clone().applyMatrix4(part.matrixWorld);
    geometry.translate(-center.x, -bounds.min.y, -center.z);
    geometry.scale(1 / height, 1 / height, 1 / height);
    const positions = geometry.attributes.position;
    const indices = new Uint16Array(positions.count * 4);
    const weights = new Float32Array(positions.count * 4);
    const expansion = new Float32Array(positions.count * 3);
    for (let i = 0; i < positions.count; i++) {
      expansion.set(chestExpansion(positions.getX(i), positions.getY(i), positions.getZ(i), width), i * 3);
      jointWeights(positions.getX(i), positions.getY(i), positions.getZ(i), width).forEach(([bone, weight], slot) => {
        indices[i * 4 + slot] = bone; weights[i * 4 + slot] = weight;
      });
    }
    geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(indices, 4));
    geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(weights, 4));
    geometry.morphTargetsRelative = true;
    geometry.morphAttributes.position = [new THREE.Float32BufferAttribute(expansion, 3)];
    const material = Array.isArray(part.material) ? part.material.map(m => m.clone()) : part.material.clone();
    for (const m of Array.isArray(material) ? material : [material]) materials.add(m);
    const mesh = new THREE.SkinnedMesh(geometry, material); mesh.name = part.name || 'supplied-soldier';
    // Small idle deformations stay inside the camera frame; avoid per-frame bounds
    // recomputation over all supplied vertices.
    mesh.frustumCulled = false;
    root.add(mesh); mesh.bind(skeleton); meshes.push(mesh);
  });
  if (!meshes.length) throw new Error('3D 캐릭터에 표시할 메시가 없습니다.');
  function animate(seconds) {
    const { breath, stretch } = idlePose(seconds);
    const breathing = breath, loosening = stretch;
    for (const mesh of meshes) mesh.morphTargetInfluences[0] = breathing;
    joints.neck.rotation.set(breathing * .008 + loosening * .1,
      loosening * .12 * Math.sin(seconds * .8), loosening * .07);
    for (const sign of [-1, 1]) {
      const side = sign < 0 ? 'left' : 'right';
      joints[`${side}Shoulder`].position.y = .05 + breathing * .002;
      joints[`${side}Shoulder`].rotation.set(-breathing * .065 - loosening * .07,
        0, sign * (breathing * .035 + loosening * .08));
      joints[`${side}Elbow`].rotation.set(-breathing * .12 - loosening * .24, 0,
        sign * breathing * .045);
      joints[`${side}Wrist`].rotation.set(breathing * .035 + loosening * .045, 0,
        -sign * breathing * .012);
    }
    root.userData.motion = stretch > .001 ? 'stretch' : 'breathe';
  }
  animate(0);
  return { root, joints, meshes, skeleton, materials: [...materials], animate,
    dispose() {
      root.removeFromParent();
      for (const mesh of meshes) mesh.geometry.dispose();
      for (const material of materials) material.dispose();
      skeleton.dispose();
    },
    setYaw(yaw) { root.rotation.y = yaw; } };
}
