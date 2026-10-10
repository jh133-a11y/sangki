import * as THREE from './vendor/three.module.min.js';
import { CHARACTERS } from './soldier-characters.mjs?v=6';

export async function loadCharacterTextures() {
  const image = new Image(); image.src = CHARACTERS['black-water'].image;
  try { await image.decode(); }
  catch (error) {
    throw new Error(`캐릭터 사진을 불러오지 못했습니다: ${image.src}`, { cause: error });
  }
  const front = new THREE.Texture(image);
  front.colorSpace = THREE.SRGBColorSpace; front.needsUpdate = true;
  front.userData.persistent = true;
  const backCanvas = document.createElement('canvas'); backCanvas.width = 1; backCanvas.height = 1;
  const context = backCanvas.getContext('2d'); context.fillStyle = '#292e2a'; context.fillRect(0, 0, 1, 1);
  const back = new THREE.CanvasTexture(backCanvas);
  back.colorSpace = THREE.SRGBColorSpace; back.userData.persistent = true;
  return { front, back };
}

// The unused legacy fallback is an honest portrait stand, not an inferred 3D body.
// The active character viewer renders the unchanged supplied JAMES GLB instead.
export function createSoldierModel(combat = false, textures = {}) {
  const model = new THREE.Group();
  const materials = [textures.front, textures.back].map(map => new THREE.MeshStandardMaterial({
    map: map || null, color: map ? '#fff' : '#292e2a', roughness: .95
  }));
  const geometry = new THREE.BoxGeometry(1.68, 2.1, .24);
  for (const group of geometry.groups) group.materialIndex = group.materialIndex === 4 ? 0 : 1;
  const portrait = new THREE.Mesh(geometry, materials);
  portrait.position.y = 1.05; model.add(portrait);
  model.userData.character = 'james-portrait';
  model.userData.combat = combat;
  return model;
}
