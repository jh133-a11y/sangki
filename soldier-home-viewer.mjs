import * as THREE from './vendor/three.module.min.js';
import { createHomeRig, loadRigTextures, idlePose } from './soldier-home-rig.mjs?v=1';

export { idlePose };

export async function createHomeViewer(canvas, status, buttons, motionButton) {
  const textures = await loadRigTextures();
  const rig = createHomeRig(textures);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setClearColor(0, 0); renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-.5, .5, .5, -.5, .01, 10);
  camera.position.set(0, 0, 3);
  scene.add(rig.root); rig.root.position.y = .5;
  const home = canvas.closest('#home'), reduced = matchMedia('(prefers-reduced-motion: reduce)');
  let yaw = 0, targetYaw = 0, seconds = 0, last = null, request = null, drag = null;
  let enabled = true, pageActive = true, contextLost = false, cssWidth = 0, cssHeight = 0;
  const visible = () => !home.hidden && !document.hidden && pageActive && !contextLost;
  const turning = () => Math.abs(targetYaw - yaw) > .0001;
  const idle = () => enabled && !reduced.matches && !drag;
  const active = () => visible() && (idle() || turning());
  function labels() {
    motionButton.textContent = reduced.matches ? '동작 줄임' : enabled ? '모션 켜짐' : '모션 꺼짐';
    motionButton.disabled = reduced.matches;
    motionButton.setAttribute('aria-pressed', String(enabled && !reduced.matches));
    status.textContent = '관절형 이미지 질감 3D · 드래그/방향키 회전 · 자동 호흡·몸풀기';
  }
  function draw() {
    canvas.dataset.motion = visible() && turning() ? 'turn' : visible() && idle() ? idlePose(seconds).stretch > .001 ? 'stretch' : 'breathe' : 'still';
    canvas.dataset.yaw = yaw.toFixed(5);
    canvas.dataset.seconds = seconds.toFixed(3);
    canvas.dataset.rig = 'articulated';
    if (contextLost) return;
    const { width, height } = canvas.getBoundingClientRect();
    if (!width || !height) return;
    if (cssWidth !== width || cssHeight !== height) {
      renderer.setSize(width, height, false); cssWidth = width; cssHeight = height;
    }
    const viewHeight = Math.max(1.1, .78 * height / width);
    camera.top = viewHeight / 2; camera.bottom = -viewHeight / 2;
    camera.left = -viewHeight * width / height / 2; camera.right = -camera.left;
    camera.updateProjectionMatrix();
    rig.setYaw(yaw);
    rig.animate(reduced.matches ? 0 : seconds);
    renderer.render(scene, camera);
  }
  function frame(time) {
    request = null;
    if (!active()) { last = null; return; }
    const dt = last === null ? 0 : Math.min(.1, (time - last) / 1000);
    last = time;
    if (idle()) seconds += dt;
    if (turning()) {
      yaw += (targetYaw - yaw) * (1 - Math.exp(-dt * 12));
      if (Math.abs(targetYaw - yaw) < .0001) yaw = targetYaw;
    }
    draw(); request = requestAnimationFrame(frame);
  }
  function sync() {
    if (request !== null) cancelAnimationFrame(request);
    request = null; last = null;
    draw(); if (active()) request = requestAnimationFrame(frame);
  }
  function rotate(nextYaw) {
    targetYaw = nextYaw;
    if (reduced.matches || !enabled) yaw = targetYaw;
    canvas.dataset.view = '0'; sync();
  }
  function select(index) {
    canvas.dataset.view = String(index);
    buttons.forEach((button, i) => button.setAttribute('aria-pressed', String(i === index)));
    if (index === 1) {
      seconds = 13; enabled = true; labels();
    } else {
      const desired = index === 2 ? Math.PI : 0;
      targetYaw = desired + Math.round((yaw - desired) / (Math.PI * 2)) * Math.PI * 2;
      if (reduced.matches || !enabled) yaw = targetYaw;
    }
    sync();
  }
  buttons.forEach((button, i) => button.addEventListener('click', () => select(i)));
  canvas.setAttribute('aria-label', 'Black Water 관절형 3D 캐릭터. 드래그·좌우 방향키로 회전, Home 키로 정면.');
  canvas.addEventListener('pointerdown', event => {
    if (event.button !== 0 || drag) return;
    drag = { id: event.pointerId, x: event.clientX };
    canvas.setPointerCapture(event.pointerId); canvas.focus({ preventScroll: true });
    event.preventDefault(); sync();
  });
  canvas.addEventListener('pointermove', event => {
    if (drag?.id !== event.pointerId) return;
    rotate(targetYaw + (event.clientX - drag.x) * .006); drag.x = event.clientX;
  });
  function cancelDrag() {
    const previous = drag; drag = null;
    if (previous && canvas.hasPointerCapture(previous.id)) canvas.releasePointerCapture(previous.id);
    sync();
  }
  for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    canvas.addEventListener(name, event => { if (drag?.id === event.pointerId) cancelDrag(); });
  }
  window.addEventListener('blur', cancelDrag);
  canvas.addEventListener('keydown', event => {
    if (event.code === 'ArrowLeft' || event.code === 'ArrowRight') {
      rotate(targetYaw + (event.code === 'ArrowLeft' ? -1 : 1) * Math.PI / 4); event.preventDefault();
    }
    if (event.code === 'Home') { select(0); event.preventDefault(); }
  });
  new ResizeObserver(draw).observe(canvas);
  new MutationObserver(sync).observe(home, { attributes: true, attributeFilter: ['hidden'] });
  document.addEventListener('visibilitychange', sync);
  motionButton.addEventListener('click', () => {
    enabled = !enabled; if (!enabled) yaw = targetYaw; labels(); sync();
  });
  reduced.addEventListener('change', () => {
    if (reduced.matches) yaw = targetYaw; labels(); sync();
  });
  canvas.addEventListener('webglcontextlost', event => {
    event.preventDefault(); contextLost = true; sync();
    status.textContent = '캐릭터 표시가 중단되었습니다. 그래픽 연결 복구를 기다리는 중입니다.';
  });
  canvas.addEventListener('webglcontextrestored', () => {
    contextLost = false; cssWidth = 0; cssHeight = 0; labels(); sync();
  });
  window.addEventListener('pagehide', () => { pageActive = false; cancelDrag(); });
  window.addEventListener('pageshow', () => { pageActive = true; sync(); });
  labels(); select(0); canvas.dataset.viewReady = 'true';
  return { cancelDrag };
}
