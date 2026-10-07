(() => {
  const main = document.querySelector('.sanggi-page main');
  const balance = document.querySelector('#sanggi-coin-balance');
  const storageKey = 'sanggi-coin-balance';
  const abilityStorageKey = 'sanggi-ability-levels';
  const characterPositionKey = 'sanggi-character-position';
  const maxBreathLevel = 3000;
  const maxAutoLevel = 50;

  if (!main || !balance) return;

  let coins = BigInt(localStorage.getItem(storageKey) || '0');
  if (coins < 0n) coins = 0n;
  let abilities;
  try {
    abilities = JSON.parse(localStorage.getItem(abilityStorageKey) || '{}');
  } catch {
    abilities = {};
  }
  let breathLevel = Math.min(maxBreathLevel, Math.max(1, Number(abilities.breathLevel) || 1));
  let autoLevel = Math.min(maxAutoLevel, Math.max(1, Number(abilities.autoLevel) || 1));
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  let audioContext = null;
  let autoTimer = null;
  const character = document.querySelector('.sanggi-character');
  let dragState = null;

  const formatCoins = (value) => value.toLocaleString('ko-KR');
  const clickReward = () => 1n + BigInt((breathLevel - 1) * 10);
  const autoReward = () => 1n;
  const autoIntervalMs = () => Math.max(100, 10000 - (autoLevel - 1) * 100);
  const upgradeCost = (level) => {
    const exponent = Math.min(10, level) + Math.floor(Math.max(0, level - 11) / 10);
    return 2n ** BigInt(exponent);
  };

  const renderBalance = () => {
    balance.textContent = `${formatCoins(coins)}원`;
  };

  const saveState = () => {
    localStorage.setItem(storageKey, coins.toString());
    localStorage.setItem(abilityStorageKey, JSON.stringify({ breathLevel, autoLevel }));
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

  const showCoinPopup = (amount) => {
    const popup = document.createElement('span');
    const bounds = main.getBoundingClientRect();
    const coinBalance = document.querySelector('.sanggi-coin-balance');
    const balanceBounds = coinBalance.getBoundingClientRect();
    popup.className = 'sanggi-coin-popup';
    popup.textContent = `+${formatCoins(amount)}원`;
    popup.style.left = `${balanceBounds.right - bounds.left + 18}px`;
    popup.style.top = `${balanceBounds.top - bounds.top + balanceBounds.height / 2}px`;
    main.appendChild(popup);
    window.setTimeout(() => popup.remove(), 750);
  };

  const collectCoin = (amount, showFeedback = true) => {
    coins += amount;
    saveState();
    renderBalance();
    if (showFeedback) {
      playCoinSound();
      showCoinPopup(amount);
    }
  };

  const renderAbilities = () => {
    const breathCost = breathLevel >= maxBreathLevel ? null : upgradeCost(breathLevel);
    const autoCost = autoLevel >= maxAutoLevel ? null : upgradeCost(autoLevel);
    document.querySelector('#sanggi-breath-level').textContent = `LV ${breathLevel}`;
    document.querySelector('#sanggi-auto-level').textContent = `LV ${autoLevel}`;
    document.querySelector('#sanggi-breath-effect').textContent = `클릭당 ${formatCoins(clickReward())}원`;
    document.querySelector('#sanggi-auto-effect').textContent = `${(autoIntervalMs() / 1000).toFixed(1)}초마다 ${formatCoins(autoReward())}원`;
    document.querySelector('#sanggi-breath-upgrade').textContent = breathCost === null ? 'MAX' : `강화 · ${formatCoins(breathCost)}원`;
    document.querySelector('#sanggi-auto-upgrade').textContent = autoCost === null ? 'MAX' : `강화 · ${formatCoins(autoCost)}원`;
    document.querySelector('#sanggi-breath-upgrade').disabled = breathCost === null;
    document.querySelector('#sanggi-auto-upgrade').disabled = autoCost === null;
  };

  const scheduleAutoCoin = () => {
    window.clearTimeout(autoTimer);
    autoTimer = window.setTimeout(() => {
      collectCoin(autoReward(), false);
      scheduleAutoCoin();
    }, autoIntervalMs());
  };

  const upgrade = (type) => {
    const level = type === 'breath' ? breathLevel : autoLevel;
    const levelLimit = type === 'breath' ? maxBreathLevel : maxAutoLevel;
    if (level >= levelLimit) return;
    const cost = upgradeCost(level);
    if (coins < cost) {
      document.querySelector('#sanggi-ability-status').textContent = `코인이 부족합니다. 필요한 비용: ${formatCoins(cost)}원`;
      return;
    }
    coins -= cost;
    if (type === 'breath') breathLevel += 1;
    else autoLevel += 1;
    saveState();
    renderBalance();
    renderAbilities();
    scheduleAutoCoin();
    document.querySelector('#sanggi-ability-status').textContent = `${type === 'breath' ? '입냄새' : '폐급 레벨'}이 강화되었습니다.`;
  };

  const isInteractiveControl = (target) =>
    target.closest('.sanggi-wallet, .sanggi-coin-display, .sanggi-coin-balance, .sanggi-home-button, .sanggi-refresh-button, .sanggi-action-bar, .sanggi-ability-modal');

  const loadCharacterPosition = () => {
    if (!character) return;
    try {
      const saved = JSON.parse(localStorage.getItem(characterPositionKey) || 'null');
      if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) {
        const mainBounds = main.getBoundingClientRect();
        const maxLeft = Math.max(0, mainBounds.width - character.offsetWidth);
        const maxTop = Math.max(0, mainBounds.height - character.offsetHeight);
        character.style.left = `${Math.max(0, Math.min(1, saved.x)) * maxLeft}px`;
        character.style.top = `${Math.max(0, Math.min(1, saved.y)) * maxTop}px`;
      }
    } catch {
      // Ignore invalid position data and use the default CSS position.
    }
  };

  const saveCharacterPosition = () => {
    const mainBounds = main.getBoundingClientRect();
    const characterBounds = character.getBoundingClientRect();
    const maxX = Math.max(1, mainBounds.width - characterBounds.width);
    const maxY = Math.max(1, mainBounds.height - characterBounds.height);
    localStorage.setItem(characterPositionKey, JSON.stringify({
      x: Math.max(0, Math.min(1, (characterBounds.left - mainBounds.left) / maxX)),
      y: Math.max(0, Math.min(1, (characterBounds.top - mainBounds.top) / maxY))
    }));
  };

  const moveCharacter = (event) => {
    if (!dragState) return;
    const mainBounds = main.getBoundingClientRect();
    const characterWidth = character.offsetWidth;
    const characterHeight = character.offsetHeight;
    const maxLeft = Math.max(0, mainBounds.width - characterWidth);
    const maxTop = Math.max(0, mainBounds.height - characterHeight);
    const nextLeft = Math.max(0, Math.min(maxLeft, event.clientX - mainBounds.left - dragState.offsetX));
    const nextTop = Math.max(0, Math.min(maxTop, event.clientY - mainBounds.top - dragState.offsetY));
    character.style.left = `${nextLeft}px`;
    character.style.top = `${nextTop}px`;
    dragState.moved = dragState.moved || Math.abs(nextLeft - dragState.startLeft) > 5 || Math.abs(nextTop - dragState.startTop) > 5;
  };

  const stopCharacterDrag = (event) => {
    if (!dragState) return;
    character.releasePointerCapture?.(event.pointerId);
    const wasMoved = dragState.moved;
    dragState = null;
    character.classList.remove('is-dragging');
    saveCharacterPosition();
    if (!wasMoved) collectCoin(clickReward());
  };

  const abilityButton = document.querySelector('#sanggi-ability-button');
  const abilityModal = document.querySelector('#sanggi-ability-modal');
  const abilityBackdrop = document.querySelector('#sanggi-ability-backdrop');
  const closeAbility = () => {
    abilityModal.hidden = true;
    abilityBackdrop.hidden = true;
  };
  abilityButton.addEventListener('click', () => {
    renderAbilities();
    abilityModal.hidden = false;
    abilityBackdrop.hidden = false;
  });
  document.querySelector('#sanggi-ability-close').addEventListener('click', closeAbility);
  abilityBackdrop.addEventListener('click', closeAbility);
  document.querySelector('#sanggi-breath-upgrade').addEventListener('click', () => upgrade('breath'));
  document.querySelector('#sanggi-auto-upgrade').addEventListener('click', () => upgrade('auto'));

  if (character) {
    loadCharacterPosition();
    character.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 && event.pointerType === 'mouse') return;
      event.preventDefault();
      event.stopPropagation();
      const characterBounds = character.getBoundingClientRect();
      const mainBounds = main.getBoundingClientRect();
      dragState = {
        offsetX: event.clientX - characterBounds.left,
        offsetY: event.clientY - characterBounds.top,
        startLeft: characterBounds.left - mainBounds.left,
        startTop: characterBounds.top - mainBounds.top,
        moved: false
      };
      character.classList.add('is-dragging');
      character.setPointerCapture?.(event.pointerId);
    });
    character.addEventListener('pointermove', moveCharacter);
    character.addEventListener('pointerup', stopCharacterDrag);
    character.addEventListener('pointercancel', stopCharacterDrag);
  }

  main.addEventListener('pointerdown', (event) => {
    if (isInteractiveControl(event.target)) return;
    collectCoin(clickReward());
  });

  renderBalance();
  renderAbilities();
  scheduleAutoCoin();
})();
