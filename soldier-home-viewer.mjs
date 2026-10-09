import * as THREE from './vendor/three.module.min.js';

export const CHARACTER_VIEWS = [
  { name: '기본 자세', src: 'soldier-angle-front.png' },
  { name: '몸풀기 자세', src: 'soldier-view-side.png' },
  { name: '편한 뒷모습', src: 'soldier-angle-back.png' }
];

export const ROTATION_VIEWS = [
  { src: 'soldier-angle-front.png', angle: 0 },
  { src: 'soldier-angle-left.png', angle: Math.PI / 2 },
  { src: 'soldier-angle-back.png', angle: Math.PI },
  { src: 'soldier-angle-rear-right.png', angle: Math.PI * 5 / 4 }
];

export function rotationPair(angle) {
  const full = Math.PI * 2;
  const wrapped = ((angle % full) + full) % full;
  const from = ROTATION_VIEWS.findLastIndex(view => view.angle <= wrapped);
  const to = (from + 1) % ROTATION_VIEWS.length;
  const end = to === 0 ? full : ROTATION_VIEWS[to].angle;
  const progress = (wrapped - ROTATION_VIEWS[from].angle) / (end - ROTATION_VIEWS[from].angle);
  const blend = progress * progress * (3 - 2 * progress);
  const yaw = (wrapped - (ROTATION_VIEWS[from].angle * (1 - blend) + end * blend)) * .65;
  return { from, to, blend, yaw };
}

export function surfaceDepth(x, spans, aspect) {
  const span = spans.find(([left, right]) => x >= left && x <= right);
  if (!span) return 0;
  const [left, right] = span;
  const radius = (right - left) / 2;
  if (!radius) return 0;
  const distance = (x - (left + right) / 2) / radius;
  return Math.sqrt(Math.max(0, 1 - distance * distance)) * radius * aspect * .65;
}

export function alignedX(x, fromSpans, toSpans) {
  if (!fromSpans.length || !toSpans.length) return x;
  const left = fromSpans[0][0], right = fromSpans.at(-1)[1];
  const otherLeft = toSpans[0][0], otherRight = toSpans.at(-1)[1];
  return otherLeft + (x - left) / Math.max(.001, right - left) * (otherRight - otherLeft);
}

export function posePoint(x, y, seconds) {
  const smooth = (a, b, value) => {
    const t = Math.max(0, Math.min(1, (value - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };
  const cycle = seconds % 40;
  const stretch = cycle >= 30 && cycle <= 36 ? Math.sin((cycle - 30) / 6 * Math.PI) ** 2 : 0;
  const breath = Math.sin(seconds * Math.PI * 2 / 4.5);
  const upper = 1 - smooth(.4, .57, y);
  const head = 1 - smooth(.14, .24, y);
  const shoulder = Math.exp(-(((y - .23) / .13) ** 2));
  const side = Math.min(1, Math.abs(x - .5) / .3);
  const tilt = stretch * .045 * Math.sin((cycle - 30) / 6 * Math.PI * 2);
  const px = x + head * (-(y - .18) * tilt) + (x - .5) * upper * breath * .004 +
    (x - .5) * shoulder * stretch * .028;
  const py = y + head * (x - .5) * tilt - upper * breath * .0018 -
    shoulder * stretch * (.006 + side * .005);
  return { x: px, y: py, stretching: stretch > .001 };
}

export async function createHomeViewer(canvas, status, buttons, motionButton) {
  const images = await Promise.all([...ROTATION_VIEWS, CHARACTER_VIEWS[1]].map(async (view, viewNumber) => {
    const image = new Image(); image.src = view.src;
    try { await image.decode(); }
    catch (error) { throw new Error(`캐릭터 사진을 불러오지 못했습니다: ${view.src}`, { cause: error }); }
    // Trim only transparent padding at display time. The original assets stay unchanged.
    const sample = document.createElement('canvas');
    sample.width = image.naturalWidth; sample.height = image.naturalHeight;
    const sampleContext = sample.getContext('2d');
    sampleContext.drawImage(image, 0, 0);
    const pixels = sampleContext.getImageData(0, 0, sample.width, sample.height).data;
    let left = sample.width, top = sample.height, right = -1, bottom = -1;
    for (let y = 0; y < sample.height; y++) for (let x = 0; x < sample.width; x++) {
      if (pixels[(y * sample.width + x) * 4 + 3] < 8) continue;
      left = Math.min(left, x); right = Math.max(right, x);
      top = Math.min(top, y); bottom = Math.max(bottom, y);
    }
    if (right < left) throw new Error(`캐릭터 사진이 비어 있습니다: ${view.src}`);
    // Extracted angle assets share a common head/foot frame, unlike the reference photo.
    if (viewNumber < ROTATION_VIEWS.length) {
      left = 0; top = 0; right = sample.width - 1; bottom = sample.height - 1;
    }
    const width = right - left + 1, height = bottom - top + 1;
    const spans = [];
    for (let row = 0; row <= 96; row++) {
      const y = top + Math.round(row / 96 * (height - 1));
      const segments = [];
      let start = null;
      for (let x = left; x <= right + 1; x++) {
        const opaque = x <= right && pixels[(y * sample.width + x) * 4 + 3] >= 8;
        if (opaque && start === null) start = x;
        if (!opaque && start !== null) {
          segments.push([(start - left) / width, (x - left) / width]); start = null;
        }
      }
      spans.push(segments);
    }
    const texture = new THREE.Texture(image); texture.colorSpace = THREE.SRGBColorSpace; texture.needsUpdate = true;
    texture.offset.set(left / sample.width, 1 - (bottom + 1) / sample.height);
    texture.repeat.set((right - left + 1) / sample.width, (bottom - top + 1) / sample.height);
    return { texture, width, height, spans };
  }));
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setClearColor(0, 0); renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene(), camera = new THREE.OrthographicCamera(-1, 1, 1, -1, .01, 10);
  camera.position.z = 2;
  const geometry = new THREE.PlaneGeometry(1, 1, 48, 96);
  geometry.setAttribute('nextUv', geometry.attributes.uv.clone());
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({
    map: images[0].texture, transparent: true, side: THREE.DoubleSide, depthTest: false
  }));
  const nextMap = { value: images[0].texture }, angleBlend = { value: 0 };
  mesh.material.onBeforeCompile = shader => {
    shader.uniforms.nextMap = nextMap; shader.uniforms.angleBlend = angleBlend;
    shader.vertexShader = 'attribute vec2 nextUv;\nvarying vec2 vNextUv;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <uv_vertex>', '#include <uv_vertex>\nvNextUv = nextUv;');
    shader.fragmentShader = 'varying vec2 vNextUv;\nuniform sampler2D nextMap;\nuniform float angleBlend;\n' + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `
      #ifdef USE_MAP
        vec4 a = texture2D(map, vMapUv);
        vec4 b = texture2D(nextMap, vNextUv);
        float detail = smoothstep(0.72, 0.76, vMapUv.y);
        detail = max(detail, smoothstep(0.39, 0.42, vMapUv.y) * (1.0 - smoothstep(0.54, 0.58, vMapUv.y)));
        float textureBlend = mix(angleBlend, smoothstep(0.45, 0.49, angleBlend), detail);
        float alpha = mix(a.a, b.a, textureBlend);
        vec3 rgb = mix(a.rgb * a.a, b.rgb * b.a, textureBlend) / max(alpha, 0.00001);
        diffuseColor *= vec4(rgb, alpha);
      #endif
    `);
  };
  scene.add(mesh);
  const original = new Float32Array(geometry.attributes.position.array);
  const home = canvas.closest('#home'), reduced = matchMedia('(prefers-reduced-motion: reduce)');
  let yaw = 0, targetYaw = 0, index = 0, drag = null, seconds = 0, last = null, request = null, enabled = true, pageActive = true;
  let contextLost = false, cssWidth = 0, cssHeight = 0;
  const visible = () => !document.hidden && !home.hidden && pageActive && !contextLost;
  const turning = () => index !== 1 && Math.abs(targetYaw - yaw) > .0001;
  const idle = () => enabled && !reduced.matches && index !== 1 && !drag;
  const active = () => visible() && (idle() || turning());
  function motionLabel() {
    motionButton.setAttribute('aria-pressed', String(enabled && !reduced.matches));
    motionButton.textContent = reduced.matches ? '동작 줄임' : enabled ? '모션 켜짐' : '모션 꺼짐';
    motionButton.disabled = reduced.matches;
  }
  function draw() {
    canvas.dataset.motion = visible() && turning() ? 'turn' : visible() && idle() ?
      posePoint(.5, .2, seconds).stretching ? 'stretch' : 'breathe' : 'still';
    canvas.dataset.yaw = yaw.toFixed(5);
    if (contextLost) return;
    const { width, height } = canvas.getBoundingClientRect();
    if (!width || !height) return;
    if (cssWidth !== width || cssHeight !== height) {
      renderer.setSize(width, height, false); cssWidth = width; cssHeight = height;
    }
    camera.left = -width / 2; camera.right = width / 2; camera.top = height / 2; camera.bottom = -height / 2;
    camera.position.z = Math.max(width, height) * 2;
    camera.near = 1; camera.far = Math.max(width, height) * 5;
    camera.updateProjectionMatrix();
    const pair = rotationPair(yaw);
    const source = images[index === 1 ? 4 : pair.from];
    const other = images[index === 1 ? 4 : pair.to];
    const blend = index === 1 ? 0 : pair.blend;
    const scale = Math.min(width / source.width, height / source.height) * .96;
    const w = source.width * scale, h = source.height * scale;
    const map = source.texture;
    nextMap.value = other.texture; angleBlend.value = blend;
    canvas.dataset.angleFrom = String(pair.from); canvas.dataset.angleTo = String(pair.to);
    canvas.dataset.angleBlend = blend.toFixed(5);
    if (mesh.material.map !== map) { mesh.material.map = map; mesh.material.needsUpdate = true; }
    const position = geometry.attributes.position;
    for (let i = 0; i < position.count; i++) {
      const x = original[i * 3] + .5, y = .5 - original[i * 3 + 1];
      const row = Math.round(y * 96);
      const otherX = index !== 1 ? alignedX(x, source.spans[row], other.spans[row]) : x;
      geometry.attributes.nextUv.setXY(i, otherX, 1 - y);
      const mixedX = x * (1 - blend) + otherX * blend;
      const pose = index !== 1 && !reduced.matches ? posePoint(mixedX, y, seconds) : { x: mixedX, y };
      // Infer shallow relief from each opaque silhouette span, not unseen side/back artwork.
      const depth = index !== 1 ? surfaceDepth(x, source.spans[row], source.width / source.height) * (1 - blend) +
        surfaceDepth(otherX, other.spans[row], other.width / other.height) * blend : 0;
      position.setXYZ(i, (pose.x - .5) * w, (.5 - pose.y) * h, depth * h);
    }
    position.needsUpdate = true;
    geometry.attributes.nextUv.needsUpdate = true;
    mesh.position.y = (h - height) / 2;
    mesh.rotation.y = index !== 1 ? pair.yaw : 0;
    renderer.render(scene, camera);
  }
  function frame(time) {
    request = null;
    if (!active()) { last = null; return; }
    if (last === null || time - last >= 1000 / 30) {
      if (last !== null) {
        const dt = Math.min(.1, (time - last) / 1000);
        if (idle()) seconds += dt;
        if (turning()) {
          yaw += (targetYaw - yaw) * (1 - Math.exp(-dt * 12));
          if (Math.abs(targetYaw - yaw) < .0001) yaw = targetYaw;
        }
      }
      last = time; draw();
    }
    request = requestAnimationFrame(frame);
  }
  function sync() {
    if (request !== null) cancelAnimationFrame(request);
    request = null; last = null;
    draw();
    if (active()) request = requestAnimationFrame(frame);
  }
  function select(nextIndex) {
    const wasReference = index === 1;
    index = nextIndex;
    const full = Math.PI * 2;
    const desired = index === 2 ? Math.PI : 0;
    targetYaw = desired + Math.round((yaw - desired) / full) * full;
    if (index === 1 || wasReference || reduced.matches || !enabled) yaw = targetYaw;
    canvas.dataset.view = String(index);
    canvas.setAttribute('aria-label', `Black Water: ${CHARACTER_VIEWS[index].name}. 드래그 또는 좌우 방향키로 다각도 2.5D 회전. Home 키로 정면 복귀.`);
    status.textContent = index === 1 ? '몸풀기 원본 참고 사진 · 회전용 옆면이 아닙니다.' :
      '다각도 원본 질감 2.5D · 드래그/방향키 회전 · 숨쉬기·몸풀기';
    buttons.forEach((button, i) => button.setAttribute('aria-pressed', String(i === index)));
    sync();
  }
  function rotate(nextYaw) {
    if (index === 1) select(0);
    index = 0; canvas.dataset.view = '0';
    buttons.forEach((button, i) => button.setAttribute('aria-pressed', String(i === 0)));
    targetYaw = nextYaw;
    status.textContent = '다각도 원본 질감 2.5D · 드래그/방향키 회전 · 숨쉬기·몸풀기';
    if (reduced.matches || !enabled) yaw = targetYaw;
    sync();
  }
  buttons.forEach((button, i) => button.addEventListener('click', () => select(i)));
  canvas.addEventListener('pointerdown', event => {
    if (event.button !== 0 || drag) return;
    drag = { id: event.pointerId, x: event.clientX };
    if (index === 1) select(0);
    sync();
    canvas.setPointerCapture(event.pointerId); canvas.focus({ preventScroll: true }); event.preventDefault();
  });
  canvas.addEventListener('pointermove', event => {
    if (drag?.id !== event.pointerId) return;
    rotate(targetYaw + (event.clientX - drag.x) * .004); drag.x = event.clientX;
  });
  function cancelDrag() {
    const active = drag; drag = null;
    if (active && canvas.hasPointerCapture(active.id)) canvas.releasePointerCapture(active.id);
    sync();
  }
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    canvas.addEventListener(type, event => { if (drag?.id === event.pointerId) cancelDrag(); });
  }
  window.addEventListener('blur', cancelDrag);
  canvas.addEventListener('keydown', event => {
    if (event.code === 'ArrowLeft' || event.code === 'ArrowRight') {
      rotate(targetYaw + (event.code === 'ArrowLeft' ? -1 : 1) * Math.PI / 4); event.preventDefault();
    }
    if (event.code === 'Home') { select(0); event.preventDefault(); }
  });
  const observer = new ResizeObserver(draw); observer.observe(canvas);
  new MutationObserver(sync).observe(home, { attributes: true, attributeFilter: ['hidden'] });
  document.addEventListener('visibilitychange', sync);
  motionButton.addEventListener('click', () => {
    enabled = !enabled; if (!enabled) yaw = targetYaw; motionLabel(); sync();
  });
  reduced.addEventListener('change', () => {
    if (reduced.matches) yaw = targetYaw; motionLabel(); sync();
  });
  canvas.addEventListener('webglcontextlost', event => {
    event.preventDefault(); contextLost = true; sync();
    status.textContent = '캐릭터 표시가 중단되었습니다. 그래픽 연결 복구를 기다리는 중입니다.';
  });
  canvas.addEventListener('webglcontextrestored', () => {
    contextLost = false; cssWidth = 0; cssHeight = 0;
    const restoredYaw = targetYaw;
    select(index); rotate(restoredYaw);
  });
  window.addEventListener('pagehide', () => { pageActive = false; cancelDrag(); sync(); });
  window.addEventListener('pageshow', () => { pageActive = true; sync(); });
  motionLabel();
  select(0);
  canvas.dataset.viewReady = 'true';
  return { cancelDrag };
}
