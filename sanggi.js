(() => {
  const main = document.querySelector('.sanggi-page main');
  const balance = document.querySelector('#sanggi-coin-balance');
  const storageKey = 'sanggi-coin-balance';
  const abilityStorageKey = 'sanggi-ability-levels';
  const characterPositionKey = 'sanggi-character-position';
  const companionPositionKey = 'sanggi-companion-position';
  const companionStateKey = 'sanggi-companion-state';
  const sessionKey = 'sangki-auth-session';
  const tabSessionKey = 'sangki-auth-session-tab';
  const keepLoginKey = 'sangki-keep-login';
  const rpcEndpoint = 'https://ejrwrwjsgizzxhqybtff.supabase.co/rest/v1/rpc';
  const rpcKey = 'sb_publishable_Mr64z4NO3wlqeKObCxLbBQ_HlhvG7D8';
  const maxBreathLevel = 3000;
  const maxAutoLevel = 50;
  const maxCompanionLevel = 3000;

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
  let remoteReady = false;
  let remoteSaveTimer = null;
  const character = document.querySelector('.sanggi-character');
  const companion = document.querySelector('#sanggi-companion');
  let companionUnlocked = false;
  let companionSummoned = false;
  let companionLevel = 1;
  let dragState = null;
  let companionDragState = null;
  try {
    const savedCompanion = JSON.parse(localStorage.getItem(companionStateKey) || '{}');
    companionUnlocked = savedCompanion.unlocked === true;
    companionSummoned = savedCompanion.summoned === true;
    companionLevel = Math.min(maxCompanionLevel, Math.max(1, Number(savedCompanion.level) || 1));
  } catch {
    companionUnlocked = false;
    companionSummoned = false;
    companionLevel = 1;
  }

  const formatCoins = (value) => value.toLocaleString('ko-KR');
  const companionBonus = () => companionUnlocked
    ? 100n + BigInt((companionLevel - 1) * 10)
    : 0n;
  const clickReward = () => 1n + BigInt((breathLevel - 1) * 10) + companionBonus();
  const autoReward = () => clickReward();
  const autoIntervalMs = () => Math.max(5000, 10000 - (autoLevel - 1) * 100);
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
    localStorage.setItem(companionStateKey, JSON.stringify({
      unlocked: companionUnlocked,
      summoned: companionSummoned,
      level: companionLevel
    }));
    if (remoteReady) scheduleRemoteSave();
  };

  const getSession = () => {
    try {
      const raw = localStorage.getItem(keepLoginKey) === 'true'
        ? localStorage.getItem(sessionKey)
        : sessionStorage.getItem(tabSessionKey);
      return JSON.parse(raw || 'null');
    } catch {
      return null;
    }
  };

  const remoteRpc = async (name, payload) => {
    const response = await fetch(`${rpcEndpoint}/${name}`, {
      method: 'POST',
      headers: {
        apikey: rpcKey,
        Authorization: 'Bearer ' + rpcKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || result.hint || '상기 키우기 정보를 저장하지 못했습니다.');
    return result;
  };

  const getLocalPosition = () => {
    try {
      const saved = JSON.parse(localStorage.getItem(characterPositionKey) || 'null');
      return {
        x: Number.isFinite(saved?.x) ? saved.x : 0.09,
        y: Number.isFinite(saved?.y) ? saved.y : 0.07
      };
    } catch {
      return { x: 0.09, y: 0.07 };
    }
  };

  const getLocalCompanionPosition = () => {
    try {
      const saved = JSON.parse(localStorage.getItem(companionPositionKey) || 'null');
      return {
        x: Number.isFinite(saved?.x) ? saved.x : 0.78,
        y: Number.isFinite(saved?.y) ? saved.y : 0.48
      };
    } catch {
      return { x: 0.78, y: 0.48 };
    }
  };

  const scheduleRemoteSave = () => {
    window.clearTimeout(remoteSaveTimer);
    remoteSaveTimer = window.setTimeout(async () => {
      const session = getSession();
      if (!session?.session_token) return;
      const position = getLocalPosition();
      const companionPosition = getLocalCompanionPosition();
      try {
        await remoteRpc('sanggi_save_state', {
          p_session_token: session.session_token,
          p_coins: coins.toString(),
          p_breath_level: breathLevel,
          p_auto_level: autoLevel,
          p_character_x: position.x,
          p_character_y: position.y,
          p_companion_unlocked: companionUnlocked,
          p_companion_summoned: companionSummoned,
          p_companion_level: companionLevel,
          p_companion_x: companionPosition.x,
          p_companion_y: companionPosition.y
        });
      } catch (error) {
        console.warn('Sanggi state save failed:', error.message);
      }
    }, 400);
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
      collectCoin(autoReward());
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
    target.closest('.sanggi-wallet, .sanggi-coin-display, .sanggi-coin-balance, .sanggi-home-button, .sanggi-refresh-button, .sanggi-action-bar, .sanggi-ability-modal, .sanggi-companion');

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
    const position = {
      x: Math.max(0, Math.min(1, (characterBounds.left - mainBounds.left) / maxX)),
      y: Math.max(0, Math.min(1, (characterBounds.top - mainBounds.top) / maxY))
    };
    localStorage.setItem(characterPositionKey, JSON.stringify(position));
    if (remoteReady) scheduleRemoteSave();
  };

  const loadCompanionPosition = () => {
    if (!companion) return;
    const saved = getLocalCompanionPosition();
    const mainBounds = main.getBoundingClientRect();
    const maxLeft = Math.max(0, mainBounds.width - companion.offsetWidth);
    const maxTop = Math.max(0, mainBounds.height - companion.offsetHeight);
    companion.style.left = `${Math.max(0, Math.min(1, saved.x)) * maxLeft}px`;
    companion.style.top = `${Math.max(0, Math.min(1, saved.y)) * maxTop}px`;
    companion.style.right = 'auto';
    companion.style.bottom = 'auto';
  };

  const saveCompanionPosition = () => {
    const mainBounds = main.getBoundingClientRect();
    const companionBounds = companion.getBoundingClientRect();
    const maxX = Math.max(1, mainBounds.width - companionBounds.width);
    const maxY = Math.max(1, mainBounds.height - companionBounds.height);
    localStorage.setItem(companionPositionKey, JSON.stringify({
      x: Math.max(0, Math.min(1, (companionBounds.left - mainBounds.left) / maxX)),
      y: Math.max(0, Math.min(1, (companionBounds.top - mainBounds.top) / maxY))
    }));
    if (remoteReady) scheduleRemoteSave();
  };

  const moveCompanion = (event) => {
    if (!companionDragState) return;
    companionDragState.clientX = event.clientX;
    companionDragState.clientY = event.clientY;
    if (companionDragState.frame) return;
    companionDragState.frame = window.requestAnimationFrame(() => {
      companionDragState.frame = 0;
      if (!companionDragState) return;
      const left = Math.max(0, Math.min(
        companionDragState.maxLeft,
        companionDragState.clientX - companionDragState.mainLeft - companionDragState.offsetX
      ));
      const top = Math.max(0, Math.min(
        companionDragState.maxTop,
        companionDragState.clientY - companionDragState.mainTop - companionDragState.offsetY
      ));
      companion.style.left = `${left}px`;
      companion.style.top = `${top}px`;
    });
  };

  const stopCompanionDrag = (event, cancelled = false) => {
    if (!companionDragState) return;
    if (companionDragState.frame) window.cancelAnimationFrame(companionDragState.frame);
    companionDragState.frame = 0;
    if (!cancelled && event) {
      companion.style.left = `${Math.max(0, Math.min(
        companionDragState.maxLeft,
        event.clientX - companionDragState.mainLeft - companionDragState.offsetX
      ))}px`;
      companion.style.top = `${Math.max(0, Math.min(
        companionDragState.maxTop,
        event.clientY - companionDragState.mainTop - companionDragState.offsetY
      ))}px`;
    }
    if (event?.pointerId !== undefined) companion.releasePointerCapture?.(event.pointerId);
    companionDragState = null;
    companion.classList.remove('is-dragging');
    saveCompanionPosition();
  };

  const syncAccountState = async () => {
    const session = getSession();
    if (!session?.session_token) return;
    const position = getLocalPosition();
    const state = await remoteRpc('sanggi_sync_state', {
      p_session_token: session.session_token,
      p_guest_coins: coins.toString(),
      p_guest_breath_level: breathLevel,
      p_guest_auto_level: autoLevel,
      p_guest_character_x: position.x,
      p_guest_character_y: position.y,
      p_guest_companion_unlocked: companionUnlocked,
      p_guest_companion_summoned: companionSummoned,
      p_guest_companion_level: companionLevel,
      p_guest_companion_x: getLocalCompanionPosition().x,
      p_guest_companion_y: getLocalCompanionPosition().y
    });
    coins = BigInt(String(state.coins || '0'));
    breathLevel = Math.min(maxBreathLevel, Math.max(1, Number(state.breath_level) || 1));
    autoLevel = Math.min(maxAutoLevel, Math.max(1, Number(state.auto_level) || 1));
    localStorage.setItem(storageKey, coins.toString());
    localStorage.setItem(abilityStorageKey, JSON.stringify({ breathLevel, autoLevel }));
    localStorage.setItem(characterPositionKey, JSON.stringify({
      x: Number(state.character_x),
      y: Number(state.character_y)
    }));
    companionUnlocked = state.companion_unlocked === true;
    companionSummoned = state.companion_summoned === true;
    companionLevel = Math.min(maxCompanionLevel, Math.max(1, Number(state.companion_level) || 1));
    localStorage.setItem(companionStateKey, JSON.stringify({
      unlocked: companionUnlocked,
      summoned: companionSummoned,
      level: companionLevel
    }));
    localStorage.setItem(companionPositionKey, JSON.stringify({
      x: Number.isFinite(Number(state.companion_x)) ? Number(state.companion_x) : 0.78,
      y: Number.isFinite(Number(state.companion_y)) ? Number(state.companion_y) : 0.48
    }));
  };

  const moveCharacter = (event) => {
    if (!dragState) return;
    dragState.clientX = event.clientX;
    dragState.clientY = event.clientY;
    if (dragState.frame) return;
    dragState.frame = window.requestAnimationFrame(() => {
      dragState.frame = 0;
      if (!dragState) return;
      const nextLeft = Math.max(0, Math.min(
        dragState.maxLeft,
        dragState.clientX - dragState.mainLeft - dragState.offsetX
      ));
      const nextTop = Math.max(0, Math.min(
        dragState.maxTop,
        dragState.clientY - dragState.mainTop - dragState.offsetY
      ));
      character.style.left = `${nextLeft}px`;
      character.style.top = `${nextTop}px`;
      dragState.moved = dragState.moved
        || Math.abs(nextLeft - dragState.startLeft) > 5
        || Math.abs(nextTop - dragState.startTop) > 5;
    });
  };

  const stopCharacterDrag = (event, cancelled = false) => {
    if (!dragState) return;
    if (dragState.frame) {
      window.cancelAnimationFrame(dragState.frame);
      dragState.frame = 0;
    }
    if (!cancelled && event) {
      const finalLeft = Math.max(0, Math.min(
        dragState.maxLeft,
        event.clientX - dragState.mainLeft - dragState.offsetX
      ));
      const finalTop = Math.max(0, Math.min(
        dragState.maxTop,
        event.clientY - dragState.mainTop - dragState.offsetY
      ));
      character.style.left = `${finalLeft}px`;
      character.style.top = `${finalTop}px`;
      dragState.moved = dragState.moved
        || Math.abs(finalLeft - dragState.startLeft) > 5
        || Math.abs(finalTop - dragState.startTop) > 5;
    }
    if (event?.pointerId !== undefined) character.releasePointerCapture?.(event.pointerId);
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

  const companionButton = document.querySelector('#sanggi-companion-button');
  const companionModal = document.querySelector('#sanggi-companion-modal');
  const companionBackdrop = document.querySelector('#sanggi-companion-backdrop');
  const companionAction = document.querySelector('#sanggi-companion-action');
  const companionStatus = document.querySelector('#sanggi-companion-status');
  const companionLevelPanel = document.querySelector('#sanggi-companion-level-panel');
  const companionLevelElement = document.querySelector('#sanggi-companion-level');
  const companionEffect = document.querySelector('#sanggi-companion-effect');
  const companionLevelEffect = document.querySelector('#sanggi-companion-level-effect');
  const companionUpgrade = document.querySelector('#sanggi-companion-upgrade');
  const companionUpgradeCost = () => companionLevel >= maxCompanionLevel ? null : upgradeCost(companionLevel);
  const renderCompanion = () => {
    companion.hidden = !companionSummoned;
    companionLevelPanel.hidden = !companionUnlocked;
    companionAction.textContent = companionUnlocked
      ? (companionSummoned ? '소환 해제' : '주성 소환')
      : '50,000원으로 잠금 해제';
    companionLevelElement.textContent = `LV ${companionLevel}`;
    companionEffect.textContent = `클릭·자동 +${formatCoins(companionBonus())}원`;
    companionLevelEffect.textContent = `클릭·자동 +${formatCoins(companionBonus())}원`;
    const cost = companionUpgradeCost();
    companionUpgrade.textContent = cost === null ? 'MAX' : `강화 · ${formatCoins(cost)}원`;
    companionUpgrade.disabled = cost === null;
  };
  const closeCompanion = () => {
    companionModal.hidden = true;
    companionBackdrop.hidden = true;
  };
  companionButton.addEventListener('click', () => {
    renderCompanion();
    companionModal.hidden = false;
    companionBackdrop.hidden = false;
  });
  document.querySelector('#sanggi-companion-close').addEventListener('click', closeCompanion);
  companionBackdrop.addEventListener('click', closeCompanion);
  companionAction.addEventListener('click', async () => {
    if (!companionUnlocked) {
      const cost = 50000n;
      if (coins < cost) {
        companionStatus.textContent = '코인이 부족합니다. 필요한 비용은 50,000원입니다.';
        return;
      }
      const session = getSession();
      try {
        if (session?.session_token) {
          const state = await remoteRpc('sanggi_unlock_companion', {
            p_session_token: session.session_token
          });
          coins = BigInt(String(state.coins || '0'));
          companionUnlocked = state.companion_unlocked === true;
          companionSummoned = state.companion_summoned === true;
        } else {
          coins -= cost;
          companionUnlocked = true;
          companionSummoned = true;
        }
        companionStatus.textContent = '주성의 잠금이 해제되고 소환되었습니다.';
      } catch (error) {
        companionStatus.textContent = error.message || '잠금 해제에 실패했습니다.';
        return;
      }
    } else {
      companionSummoned = !companionSummoned;
      companionStatus.textContent = companionSummoned ? '주성을 소환했습니다.' : '주성을 소환 해제했습니다.';
    }
    saveState();
    renderBalance();
    renderCompanion();
  });
  companionUpgrade.addEventListener('click', () => {
    const cost = companionUpgradeCost();
    if (cost === null) return;
    if (coins < cost) {
      companionStatus.textContent = `코인이 부족합니다. 필요한 비용: ${formatCoins(cost)}원`;
      return;
    }
    coins -= cost;
    companionLevel += 1;
    saveState();
    renderBalance();
    renderCompanion();
    companionStatus.textContent = `주성 레벨이 ${companionLevel}이 되었습니다.`;
  });

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
        mainLeft: mainBounds.left,
        mainTop: mainBounds.top,
        maxLeft: Math.max(0, mainBounds.width - character.offsetWidth),
        maxTop: Math.max(0, mainBounds.height - character.offsetHeight),
        startLeft: characterBounds.left - mainBounds.left,
        startTop: characterBounds.top - mainBounds.top,
        moved: false,
        clientX: event.clientX,
        clientY: event.clientY,
        frame: 0
      };
      character.classList.add('is-dragging');
      character.setPointerCapture?.(event.pointerId);
    });
    character.addEventListener('pointermove', moveCharacter);
    character.addEventListener('pointerup', stopCharacterDrag);
    character.addEventListener('pointercancel', (event) => {
      if (event.pointerType !== 'touch') stopCharacterDrag(null, true);
    });
    character.addEventListener('touchmove', (event) => {
      if (!dragState || !event.touches[0]) return;
      event.preventDefault();
      moveCharacter(event.touches[0]);
    }, { passive: false });
    character.addEventListener('touchend', (event) => {
      const touch = event.changedTouches[0];
      if (dragState && touch) stopCharacterDrag(touch);
    }, { passive: false });
    character.addEventListener('touchcancel', () => {
      if (dragState) stopCharacterDrag(null, true);
    });
      window.addEventListener('pointermove', (event) => {
        if (!dragState) return;
        event.preventDefault();
        moveCharacter(event);
      }, { passive: false });
      window.addEventListener('pointerup', (event) => {
        if (dragState) stopCharacterDrag(event);
      });
      window.addEventListener('pointercancel', (event) => {
        if (dragState && event.pointerType !== 'touch') stopCharacterDrag(null, true);
      });
      window.addEventListener('touchmove', (event) => {
        if (!dragState || !event.touches[0]) return;
        event.preventDefault();
        moveCharacter(event.touches[0]);
      }, { passive: false });
      window.addEventListener('touchend', (event) => {
        const touch = event.changedTouches[0];
        if (dragState && touch) stopCharacterDrag(touch);
      }, { passive: false });
      window.addEventListener('touchcancel', () => {
        if (dragState) stopCharacterDrag(null, true);
      });
    }

  if (companion) {
    renderCompanion();
    loadCompanionPosition();
    companion.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 && event.pointerType === 'mouse') return;
      event.preventDefault();
      event.stopPropagation();
      const bounds = companion.getBoundingClientRect();
      const mainBounds = main.getBoundingClientRect();
      companionDragState = {
        offsetX: event.clientX - bounds.left,
        offsetY: event.clientY - bounds.top,
        mainLeft: mainBounds.left,
        mainTop: mainBounds.top,
        maxLeft: Math.max(0, mainBounds.width - companion.offsetWidth),
        maxTop: Math.max(0, mainBounds.height - companion.offsetHeight),
        frame: 0
      };
      companion.classList.add('is-dragging');
      companion.setPointerCapture?.(event.pointerId);
    });
    companion.addEventListener('pointermove', moveCompanion);
    companion.addEventListener('pointerup', stopCompanionDrag);
    companion.addEventListener('pointercancel', () => stopCompanionDrag(null, true));
    window.addEventListener('pointermove', (event) => {
      if (!companionDragState) return;
      event.preventDefault();
      moveCompanion(event);
    }, { passive: false });
    window.addEventListener('pointerup', (event) => {
      if (companionDragState) stopCompanionDrag(event);
    });
    window.addEventListener('touchmove', (event) => {
      if (!companionDragState || !event.touches[0]) return;
      event.preventDefault();
      moveCompanion(event.touches[0]);
    }, { passive: false });
    window.addEventListener('touchend', (event) => {
      if (companionDragState && event.changedTouches[0]) stopCompanionDrag(event.changedTouches[0]);
    }, { passive: false });
    window.addEventListener('touchcancel', () => stopCompanionDrag(null, true));
  }

  main.addEventListener('pointerdown', (event) => {
    if (isInteractiveControl(event.target)) return;
    collectCoin(clickReward());
  });

  const initialize = async () => {
    try {
      await syncAccountState();
      remoteReady = Boolean(getSession()?.session_token);
    } catch (error) {
      console.warn('Sanggi account sync failed:', error.message);
    }
    loadCharacterPosition();
    renderCompanion();
    loadCompanionPosition();
    renderBalance();
    renderAbilities();
    scheduleAutoCoin();
  };
  initialize();
})();
