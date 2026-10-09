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

export function textureWeights(nx, nz) {
  const front = Math.max(0, nz) ** 6;
  const back = Math.max(0, -nz) ** 6;
  const side = Math.abs(nx) ** 6;
  const sum = Math.max(.000001, front + back + side);
  return [front / sum, back / sum, side / sum];
}

function volume(name, rings, materials) {
  const positions = [], sectors = 40;
  const sections = [];
  for (let row = 0; row < rings.length - 1; row++) {
    for (let step = 0; step < 4; step++) {
      const t = step / 4;
      const values = rings[row].map((value, channel) => {
        const a = rings[Math.max(0, row - 1)][channel] ?? 0;
        const b = value, c = rings[row + 1][channel] ?? 0;
        const d = rings[Math.min(rings.length - 1, row + 2)][channel] ?? 0;
        return .5 * ((2*b) + (-a+c)*t + (2*a-5*b+4*c-d)*t*t + (-a+3*b-3*c+d)*t*t*t);
      });
      sections.push(values);
    }
  }
  sections.push(rings.at(-1));
  for (const [cx, cy, rx, rz, cz = 0] of sections) {
    for (let i = 0; i <= sectors; i++) {
      const angle = i / sectors * Math.PI * 2;
      let z = cz + Math.cos(angle) * Math.max(.001, rz);
      if (name === 'head') {
        const nose = Math.exp(-(((cy - .105) / .014) ** 2)) *
          Math.exp(-((Math.sin(angle) / .19) ** 2)) * Math.max(0, Math.cos(angle));
        z += nose * .009;
      }
      positions.push(cx + Math.sin(angle) * Math.max(.001, rx), cy, z);
    }
  }
  const geometry = new THREE.BufferGeometry();
  // Give each face its own UVs so front/back and side projections cannot blend across seams.
  const expanded = [], mapped = [], frontMapped = [], backMapped = [], sideMapped = [], sideRear = [], weights = [];
  const add = (a, b, c, material) => {
    const start = expanded.length / 3;
    for (const vertex of [a, b, c]) {
      const x = positions[vertex * 3], y = positions[vertex * 3 + 1], z = positions[vertex * 3 + 2];
      expanded.push(x, y, z);
      const sector = vertex % (sectors + 1);
      const angle = sector / sectors * Math.PI * 2;
      weights.push(...textureWeights(Math.sin(angle), Math.cos(angle)));
      const imageX = material === 2 || material === 3 ? .5 - z / .38 : .5 + x / .84 * (material === 1 ? -1 : 1);
      mapped.push(imageX, 1 - y);
      const headX = name === 'head' ? x * 1.75 : x;
      frontMapped.push(.5 + headX / .84, 1 - y);
      backMapped.push(.5 - headX / .84, 1 - y);
      let sideX = .5 - z / .38;
      const usesRear = name === 'vest' || name === 'pelvis' || name === 'scarf';
      if (usesRear) sideX = .5 + z / .8;
      sideMapped.push(sideX, 1 - y);
      sideRear.push(usesRear ? 1 : 0);
    }
    geometry.addGroup(start, 3, material);
  };
  for (let row = 0; row < sections.length - 1; row++) for (let i = 0; i < sectors; i++) {
    const angle = (i + .5) / sectors * Math.PI * 2;
    const material = Math.abs(Math.cos(angle)) > .8 ? Math.cos(angle) > 0 ? 0 : 1 : Math.sin(angle) > 0 ? 2 : 3;
    const a = row * (sectors + 1) + i, b = a + sectors + 1;
    add(a, b, a + 1, material); add(a + 1, b, b + 1, material);
  }
  for (const row of [0, sections.length - 1]) {
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
  geometry.setAttribute('textureWeight', new THREE.Float32BufferAttribute(weights, 3));
  geometry.computeVertexNormals();
  const normals = geometry.attributes.normal;
  const shared = new Map();
  for (let i = 0; i < expanded.length / 3; i++) {
    const key = expanded.slice(i*3, i*3+3).map(value => value.toFixed(6)).join(',');
    const entry = shared.get(key) || { normal: new THREE.Vector3(), vertices: [] };
    entry.normal.add(new THREE.Vector3().fromBufferAttribute(normals, i)); entry.vertices.push(i);
    shared.set(key, entry);
  }
  for (const { normal, vertices } of shared.values()) {
    normal.normalize();
    for (const i of vertices) normals.setXYZ(i, normal.x, normal.y, normal.z);
  }
  geometry.clearGroups();
  const mesh = new THREE.Mesh(geometry, materials[0]); mesh.name = name;
  return mesh;
}

export function createHomeRig(textures = []) {
  const materials = [0].map(index => new THREE.MeshBasicMaterial({
    map: textures[index] || null, color: textures[index] ? 0xffffff : 0x8d897a, side: THREE.DoubleSide
  }));
  for (const material of materials) {
    material.onBeforeCompile = shader => {
      shader.uniforms.frontTexture = { value: textures[0] || null };
      shader.uniforms.backTexture = { value: textures[1] || null };
      shader.uniforms.sideTexture = { value: textures[2] || null };
      shader.vertexShader = 'attribute vec2 frontUv; attribute vec2 backUv; attribute vec2 sideUv; attribute float sideRear; attribute vec3 textureWeight;\nvarying vec2 vFront; varying vec2 vBack; varying vec2 vSide; varying float vSideRear; varying vec3 vTextureWeight;\n' + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace('#include <uv_vertex>', '#include <uv_vertex>\nvFront=frontUv; vBack=backUv; vSide=sideUv; vSideRear=sideRear; vTextureWeight=textureWeight;');
      shader.fragmentShader = 'uniform sampler2D frontTexture; uniform sampler2D backTexture; uniform sampler2D sideTexture;\nvarying vec2 vFront; varying vec2 vBack; varying vec2 vSide; varying float vSideRear; varying vec3 vTextureWeight;\n' + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `
        #ifdef USE_MAP
          vec3 frontColour=texture2D(frontTexture,vFront).rgb;
          vec3 backColour=texture2D(backTexture,vBack).rgb;
          vec3 sideColour=vSideRear>0.5 ? texture2D(backTexture,vSide).rgb : texture2D(sideTexture,vSide).rgb;
          vec3 weights=vTextureWeight/max(dot(vTextureWeight,vec3(1.0)),0.00001);
          diffuseColor *= vec4(frontColour*weights.x+backColour*weights.y+sideColour*weights.z,1.0);
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
  part('pelvis', hips, [[0,.445,.135,.072],[0,.48,.15,.078],[0,.53,.145,.085],[0,.575,.125,.071]]);
  const chest = joint('spine', hips, 0, -.2);
  part('vest', chest, [[0,.175,.075,.045],[0,.20,.13,.06],[0,.23,.158,.075],[0,.29,.151,.082],[0,.36,.14,.075],[0,.43,.145,.075],[0,.46,.15,.076]]);
  const neck = joint('neck', chest, 0, -.15);
  part('neckSkin', neck, [[0,.132,.025,.026],[0,.156,.027,.025],[0,.182,.034,.03]]);
  part('scarf', neck, [[0,.145,.048,.048],[0,.16,.077,.055],[0,.183,.091,.052],[0,.205,.071,.045]]);
  part('head', neck, [[0,.02,.003,.005,-.004],[0,.038,.029,.032,-.007],[0,.056,.044,.047,-.008],
    [0,.077,.048,.052,-.007],[0,.096,.047,.049,-.003],[0,.115,.043,.042,.002],
    [0,.135,.034,.035,.006],[0,.148,.021,.021,.012],[0,.154,.009,.012,.013]]);
  for (const sign of [-1, 1]) {
    part(`${sign < 0 ? 'left' : 'right'}Ear`, neck,
      [[sign*.046,.085,.004,.005,-.008],[sign*.049,.099,.009,.011,-.008],[sign*.047,.118,.005,.007,-.007]]);
  }
  for (const sign of [-1, 1]) {
    const side = sign < 0 ? 'left' : 'right';
    const shoulder = joint(`${side}Shoulder`, chest, sign * .173, -.105);
    part(`${side}UpperArm`, shoulder, [[sign*.16,.20,.02,.025],[sign*.185,.226,.043,.048],
      [sign*.201,.267,.041,.042],[sign*.22,.31,.036,.036],[sign*.233,.338,.032,.032]]);
    const elbow = joint(`${side}Elbow`, shoulder, sign * .06, .133);
    part(`${side}Forearm`, elbow, [[sign*.233,.327,.033,.032],[sign*.244,.36,.034,.032],
      [sign*.256,.4,.028,.027],[sign*.273,.451,.022,.021]]);
    part(`${side}Hand`, elbow, [[sign*.273,.439,.021,.019],[sign*.29,.465,.031,.02],
      [sign*.296,.494,.029,.018],[sign*.293,.529,.014,.013]]);
    const hip = joint(`${side}Hip`, hips, sign * .076, 0);
    part(`${side}Thigh`, hip, [[sign*.075,.51,.072,.074],[sign*.085,.56,.072,.075],
      [sign*.097,.61,.064,.065],[sign*.107,.655,.053,.055],[sign*.111,.69,.047,.048]]);
    const knee = joint(`${side}Knee`, hip, sign * .026, .17);
    part(`${side}Calf`, knee, [[sign*.111,.671,.048,.048],[sign*.115,.713,.051,.052],
      [sign*.122,.764,.052,.058,-.008],[sign*.128,.824,.038,.039],[sign*.13,.879,.031,.034]]);
    part(`${side}Boot`, knee, [[sign*.13,.857,.034,.035],[sign*.132,.899,.036,.042],
      [sign*.136,.945,.042,.067,.019],[sign*.14,.969,.047,.091,.037],[sign*.14,.981,.048,.09,.037]]);
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
  return { root, joints, animate, materials, setYaw(yaw) { root.rotation.y = yaw; } };
}
