export const CHARACTER_VIEWS = [
  { name: '정면', src: 'soldier-view-front.png' },
  { name: '측후면', src: 'soldier-view-side.png' },
  { name: '뒷면', src: 'soldier-view-back.png' }
];

export function viewIndex(angle) {
  const count = CHARACTER_VIEWS.length;
  return ((Math.round(angle / (Math.PI * 2 / count)) % count) + count) % count;
}

export async function createHomeViewer(canvas, status, buttons) {
  const context = canvas.getContext('2d');
  if (!context) throw new Error('캐릭터 사진 화면을 시작할 수 없습니다.');
  const images = await Promise.all(CHARACTER_VIEWS.map(async view => {
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
    return { image, left, top, width: right - left + 1, height: bottom - top + 1 };
  }));
  let angle = 0, index = 0, drag = null;
  function draw() {
    const { width, height } = canvas.getBoundingClientRect();
    if (!width || !height) return;
    const ratio = Math.min(devicePixelRatio, 2);
    canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width, height);
    context.imageSmoothingEnabled = true; context.imageSmoothingQuality = 'high';
    const source = images[index], scale = Math.min(width / source.width, height / source.height) * .96;
    const w = source.width * scale, h = source.height * scale;
    context.drawImage(source.image, source.left, source.top, source.width, source.height, (width - w) / 2, height - h, w, h);
  }
  function select(nextAngle) {
    angle = nextAngle % (Math.PI * 2);
    index = viewIndex(angle);
    canvas.dataset.view = String(index);
    canvas.setAttribute('aria-label', `Black Water 고화질 원본 사진: ${CHARACTER_VIEWS[index].name}. 드래그 또는 좌우 방향키로 보기 전환, Home 키로 정면.`);
    status.textContent = `${CHARACTER_VIEWS[index].name} · 드래그/방향키로 사진 전환 (연속 3D 회전 아님)`;
    buttons.forEach((button, i) => button.setAttribute('aria-pressed', String(i === index)));
    draw();
  }
  const step = Math.PI * 2 / CHARACTER_VIEWS.length;
  buttons.forEach((button, i) => button.addEventListener('click', () => select(i * step)));
  canvas.addEventListener('pointerdown', event => {
    if (event.button !== 0 || drag) return;
    drag = { id: event.pointerId, x: event.clientX };
    canvas.setPointerCapture(event.pointerId); canvas.focus({ preventScroll: true }); event.preventDefault();
  });
  canvas.addEventListener('pointermove', event => {
    if (drag?.id !== event.pointerId) return;
    select(angle + (event.clientX - drag.x) * .012); drag.x = event.clientX;
  });
  function cancelDrag() {
    const active = drag; drag = null;
    if (active && canvas.hasPointerCapture(active.id)) canvas.releasePointerCapture(active.id);
  }
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    canvas.addEventListener(type, event => { if (drag?.id === event.pointerId) cancelDrag(); });
  }
  window.addEventListener('blur', cancelDrag);
  canvas.addEventListener('keydown', event => {
    if (event.code === 'ArrowLeft' || event.code === 'ArrowRight') {
      select((index + (event.code === 'ArrowLeft' ? -1 : 1)) * step); event.preventDefault();
    }
    if (event.code === 'Home') { select(0); event.preventDefault(); }
  });
  const observer = new ResizeObserver(draw); observer.observe(canvas);
  select(0);
  canvas.dataset.viewReady = 'true';
  return { cancelDrag };
}
