(() => {
  const audio = document.getElementById('sanggi-background-music');
  const button = document.getElementById('sanggi-music-button');
  const status = document.getElementById('sanggi-music-status');
  const preferenceKey = 'sanggi-background-music-enabled';
  let enabled = true;
  let starting = false;
  let failed = false;

  try {
    enabled = localStorage.getItem(preferenceKey) !== 'false';
  } catch (error) {
    console.warn('배경음악 설정을 불러올 수 없습니다.', error);
  }
  audio.volume = 0.25;

  function render() {
    button.setAttribute('aria-pressed', String(enabled));
    button.textContent = failed ? '배경음악 재시도' : enabled ? '배경음악 켜짐' : '배경음악 꺼짐';
  }

  function reportFailure(error) {
    failed = true;
    status.textContent = '음악을 재생할 수 없습니다. 재시도를 눌러 주세요.';
    console.error('상기 배경음악 재생 오류', error);
    render();
  }

  async function start() {
    if (!enabled || starting || failed || !audio.paused) return;
    starting = true;
    try {
      await audio.play();
      if (!enabled) audio.pause();
      status.textContent = '';
    } catch (error) {
      if (error.name === 'NotAllowedError') {
        status.textContent = '화면을 누르면 음악이 시작됩니다.';
      } else if (error.name !== 'AbortError' || enabled) {
        reportFailure(error);
      }
    } finally {
      starting = false;
    }
  }

  button.addEventListener('click', () => {
    if (failed) {
      failed = false;
      enabled = true;
      audio.load();
    } else {
      enabled = !enabled;
    }
    status.textContent = '';
    try {
      localStorage.setItem(preferenceKey, String(enabled));
    } catch (error) {
      console.warn('배경음악 설정을 저장할 수 없습니다.', error);
    }
    render();
    if (enabled) start();
    else audio.pause();
  });

  function unlock(event) {
    if (event.target instanceof Element && event.target.closest('#sanggi-music-button')) return;
    start();
  }
  document.addEventListener('pointerdown', unlock, true);
  document.addEventListener('click', unlock, true);
  document.addEventListener('keydown', unlock, true);
  audio.addEventListener('error', () => reportFailure(audio.error));
  window.addEventListener('pagehide', () => audio.pause());
  window.addEventListener('pageshow', () => start());
  render();
  start();
})();
