(() => {
  const main = document.querySelector('.sanggi-page main');
  const balance = document.querySelector('#sanggi-coin-balance');
  const storageKey = 'sanggi-coin-balance';

  if (!main || !balance) return;

  let coins = Number.parseInt(localStorage.getItem(storageKey) || '0', 10);
  if (!Number.isFinite(coins) || coins < 0) coins = 0;

  const renderBalance = () => {
    balance.textContent = `${coins.toLocaleString('ko-KR')}원`;
  };

  const playCoinSound = () => {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;

    const audioContext = new AudioContextClass();
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    const now = audioContext.currentTime;

    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(880, now);
    oscillator.frequency.exponentialRampToValueAtTime(1320, now + 0.08);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.12, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.16);
    oscillator.connect(gain);
    gain.connect(audioContext.destination);
    oscillator.start(now);
    oscillator.stop(now + 0.17);
    oscillator.addEventListener('ended', () => audioContext.close(), { once: true });
  };

  const isInteractiveControl = (target) =>
    target.closest('.sanggi-wallet, .sanggi-coin-display, .sanggi-coin-balance, .sanggi-home-button, .sanggi-refresh-button, .sanggi-action-bar');

  main.addEventListener('click', (event) => {
    if (isInteractiveControl(event.target)) return;

    coins += 1;
    localStorage.setItem(storageKey, String(coins));
    renderBalance();
    playCoinSound();
  });

  renderBalance();
})();
