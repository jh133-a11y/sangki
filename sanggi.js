(() => {
  const main = document.querySelector('.sanggi-page main');
  const balance = document.querySelector('#sanggi-coin-balance');
  const storageKey = 'sanggi-coin-balance';

  if (!main || !balance) return;

  let coins = Number.parseInt(localStorage.getItem(storageKey) || '0', 10);
  if (!Number.isFinite(coins) || coins < 0) coins = 0;
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  let audioContext = null;

  const renderBalance = () => {
    balance.textContent = `${coins.toLocaleString('ko-KR')}원`;
  };

  const playCoinSound = () => {
    if (!AudioContextClass) return;

    if (!audioContext) audioContext = new AudioContextClass();
    if (audioContext.state === 'suspended') audioContext.resume();
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    const now = audioContext.currentTime;

    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(880, now);
    oscillator.frequency.exponentialRampToValueAtTime(1320, now + 0.08);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.2, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.16);
    oscillator.connect(gain);
    gain.connect(audioContext.destination);
    oscillator.start(now);
    oscillator.stop(now + 0.17);
  };

  const isInteractiveControl = (target) =>
    target.closest('.sanggi-wallet, .sanggi-coin-display, .sanggi-coin-balance, .sanggi-home-button, .sanggi-refresh-button, .sanggi-action-bar');

  main.addEventListener('pointerdown', (event) => {
    if (isInteractiveControl(event.target)) return;

    coins += 1;
    localStorage.setItem(storageKey, String(coins));
    renderBalance();
    playCoinSound();

    const popup = document.createElement('span');
    const bounds = main.getBoundingClientRect();
    const coinBalance = document.querySelector('.sanggi-coin-balance');
    const balanceBounds = coinBalance.getBoundingClientRect();
    popup.className = 'sanggi-coin-popup';
    popup.textContent = '+1원';
    popup.style.left = `${balanceBounds.right - bounds.left + 12}px`;
    popup.style.top = `${balanceBounds.top - bounds.top + balanceBounds.height / 2}px`;
    main.appendChild(popup);
    window.setTimeout(() => popup.remove(), 750);
  });

  renderBalance();
})();
