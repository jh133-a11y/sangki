import * as THREE from './vendor/three.module.min.js';
import { loadHomeRig, idlePose } from './soldier-home-rig.mjs?v=4';

export { idlePose };

export async function createHomeViewer(canvas, status) {
  status.textContent = '제공된 3D 모델을 불러오는 중입니다 (약 65 MB)…';
  const rig = await loadHomeRig();
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setClearColor(0, 0); renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-.5, .5, .5, -.5, .01, 10);
  camera.position.set(0, 0, 3);
  scene.add(rig.root); rig.root.position.y = -.5;
  scene.add(new THREE.HemisphereLight(0xffffff, 0x777d86, 2));
  const light = new THREE.DirectionalLight(0xfff5e8, 2.2);
  light.position.set(-2, 3, 4); scene.add(light);
  const home = canvas.closest('#home'), reduced = matchMedia('(prefers-reduced-motion: reduce)');
  let yaw = 0, targetYaw = 0, seconds = 0, last = null, request = null, drag = null;
  let pageActive = true, contextLost = false, cssWidth = 0, cssHeight = 0;
  const visible = () => !home.hidden && !document.hidden && pageActive && !contextLost;
  const turning = () => Math.abs(targetYaw - yaw) > .0001;
  const idle = () => !reduced.matches && !drag;
  const active = () => visible() && (idle() || turning());
  function labels() {
    status.textContent = '제공된 3D 모델 · 드래그/방향키 회전 · 자동 호흡·몸풀기';
  }
  function draw() {
    canvas.dataset.motion = visible() && turning() ? 'turn' : visible() && idle() ? idlePose(seconds).stretch > .001 ? 'stretch' : 'breathe' : 'still';
    canvas.dataset.yaw = yaw.toFixed(5);
    canvas.dataset.seconds = seconds.toFixed(3);
    canvas.dataset.rig = 'articulated';
    canvas.dataset.model = 'supplied-glb';
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
    const dt = last === null ? 0 : Math.max(0, (time - last) / 1000);
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
    if (reduced.matches) yaw = targetYaw;
    canvas.dataset.view = '0'; sync();
  }
  canvas.setAttribute('aria-label', '제공된 3D 캐릭터. 드래그·좌우 방향키로 회전, Home 키로 정면.');
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
    if (event.code === 'Home') {
      rotate(Math.round(yaw / (Math.PI * 2)) * Math.PI * 2); event.preventDefault();
    }
  });
  new ResizeObserver(draw).observe(canvas);
  new MutationObserver(sync).observe(home, { attributes: true, attributeFilter: ['hidden'] });
  document.addEventListener('visibilitychange', sync);
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
  canvas.dataset.view = '0';
  labels(); sync(); canvas.dataset.viewReady = 'true';
  return { cancelDrag };
}
