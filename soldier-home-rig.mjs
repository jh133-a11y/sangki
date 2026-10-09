import * as THREE from './vendor/three.module.min.js';
import { GLTFLoader } from './vendor/GLTFLoader.js';

export const HOME_MODEL = 'soldier-home-model.glb';

export function idlePose(seconds) {
  const cycle = seconds % 10;
  const stretch = cycle >= 4 ? Math.sin((cycle - 4) / 6 * Math.PI) ** 2 : 0;
  return { breath: Math.sin(seconds * Math.PI * 2 / 4.5), stretch };
}

export async function loadHomeRig() {
  let gltf;
  try {
    gltf = await new GLTFLoader().loadAsync(`${HOME_MODEL}?v=1`);
  } catch (error) {
    throw new Error('제공된 3D 캐릭터 파일을 불러오지 못했습니다.', { cause: error });
  }
  return createHomeRig(gltf.scene);
}

const smooth = (min, max, value) => THREE.MathUtils.smoothstep(value, min, max);

// The supplied single-mesh GLB has no skin. Blend inferred joints across regions,
// rather than cutting its geometry or replacing the supplied silhouette/textures.
export function jointWeights(x, y) {
  const neck = smooth(.81, .86, y);
  const torso = smooth(.49, .59, y);
  const arm = smooth(.097, .137, Math.abs(x)) * (1 - smooth(.79, .83, y)) * smooth(.44, .49, y);
  const elbow = 1 - smooth(.60, .67, y);
  const shoulderIndex = x < 0 ? 3 : 5;
  const weights = [
    [0, (1 - neck) * (1 - arm) * (1 - torso)],
    [1, (1 - neck) * (1 - arm) * torso],
    [2, neck],
    [shoulderIndex, (1 - neck) * arm * (1 - elbow)],
    [shoulderIndex + 1, (1 - neck) * arm * elbow]
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
  const root = new THREE.Group(); root.name = 'supplied-home-character';
  const joints = {}, bones = [], meshes = [], materials = new Set();
  function joint(name, parent, x, y) {
    const bone = new THREE.Bone(); bone.name = name; bone.position.set(x, y, 0);
    parent.add(bone); bones.push(bone); joints[name] = bone; return bone;
  }
  const hips = joint('hips', root, 0, .5);
  const spine = joint('spine', hips, 0, .12);
  joint('neck', spine, 0, .22);
  for (const sign of [-1, 1]) {
    const side = sign < 0 ? 'left' : 'right';
    const shoulder = joint(`${side}Shoulder`, spine, sign * .125, .14);
    joint(`${side}Elbow`, shoulder, sign * .04, -.135);
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
    for (let i = 0; i < positions.count; i++) {
      jointWeights(positions.getX(i), positions.getY(i)).forEach(([bone, weight], slot) => {
        indices[i * 4 + slot] = bone; weights[i * 4 + slot] = weight;
      });
    }
    geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(indices, 4));
    geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(weights, 4));
    const material = Array.isArray(part.material) ? part.material.map(m => m.clone()) : part.material.clone();
    for (const m of Array.isArray(material) ? material : [material]) materials.add(m);
    const mesh = new THREE.SkinnedMesh(geometry, material); mesh.name = part.name || 'supplied-soldier';
    // Small idle deformations stay inside the camera frame; avoid per-frame bounds
    // recomputation over the supplied model's nearly one million vertices.
    mesh.frustumCulled = false;
    root.add(mesh); mesh.bind(skeleton); meshes.push(mesh);
  });
  if (!meshes.length) throw new Error('3D 캐릭터에 표시할 메시가 없습니다.');
  function animate(seconds) {
    const { breath, stretch } = idlePose(seconds);
    const breathing = breath, loosening = stretch;
    spine.scale.set(1 + breathing * .012, 1 + breathing * .006, 1 + breathing * .035);
    spine.position.y = .12 + breathing * .0025;
    joints.neck.rotation.set(breathing * .008 + loosening * .1,
      loosening * .12 * Math.sin(seconds * .8), loosening * .07);
    for (const sign of [-1, 1]) {
      const side = sign < 0 ? 'left' : 'right';
      joints[`${side}Shoulder`].position.y = .14 + breathing * .0015;
      joints[`${side}Shoulder`].rotation.set(breathing * .025 + loosening * .07,
        0, sign * (breathing * .018 + loosening * .08));
      joints[`${side}Elbow`].rotation.set(breathing * .018 + loosening * .13, 0, 0);
    }
    root.userData.motion = stretch > .001 ? 'stretch' : 'breathe';
  }
  animate(0);
  return { root, joints, meshes, skeleton, materials: [...materials], animate,
    setYaw(yaw) { root.rotation.y = yaw; } };
}
