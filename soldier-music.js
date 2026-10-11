(() => {
  const lobbyAudio = document.getElementById('soldier-lobby-music');
  const rouletteAudio = document.getElementById('soldier-roulette-music');
  const roulette = document.getElementById('roulette-dialog');
  let audio = lobbyAudio;
  const home = document.getElementById('home');
  const menus = ['equipment-dialog', 'shop-dialog'].map(id => document.getElementById(id));
  const button = document.getElementById('soldier-music-toggle');
  const input = document.getElementById('soldier-music-volume');
  const output = document.getElementById('soldier-music-volume-label');
  const status = document.getElementById('soldier-music-status');
  const enabledKey = 'sanggi-soldier-music-enabled', volumeKey = 'sanggi-soldier-music-volume';
  let enabled = true, volume = 25, starting = false, failed = false, pageActive = true;
  try {
    enabled = localStorage.getItem(enabledKey) !== 'false';
    const saved = localStorage.getItem(volumeKey);
    if (saved !== null) {
      const parsed = Number(saved);
      if (saved.trim() && Number.isFinite(parsed) && parsed >= 0 && parsed <= 100) volume = Math.round(parsed);
      else console.warn('저장된 솔져 음악 음량이 올바르지 않습니다.', saved);
    }
  } catch (error) { console.warn('솔져 음악 설정을 읽지 못했습니다.', error); }
  function save(key, value) {
    try { localStorage.setItem(key, String(value)); }
    catch (error) {
      status.textContent = '음악 설정을 저장하지 못했습니다. 현재 화면에만 적용됩니다.';
      console.warn('솔져 음악 설정 저장 오류', error);
    }
  }
  const allowed = () => enabled && pageActive && (!home.hidden || menus.some(menu => menu.open));
  function applyVolume() {
    lobbyAudio.volume = rouletteAudio.volume = volume / 100; input.value = String(volume);
    output.textContent = `${volume}%`; input.setAttribute('aria-valuetext', `${volume}%`);
  }
  function render() {
    button.textContent = failed ? '음악 재시도' : enabled ? '음악 켜짐' : '음악 꺼짐';
    button.setAttribute('aria-pressed', String(enabled));
  }
  function reportFailure(error) {
    failed = true;
    status.textContent = '배경음악을 재생하지 못했습니다. 재시도를 눌러 주세요.';
    console.error('솔져 배경음악 오류', error); render();
  }
  async function start() {
    if (!allowed() || starting || failed || !audio.paused) return;
    starting = true;
    const target = audio;
    try {
      await target.play();
      if (!allowed() || target!==audio) target.pause();
      else status.textContent = '';
    } catch (error) {
      if (!allowed() && error.name === 'AbortError') return;
      if (error.name === 'NotAllowedError') {
        if (allowed()) status.textContent = '화면을 누르면 배경음악이 시작됩니다.';
      } else reportFailure(error);
    } finally { starting = false; if (target!==audio) sync(); }
  }
  function sync() {
    const target = roulette.open ? rouletteAudio : lobbyAudio;
    if (target!==audio) { audio.pause(); audio=target; }
    if (!allowed()) { lobbyAudio.pause();rouletteAudio.pause(); }
    else start();
  }
  button.addEventListener('click', () => {
    if (failed) { failed = false; enabled = true; audio.load(); }
    else enabled = !enabled;
    status.textContent = ''; render(); sync(); save(enabledKey, enabled);
  });
  input.addEventListener('input', () => {
    volume = Number(input.value); applyVolume(); save(volumeKey, volume);
  });
  function unlock(event) {
    if (event.target instanceof Element && event.target.closest('#soldier-music-toggle')) return;
    sync();
  }
  for (const type of ['pointerdown', 'click', 'keydown']) document.addEventListener(type, unlock, true);
  new MutationObserver(sync).observe(home, { attributes: true, attributeFilter: ['hidden'] });
  for (const menu of menus) new MutationObserver(sync).observe(menu, { attributes: true, attributeFilter: ['open'] });
  new MutationObserver(sync).observe(roulette, {attributes:true,attributeFilter:['open']});
  for (const track of [lobbyAudio,rouletteAudio]) track.addEventListener('error', () => reportFailure(track.error));
  window.addEventListener('pagehide', () => { pageActive = false; lobbyAudio.pause();rouletteAudio.pause(); });
  window.addEventListener('pageshow', () => { pageActive = true; sync(); });
  applyVolume(); render(); sync();
})();
