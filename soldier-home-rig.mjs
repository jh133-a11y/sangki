import * as THREE from './vendor/three.module.min.js';
import { GLTFLoader } from './vendor/GLTFLoader.js';
import { CHARACTERS } from './soldier-characters.mjs?v=5';

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

const REQUIRED_JOINTS = ['Hips', 'Spine2', 'Neck', 'Head',
  'LeftShoulder', 'LeftArm', 'LeftForeArm', 'LeftHand',
  'RightShoulder', 'RightArm', 'RightForeArm', 'RightHand',
  'LeftUpLeg', 'LeftLeg', 'LeftFoot', 'RightUpLeg', 'RightLeg', 'RightFoot'];

export function createHomeRig(source) {
  if (!source?.isObject3D) throw new Error('3D 캐릭터 장면이 필요합니다.');
  const model = source.clone(true), clones = new Map(), meshes = [], skeletons = new Set(), materials = new Set();
  function pair(original, copy) {
    clones.set(original, copy);
    original.children.forEach((child, index) => pair(child, copy.children[index]));
  }
  pair(source, model);
  // Object3D.clone keeps a SkinnedMesh's original skeleton reference.
  // Rebind every joint to this instance, retaining the supplied inverse bind matrices.
  source.traverse(original => {
    if (!original.isMesh) return;
    const mesh = clones.get(original);
    mesh.geometry = original.geometry.clone();
    mesh.material = Array.isArray(original.material)
      ? original.material.map(material => material.clone()) : original.material.clone();
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) materials.add(material);
    if (original.isSkinnedMesh) {
      const bones = original.skeleton.bones.map(bone => clones.get(bone));
      if (bones.some(bone => !bone?.isBone)) throw new Error('캐릭터 뼈대 연결을 확인할 수 없습니다.');
      mesh.skeleton = new THREE.Skeleton(bones, original.skeleton.boneInverses.map(matrix => matrix.clone()));
      mesh.bindMatrix.copy(original.bindMatrix);
      mesh.bindMatrixInverse.copy(original.bindMatrixInverse);
      skeletons.add(mesh.skeleton);
    }
    mesh.frustumCulled = false;
    meshes.push(mesh);
  });
  function release() {
    for (const mesh of meshes) mesh.geometry.dispose();
    for (const material of materials) material.dispose();
    for (const skeleton of skeletons) skeleton.dispose();
  }
  const joints = {};
  model.traverse(part => {
    if (part.isBone) joints[part.name.replace(/^mixamorig[:_]?/, '')] = part;
  });
  if (!skeletons.size || REQUIRED_JOINTS.some(name => !joints[name])) {
    release();
    throw new Error('제공된 캐릭터의 스킨과 필수 관절이 없습니다. 리깅된 GLB가 필요합니다.');
  }
  model.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(model);
  const height = bounds.max.y - bounds.min.y;
  if (!Number.isFinite(height) || height <= 0) {
    release();
    throw new Error('3D 캐릭터 크기가 올바르지 않습니다.');
  }
  const center = bounds.getCenter(new THREE.Vector3());
  const root = new THREE.Group(); root.name = 'supplied-home-character';
  const normalized = new THREE.Group();
  normalized.scale.setScalar(1 / height);
  normalized.position.set(-center.x / height, -bounds.min.y / height, -center.z / height);
  normalized.add(model); root.add(normalized);
  root.updateMatrixWorld(true);
  const rest = new Map();
  for (const bone of Object.values(joints)) {
    const inverseWorld = bone.getWorldQuaternion(new THREE.Quaternion()).invert();
    rest.set(bone, {
      rotation: bone.quaternion.clone(),
      x: new THREE.Vector3(1, 0, 0).applyQuaternion(inverseWorld),
      z: new THREE.Vector3(0, 0, 1).applyQuaternion(inverseWorld)
    });
  }
  const rotation = new THREE.Quaternion();
  function rotate(name, x, z = 0) {
    const bone = joints[name], bind = rest.get(bone);
    bone.quaternion.copy(bind.rotation)
      .multiply(rotation.setFromAxisAngle(bind.x, x))
      .multiply(rotation.setFromAxisAngle(bind.z, z));
  }
  function animate(seconds) {
    const { breath, stretch } = idlePose(seconds);
    // Rotate existing joints only: no inferred weights, scaling or mesh expansion.
    rotate('Spine2', -breath * .006);
    rotate('Neck', breath * .004 + stretch * .06, stretch * .04);
    for (const side of ['Left', 'Right']) {
      const sign = side === 'Left' ? 1 : -1;
      rotate(`${side}Shoulder`, -breath * .012, sign * breath * .012);
      rotate(`${side}Arm`, -breath * .035 - stretch * .04, sign * (breath * .04 + stretch * .045));
      rotate(`${side}ForeArm`, -breath * .045 - stretch * .12);
      rotate(`${side}Hand`, breath * .012 + stretch * .025);
    }
    root.userData.motion = stretch > .001 ? 'stretch' : 'breathe';
  }
  animate(0);
  return { root, joints, meshes, skeleton: [...skeletons][0], materials: [...materials], animate,
    dispose() { root.removeFromParent(); release(); },
    setYaw(yaw) { root.rotation.y = yaw; } };
}
