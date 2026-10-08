(() => {
  const audio = document.getElementById('sanggi-background-music');
  const button = document.getElementById('sanggi-music-button');
  const status = document.getElementById('sanggi-music-status');
  const volumeInput = document.getElementById('sanggi-music-volume');
  const volumeLabel = document.getElementById('sanggi-music-volume-label');
  const preferenceKey = 'sanggi-background-music-enabled';
  const volumeKey = 'sanggi-background-music-volume';
  let volume = 25;
  let enabled = true;
  let starting = false;
  let failed = false;

  try {
    enabled = localStorage.getItem(preferenceKey) !== 'false';
    const savedVolume = localStorage.getItem(volumeKey);
    if (savedVolume !== null) {
      const parsedVolume = Number(savedVolume);
      if (savedVolume.trim() !== '' && Number.isFinite(parsedVolume) && parsedVolume >= 0 && parsedVolume <= 100) {
        volume = Math.round(parsedVolume);
      } else {
        console.warn('저장된 배경음악 음량이 올바르지 않습니다.', savedVolume);
      }
    }
  } catch (error) {
    console.warn('배경음악 설정을 불러올 수 없습니다.', error);
  }
  function applyVolume() {
    audio.volume = volume / 100;
    volumeInput.value = String(volume);
    volumeLabel.textContent = `${volume}%`;
    volumeInput.setAttribute('aria-valuetext', `${volume}%`);
  }
  applyVolume();

  volumeInput.addEventListener('input', () => {
    volume = Number(volumeInput.value);
    applyVolume();
    try {
      localStorage.setItem(volumeKey, String(volume));
    } catch (error) {
      console.warn('배경음악 음량을 저장할 수 없습니다.', error);
    }
  });

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
