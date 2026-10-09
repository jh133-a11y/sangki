import * as THREE from './vendor/three.module.min.js';

export const RIG_TEXTURES = ['soldier-angle-front.png', 'soldier-angle-back.png', 'soldier-angle-left.png'];

export function idlePose(seconds) {
  const cycle = seconds % 24;
  const stretch = cycle >= 12 && cycle <= 18 ? Math.sin((cycle - 12) / 6 * Math.PI) ** 2 : 0;
  return { breath: Math.sin(seconds * Math.PI * 2 / 4.5), stretch };
}

export async function loadRigTextures() {
  return Promise.all(RIG_TEXTURES.map(async src => {
    const image = new Image(); image.src = `${src}?v=2`;
    try { await image.decode(); }
    catch (error) { throw new Error(`캐릭터 질감을 불러오지 못했습니다: ${src}`, { cause: error }); }
    const canvas = document.createElement('canvas');
    canvas.width = image.width; canvas.height = image.height;
    const context = canvas.getContext('2d'); context.drawImage(image, 0, 0);
    const data = context.getImageData(0, 0, canvas.width, canvas.height);
    const foreground = new ImageData(new Uint8ClampedArray(data.data), canvas.width, canvas.height);
    for (let offset = 0; offset < foreground.data.length; offset += 4) {
      foreground.data[offset + 3] = foreground.data[offset + 3] > 200 ? 255 : 0;
    }
    // Extend edge colours across transparent pixels so projected UVs never include studio background.
    for (let y = 0; y < canvas.height; y++) {
      const opaque = [];
      for (let x = 0; x < canvas.width; x++) if (data.data[(y * canvas.width + x) * 4 + 3] > 200) opaque.push(x);
      if (!opaque.length) continue;
      let nearest = 0;
      for (let x = 0; x < canvas.width; x++) {
        while (nearest + 1 < opaque.length && Math.abs(opaque[nearest + 1] - x) < Math.abs(opaque[nearest] - x)) nearest++;
        const offset = (y * canvas.width + x) * 4, from = (y * canvas.width + opaque[nearest]) * 4;
        if (data.data[offset + 3] <= 200) for (let channel = 0; channel < 3; channel++) data.data[offset + channel] = data.data[from + channel];
        data.data[offset + 3] = 255;
      }
    }
    context.putImageData(data, 0, 0);
    const padding = document.createElement('canvas');
    padding.width = canvas.width; padding.height = canvas.height;
    padding.getContext('2d').drawImage(canvas, 0, 0);
    context.filter = 'blur(6px)'; context.drawImage(padding, 0, 0);
    const masked = document.createElement('canvas');
    masked.width = canvas.width; masked.height = canvas.height;
    masked.getContext('2d').putImageData(foreground, 0, 0);
    context.filter = 'none'; context.drawImage(masked, 0, 0);
    const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  }));
}

function volume(name, rings, materials) {
  const positions = [], sectors = 40;
  for (const [cx, cy, rx, rz] of rings) {
    for (let i = 0; i <= sectors; i++) {
      const angle = i / sectors * Math.PI * 2;
      positions.push(cx + Math.sin(angle) * rx, cy, Math.cos(angle) * rz);
    }
  }
  const geometry = new THREE.BufferGeometry();
  // Give each face its own UVs so front/back and side projections cannot blend across seams.
  const expanded = [], mapped = [], frontMapped = [], backMapped = [], sideMapped = [], sideRear = [];
  const add = (a, b, c, material) => {
    const start = expanded.length / 3;
    for (const vertex of [a, b, c]) {
      const x = positions[vertex * 3], y = positions[vertex * 3 + 1], z = positions[vertex * 3 + 2];
      expanded.push(x, y, z);
      const imageX = material === 2 || material === 3 ? .5 - z / .38 : .5 + x / .84 * (material === 1 ? -1 : 1);
      mapped.push(imageX, 1 - y);
      frontMapped.push(.5 + x / .84, 1 - y);
      backMapped.push(.5 - x / .84, 1 - y);
      let sideX = .5 - z / .38;
      const usesRear = name === 'vest' || name === 'pelvis' || name === 'scarf';
      if (usesRear) sideX = .5 + z / .8;
      sideMapped.push(sideX, 1 - y);
      sideRear.push(usesRear ? 1 : 0);
    }
    geometry.addGroup(start, 3, material);
  };
  for (let row = 0; row < rings.length - 1; row++) for (let i = 0; i < sectors; i++) {
    const angle = (i + .5) / sectors * Math.PI * 2;
    const material = Math.abs(Math.cos(angle)) > .8 ? Math.cos(angle) > 0 ? 0 : 1 : Math.sin(angle) > 0 ? 2 : 3;
    const a = row * (sectors + 1) + i, b = a + sectors + 1;
    add(a, b, a + 1, material); add(a + 1, b, b + 1, material);
  }
  for (const row of [0, rings.length - 1]) {
    for (let i = 1; i < sectors - 1; i++) {
      const start = row * (sectors + 1);
      add(start, start + i + (row === 0 ? 1 : 0), start + i + (row === 0 ? 0 : 1), 0);
    }
  }
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(expanded, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(mapped, 2));
  geometry.setAttribute('frontUv', new THREE.Float32BufferAttribute(frontMapped, 2));
  geometry.setAttribute('backUv', new THREE.Float32BufferAttribute(backMapped, 2));
  geometry.setAttribute('sideUv', new THREE.Float32BufferAttribute(sideMapped, 2));
  geometry.setAttribute('sideRear', new THREE.Float32BufferAttribute(sideRear, 1));
  geometry.computeVertexNormals();
  geometry.clearGroups();
  const mesh = new THREE.Mesh(geometry, materials[0]); mesh.name = name;
  return mesh;
}

export function createHomeRig(textures = []) {
  const view = { value: 0 };
  const materials = [0].map(index => new THREE.MeshBasicMaterial({
    map: textures[index] || null, color: textures[index] ? 0xffffff : 0x8d897a, side: THREE.DoubleSide
  }));
  for (const material of materials) {
    material.onBeforeCompile = shader => {
      shader.uniforms.viewDirection = view;
      shader.uniforms.frontTexture = { value: textures[0] || null };
      shader.uniforms.backTexture = { value: textures[1] || null };
      shader.uniforms.sideTexture = { value: textures[2] || null };
      shader.vertexShader = 'attribute vec2 frontUv; attribute vec2 backUv; attribute vec2 sideUv; attribute float sideRear;\nvarying vec2 vFront; varying vec2 vBack; varying vec2 vSide; varying float vSideRear;\n' + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace('#include <uv_vertex>', '#include <uv_vertex>\nvFront=frontUv; vBack=backUv; vSide=sideUv; vSideRear=sideRear;');
      shader.fragmentShader = 'uniform float viewDirection; uniform sampler2D frontTexture; uniform sampler2D backTexture; uniform sampler2D sideTexture;\nvarying vec2 vFront; varying vec2 vBack; varying vec2 vSide; varying float vSideRear;\n' + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `
        #ifdef USE_MAP
          vec4 colour;
          if (viewDirection > 0.45) colour=texture2D(frontTexture,vFront);
          else if (viewDirection < -0.45) colour=texture2D(backTexture,vBack);
          else if (vSideRear > 0.5) colour=texture2D(backTexture,vSide);
          else colour=texture2D(sideTexture,vSide);
          diffuseColor *= vec4(colour.rgb,1.0);
        #endif
      `);
    };
  }
  const root = new THREE.Group(); root.name = 'articulated-home-character';
  const joints = {};
  function joint(name, parent, x, y) {
    const group = new THREE.Group(); group.name = name;
    group.position.set(x, y, 0); parent.add(group); joints[name] = group; return group;
  }
  function part(name, parent, rings) {
    const mesh = volume(name, rings, materials);
    // Rest-image coordinates remain fixed in UVs; geometry is local to its pivot.
    parent.updateWorldMatrix(true, false);
    const pivot = new THREE.Vector3(); parent.getWorldPosition(pivot);
    mesh.geometry.translate(-pivot.x, -pivot.y, -pivot.z); parent.add(mesh);
  }
  const hips = joint('hips', root, 0, .52);
  part('pelvis', hips, [[0,.46,.13,.075],[0,.52,.145,.082],[0,.59,.13,.073]]);
  const chest = joint('spine', hips, 0, -.2);
  part('vest', chest, [[0,.17,.105,.065],[0,.205,.155,.08],[0,.25,.175,.085],[0,.34,.17,.085],[0,.46,.175,.075]]);
  const neck = joint('neck', chest, 0, -.15);
  part('scarf', neck, [[0,.125,.08,.055],[0,.16,.11,.065],[0,.20,.09,.06]]);
  part('head', neck, [[0,.02,.012,.012],[0,.035,.055,.045],[0,.055,.084,.07],[0,.09,.094,.08],[0,.125,.074,.07],[0,.15,.047,.047]]);
  for (const sign of [-1, 1]) {
    const side = sign < 0 ? 'left' : 'right';
    const shoulder = joint(`${side}Shoulder`, chest, sign * .202, -.105);
    part(`${side}UpperArm`, shoulder, [[sign*.202,.205,.045,.047],[sign*.227,.265,.048,.049],[sign*.254,.325,.041,.041]]);
    const elbow = joint(`${side}Elbow`, shoulder, sign * .052, .12);
    part(`${side}Forearm`, elbow, [[sign*.254,.325,.041,.041],[sign*.273,.40,.03,.033],[sign*.299,.46,.027,.028]]);
    part(`${side}Hand`, elbow, [[sign*.299,.445,.03,.03],[sign*.316,.49,.035,.026],[sign*.312,.535,.022,.019]]);
    const hip = joint(`${side}Hip`, hips, sign * .076, 0);
    part(`${side}Thigh`, hip, [[sign*.075,.51,.072,.07],[sign*.086,.60,.076,.07],[sign*.102,.69,.059,.061]]);
    const knee = joint(`${side}Knee`, hip, sign * .026, .17);
    part(`${side}Calf`, knee, [[sign*.102,.67,.059,.058],[sign*.113,.76,.063,.055],[sign*.125,.87,.044,.041]]);
    part(`${side}Boot`, knee, [[sign*.125,.85,.044,.045],[sign*.129,.94,.048,.065],[sign*.133,.978,.061,.09]]);
  }
  root.scale.y = -1;
  function animate(seconds) {
    const { breath, stretch } = idlePose(seconds);
    chest.scale.set(1 + breath * .015, 1, 1 + breath * .035);
    neck.rotation.z = stretch * .1 * Math.sin(seconds * 1.2);
    neck.rotation.x = stretch * .12;
    for (const sign of [-1, 1]) {
      const side = sign < 0 ? 'left' : 'right';
      joints[`${side}Shoulder`].rotation.z = sign * (.01 + stretch * .1 + breath * .006);
      joints[`${side}Elbow`].rotation.x = stretch * .16;
    }
    root.userData.motion = stretch > .001 ? 'stretch' : 'breathe';
  }
  animate(0);
  return { root, joints, animate, materials, setYaw(yaw) { root.rotation.y = yaw; view.value = Math.cos(yaw); } };
}
