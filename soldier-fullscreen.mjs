export function setupFullscreen(button, status, doc = document) {
  const root = doc.documentElement;
  const enter = root.requestFullscreen || root.webkitRequestFullscreen;
  const exit = doc.exitFullscreen || doc.webkitExitFullscreen;
  const supported = !!enter && !!exit
    && doc.fullscreenEnabled !== false && doc.webkitFullscreenEnabled !== false;
  button.disabled = !supported;
  let busy = false;
  const active = () => !!(doc.fullscreenElement || doc.webkitFullscreenElement);
  function update() {
    button.textContent = active() ? '⤢' : '⛶';
    button.setAttribute('aria-label', active() ? '전체화면 종료' : '전체화면');
    button.setAttribute('aria-pressed', String(active()));
    button.title = supported ? (active() ? '전체화면 종료' : '전체화면')
      : '이 브라우저는 전체화면 전환을 지원하지 않습니다.';
  }
  button.addEventListener('click', async () => {
    if (!supported || busy) return;
    busy = true; button.disabled = true;
    try {
      if (active()) await exit.call(doc);
      else await enter.call(root);
      status.textContent = '';
    } catch (error) {
      status.textContent = `전체화면 전환 실패: ${error.message}`;
      console.error('전체화면 전환 오류', error);
    } finally { busy = false; button.disabled = !supported; update(); }
  });
  doc.addEventListener('fullscreenchange', update);
  doc.addEventListener('webkitfullscreenchange', update);
  update();
}
