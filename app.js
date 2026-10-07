const SUPABASE_URL = 'https://ejrwrwjsgizzxhqybtff.supabase.co';
const SUPABASE_KEY = 'sb_publishable_Mr64z4NO3wlqeKObCxLbBQ_HlhvG7D8';
const commentsEndpoint = `${SUPABASE_URL}/rest/v1/comments`;
const rpcEndpoint = `${SUPABASE_URL}/rest/v1/rpc`;
const scoresEndpoint = `${SUPABASE_URL}/rest/v1/speed_game_scores`;
const investmentClientKey = 'sangki-investment-client-id';
const legacyInvestmentClientKey = 'sangki-legacy-investment-client-id';
const apiHeaders = {
  apikey: SUPABASE_KEY,
  Authorization: `Bearer ${SUPABASE_KEY}`
};

const updateOnlinePresence = async () => {
  if (!accountSession?.session_token) {
    onlineUsersList.replaceChildren(Object.assign(document.createElement('li'), {
      textContent: '로그인 후 표시됩니다.'
    }));
    return;
  }
  try {
    await callInvestmentRpc('site_account_presence_heartbeat', {
      p_session_token: accountSession.session_token
    });
  } catch (error) {
    console.warn('presence heartbeat failed:', error.message);
  }
};

const loadOnlineUsers = async () => {
  try {
    const users = await callInvestmentRpc('site_account_online_users', {});
    onlineUsersList.replaceChildren(...(users.length
      ? users.map((user) => {
        const item = document.createElement('li');
        item.classList.toggle('is-offline', !user.is_online);
        item.textContent = user.nickname || user.username || '닉네임 없음';
        return item;
      })
      : [Object.assign(document.createElement('li'), {
        textContent: '현재 접속 중인 로그인 유저가 없습니다.'
      })]));
  } catch (error) {
    onlineUsersList.replaceChildren(Object.assign(document.createElement('li'), {
      textContent: error.message
    }));
  }
};

const accountStorageKey = 'sangki-auth-session';
const accountSessionStorageKey = 'sangki-auth-session-tab';
const rememberedUsernameKey = 'sangki-remembered-username';
const keepLoginKey = 'sangki-keep-login';
const sanggiLocalStateKeys = [
  'sanggi-coin-balance',
  'sanggi-ability-levels',
  'sanggi-character-position',
  'sanggi-companion-position',
  'sanggi-companion-state',
  'sanggi-player-level',
  'sanggi-normal-potions',
  'sanggi-advanced-potions',
  'sanggi-legendary-potions'
];
const clearSanggiLocalState = () => {
  sanggiLocalStateKeys.forEach((key) => localStorage.removeItem(key));
};
let accountMode = 'login';
let accountSession = null;
let siteStateSaveTimer = null;
const siteStateStorageKeys = {
  notifications: 'sangki-notifications-enabled',
  watchedComments: 'sangki-watched-comments',
  commentVoter: 'sangki-comment-voter-key'
};
const callSiteStateRpc = async (name, payload) => {
  const response = await fetch(`${rpcEndpoint}/${name}`, {
    method: 'POST',
    headers: { ...apiHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.message || result.hint || '계정 상태를 저장하지 못했습니다.');
  return result;
};
const getSiteStateSnapshot = () => ({
  notifications_enabled: localStorage.getItem(siteStateStorageKeys.notifications) !== 'false',
  watched_comments: getWatchedComments(),
  comment_voter_key: localStorage.getItem(siteStateStorageKeys.commentVoter) || null
});
const saveSiteAccountState = async () => {
  if (!accountSession?.session_token) return;
  await callSiteStateRpc('site_save_account_state', {
    p_session_token: accountSession.session_token,
    p_state: getSiteStateSnapshot()
  });
};
const scheduleSiteAccountStateSave = () => {
  if (!accountSession?.session_token) return;
  window.clearTimeout(siteStateSaveTimer);
  siteStateSaveTimer = window.setTimeout(() => {
    saveSiteAccountState().catch((error) => {
      console.warn('account site state save failed:', error.message);
    });
  }, 400);
};
const loadSiteAccountState = async () => {
  if (!accountSession?.session_token) return;
  const state = await callSiteStateRpc('site_get_account_state', {
    p_session_token: accountSession.session_token
  });
  if (typeof state.notifications_enabled === 'boolean') {
    localStorage.setItem(
      siteStateStorageKeys.notifications,
      String(state.notifications_enabled)
    );
  }
  if (Array.isArray(state.watched_comments)) {
    localStorage.setItem(
      siteStateStorageKeys.watchedComments,
      JSON.stringify(state.watched_comments.filter((id) => typeof id === 'string'))
    );
  }
  if (typeof state.comment_voter_key === 'string' && state.comment_voter_key.length >= 16) {
    localStorage.setItem(siteStateStorageKeys.commentVoter, state.comment_voter_key);
    commentVoterKey = state.comment_voter_key;
  }
};
const accountButton = document.querySelector('#account-button');
const accountModal = document.querySelector('#account-modal');
const accountBackdrop = document.querySelector('#account-backdrop');
const accountClose = document.querySelector('#account-close');
const accountForm = document.querySelector('#account-form');
const accountUsername = document.querySelector('#account-username');
const accountPassword = document.querySelector('#account-password');
const accountSubmit = document.querySelector('#account-submit');
const accountSwitch = document.querySelector('#account-switch');
const accountStatus = document.querySelector('#account-status');
const rememberUsername = document.querySelector('#remember-username');
const keepLogin = document.querySelector('#keep-login');
const settingsOpen = document.querySelector('#settings-open');
const settingsModal = document.querySelector('#settings-modal');
const settingsBackdrop = document.querySelector('#settings-backdrop');
const settingsClose = document.querySelector('#settings-close');
const settingsLogout = document.querySelector('#settings-logout');
const settingsDeleteAccount = document.querySelector('#settings-delete-account');
const settingsAccountStatus = document.querySelector('#settings-account-status');
const settingsStatus = document.querySelector('#settings-status');
const onlineUsersList = document.querySelector('#online-users-list');

const updateAccountButton = () => {
  if (!accountSession?.username) {
    accountButton.textContent = '로그인';
    return;
  }
  const username = document.createElement('span');
  username.className = 'account-name';
  username.textContent = accountSession.username;
  const logout = document.createElement('span');
  logout.className = 'account-logout';
  logout.textContent = '로그아웃';
  accountButton.replaceChildren(username, logout);
};
const clearInvestmentView = () => {
  if (accountSession?.account_id && investorNickname.value.trim()) {
    localStorage.setItem(
      `sangki-account-nickname-${accountSession.account_id}`,
      investorNickname.value.trim()
    );
  }
  investmentState = null;
  localStorage.removeItem(investmentClientKey);
  localStorage.removeItem('sangki-investor-nickname');
  investorForm.reset();
  investorNickname.disabled = false;
  investorForm.querySelector('button').disabled = false;
  portfolioSummary.hidden = true;
  investmentHoldings.hidden = true;
  investmentProducts.replaceChildren();
  holdingsList.replaceChildren();
  investmentRankingList.replaceChildren();
  investmentRankingPagination.replaceChildren();
};
const closeAccountModal = () => {
  accountModal.hidden = true;
  accountBackdrop.hidden = true;
};
const authenticateAccount = async (username, password) => {
  const normalizedUsername = username.trim().toLowerCase();
  if (!/^[a-z0-9_]{3,24}$/.test(normalizedUsername)) {
    throw new Error('아이디는 영문 소문자, 숫자, 밑줄(_)만 사용해 3~24자로 입력하세요.');
  }
  const rpcName = accountMode === 'signup' ? 'site_account_signup' : 'site_account_login';
  const response = await fetch(`${rpcEndpoint}/${rpcName}`, {
    method: 'POST',
    headers: { ...apiHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_username: normalizedUsername, p_password: password })
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.message || result.hint || '계정 요청에 실패했습니다.');
  const currentClientId = localStorage.getItem(investmentClientKey);
  const storedGuestClientId = localStorage.getItem(legacyInvestmentClientKey);
  const currentGuestClientId = currentClientId && currentClientId !== result.account_id
    ? currentClientId
    : null;
  const previousClientId = currentGuestClientId || storedGuestClientId;
  if (currentGuestClientId) {
    localStorage.setItem(legacyInvestmentClientKey, currentGuestClientId);
  }
  const previousNickname = localStorage.getItem('sangki-investor-nickname');
  const oldClientId = previousClientId && previousClientId !== result.account_id
    ? previousClientId
    : null;
  accountSession = result;
  window.dispatchEvent(new CustomEvent('sanggi-account-changed'));
  if (rememberUsername.checked) {
    localStorage.setItem(rememberedUsernameKey, normalizedUsername);
  } else {
    localStorage.removeItem(rememberedUsernameKey);
  }
  if (keepLogin.checked) {
    localStorage.setItem(keepLoginKey, 'true');
  } else {
    localStorage.removeItem(keepLoginKey);
  }
  localStorage.setItem(accountStorageKey, JSON.stringify(result));
  sessionStorage.setItem(accountSessionStorageKey, JSON.stringify(result));
  const linkResponse = await fetch(`${rpcEndpoint}/investment_link_account`, {
    method: 'POST',
    headers: { ...apiHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      p_session_token: accountSession.session_token,
      p_old_client_id: oldClientId
    })
  });
  if (!linkResponse.ok) {
    let detail = '';
    try {
      const linkError = await linkResponse.json();
      detail = linkError.message || linkError.details || linkError.hint || '';
    } catch {
      detail = '';
    }
    console.error('investment_link_account failed:', detail || linkResponse.status);
    accountSession.linkError = detail || `연결 요청 실패 (${linkResponse.status})`;
  }
  if (linkResponse.ok) {
    if (previousNickname) {
      localStorage.setItem(
        `sangki-account-nickname-${accountSession.account_id}`,
        previousNickname
      );
    }
    localStorage.setItem(investmentClientKey, accountSession.account_id);
    localStorage.removeItem(legacyInvestmentClientKey);
  } else if (oldClientId) {
    localStorage.setItem(investmentClientKey, oldClientId);
    localStorage.setItem(legacyInvestmentClientKey, oldClientId);
  } else {
    localStorage.setItem(investmentClientKey, accountSession.account_id);
  }
  try {
    await loadSiteAccountState();
  } catch (error) {
    console.warn('account site state restore failed:', error.message);
  }
  updateAccountButton();
  if (typeof window.refreshPlayerLevelRanking === 'function') {
    window.refreshPlayerLevelRanking();
  }
  const savedAccountNickname = localStorage.getItem(
    `sangki-account-nickname-${accountSession.account_id}`
  );
  if (savedAccountNickname) {
    investorNickname.value = savedAccountNickname;
    await loadInvestmentState(savedAccountNickname);
  } else {
    try {
      const accountInvestmentState = await callInvestmentRpc('investment_build_state', {
        p_client_id: accountSession.account_id
      });
      if (accountInvestmentState?.nickname) {
        localStorage.setItem(
          `sangki-account-nickname-${accountSession.account_id}`,
          accountInvestmentState.nickname
        );
        localStorage.setItem('sangki-investor-nickname', accountInvestmentState.nickname);
        investorNickname.value = accountInvestmentState.nickname;
        renderInvestmentState(accountInvestmentState);
      }
    } catch (error) {
      console.warn('account investment restore failed:', error.message);
    }
  }
};
accountButton.addEventListener('click', async () => {
  if (accountSession) {
    if (!await siteConfirm('정말로 로그아웃하시겠습니까?')) return;
    await saveSiteAccountState().catch((error) => {
      console.warn('account site state save failed:', error.message);
    });
    accountSession = null;
    window.dispatchEvent(new CustomEvent('sanggi-account-changed'));
    localStorage.removeItem(accountStorageKey);
    sessionStorage.removeItem(accountSessionStorageKey);
    clearSanggiLocalState();
    clearInvestmentView();
    if (typeof window.refreshPlayerLevelRanking === 'function') {
      window.refreshPlayerLevelRanking();
    }
    updateAccountButton();
    return;
  }
  accountModal.hidden = false;
  accountBackdrop.hidden = false;
  accountUsername.value = localStorage.getItem(rememberedUsernameKey) || '';
  rememberUsername.checked = Boolean(accountUsername.value);
  keepLogin.checked = localStorage.getItem(keepLoginKey) === 'true';
  accountUsername.focus();
});
accountClose.addEventListener('click', closeAccountModal);
accountBackdrop.addEventListener('click', closeAccountModal);
accountSwitch.addEventListener('click', () => {
  accountMode = accountMode === 'login' ? 'signup' : 'login';
  accountSubmit.textContent = accountMode === 'login' ? '로그인' : '회원가입';
  accountSwitch.textContent = accountMode === 'login' ? '회원가입으로 전환' : '로그인으로 전환';
});
accountForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  accountSubmit.disabled = true;
  accountStatus.textContent = '처리 중...';
  try {
    await authenticateAccount(accountUsername.value, accountPassword.value);
    closeAccountModal();
    if (document.querySelector('#investor-nickname')?.value.trim()) await loadInvestmentState();
  } catch (error) {
    accountStatus.textContent = error.message;
  } finally {
    accountSubmit.disabled = false;
  }
});
try {
  const storedSession = localStorage.getItem(accountStorageKey)
    || sessionStorage.getItem(accountSessionStorageKey);
  accountSession = JSON.parse(storedSession || 'null');
} catch {
  accountSession = null;
}
if (accountSession?.account_id) {
  const currentClientId = localStorage.getItem(investmentClientKey);
  if (currentClientId && currentClientId !== accountSession.account_id) {
    localStorage.setItem(legacyInvestmentClientKey, currentClientId);
  }
  localStorage.setItem(investmentClientKey, accountSession.account_id);
}
updateAccountButton();

const closeSettings = () => {
  settingsModal.hidden = true;
  settingsBackdrop.hidden = true;
};
const logoutAccount = async () => {
  await saveSiteAccountState().catch((error) => {
    console.warn('account site state save failed:', error.message);
  });
  accountSession = null;
  window.dispatchEvent(new CustomEvent('sanggi-account-changed'));
  localStorage.removeItem(accountStorageKey);
  sessionStorage.removeItem(accountSessionStorageKey);
  clearSanggiLocalState();
  clearInvestmentView();
  if (typeof window.refreshPlayerLevelRanking === 'function') {
    window.refreshPlayerLevelRanking();
  }
  updateAccountButton();
  closeSettings();
  investorStatus.textContent = '로그아웃되었습니다.';
};
settingsOpen.addEventListener('click', () => {
  settingsAccountStatus.textContent = accountSession?.username
    ? `현재 로그인: ${accountSession.username}`
    : '로그인하면 계정 설정을 사용할 수 있습니다.';
  settingsStatus.textContent = '';
  settingsModal.hidden = false;
  settingsBackdrop.hidden = false;
});
settingsClose.addEventListener('click', closeSettings);
settingsBackdrop.addEventListener('click', closeSettings);
settingsLogout.addEventListener('click', async () => {
  if (!accountSession) {
    settingsStatus.textContent = '로그인된 계정이 없습니다.';
    return;
  }
  await logoutAccount();
});
settingsDeleteAccount.addEventListener('click', async () => {
  if (!accountSession) {
    settingsStatus.textContent = '로그인된 계정이 없습니다.';
    return;
  }
  if (!await siteConfirm('아이디와 연결된 투자 정보, 세션을 모두 삭제할까요?\n이 작업은 되돌릴 수 없습니다.')) return;
  const password = window.prompt('삭제를 확인하려면 현재 비밀번호를 입력하세요.');
  if (password === null) return;
  settingsDeleteAccount.disabled = true;
  settingsStatus.textContent = '삭제 중...';
  try {
    const response = await fetch(`${rpcEndpoint}/site_account_delete`, {
      method: 'POST',
      headers: { ...apiHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        p_session_token: accountSession.session_token,
        p_password: password
      })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || result.details || result.hint || '아이디를 삭제하지 못했습니다.');
    localStorage.removeItem(accountStorageKey);
    sessionStorage.removeItem(accountSessionStorageKey);
    localStorage.removeItem(legacyInvestmentClientKey);
    localStorage.removeItem('sangki-investor-nickname');
    clearSanggiLocalState();
    accountSession = null;
    localStorage.removeItem(investmentClientKey);
    updateAccountButton();
    closeSettings();
    investorStatus.textContent = '아이디가 삭제되었습니다.';
    investorForm.reset();
    portfolioSummary.hidden = true;
    investmentHoldings.hidden = true;
  } catch (error) {
    settingsStatus.textContent = error.message;
  } finally {
    settingsDeleteAccount.disabled = false;
  }
});

document.querySelectorAll('a[href^="#"]').forEach((link) => {
  link.addEventListener('click', (event) => {
    const target = document.querySelector(link.getAttribute('href'));

    if (target) {
      event.preventDefault();
      target.scrollIntoView({ behavior: 'smooth' });
    }
  });
});

const menuToggle = document.querySelector('#menu-toggle');
const sideMenu = document.querySelector('#side-menu');
const sideMenuClose = document.querySelector('#side-menu-close');
const sideMenuBackdrop = document.querySelector('#side-menu-backdrop');

const closeSideMenu = () => {
  sideMenu.classList.remove('is-open');
  sideMenuBackdrop.classList.remove('is-open');
  menuToggle.setAttribute('aria-expanded', 'false');
  menuToggle.setAttribute('aria-label', '사이드바 열기');
  sideMenu.setAttribute('aria-hidden', 'true');
};

menuToggle.addEventListener('click', () => {
  const isOpen = sideMenu.classList.toggle('is-open');
  sideMenuBackdrop.classList.toggle('is-open', isOpen);
  menuToggle.setAttribute('aria-expanded', String(isOpen));
  menuToggle.setAttribute('aria-label', isOpen ? '사이드바 닫기' : '사이드바 열기');
  sideMenu.setAttribute('aria-hidden', String(!isOpen));
});

sideMenuClose.addEventListener('click', closeSideMenu);
sideMenuBackdrop.addEventListener('click', closeSideMenu);
sideMenu.addEventListener('transitionend', (event) => {
  if (event.propertyName === 'transform' && sideMenu.classList.contains('is-open')) {
    loadOnlineUsers();
  }
});

const investorForm = document.querySelector('#investor-form');
const investorNickname = document.querySelector('#investor-nickname');
const investorStatus = document.querySelector('#investor-status');
const portfolioSummary = document.querySelector('#portfolio-summary');
const portfolioNickname = document.querySelector('#portfolio-nickname');
const portfolioCash = document.querySelector('#portfolio-cash');
const portfolioTotal = document.querySelector('#portfolio-total');
const marketUpdated = document.querySelector('#market-updated');
const investmentProducts = document.querySelector('#investment-products');
const investmentTransferToggle = document.querySelector('#investment-transfer-toggle');
const investmentTransfer = document.querySelector('#investment-transfer');
const transferTarget = document.querySelector('#transfer-target');
const transferAmount = document.querySelector('#transfer-amount');
const transferStatus = document.querySelector('#transfer-status');
const investmentRefresh = document.querySelector('#investment-refresh');
const investmentHoldings = document.querySelector('#investment-holdings');
const holdingsList = document.querySelector('#holdings-list');
const investmentRankingList = document.querySelector('#investment-ranking-list');
const investmentRankingPagination = document.querySelector('#investment-ranking-pagination');
const investmentAdminButton = document.querySelector('#investment-admin-button');
const investmentAdminPanel = document.querySelector('#investment-admin-panel');
const adminAssetSelect = document.querySelector('#admin-asset-select');
const adminResetAsset = document.querySelector('#admin-reset-asset');
const adminSplitAsset = document.querySelector('#admin-split-asset');
const adminResetAllAssets = document.querySelector('#admin-reset-all-assets');
const adminSaveVolatility = document.querySelector('#admin-save-volatility');
const adminMarketStatus = document.querySelector('#admin-market-status');
const adminBroadcastAmount = document.querySelector('#admin-broadcast-amount');
const adminBroadcastMessage = document.querySelector('#admin-broadcast-message');
const adminBroadcastCash = document.querySelector('#admin-broadcast-cash');
let investmentState = null;
let investmentAdminMode = false;
let investmentRankingPage = 1;
const INVESTMENT_RANKING_PER_PAGE = 5;

const getInvestmentClientId = () => {
  let id = localStorage.getItem(investmentClientKey);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(investmentClientKey, id);
  }
  return id;
};

const formatWon = (value) => `₩${Number(value || 0).toLocaleString('ko-KR')}`;
const confirmBackdrop = document.querySelector('#confirm-backdrop');
const confirmModal = document.querySelector('#confirm-modal');
const confirmMessage = document.querySelector('#confirm-message');
const confirmOk = document.querySelector('#confirm-ok');
const confirmCancel = document.querySelector('#confirm-cancel');
let confirmResolve = null;
const siteConfirm = (message) => new Promise((resolve) => {
  confirmResolve = resolve;
  confirmMessage.textContent = message;
  confirmCancel.hidden = false;
  confirmOk.textContent = '확인';
  confirmModal.hidden = false;
  confirmBackdrop.hidden = false;
});
const closeSiteConfirm = (result) => {
  confirmModal.hidden = true;
  confirmBackdrop.hidden = true;
  if (confirmResolve) confirmResolve(result);
  confirmResolve = null;
};
confirmOk.addEventListener('click', () => closeSiteConfirm(true));
confirmCancel.addEventListener('click', () => closeSiteConfirm(false));
confirmBackdrop.addEventListener('click', () => closeSiteConfirm(false));
const siteNotice = (message) => {
  confirmMessage.textContent = message;
  confirmCancel.hidden = true;
  confirmModal.hidden = false;
  confirmBackdrop.hidden = false;
  confirmOk.onclick = () => {
    confirmCancel.hidden = false;
    confirmOk.onclick = () => closeSiteConfirm(true);
    closeSiteConfirm(true);
  };
};
window.alert = siteNotice;

const callInvestmentRpc = async (name, payload) => {
  const response = await fetch(`${rpcEndpoint}/${name}`, {
    method: 'POST',
    headers: { ...apiHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!response.ok) {
    let detail = '';
    try {
      const error = await response.json();
      detail = error.message || error.hint || '';
    } catch {
      detail = '';
    }
    throw new Error(detail || '투자장 요청에 실패했습니다.');
  }
  return response.json();
};

const bagButton = document.querySelector('#bag-button');
const bagCount = document.querySelector('#bag-count');
const bagModal = document.querySelector('#bag-modal');
const bagBackdrop = document.querySelector('#bag-backdrop');
const bagClose = document.querySelector('#bag-close');
const bagCash = document.querySelector('#bag-cash');
const bagItems = document.querySelector('#bag-items');
const bagTarget = document.querySelector('#bag-target');
const bagNicknameLabel = document.querySelector('#bag-nickname-label');
const bagNewNickname = document.querySelector('#bag-new-nickname');
const bagStatus = document.querySelector('#bag-status');
const bagUsePanel = document.querySelector('#bag-use-panel');
const bagUseIcon = document.querySelector('#bag-use-icon');
const bagUseName = document.querySelector('#bag-use-name');
const bagUseDescription = document.querySelector('#bag-use-description');
const bagUseButton = document.querySelector('#bag-use-button');
const bagDiscardQuantity = document.querySelector('#bag-discard-quantity');
const bagDiscardButton = document.querySelector('#bag-discard-button');
let selectedShopItem = null;
let bagTargets = [];
const messageButton = document.querySelector('#message-button');
const messageCount = document.querySelector('#message-count');
const messageModal = document.querySelector('#message-modal');
const messageBackdrop = document.querySelector('#message-backdrop');
const messageClose = document.querySelector('#message-close');
const messageList = document.querySelector('#message-list');
const messagePagination = document.querySelector('#message-pagination');
const MESSAGE_PAGE_SIZE = 5;
let messageItems = [];
let messagePage = 1;
let activeShopClientId = null;

const getShopClientId = () => {
  if (activeShopClientId) return activeShopClientId;
  if (accountSession?.account_id) return accountSession.account_id;
  return getInvestmentClientId();
};

const resolveShopClientId = async () => {
  if (activeShopClientId) return activeShopClientId;
  const state = await callInvestmentRpc('shop_get_state', {
    p_client_id: accountSession?.account_id || getInvestmentClientId(),
    p_nickname: investorNickname.value.trim()
      || localStorage.getItem('sangki-investor-nickname')
      || null
  });
  activeShopClientId = state.client_id || getShopClientId();
  return activeShopClientId;
};

const shopItemIcons = {
  low_missile: '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="m7 36 21-21 6 6-21 21H7v-6Z" fill="#d9ff36" stroke="#171717" stroke-width="2.5"/><path d="m31 18 6-6 6 6-6 6" fill="none" stroke="#171717" stroke-width="3"/><path d="m12 42-5 5m12-5-5 5" stroke="#ff5b36" stroke-width="3"/></svg>',
  mid_missile: '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="m5 36 25-25 8 8-25 25H5v-8Z" fill="#ffb02e" stroke="#171717" stroke-width="2.5"/><path d="m32 15 6-6 7 7-6 6" fill="none" stroke="#171717" stroke-width="3"/><path d="m10 43-5 5m13-5-5 5" stroke="#ff5b36" stroke-width="3"/></svg>',
  high_missile: '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="m3 36 28-28 10 10-28 28H3V36Z" fill="#ff5b36" stroke="#171717" stroke-width="2.5"/><path d="m34 14 6-6 7 7-6 6" fill="none" stroke="#171717" stroke-width="3"/><path d="m8 44-5 5m14-5-5 5" stroke="#d9ff36" stroke-width="3"/></svg>'
  ,nuclear_missile: '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M5 35 27 13l10 10-22 22H5v-10Z" fill="#b9c0c8" stroke="#171717" stroke-width="2.5"/><path d="M29 11c4-5 10-7 15-6-1 5-3 10-8 13" fill="#d9ff36" stroke="#171717" stroke-width="2.5"/><path d="m9 43-5 5m13-5-5 5" stroke="#ff5b36" stroke-width="3"/></svg>'
  ,missile_shield: '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M24 4 40 10v12c0 10-6 17-16 22C14 39 8 32 8 22V10l16-6Z" fill="#8ed8d2" stroke="#171717" stroke-width="2.5"/><path d="m15 24 6 6 12-13" fill="none" stroke="#d9ff36" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg>'
  ,nickname_ticket: '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M7 12h34v24H7z" fill="#d9ff36" stroke="#171717" stroke-width="2.5"/><path d="M15 12v24M33 12v24" stroke="#171717" stroke-width="2" stroke-dasharray="3 3"/><path d="M20 20h8M20 25h8M20 30h5" stroke="#ff5b36" stroke-width="2.5" stroke-linecap="round"/></svg>',
  letter: '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M5 11h38v27H5z" fill="#8ed8d2" stroke="#171717" stroke-width="2.5"/><path d="m6 13 18 14 18-14M6 36l13-13m23 13L29 23" fill="none" stroke="#171717" stroke-width="2.5"/><path d="M35 5v10M30 10h10" stroke="#ff5b36" stroke-width="2.5"/></svg>',
  normal_potion: '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M18 5h12M20 5v9L10 25v14a4 4 0 0 0 4 4h20a4 4 0 0 0 4-4V25L28 14V5" fill="#e8f7ff" stroke="#171717" stroke-width="2.5"/><path d="M10 29h28v10a4 4 0 0 1-4 4H14a4 4 0 0 1-4-4Z" fill="#398fe5"/></svg>',
  advanced_potion: '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M18 5h12M20 5v9L10 25v14a4 4 0 0 0 4 4h20a4 4 0 0 0 4-4V25L28 14V5" fill="#fff8d0" stroke="#171717" stroke-width="2.5"/><path d="M10 29h28v10a4 4 0 0 1-4 4H14a4 4 0 0 1-4-4Z" fill="#e6a62f"/></svg>',
  legendary_potion: '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M18 5h12M20 5v9L10 25v14a4 4 0 0 0 4 4h20a4 4 0 0 0 4-4V25L28 14V5" fill="#f3e7ff" stroke="#171717" stroke-width="2.5"/><path d="M10 29h28v10a4 4 0 0 1-4 4H14a4 4 0 0 1-4-4Z" fill="#8b3fd6"/></svg>',
  sanggi_hanbok: '<img src="sanggi-hanbok.png" alt="" aria-hidden="true">',
  sanggi_spacesuit: '<img src="sanggi-spacesuit.png" alt="" aria-hidden="true">',
  juseong_hanbok: '<img src="juseong-hanbok.png" alt="" aria-hidden="true">',
  juseong_spacesuit: '<img src="juseong-spacesuit.png" alt="" aria-hidden="true">',
  cash_box: '<span class="bag-cash-box-icon">₩</span>',
  weird_cash_box: '<span class="bag-cash-box-icon bag-cash-box-weird">?</span>'
};
const shopItemDescriptions = {
  low_missile: '20% 확률로 선택한 유저의 전체 자산 20%를 감소시킵니다.',
  mid_missile: '30% 확률로 선택한 유저의 전체 자산 30%를 감소시킵니다.',
  high_missile: '40% 확률로 선택한 유저의 전체 자산 40%를 감소시킵니다.'
  ,nuclear_missile: '80% 확률로 선택한 유저의 전체 자산 80%를 감소시킵니다.'
  ,missile_shield: '다른 유저의 미사일을 막을 수 있습니다. 하급 미사일을 막는 데에는 1개, 중급 미사일에는 3개, 고급 미사일에는 5개, 핵 미사일에는 미사일 방어막 10개가 필요합니다. 미사일에 피격되면 자동으로 소모됩니다.'
  ,nickname_ticket: '사용하면 투자 닉네임을 한 번 변경할 수 있습니다.',
  letter: '선택한 유저에게 최대 500자의 메시지를 보내는 일회용 편지입니다.',
  normal_potion: '10초 동안 획득 코인이 2배가 됩니다.',
  advanced_potion: '10초 동안 획득 코인이 10배가 됩니다.',
  legendary_potion: '10초 동안 획득 코인이 100배가 됩니다.',
  sanggi_hanbok: '상기가 착용할 수 있는 한복입니다.',
  sanggi_spacesuit: '상기가 착용할 수 있는 우주복입니다.',
  juseong_hanbok: '주성이 착용할 수 있는 한복입니다.',
  juseong_spacesuit: '주성이 착용할 수 있는 우주복입니다.',
  cash_box: '가방에서 바로 개봉하면 투자 현금 1,000,000원~1,000,000,000원을 무작위로 받습니다. 유저를 선택하면 선물할 수 있습니다.',
  weird_cash_box: '가방에서 바로 개봉하거나 유저에게 선물할 수 있습니다. 개봉하면 대상의 총자산이 -30%~+30% 범위에서 무작위로 변합니다.'
};
const shopItemNames = {
  low_missile: '하급 미사일',
  mid_missile: '중급 미사일',
  high_missile: '고급 미사일',
  nuclear_missile: '핵 미사일',
  missile_shield: '미사일 방어막',
  nickname_ticket: '닉네임 변경권',
  letter: '편지',
  normal_potion: '일반 물약',
  advanced_potion: '고급 물약',
  legendary_potion: '전설 물약',
  sanggi_hanbok: '상기 한복',
  sanggi_spacesuit: '상기 우주복',
  juseong_hanbok: '주성 한복',
  juseong_spacesuit: '주성 우주복',
  cash_box: '랜덤 현금 박스',
  weird_cash_box: '이상한 랜덤 현금 박스'
};
const validShopItemTypes = new Set(Object.keys(shopItemNames));
const normalizeShopItem = (item) => ({
  ...item,
  name: shopItemNames[item.item_type] || item.name || '아이템'
});

const resetBagSelection = () => {
  selectedShopItem = null;
  bagUsePanel.hidden = true;
  bagUsePanel.style.display = 'none';
  bagNicknameLabel.hidden = true;
  document.querySelector('#bag-letter-label').hidden = true;
  document.querySelector('.bag-target-label').hidden = true;
  bagNewNickname.value = '';
  document.querySelector('#bag-letter-message').value = '';
  bagDiscardQuantity.value = '1';
  document.querySelectorAll('.bag-slot.is-selected').forEach((selected) => {
    selected.classList.remove('is-selected');
  });
};

const selectShopItem = (item) => {
  item = normalizeShopItem(item);
  selectedShopItem = item;
  bagUsePanel.hidden = false;
  bagUsePanel.style.display = 'grid';
  bagUseIcon.innerHTML = shopItemIcons[item.item_type] || '◆';
  bagUseName.textContent = `${item.name} · ${item.quantity}개`;
  bagDiscardQuantity.max = String(item.quantity);
  bagDiscardQuantity.value = '1';
  bagUseDescription.textContent = shopItemDescriptions[item.item_type] || '선택한 아이템을 사용할 수 있습니다.';
  const isNicknameTicket = item.item_type === 'nickname_ticket';
  const isLetter = item.item_type === 'letter';
  const isShield = item.item_type === 'missile_shield';
  const isCashBox = item.item_type === 'cash_box' || item.item_type === 'weird_cash_box';
  const targetLabel = document.querySelector('.bag-target-label');
  targetLabel.hidden = isShield || (!isCashBox && !isNicknameTicket && !isLetter
    && !['low_missile', 'mid_missile', 'high_missile', 'nuclear_missile'].includes(item.item_type));
  bagTarget.disabled = isShield;
  if (isShield) bagTarget.value = '';
  targetLabel.firstChild.textContent = isCashBox
    ? '선물할 유저 선택 (선택하지 않으면 개봉)'
    : isNicknameTicket
    ? '닉네임 변경 대상 선택'
    : isLetter ? '편지 받을 유저 선택' : '공격 대상 선택';
  bagTarget.replaceChildren(...(isCashBox ? [new Option('선택하지 않고 개봉', '')] : []), ...bagTargets
    .filter((target) => isNicknameTicket || isLetter || target.client_id !== activeShopClientId)
    .map((target) => new Option(
      `${target.nickname}${target.client_id === activeShopClientId ? ' (나)' : ''} · ${formatWon(target.total_asset)}`,
      target.client_id
    )));
  bagNicknameLabel.hidden = !isNicknameTicket;
  document.querySelector('#bag-letter-label').hidden = !isLetter;
  bagUseButton.disabled = isShield;
  bagUseButton.textContent = isShield ? '자동 방어 아이템' : isCashBox ? '개봉/선물하기' : '사용하기';
  bagStatus.textContent = isShield
    ? '다른 유저의 미사일이 명중하면 필요한 수량이 자동으로 소모되어 방어합니다.'
    : isCashBox
    ? '유저를 선택하면 상자를 선물하고, 선택하지 않으면 내 계정에서 바로 개봉합니다.'
    : isNicknameTicket
    ? '대상을 선택하고 새 닉네임을 입력한 뒤 사용하기를 누르세요.'
    : isLetter
      ? '받는 유저와 편지 내용을 입력한 뒤 사용하기를 누르세요.'
      : '공격 대상을 선택한 뒤 사용하기를 누르세요.';
  document.querySelectorAll('.bag-slot.is-selected').forEach((selected) => selected.classList.remove('is-selected'));
};

const loadBag = async () => {
  const state = await callInvestmentRpc('shop_get_state', {
    p_client_id: accountSession?.account_id || getInvestmentClientId(),
    p_nickname: investorNickname.value.trim()
      || localStorage.getItem('sangki-investor-nickname')
      || null
  });
  activeShopClientId = state.client_id || getShopClientId();
  bagCash.textContent = `보유 현금 ${formatWon(state.cash)}`;
  const slots = [];
  for (let index = 0; index < 27; index += 1) {
    const availableItems = (Array.isArray(state.items) ? state.items : [])
      .filter((entry) => validShopItemTypes.has(entry.item_type) && Number(entry.quantity) > 0)
      .map(normalizeShopItem);
    const item = availableItems[index] || null;
    const slot = document.createElement('button');
    slot.type = 'button';
    slot.className = 'bag-slot';
    if (item) {
      slot.disabled = item.quantity < 1;
      slot.title = `${item.name} ${item.quantity}개`;
      slot.innerHTML = `<span class="bag-slot-icon">${shopItemIcons[item.item_type] || '◆'}</span><span class="bag-slot-count">${item.quantity}</span><span class="bag-slot-name">${item.name}</span>`;
      slot.addEventListener('click', () => {
        selectShopItem(item);
        slot.classList.add('is-selected');
      });
    }
    slots.push(slot);
  }
  bagItems.replaceChildren(...slots);
  bagCount.textContent = state.items
    .filter((item) => validShopItemTypes.has(item.item_type))
    .reduce((sum, item) => sum + Number(item.quantity), 0);
  bagTargets = state.targets;
  bagTarget.replaceChildren();
  if (selectedShopItem) {
    const refreshedItem = state.items
      .filter((item) => validShopItemTypes.has(item.item_type))
      .map(normalizeShopItem)
      .find((item) => item.item_type === selectedShopItem.item_type);
    if (refreshedItem?.quantity > 0) {
      selectShopItem(refreshedItem);
    } else {
      selectedShopItem = null;
      bagUsePanel.hidden = true;
      bagNicknameLabel.hidden = true;
      document.querySelector('#bag-letter-label').hidden = true;
      document.querySelector('.bag-target-label').hidden = true;
      }
  }
};

const useShopItem = async (itemType) => {
  if (itemType === 'missile_shield') {
    bagStatus.textContent = '미사일 방어막은 미사일에 피격되면 필요한 수량만큼 자동으로 소모됩니다.';
    return;
  }
  if (itemType === 'letter') {
    if (!bagTarget.value) {
      bagStatus.textContent = '편지를 받을 유저를 선택하세요.';
      return;
    }
    if (itemType === 'cash_box' || itemType === 'weird_cash_box') {
      const targetId = bagTarget.value || null;
      const targetName = targetId
        ? bagTarget.options[bagTarget.selectedIndex]?.textContent?.split(' · ')[0] || '선택한 유저'
        : null;
      const itemName = selectedShopItem?.name || '현금 박스';
      const actionText = targetName ? `${targetName}에게 ${itemName}을(를) 선물하시겠습니까?` : `${itemName}을(를) 지금 개봉하시겠습니까?`;
      if (!await siteConfirm(actionText)) {
        bagStatus.textContent = targetName ? '선물하기를 취소했습니다.' : '개봉을 취소했습니다.';
        return;
      }
      bagStatus.textContent = targetName ? '상자를 선물하는 중...' : '상자를 개봉하는 중...';
      try {
        const result = await callInvestmentRpc('shop_use_cash_box', {
          p_client_id: await resolveShopClientId(),
          p_item_type: itemType,
          p_target_client_id: targetId
        });
        bagStatus.textContent = result.message;
        window.alert(result.message);
        await loadMessageCount();
        await loadBag();
        if (investmentState) await loadInvestmentState();
      } catch (error) {
        bagStatus.textContent = error.message;
        window.alert(`상자 처리 실패: ${error.message}`);
      }
      return;
    }
    const message = document.querySelector('#bag-letter-message').value.trim();
    if (!message) {
      bagStatus.textContent = '편지 내용을 입력하세요.';
      return;
    }
    const targetName = bagTarget.options[bagTarget.selectedIndex]?.textContent?.split(' · ')[0] || '선택한 유저';
    if (!await siteConfirm(`${targetName}에게 편지를 보내시겠습니까?`)) {
      bagStatus.textContent = '편지 보내기를 취소했습니다.';
      return;
    }
    bagStatus.textContent = '편지 보내는 중...';
    try {
      const result = await callInvestmentRpc('shop_send_letter', {
        p_client_id: await resolveShopClientId(),
        p_target_client_id: bagTarget.value,
        p_message: message
      });
      bagStatus.textContent = result.message;
      window.alert(result.message);
      document.querySelector('#bag-letter-message').value = '';
      await loadMessageCount();
      await loadBag();
    } catch (error) {
      bagStatus.textContent = error.message;
      window.alert(`편지 보내기 실패: ${error.message}`);
    }
    return;
  }
  if (itemType === 'nickname_ticket') {
    if (!bagTarget.value) {
      bagStatus.textContent = '닉네임 변경 대상을 선택하세요.';
      return;
    }
    const nickname = bagNewNickname.value.trim();
    if (!nickname) {
      bagStatus.textContent = '새 닉네임을 입력하세요.';
      return;
    }
    const targetName = bagTarget.options[bagTarget.selectedIndex]?.textContent?.split(' · ')[0] || '선택한 유저';
    if (!await siteConfirm(`${targetName}의 닉네임을 "${nickname}"(으)로 정말 변경하시겠습니까?`)) {
      bagStatus.textContent = '닉네임 변경을 취소했습니다.';
      return;
    }
    bagStatus.textContent = '닉네임 변경 중...';
    try {
      const result = await callInvestmentRpc('shop_change_nickname', {
        p_client_id: await resolveShopClientId(),
        p_target_client_id: bagTarget.value,
        p_new_nickname: nickname
      });
      bagStatus.textContent = result.message;
      window.alert(result.message);
      if (bagTarget.value === (await resolveShopClientId())) {
        localStorage.setItem('sangki-investor-nickname', nickname);
      }
      if (accountSession?.account_id && bagTarget.value === accountSession.account_id) {
        localStorage.setItem(`sangki-account-nickname-${accountSession.account_id}`, nickname);
      }
      await loadBag();
      if (bagTarget.value === (await resolveShopClientId())) {
        await loadInvestmentState(nickname);
      }
    } catch (error) {
      bagStatus.textContent = error.message;
      window.alert(`닉네임 변경 실패: ${error.message}`);
    }
    return;
  }
  if (!bagTarget.value) {
    bagStatus.textContent = '공격 대상을 선택하세요.';
    return;
  }
  const targetName = bagTarget.options[bagTarget.selectedIndex]?.textContent?.split(' · ')[0] || '선택한 유저';
  if (!await siteConfirm(`${targetName}에게 ${selectedShopItem?.name || '미사일'}을(를) 정말 발사하시겠습니까?`)) {
    bagStatus.textContent = '미사일 발사를 취소했습니다.';
    return;
  }
  bagStatus.textContent = '아이템 사용 중...';
  try {
    const result = await callInvestmentRpc('shop_use_missile', {
      p_client_id: await resolveShopClientId(),
      p_item_type: itemType,
      p_target_client_id: bagTarget.value
    });
    bagStatus.textContent = result.message;
    window.alert(result.message);
    if (result.blocked && result.blocked_message) {
      window.alert(result.blocked_message);
    }
    await loadMessageCount();
    await loadBag();
    if (investmentState) await loadInvestmentState();
  } catch (error) {
    bagStatus.textContent = error.message;
    window.alert(`미사일 발사 실패: ${error.message}`);
  }
};

const discardShopItem = async () => {
  if (!selectedShopItem) return;
  const quantityText = bagDiscardQuantity.value.trim();
  if (!/^[0-9]+$/.test(quantityText) || BigInt(quantityText) < 1n) {
    bagStatus.textContent = '버릴 수량은 1개 이상의 정수로 입력하세요.';
    return;
  }
  const quantity = BigInt(quantityText);
  const owned = BigInt(String(selectedShopItem.quantity));
  if (quantity > owned) {
    bagStatus.textContent = `보유 수량(${owned})보다 많이 버릴 수 없습니다.`;
    return;
  }
  if (!await siteConfirm(`${selectedShopItem.name} ${quantity}개를 정말 버릴까요?`)) return;
  bagDiscardButton.disabled = true;
  bagStatus.textContent = '아이템을 버리는 중...';
  try {
    const result = await callInvestmentRpc('shop_discard_item', {
      p_client_id: await resolveShopClientId(),
      p_item_type: selectedShopItem.item_type,
      p_quantity: quantityText
    });
    bagStatus.textContent = result.message;
    window.alert(result.message);
    await loadBag();
  } catch (error) {
    bagStatus.textContent = error.message;
    window.alert(`아이템 버리기 실패: ${error.message}`);
  } finally {
    bagDiscardButton.disabled = false;
  }
};

const loadMessageCount = async () => {
  try {
    const result = await callInvestmentRpc('shop_get_unread_count', {
      p_client_id: await resolveShopClientId()
    });
    messageCount.textContent = result.count || 0;
  } catch {
    messageCount.textContent = '0';
  }
};

const loadMessages = async () => {
  const result = await callInvestmentRpc('shop_get_messages', {
    p_client_id: await resolveShopClientId()
  });
  messageItems = result.messages || [];
  messagePage = 1;
  renderMessages();
  messageCount.textContent = '0';
};

const renderMessages = () => {
  const totalPages = Math.max(1, Math.ceil(messageItems.length / MESSAGE_PAGE_SIZE));
  messagePage = Math.min(Math.max(messagePage, 1), totalPages);
  const start = (messagePage - 1) * MESSAGE_PAGE_SIZE;
  const pageItems = messageItems.slice(start, start + MESSAGE_PAGE_SIZE);
  messageList.replaceChildren(...(pageItems.length
    ? pageItems.map((message) => {
      const card = document.createElement('article');
      card.className = 'message-card';
      card.textContent = message.message;
      const time = document.createElement('time');
      time.textContent = new Date(message.created_at).toLocaleString('ko-KR');
      card.append(time);
      return card;
    })
    : [Object.assign(document.createElement('p'), {
      textContent: '새 메시지가 없습니다.'
    })]));
  if (!messageItems.length) {
    messagePagination.replaceChildren();
    return;
  }
  const previous = document.createElement('button');
  previous.type = 'button';
  previous.className = 'message-page-button';
  previous.textContent = '← 이전';
  previous.disabled = messagePage === 1;
  previous.addEventListener('click', () => {
    messagePage -= 1;
    renderMessages();
  });
  const pageNumber = document.createElement('span');
  pageNumber.className = 'message-page-number';
  pageNumber.textContent = `${messagePage} / ${totalPages}`;
  const next = document.createElement('button');
  next.type = 'button';
  next.className = 'message-page-button';
  next.textContent = '다음 →';
  next.disabled = messagePage === totalPages;
  next.addEventListener('click', () => {
    messagePage += 1;
    renderMessages();
  });
  messagePagination.replaceChildren(previous, pageNumber, next);
};

messageButton.addEventListener('click', async () => {
  messageModal.hidden = false;
  messageBackdrop.hidden = false;
  try {
    await loadMessages();
  } catch (error) {
    messageList.replaceChildren(Object.assign(document.createElement('p'), {
      textContent: error.message
    }));
  }
});
const closeMessages = () => {
  messageModal.hidden = true;
  messageBackdrop.hidden = true;
};
messageClose.addEventListener('click', closeMessages);
messageBackdrop.addEventListener('click', closeMessages);

bagUseButton.addEventListener('click', async () => {
  if (!selectedShopItem) {
    bagStatus.textContent = '먼저 사용할 아이템을 선택하세요.';
    return;
  }
  bagUseButton.disabled = true;
  await useShopItem(selectedShopItem.item_type);
  bagUseButton.disabled = false;
});
bagDiscardButton.addEventListener('click', discardShopItem);

bagButton.addEventListener('click', async () => {
  bagModal.hidden = false;
  bagBackdrop.hidden = false;
  resetBagSelection();
  bagStatus.textContent = '';
  try {
    await loadBag();
  } catch (error) {
    bagItems.replaceChildren(Object.assign(document.createElement('p'), {
      textContent: error.message
    }));
  }
});
const closeBag = () => {
  resetBagSelection();
  bagModal.hidden = true;
  bagBackdrop.hidden = true;
};
bagClose.addEventListener('click', closeBag);
bagBackdrop.addEventListener('click', closeBag);

updateOnlinePresence();
loadMessageCount();
window.setInterval(updateOnlinePresence, 60000);
window.setInterval(() => {
  if (sideMenu.classList.contains('is-open')) {
    loadOnlineUsers();
  }
}, 60000);

const renderInvestmentState = (state) => {
  investmentState = state;
  investorNickname.value = state.nickname;
  investorNickname.disabled = true;
  investorForm.querySelector('button').disabled = true;
  portfolioSummary.hidden = false;
  investmentTransferToggle.hidden = false;
  transferTarget.replaceChildren(new Option('유저를 선택하세요', ''));
  transferTarget.append(...state.ranking
    .filter((entry) => entry.client_id !== getInvestmentClientId())
    .map((entry) => new Option(
      `${entry.nickname} · ${formatWon(entry.total_asset)}`,
      entry.client_id
    )));
  investmentHoldings.hidden = false;
  portfolioNickname.textContent = state.nickname;
  portfolioCash.textContent = formatWon(state.cash);
  portfolioTotal.textContent = formatWon(state.total_asset);
  marketUpdated.textContent = `${state.market_date} · 5분마다 갱신`;

  investmentProducts.replaceChildren(...state.assets.map((asset) => {
    const row = document.createElement('article');
    row.className = 'investment-product';
    const name = document.createElement('div');
    name.innerHTML = `<strong class="investment-product-name"></strong><span class="investment-product-symbol"></span><small class="investment-product-notices"></small>`;
    name.querySelector('strong').textContent = asset.name;
    name.querySelector('span').textContent = asset.listed ? asset.symbol : '상장폐지 · 다음 갱신 시 재상장';
    const notices = [];
    if (asset.split_notice) notices.push('주식 분할 상품입니다');
    if (asset.was_delisted && asset.listed) notices.push('이전에 상장폐지 되었던 상품입니다');
    name.querySelector('.investment-product-notices').textContent = notices.join(' · ');
    const price = document.createElement('strong');
    price.className = 'investment-price';
    price.textContent = asset.listed ? formatWon(asset.current_price) : '—';
    const change = document.createElement('span');
    change.className = 'investment-change';
    if (!asset.listed) {
      change.classList.add('flat');
      change.textContent = '상장폐지';
    } else {
      const pct = Number(asset.change_pct);
      change.classList.add(pct > 0 ? 'positive' : pct < 0 ? 'negative' : 'flat');
      change.textContent = `${pct > 0 ? '+' : ''}${pct.toFixed(2)}%`;
    }
    const trade = document.createElement('div');
    trade.className = 'investment-trade';
    const quantity = document.createElement('input');
    quantity.type = 'text';
    quantity.inputMode = 'numeric';
    quantity.pattern = '[0-9]+';
    quantity.value = '1';
    quantity.disabled = !asset.listed;
    const buy = document.createElement('button');
    buy.type = 'button';
    buy.textContent = '매수';
    buy.disabled = !asset.listed;
    buy.addEventListener('click', () => tradeInvestment(asset.symbol, 'buy', quantity));
    const sell = document.createElement('button');
    sell.type = 'button';
    sell.textContent = '매도';
    sell.disabled = !asset.listed;
    sell.addEventListener('click', () => tradeInvestment(asset.symbol, 'sell', quantity));
    const maxBuy = document.createElement('button');
    maxBuy.type = 'button';
    maxBuy.textContent = '최대 매수';
    maxBuy.disabled = !asset.listed;
    maxBuy.addEventListener('click', () => {
      const cash = BigInt(String(state.cash_exact ?? state.cash));
      const price = BigInt(String(asset.current_price_exact ?? asset.current_price));
      quantity.value = String(price > 0n ? cash / price : 0n);
    });
    const maxSell = document.createElement('button');
    maxSell.type = 'button';
    maxSell.textContent = '최대 매도';
    maxSell.disabled = !asset.listed;
    maxSell.addEventListener('click', () => {
      const holding = state.holdings.find((item) => item.symbol === asset.symbol);
      quantity.value = String(holding ? holding.quantity : 0);
    });
    trade.append(quantity, buy, sell, maxBuy, maxSell);
    row.append(name, price, change, trade);
    return row;
  }));
  adminAssetSelect.replaceChildren(...state.assets.map((asset) => {
    const option = document.createElement('option');
    option.value = asset.symbol;
    option.textContent = asset.name;
    return option;
  }));

  const holdings = state.holdings.filter((holding) => holding.quantity > 0);
  holdingsList.replaceChildren(...(holdings.length ? holdings.map((holding) => {
    const asset = state.assets.find((item) => item.symbol === holding.symbol);
    const row = document.createElement('div');
    row.className = 'holding-row';
    const value = asset && asset.listed ? asset.current_price * holding.quantity : 0;
    const invested = Number(holding.invested_amount || 0);
    const returnPct = invested > 0 ? ((value - invested) / invested) * 100 : 0;
    const name = document.createElement('span');
    name.className = 'holding-name';
    name.innerHTML = '<strong></strong><small></small>';
    name.querySelector('strong').textContent = asset ? asset.name : holding.symbol;
    name.querySelector('small').textContent = `${holding.quantity}주 보유`;
    const change = document.createElement('span');
    const changePct = asset ? Number(asset.change_pct) : 0;
    change.className = `holding-change ${changePct > 0 ? 'positive' : changePct < 0 ? 'negative' : 'flat'}`;
    change.textContent = asset && asset.listed
      ? `${changePct > 0 ? '+' : ''}${changePct.toFixed(2)}%`
      : '상장폐지';
    const total = document.createElement('strong');
    total.className = 'holding-value';
    total.innerHTML = '<span></span><small></small>';
    total.querySelector('span').textContent = formatWon(value);
    total.querySelector('small').textContent = `투자금액 ${formatWon(invested)}`;
    const trade = document.createElement('div');
    trade.className = 'holding-trade';
    const quantity = document.createElement('input');
    quantity.type = 'text';
    quantity.inputMode = 'numeric';
    quantity.pattern = '[0-9]+';
    quantity.value = '1';
    quantity.disabled = !asset || !asset.listed;
    const buy = document.createElement('button');
    buy.type = 'button';
    buy.textContent = '매수';
    buy.disabled = !asset || !asset.listed;
    buy.addEventListener('click', () => tradeInvestment(holding.symbol, 'buy', quantity));
    const sell = document.createElement('button');
    sell.type = 'button';
    sell.textContent = '매도';
    sell.disabled = !asset || !asset.listed;
    sell.addEventListener('click', () => tradeInvestment(holding.symbol, 'sell', quantity));
    const maxBuy = document.createElement('button');
    maxBuy.type = 'button';
    maxBuy.textContent = '최대 매수';
    maxBuy.disabled = !asset || !asset.listed;
    maxBuy.addEventListener('click', () => {
      const cash = BigInt(String(state.cash_exact ?? state.cash));
      const price = BigInt(String(asset.current_price_exact ?? asset.current_price));
      quantity.value = String(price > 0n ? cash / price : 0n);
    });
    const maxSell = document.createElement('button');
    maxSell.type = 'button';
    maxSell.textContent = '최대 매도';
    maxSell.disabled = !asset || !asset.listed;
    maxSell.addEventListener('click', () => {
      quantity.value = String(holding.quantity);
    });
    trade.append(quantity, buy, sell, maxBuy, maxSell);
    total.dataset.return = returnPct;
    const returnValue = document.createElement('span');
    returnValue.className = `holding-return ${returnPct > 0 ? 'positive' : returnPct < 0 ? 'negative' : 'flat'}`;
    returnValue.textContent = `수익률 ${returnPct > 0 ? '+' : ''}${returnPct.toFixed(2)}%`;
    row.append(name, total, returnValue, change, trade);
    return row;
  }) : [Object.assign(document.createElement('p'), {
    className: 'investment-empty',
    textContent: '아직 보유한 종목이 없습니다.'
  })]));

  const rankingTotalPages = Math.max(1, Math.ceil(state.ranking.length / INVESTMENT_RANKING_PER_PAGE));
  investmentRankingPage = Math.min(investmentRankingPage, rankingTotalPages);
  const rankingStart = (investmentRankingPage - 1) * INVESTMENT_RANKING_PER_PAGE;
  const rankingPage = state.ranking.slice(rankingStart, rankingStart + INVESTMENT_RANKING_PER_PAGE);
  investmentRankingList.replaceChildren(...(rankingPage.length ? rankingPage.map((entry) => {
    const item = document.createElement('li');
    const name = document.createElement('span');
    name.className = 'investment-ranking-name';
    const level = document.createElement('small');
    const playerLevel = Math.max(0, Number(entry.player_level) || 0);
    level.className = playerLevel <= 10
      ? 'investment-level investment-level-gray'
      : playerLevel <= 50
        ? 'investment-level investment-level-lime'
        : playerLevel <= 100
          ? 'investment-level investment-level-blue'
          : playerLevel <= 500
            ? 'investment-level investment-level-red'
            : playerLevel <= 1000
              ? 'investment-level investment-level-orange'
              : 'investment-level investment-level-purple';
    level.textContent = String(playerLevel);
    const nickname = document.createElement('span');
    nickname.textContent = entry.nickname;
    name.append(level, nickname);
    const total = document.createElement('span');
    total.className = 'ranking-value';
    total.textContent = formatWon(entry.total_asset);
    item.append(name, total);
    if (investmentAdminMode) {
      const rename = document.createElement('div');
      rename.className = 'ranking-rename';
      const renameInput = document.createElement('input');
      renameInput.type = 'text';
      renameInput.maxLength = 24;
      renameInput.placeholder = '새 닉네임';
      const renameButton = document.createElement('button');
      renameButton.type = 'button';
      renameButton.textContent = '닉네임 변경';
      renameButton.addEventListener('click', async () => {
        const nickname = renameInput.value.trim();
        if (!nickname) return;
        renameButton.disabled = true;
        try {
          await callInvestmentRpc('investment_admin_rename_user', {
            p_admin_password: '8170',
            p_target_client_id: entry.client_id,
            p_nickname: nickname
          });
          await loadInvestmentState();
          investorStatus.textContent = '유저 닉네임을 변경했습니다.';
        } catch (error) {
          investorStatus.textContent = error.message;
        } finally {
          renameButton.disabled = false;
        }
      });
      rename.append(renameInput, renameButton);
      item.append(rename);
      const grant = document.createElement('div');
      grant.className = 'ranking-grant';
      const amount = document.createElement('input');
      amount.type = 'number';
      amount.min = '1';
      amount.step = '1000';
      amount.placeholder = '지급액';
      const grantButton = document.createElement('button');
      grantButton.type = 'button';
      grantButton.textContent = '현금 지급';
      grantButton.addEventListener('click', () => grantInvestmentCash(entry.client_id, amount));
      const deductButton = document.createElement('button');
      deductButton.type = 'button';
      deductButton.textContent = '현금 차감';
      deductButton.addEventListener('click', () => adjustInvestmentCash(entry.client_id, amount, 'subtract'));
      grant.append(amount, grantButton, deductButton);
      item.append(grant);
    }
    return item;
  }) : [Object.assign(document.createElement('li'), {
    className: 'ranking-empty',
    textContent: '아직 투자자가 없습니다.'
  })]));
  const previous = document.createElement('button');
  previous.type = 'button';
  previous.className = 'investment-page-button';
  previous.textContent = '← 이전';
  previous.disabled = investmentRankingPage === 1;
  previous.addEventListener('click', () => {
    investmentRankingPage -= 1;
    renderInvestmentState(investmentState);
  });
  const pageNumber = document.createElement('span');
  pageNumber.className = 'investment-page-number';
  pageNumber.textContent = `${investmentRankingPage} / ${rankingTotalPages}`;
  const next = document.createElement('button');
  next.type = 'button';
  next.className = 'investment-page-button';
  next.textContent = '다음 →';
  next.disabled = investmentRankingPage === rankingTotalPages;
  next.addEventListener('click', () => {
    investmentRankingPage += 1;
    renderInvestmentState(investmentState);
  });
  investmentRankingPagination.replaceChildren(previous, pageNumber, next);
};

investmentTransferToggle.addEventListener('click', () => {
  const willOpen = investmentTransfer.hidden;
  investmentTransfer.hidden = !willOpen;
  investmentTransfer.style.display = willOpen ? '' : 'none';
  if (willOpen) {
    transferStatus.textContent = '';
    transferTarget.focus();
  }
});

investmentTransfer.addEventListener('submit', async (event) => {
  event.preventDefault();
  const targetClientId = transferTarget.value;
  const amount = Number(transferAmount.value);
  if (!targetClientId) {
    transferStatus.textContent = '받는 유저를 선택하세요.';
    return;
  }
  if (!Number.isSafeInteger(amount) || amount < 1) {
    transferStatus.textContent = '송금액은 1원 이상의 정수로 입력하세요.';
    return;
  }
  const targetName = transferTarget.options[transferTarget.selectedIndex]?.textContent?.split(' · ')[0] || '선택한 유저';
  if (!await siteConfirm(`${targetName}에게 ${formatWon(amount)}을 송금할까요?`)) return;
  transferAmount.disabled = true;
  transferTarget.disabled = true;
  transferStatus.textContent = '송금 처리 중...';
  try {
    const result = await callInvestmentRpc('investment_transfer_cash', {
      p_sender_client_id: getInvestmentClientId(),
      p_recipient_client_id: targetClientId,
      p_amount: amount
    });
    transferStatus.textContent = result.message;
    window.alert(result.message);
    transferAmount.value = '';
    await loadInvestmentState();
    await loadMessageCount();
  } catch (error) {
    transferStatus.textContent = error.message;
    window.alert(`송금 실패: ${error.message}`);
  } finally {
    transferAmount.disabled = false;
    transferTarget.disabled = false;
  }
});

const grantInvestmentCash = async (clientId, amountInput) => {
  const amount = Number(amountInput.value);
  if (!Number.isSafeInteger(amount) || amount < 1) {
    window.alert('지급액은 1원 이상의 정수로 입력하세요.');
    return;
  }
  if (!await siteConfirm(`${formatWon(amount)}을 지급할까요?`)) return;
  try {
    amountInput.disabled = true;
    await callInvestmentRpc('investment_admin_grant_cash', {
      p_admin_password: '8170',
      p_target_client_id: clientId,
      p_amount: amount
    });
    amountInput.value = '';
    await loadInvestmentState();
    investorStatus.textContent = '현금 지급이 완료되었습니다.';
  } catch (error) {
    window.alert(error.message);
  } finally {
    amountInput.disabled = false;
  }
};

const adjustInvestmentCash = async (clientId, amountInput, action) => {
  const amount = Number(amountInput.value);
  if (!Number.isSafeInteger(amount) || amount < 1) {
    window.alert('차감액은 1원 이상의 정수로 입력하세요.');
    return;
  }
  if (!await siteConfirm(`${formatWon(amount)}을 차감할까요?`)) return;
  try {
    amountInput.disabled = true;
    await callInvestmentRpc('investment_admin_adjust_cash', {
      p_admin_password: '8170',
      p_target_client_id: clientId,
      p_amount: action === 'subtract' ? -amount : amount
    });
    amountInput.value = '';
    await loadInvestmentState();
    investorStatus.textContent = '현금 차감이 완료되었습니다.';
  } catch (error) {
    window.alert(error.message);
  } finally {
    amountInput.disabled = false;
  }
};

adminBroadcastCash?.addEventListener('click', async () => {
  if (!requireInvestmentAdmin()) return;
  const amountText = adminBroadcastAmount.value.trim().replace(/,/g, '');
  const message = adminBroadcastMessage.value.trim();
  if (!/^[0-9]+$/.test(amountText) || BigInt(amountText) < 1n) {
    adminMarketStatus.textContent = '전체 지급액은 1원 이상의 정수로 입력하세요.';
    window.alert('전체 지급액은 1원 이상의 정수로 입력하세요.');
    return;
  }
  if (!message) {
    adminMarketStatus.textContent = '전달할 메시지를 입력하세요.';
    window.alert('전달할 메시지를 입력하세요.');
    return;
  }
  const displayAmount = `₩${BigInt(amountText).toLocaleString('ko-KR')}`;
  if (!await siteConfirm(`${displayAmount}을 모든 유저에게 지급하고 메시지를 전달할까요?`)) return;
  adminBroadcastCash.disabled = true;
  adminMarketStatus.textContent = '전체 지급 처리 중...';
  try {
    const result = await callInvestmentRpc('investment_admin_grant_cash_to_all', {
      p_admin_password: '8170',
      p_amount: amountText,
      p_message: message
    });
    adminBroadcastAmount.value = '';
    adminBroadcastMessage.value = '';
    await loadInvestmentState();
    await loadMessageCount();
    adminMarketStatus.textContent = `${result.user_count}명에게 현금 지급과 메시지 전달을 완료했습니다.`;
    window.alert(`${result.user_count}명에게 현금 지급과 메시지 전달을 완료했습니다.`);
  } catch (error) {
    adminMarketStatus.textContent = error.message;
    window.alert(`전체 지급 실패: ${error.message}`);
  } finally {
    if (adminBroadcastCash) adminBroadcastCash.disabled = false;
  }
});

investmentAdminButton.addEventListener('click', () => {
  if (investmentAdminMode) {
    investmentAdminMode = false;
    investmentAdminPanel.hidden = true;
    investmentAdminButton.textContent = '관리자 모드';
    if (investmentState) renderInvestmentState(investmentState);
    return;
  }
  const password = window.prompt('관리자 비밀번호를 입력하세요.');
  if (password !== '8170') {
    if (password !== null) window.alert('관리자 비밀번호가 틀렸습니다.');
    return;
  }
  investmentAdminMode = true;
  investmentAdminPanel.hidden = false;
  investmentAdminButton.textContent = '관리자 모드 종료';
  if (investmentState) renderInvestmentState(investmentState);
});

const requireInvestmentAdmin = () => {
  if (!investmentAdminMode) {
    window.alert('먼저 관리자 모드를 활성화하세요.');
    return false;
  }
  return true;
};

const runAdminMarketAction = async (rpcName, payload, successMessage) => {
  if (!requireInvestmentAdmin()) return;
  try {
    await callInvestmentRpc(rpcName, { p_admin_password: '8170', ...payload });
    await loadInvestmentState();
    adminMarketStatus.textContent = successMessage;
  } catch (error) {
    adminMarketStatus.textContent = error.message;
  }
};

adminResetAsset.addEventListener('click', () => {
  runAdminMarketAction(
    'investment_admin_reset_asset',
    { p_symbol: adminAssetSelect.value },
    '선택한 종목의 가격과 변동률을 초기화했습니다.'
  );
});

adminSplitAsset.addEventListener('click', async () => {
  const selectedName = adminAssetSelect.options[adminAssetSelect.selectedIndex]?.textContent || '선택한 종목';
  if (!await siteConfirm(`${selectedName}을(를) 1000분의 1 액면분할할까요?\n가격은 1/1000, 보유 수량은 1000배가 됩니다.`)) return;
  runAdminMarketAction(
    'investment_admin_split_asset',
    { p_symbol: adminAssetSelect.value },
    `${selectedName}을(를) 1000분의 1 액면분할했습니다.`
  );
});

adminResetAllAssets.addEventListener('click', async () => {
  if (!await siteConfirm('모든 종목의 가격과 변동률을 초기화할까요?')) return;
  runAdminMarketAction(
    'investment_admin_reset_all_assets',
    {},
    '모든 종목의 가격과 변동률을 초기화했습니다.'
  );
});

adminSaveVolatility.addEventListener('click', () => {
  const values = {
    p_normal_max: Number(document.querySelector('#admin-surge-normal-max').value),
    p_spike_chance: Number(document.querySelector('#admin-surge-chance').value),
    p_spike_min: Number(document.querySelector('#admin-surge-min').value),
    p_spike_max: Number(document.querySelector('#admin-surge-max').value),
    p_crash_chance: Number(document.querySelector('#admin-crash-chance').value),
    p_crash_min: Number(document.querySelector('#admin-crash-min').value),
    p_crash_max: Number(document.querySelector('#admin-crash-max').value)
  };
  if (Object.values(values).some((value) => !Number.isFinite(value))) {
    adminMarketStatus.textContent = '변동성 값을 숫자로 입력하세요.';
    return;
  }
  runAdminMarketAction(
    'investment_admin_set_surge_volatility',
    values,
    '급등주 변동성을 저장했습니다.'
  );
});

const hydrateInvestmentRankingLevels = async (state) => {
  if (!Array.isArray(state?.ranking) || !accountSession?.session_token) return state;
  try {
    const playerRanking = await callInvestmentRpc('sanggi_get_player_ranking', {
      p_session_token: accountSession.session_token
    });
    const levelsByNickname = new Map(
      (Array.isArray(playerRanking) ? playerRanking : []).map((entry) => [
        String(entry.nickname || '').trim(),
        Math.max(0, Number(entry.player_level) || 0)
      ])
    );
    return {
      ...state,
      ranking: state.ranking.map((entry) => ({
        ...entry,
        player_level: levelsByNickname.get(String(entry.nickname || '').trim())
          ?? Math.max(0, Number(entry.player_level) || 0)
      }))
    };
  } catch (error) {
    console.warn('투자 랭킹의 플레이어 레벨을 보완하지 못했습니다.', error);
    return state;
  }
};

const loadInvestmentState = async (nickname = investorNickname.value.trim()) => {
  if (!nickname) return;
  const state = await callInvestmentRpc('investment_get_state', {
    p_client_id: getInvestmentClientId(),
    p_nickname: nickname
  });
  const hydratedState = await hydrateInvestmentRankingLevels(state);
  renderInvestmentState(hydratedState);
};

const retryAccountInvestmentLink = async () => {
  if (!accountSession?.session_token) return false;
  const oldClientId = localStorage.getItem(legacyInvestmentClientKey);
  if (!oldClientId || oldClientId === accountSession.account_id) return false;

  const response = await fetch(`${rpcEndpoint}/investment_link_account`, {
    method: 'POST',
    headers: { ...apiHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      p_session_token: accountSession.session_token,
      p_old_client_id: oldClientId
    })
  });
  if (!response.ok) {
    throw new Error('기존 투자 정보를 계정에 연결하지 못했습니다.');
  }

  localStorage.setItem(investmentClientKey, accountSession.account_id);
  localStorage.removeItem(legacyInvestmentClientKey);
  return true;
};

investmentRefresh.addEventListener('click', async () => {
  if (!investmentState) {
    investorStatus.textContent = '먼저 고유 닉네임을 설정하세요.';
    return;
  }
  investmentRefresh.disabled = true;
  investmentRefresh.textContent = '불러오는 중...';
  try {
    await loadInvestmentState();
    investorStatus.textContent = '투자장 가격과 랭킹을 새로고침했습니다.';
  } catch (error) {
    investorStatus.textContent = error.message;
  } finally {
    investmentRefresh.disabled = false;
    investmentRefresh.textContent = '새로고침 ↻';
  }
});

const tradeInvestment = async (symbol, side, quantityInput) => {
  const quantityText = quantityInput.value.trim();
  if (!/^[0-9]+$/.test(quantityText) || BigInt(quantityText) < 1n) {
    window.alert('수량은 1주 이상 정수로 입력하세요.');
    return;
  }
  try {
    quantityInput.disabled = true;
    const state = await callInvestmentRpc('investment_trade', {
      p_client_id: getInvestmentClientId(),
      p_symbol: symbol,
      p_side: side,
      p_quantity: quantityText
    });
    investorStatus.textContent = side === 'buy' ? `${quantityText}주 매수했습니다.` : `${quantityText}주 매도했습니다.`;
    hydrateInvestmentRankingLevels(state).then(renderInvestmentState);
  } catch (error) {
    window.alert(error.message);
  } finally {
    quantityInput.disabled = false;
  }
};

investorForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = investorForm.querySelector('button');
  const nickname = investorNickname.value.trim();
  if (!nickname) return;
  button.disabled = true;
  investorStatus.textContent = '투자장을 여는 중...';
  try {
    await loadInvestmentState(nickname);
    localStorage.setItem('sangki-investor-nickname', nickname);
    investorStatus.textContent = '닉네임은 이 브라우저에서 변경할 수 없습니다.';
  } catch (error) {
    button.disabled = false;
    investorStatus.textContent = error.message;
  }
});

try {
  const savedNickname = localStorage.getItem('sangki-investor-nickname');
  if (savedNickname) {
    investorNickname.value = savedNickname;
      loadInvestmentState(savedNickname).catch((error) => {
      investorStatus.textContent = `투자 정보를 불러오지 못했습니다: ${error.message}`;
    });
  }
} catch {
  // Private browsing can block localStorage; the form remains usable.
}

if (accountSession?.session_token) {
  retryAccountInvestmentLink()
    .catch((error) => {
      console.warn('account investment link retry failed:', error.message);
    })
    .then(() => callInvestmentRpc('investment_build_state', {
      p_client_id: accountSession.account_id
    }))
    .then((state) => {
      if (!state?.nickname) return;
      localStorage.setItem(
        `sangki-account-nickname-${accountSession.account_id}`,
        state.nickname
      );
      localStorage.setItem('sangki-investor-nickname', state.nickname);
      investorNickname.value = state.nickname;
      hydrateInvestmentRankingLevels(state).then(renderInvestmentState);
    })
    .catch(() => {
      const savedNickname = localStorage.getItem('sangki-investor-nickname');
      if (savedNickname) {
        investorNickname.value = savedNickname;
      }
    });
}

const playerLevelRankingList = document.querySelector('#player-level-ranking-list');
const playerLevelRankingPagination = document.querySelector('#player-level-ranking-pagination');
let playerLevelRanking = [];
let playerLevelRankingPage = 1;
const PLAYER_LEVEL_RANKING_PER_PAGE = 5;

const renderPlayerLevelRanking = () => {
  if (!playerLevelRankingList || !playerLevelRankingPagination) return;
  const totalPages = Math.max(1, Math.ceil(
    playerLevelRanking.length / PLAYER_LEVEL_RANKING_PER_PAGE
  ));
  playerLevelRankingPage = Math.min(playerLevelRankingPage, totalPages);
  const start = (playerLevelRankingPage - 1) * PLAYER_LEVEL_RANKING_PER_PAGE;
  const pageItems = playerLevelRanking.slice(start, start + PLAYER_LEVEL_RANKING_PER_PAGE);
  playerLevelRankingList.replaceChildren(...(pageItems.length
    ? pageItems.map((entry) => {
      const item = document.createElement('li');
      const nickname = document.createElement('span');
      nickname.textContent = entry.nickname;
      const level = document.createElement('span');
      const playerLevel = Math.max(0, Number(entry.player_level) || 0);
      level.className = `ranking-value investment-level ${
        playerLevel <= 10 ? 'investment-level-gray'
          : playerLevel <= 50 ? 'investment-level-lime'
            : playerLevel <= 100 ? 'investment-level-blue'
              : playerLevel <= 500 ? 'investment-level-red'
                : playerLevel <= 1000 ? 'investment-level-orange'
                  : 'investment-level-purple'
      }`;
      level.textContent = `LV ${playerLevel}`;
      item.append(nickname, level);
      return item;
    })
    : [Object.assign(document.createElement('li'), {
      className: 'ranking-empty',
      textContent: '아직 플레이어 랭킹이 없습니다.'
    })]));
  if (!playerLevelRanking.length) {
    playerLevelRankingPagination.replaceChildren();
    return;
  }
  const previous = document.createElement('button');
  previous.type = 'button';
  previous.className = 'investment-page-button';
  previous.textContent = '← 이전';
  previous.disabled = playerLevelRankingPage === 1;
  previous.addEventListener('click', () => {
    playerLevelRankingPage -= 1;
    renderPlayerLevelRanking();
  });
  const pageNumber = document.createElement('span');
  pageNumber.className = 'investment-page-number';
  pageNumber.textContent = `${playerLevelRankingPage} / ${totalPages}`;
  const next = document.createElement('button');
  next.type = 'button';
  next.className = 'investment-page-button';
  next.textContent = '다음 →';
  next.disabled = playerLevelRankingPage === totalPages;
  next.addEventListener('click', () => {
    playerLevelRankingPage += 1;
    renderPlayerLevelRanking();
  });
  playerLevelRankingPagination.replaceChildren(previous, pageNumber, next);
};

const refreshPlayerLevelRanking = async () => {
  if (!playerLevelRankingList) return;
  if (!accountSession?.session_token) {
    playerLevelRanking = [];
    playerLevelRankingList.replaceChildren(Object.assign(document.createElement('li'), {
      className: 'ranking-empty',
      textContent: '로그인 후 랭킹을 불러옵니다.'
    }));
    playerLevelRankingPagination?.replaceChildren();
    return;
  }
  playerLevelRankingList.replaceChildren(Object.assign(document.createElement('li'), {
    className: 'ranking-empty',
    textContent: '랭킹을 불러오는 중...'
  }));
  try {
    const result = await callInvestmentRpc('sanggi_get_player_ranking', {
      p_session_token: accountSession.session_token
    });
    playerLevelRanking = Array.isArray(result) ? result : [];
    playerLevelRankingPage = 1;
    renderPlayerLevelRanking();
  } catch (error) {
    playerLevelRanking = [];
    playerLevelRankingPagination?.replaceChildren();
    playerLevelRankingList.replaceChildren(Object.assign(document.createElement('li'), {
      className: 'ranking-empty',
      textContent: error.message || '랭킹을 불러오지 못했습니다.'
    }));
  }
};

window.refreshPlayerLevelRanking = refreshPlayerLevelRanking;
refreshPlayerLevelRanking();

window.setInterval(() => {
  if (investmentState) loadInvestmentState().catch(() => {});
}, 60000);

const form = document.querySelector('#comment-form');
const comments = document.querySelector('#comments');
const status = document.querySelector('#form-status');
const refreshButton = document.querySelector('#comments-refresh');
const investorCommentToggle = document.querySelector('#investor-comment');
const commentNicknameField = document.querySelector('#comment-nickname-field');
const commentPasswordField = document.querySelector('#comment-password-field');
const investorCommentHint = document.querySelector('#investor-comment-hint');
const notificationToggle = document.querySelector('#notification-toggle');
const pagination = document.querySelector('#comments-pagination');
const COMMENTS_PER_PAGE = 10;
let currentPage = 1;
let allComments = [];
let commentsInitialized = false;
const WATCHED_COMMENTS_KEY = 'sangki-watched-comments';
const COMMENT_VOTER_KEY = 'sangki-comment-voter-key';
const NOTIFICATIONS_ENABLED_KEY = 'sangki-notifications-enabled';
const notifiedEvents = new Set();
let commentVoterKey = localStorage.getItem(COMMENT_VOTER_KEY);
if (!commentVoterKey) {
  commentVoterKey = crypto.randomUUID();
  localStorage.setItem(COMMENT_VOTER_KEY, commentVoterKey);
}

const getWatchedComments = () => {
  try {
    return JSON.parse(localStorage.getItem(WATCHED_COMMENTS_KEY) || '[]');
  } catch {
    return [];
  }
};

const watchComment = (id) => {
  const watched = new Set(getWatchedComments());
  watched.add(id);
  localStorage.setItem(WATCHED_COMMENTS_KEY, JSON.stringify([...watched]));
  scheduleSiteAccountStateSave();
};

const showNotification = (title, body, tag) => {
  if (Notification.permission !== 'granted'
    || localStorage.getItem(NOTIFICATIONS_ENABLED_KEY) === 'false'
    || notifiedEvents.has(tag)) return;
  notifiedEvents.add(tag);
  new Notification(title, { body, tag });
};

const requestNotifications = async () => {
  if (!('Notification' in window)) return;
  if (Notification.permission === 'default') {
    try {
      await Notification.requestPermission();
    } catch {
      // Permission prompts can be blocked by the browser.
    }
  }
};

const updateNotificationButton = () => {
  if (!('Notification' in window)) {
    notificationToggle.textContent = '알림 미지원';
    notificationToggle.disabled = true;
    return;
  }
  const permission = Notification.permission;
  const enabled = localStorage.getItem(NOTIFICATIONS_ENABLED_KEY) !== 'false';
  notificationToggle.classList.toggle('is-enabled', permission === 'granted' && enabled);
  notificationToggle.classList.toggle('is-blocked', permission === 'denied' || !enabled);
  notificationToggle.textContent = permission === 'granted'
    ? enabled ? '알림 켜짐' : '알림 꺼짐'
    : permission === 'denied'
      ? '알림 차단됨'
      : '알림 허용';
};

notificationToggle.addEventListener('click', async () => {
  if (!('Notification' in window)) return;
  if (Notification.permission === 'denied') {
    window.alert('브라우저 사이트 설정에서 알림을 허용한 뒤 다시 시도해주세요.');
    return;
  }
  if (Notification.permission === 'granted') {
    const enabled = localStorage.getItem(NOTIFICATIONS_ENABLED_KEY) !== 'false';
    localStorage.setItem(NOTIFICATIONS_ENABLED_KEY, String(!enabled));
    scheduleSiteAccountStateSave();
  } else {
    await requestNotifications();
    if (Notification.permission === 'granted') {
      localStorage.setItem(NOTIFICATIONS_ENABLED_KEY, 'true');
      scheduleSiteAccountStateSave();
    }
  }
  updateNotificationButton();
});

const escapeDate = (value) => new Intl.DateTimeFormat('ko-KR', {
  dateStyle: 'medium',
  timeStyle: 'short'
}).format(new Date(value));

const getInvestmentLevelClass = (level) => {
  const playerLevel = Math.max(0, Number(level) || 0);
  if (playerLevel <= 10) return 'investment-level-gray';
  if (playerLevel <= 50) return 'investment-level-lime';
  if (playerLevel <= 100) return 'investment-level-blue';
  if (playerLevel <= 500) return 'investment-level-red';
  if (playerLevel <= 1000) return 'investment-level-orange';
  return 'investment-level-purple';
};

const renderComment = (item, isReply = false) => {
  const article = document.createElement('article');
  article.className = isReply ? 'comment comment-reply' : 'comment';
  article.innerHTML = `
    <div class="comment-side">
      <strong class="comment-author"><span class="comment-author-name"></span></strong>
      <div class="comment-votes">
        <button class="comment-vote" type="button" data-vote="1">추천 <span></span></button>
        <button class="comment-vote" type="button" data-vote="-1">비추천 <span></span></button>
      </div>
    </div>
    <p class="comment-body"></p>
    <div class="comment-meta">
      <time class="comment-date"></time>
      <span class="edited"></span>
      <div class="comment-actions">
        <button class="comment-action" type="button" data-action="reply">답글</button>
        <button class="comment-action" type="button" data-action="edit">수정</button>
        <button class="comment-action" type="button" data-action="delete">삭제</button>
      </div>
    </div>
  `;
  const author = article.querySelector('.comment-author');
  if (item.author_account_id) {
    const level = document.createElement('small');
    level.className = `investment-level ${getInvestmentLevelClass(item.investor_level)}`;
    level.textContent = String(Math.max(0, Number(item.investor_level) || 0));
    author.prepend(level);
  }
  author.querySelector('.comment-author-name').textContent = item.nickname;
  article.querySelector('.comment-body').textContent = item.body;
  article.querySelector('[data-vote="1"] span').textContent = Number(item.upvotes) || 0;
  article.querySelector('[data-vote="-1"] span').textContent = Number(item.downvotes) || 0;
  article.querySelector('.comment-date').textContent = escapeDate(item.created_at);
  article.querySelector('.edited').textContent = item.edited_at ? '(edited)' : '';
  const replyButton = article.querySelector('[data-action="reply"]');
  replyButton.addEventListener('click', () => addReply(item.id));
  if (item.author_account_id) {
    article.querySelector('[data-action="edit"]').remove();
  }
  article.querySelectorAll('[data-vote]').forEach((button) => {
    button.addEventListener('click', async () => {
      button.disabled = true;
      try {
        const result = await callCommentRpc('comment_vote', {
          p_comment_id: item.id,
          p_voter_key: commentVoterKey,
          p_vote: Number(button.dataset.vote)
        });
        item.upvotes = result.upvotes;
        item.downvotes = result.downvotes;
        article.querySelector('[data-vote="1"] span').textContent = result.upvotes;
        article.querySelector('[data-vote="-1"] span').textContent = result.downvotes;
        article.querySelectorAll('[data-vote]').forEach((voteButton) => {
          voteButton.classList.toggle('is-selected', Number(voteButton.dataset.vote) === Number(result.vote));
        });
      } catch (error) {
        window.alert(error.message);
      } finally {
        button.disabled = false;
      }
    });
  });
  article.querySelector('[data-action="edit"]')?.addEventListener('click', () => editComment(item));
  article.querySelector('[data-action="delete"]')?.addEventListener('click', () => deleteComment(item));
  return article;
};

const renderComments = (items) => {
  if (!items.length) {
    comments.innerHTML = '<p class="comments-empty">아직 남겨진 흔적이 없습니다. 첫 번째 댓글을 남겨보세요.</p>';
    pagination.replaceChildren();
    return;
  }

  const rootComments = items
    .filter((item) => !item.parent_id)
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  const totalPages = Math.ceil(rootComments.length / COMMENTS_PER_PAGE);
  currentPage = Math.min(currentPage, totalPages);
  const pageStart = (currentPage - 1) * COMMENTS_PER_PAGE;
  const pageItems = rootComments.slice(pageStart, pageStart + COMMENTS_PER_PAGE);
  const replies = new Map();
  items.filter((item) => item.parent_id).forEach((item) => {
    if (!replies.has(item.parent_id)) replies.set(item.parent_id, []);
    replies.get(item.parent_id).push(item);
  });
  const nodes = [];
  const appendReplies = (parentId, depth = 0) => {
    (replies.get(parentId) || [])
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .forEach((reply) => {
        const node = renderComment(reply, true);
        node.style.marginLeft = `${Math.min(depth + 1, 4) * 18}px`;
        nodes.push(node);
        appendReplies(reply.id, depth + 1);
      });
  };
  pageItems.forEach((item) => {
    nodes.push(renderComment(item));
    appendReplies(item.id);
  });
  comments.replaceChildren(...nodes);
  renderPagination(totalPages);
};

const renderPagination = (totalPages) => {
  const previous = document.createElement('button');
  previous.className = 'comments-page-button';
  previous.type = 'button';
  previous.textContent = '← 이전';
  previous.disabled = currentPage === 1;
  previous.addEventListener('click', () => {
    currentPage -= 1;
    renderComments(allComments);
  });

  const number = document.createElement('span');
  number.className = 'comments-page-number';
  number.textContent = `${currentPage} / ${totalPages}`;

  const next = document.createElement('button');
  next.className = 'comments-page-button';
  next.type = 'button';
  next.textContent = '다음 →';
  next.disabled = currentPage === totalPages;
  next.addEventListener('click', () => {
    currentPage += 1;
    renderComments(allComments);
  });

  pagination.replaceChildren(previous, number, next);
};

const loadComments = async () => {
  try {
    const response = await fetch(`${commentsEndpoint}?select=id,nickname,body,created_at,edited_at,parent_id,author_account_id,investor_level,upvotes,downvotes&order=created_at.asc`, {
      headers: apiHeaders
    });
    if (!response.ok) throw new Error('댓글을 불러오지 못했습니다.');
    const nextComments = await response.json();
    if (commentsInitialized) {
      const watched = new Set(getWatchedComments());
      const previousById = new Map(allComments.map((item) => [item.id, item]));
      nextComments.forEach((item) => {
        if (item.parent_id && watched.has(item.parent_id) && !previousById.has(item.id)) {
          showNotification('새 답글이 달렸습니다', `${item.nickname}님이 회원님의 댓글에 답글을 남겼습니다.`, `reply-${item.id}`);
        }
      });
      allComments.forEach((item) => {
        if (watched.has(item.id) && !nextComments.some((next) => next.id === item.id)) {
          showNotification('댓글이 삭제되었습니다', '회원님의 댓글이 관리자 또는 작성자에 의해 삭제되었습니다.', `deleted-${item.id}`);
        }
      });
    }
    allComments = nextComments;
    commentsInitialized = true;
    renderComments(allComments);
  } catch (error) {
    comments.innerHTML = '<p class="comments-empty">댓글을 불러오지 못했습니다. 잠시 후 다시 확인해주세요.</p>';
  }
};

const addReply = async (parentId) => {
  const nickname = window.prompt('답글 작성자의 닉네임을 입력하세요.');
  if (nickname === null || !nickname.trim()) return;
  const password = requestPassword();
  if (password === null) return;
  const body = window.prompt('답글을 입력하세요.');
  if (body === null || !body.trim()) return;

  try {
    const response = await fetch(commentsEndpoint, {
      method: 'POST',
      headers: { ...apiHeaders, 'Content-Type': 'application/json', Prefer: 'return=representation' },
      body: JSON.stringify({
        nickname: nickname.trim(),
        body: body.trim(),
        password_hash: await hashPassword(password),
        parent_id: parentId
      })
    });
    if (!response.ok) throw new Error('답글 저장에 실패했습니다.');
    const [createdReply] = await response.json();
    watchComment(parentId);
    if (createdReply) watchComment(createdReply.id);
    await loadComments();
  } catch (error) {
    window.alert(error.message);
  }
};

const requestPassword = () => {
  const password = window.prompt('댓글의 4자리 비밀번호를 입력하세요.');
  if (password === null) return null;
  if (!/^\d{4}$/.test(password)) {
    window.alert('비밀번호는 숫자 4자리여야 합니다.');
    return null;
  }
  return password;
};

const callCommentRpc = async (name, payload) => {
  const response = await fetch(`${rpcEndpoint}/${name}`, {
    method: 'POST',
    headers: { ...apiHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!response.ok) {
    let detail = '';
    try {
      const error = await response.json();
      detail = error.message || error.hint || '';
    } catch {
      detail = '';
    }
    throw new Error(detail || 'Supabase 요청에 실패했습니다.');
  }
  return response.json();
};

refreshButton.addEventListener('click', async () => {
  refreshButton.disabled = true;
  refreshButton.textContent = '불러오는 중...';
  await loadComments();
  refreshButton.disabled = false;
  refreshButton.textContent = '새로고침 ↻';
});

const editComment = async (item) => {
  const password = requestPassword();
  if (password === null) return;
  const body = window.prompt('수정할 댓글을 입력하세요.', item.body);
  if (body === null || !body.trim()) return;

  try {
    const updated = await callCommentRpc('update_comment', {
      p_id: item.id,
      p_password_hash: await hashPassword(password),
      p_body: body
    });
    if (!updated) throw new Error('비밀번호가 틀렸거나 댓글을 수정할 수 없습니다.');
    await loadComments();
  } catch (error) {
    window.alert(error.message);
  }
};

const deleteComment = async (item) => {
  const isInvestorComment = Boolean(item.author_account_id);
  if (isInvestorComment && !accountSession?.session_token) {
    window.alert('이 투자자 댓글을 삭제하려면 작성한 계정으로 로그인해야 합니다.');
    return;
  }
  const password = isInvestorComment ? null : requestPassword();
  if (!isInvestorComment && password === null) return;
  const isAdmin = !isInvestorComment && password === '8170';
  if (!await siteConfirm(isInvestorComment
    ? '로그인한 본인의 투자자 댓글을 삭제할까요?'
    : isAdmin ? '관리자 권한으로 이 댓글을 삭제할까요?' : '이 댓글을 삭제할까요?')) return;

  try {
    const deleted = isInvestorComment
      ? await callCommentRpc('delete_investor_comment', {
        p_id: item.id,
        p_session_token: accountSession.session_token
      })
      : await callCommentRpc('delete_comment', {
        p_id: item.id,
        p_password_hash: await hashPassword(password),
        p_admin_password: isAdmin ? password : ''
      });
    if (!deleted) {
      throw new Error(isInvestorComment
        ? '작성한 계정으로 로그인했는지 확인해주세요.'
        : '비밀번호가 틀렸거나 댓글을 삭제할 수 없습니다.');
    }
    await loadComments();
  } catch (error) {
    window.alert(error.message);
  }
};

const hashPassword = async (password) => {
  const data = new TextEncoder().encode(password);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('');
};

const gameStart = document.querySelector('#game-start');
const gameAnswerForm = document.querySelector('#game-answer-form');
const gameAnswer = document.querySelector('#game-answer');
const gameQuestion = document.querySelector('#game-question');
const gameTime = document.querySelector('#game-time');
const gameQuestionNumber = document.querySelector('#game-question-number');
const gamePlayer = document.querySelector('#game-player');
const gameMessage = document.querySelector('#game-message');
const gameRankingList = document.querySelector('#game-ranking-list');
const gameRankingPagination = document.querySelector('#game-ranking-pagination');
let gameState = null;
let gameTimer = null;
let gameRankingPage = 1;
const GAME_RANKING_PER_PAGE = 5;

const randomInteger = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

const createGameQuestion = () => {
  const first = gameState.questionNumber >= 10 ? randomInteger(100, 999) : randomInteger(10, 99);
  const second = randomInteger(10, 99);
  gameState.first = first;
  gameState.second = second;
  gameQuestion.textContent = `${first} × ${second}`;
};

const endGame = async (message) => {
  window.clearInterval(gameTimer);
  gameTimer = null;
  gameAnswer.disabled = true;
  document.querySelector('#game-submit').disabled = true;
  gameStart.disabled = false;
  gameStart.textContent = '다시 시작';
  const answer = gameState.first * gameState.second;
  gameMessage.textContent = `${message} 정답은 ${answer}입니다. 총 ${gameState.solved}문제를 풀었습니다.`;

  try {
    const response = await fetch(scoresEndpoint, {
      method: 'POST',
      headers: { ...apiHeaders, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ nickname: gameState.nickname, solved_count: gameState.solved })
    });
    if (!response.ok) throw new Error('랭킹 저장에 실패했습니다.');
    await loadGameRanking();
  } catch (error) {
    gameMessage.textContent += ` ${error.message}`;
  }
};

const tickGame = () => {
  gameState.remaining -= .1;
  gameTime.textContent = Math.max(0, gameState.remaining).toFixed(1);
  if (gameState.remaining <= 0) endGame('시간이 끝났습니다.');
};

const startGame = () => {
  const nickname = window.prompt('닉네임을 입력하세요.');
  if (nickname === null || !nickname.trim()) return;
  gameState = { nickname: nickname.trim().slice(0, 24), questionNumber: 1, solved: 0, remaining: 10 };
  gamePlayer.textContent = `player — ${gameState.nickname}`;
  gameQuestionNumber.textContent = '1';
  gameTime.textContent = '10.0';
  gameAnswer.disabled = false;
  document.querySelector('#game-submit').disabled = false;
  gameStart.disabled = true;
  gameMessage.textContent = '정답을 입력하고 Enter를 누르세요.';
  createGameQuestion();
  gameAnswer.value = '';
  gameAnswer.focus();
  gameTimer = window.setInterval(tickGame, 100);
};

gameStart.addEventListener('click', startGame);
gameAnswerForm.addEventListener('submit', (event) => {
  event.preventDefault();
  if (!gameState || gameAnswer.disabled) return;
  const answer = Number(gameAnswer.value);
  if (answer === gameState.first * gameState.second) {
    gameState.solved += 1;
    gameState.questionNumber += 1;
    gameState.remaining = Math.max(3, 10 - (gameState.questionNumber - 1));
    gameQuestionNumber.textContent = String(gameState.questionNumber);
    gameTime.textContent = gameState.remaining.toFixed(1);
    createGameQuestion();
    gameAnswer.value = '';
    gameMessage.textContent = gameState.questionNumber >= 10
      ? '3자리 × 2자리 문제입니다. 계속 빠르게 풀어보세요.'
      : '정답입니다. 다음 문제!';
  } else {
    gameMessage.textContent = '오답입니다. 다시 입력하세요.';
    gameAnswer.select();
  }
});

const loadGameRanking = async () => {
  try {
    const response = await fetch(`${scoresEndpoint}?select=id,nickname,solved_count,created_at&order=solved_count.desc,created_at.asc&limit=1000`, {
      headers: apiHeaders
    });
    if (!response.ok) throw new Error('랭킹을 불러오지 못했습니다.');
    const scores = await response.json();
    if (!scores.length) {
      gameRankingList.innerHTML = '<li class="ranking-empty">아직 기록이 없습니다.</li>';
      gameRankingPagination.replaceChildren();
      return;
    }
    const totalPages = Math.max(1, Math.ceil(scores.length / GAME_RANKING_PER_PAGE));
    gameRankingPage = Math.min(gameRankingPage, totalPages);
    const start = (gameRankingPage - 1) * GAME_RANKING_PER_PAGE;
    const visibleScores = scores.slice(start, start + GAME_RANKING_PER_PAGE);
    gameRankingList.replaceChildren(...visibleScores.map((score) => {
      const item = document.createElement('li');
      const name = document.createElement('span');
      name.textContent = score.nickname;
      const value = document.createElement('span');
      value.className = 'ranking-score';
      value.textContent = `${score.solved_count}문제`;
      const deleteButton = document.createElement('button');
      deleteButton.className = 'ranking-delete';
      deleteButton.type = 'button';
      deleteButton.textContent = '관리자 삭제';
      deleteButton.addEventListener('click', () => deleteGameScore(score.id));
      item.append(name, value, deleteButton);
      return item;
    }));
    const previous = document.createElement('button');
    previous.type = 'button';
    previous.className = 'game-page-button';
    previous.textContent = '← 이전';
    previous.disabled = gameRankingPage === 1;
    previous.addEventListener('click', () => {
      gameRankingPage -= 1;
      loadGameRanking();
    });

    const pageNumber = document.createElement('span');
    pageNumber.className = 'game-page-number';
    pageNumber.textContent = `${gameRankingPage} / ${totalPages}`;

    const next = document.createElement('button');
    next.type = 'button';
    next.className = 'game-page-button';
    next.textContent = '다음 →';
    next.disabled = gameRankingPage === totalPages;
    next.addEventListener('click', () => {
      gameRankingPage += 1;
      loadGameRanking();
    });

    gameRankingPagination.replaceChildren(previous, pageNumber, next);
  } catch {
    gameRankingList.innerHTML = '<li class="ranking-empty">랭킹을 불러오지 못했습니다.</li>';
    gameRankingPagination.replaceChildren();
  }
};

const deleteGameScore = async (id) => {
  const password = window.prompt('관리자 비밀번호를 입력하세요.');
  if (password === null || !await siteConfirm('이 랭킹 기록을 삭제할까요?')) return;

  try {
    const response = await fetch(`${rpcEndpoint}/delete_speed_game_score`, {
      method: 'POST',
      headers: { ...apiHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_id: id, p_admin_password: password })
    });
    if (!response.ok || !(await response.json())) {
      throw new Error('관리자 비밀번호가 틀렸거나 삭제할 수 없습니다.');
    }
    await loadGameRanking();
  } catch (error) {
    window.alert(error.message);
  }
};

loadGameRanking();

const updateInvestorCommentFields = () => {
  const enabled = investorCommentToggle.checked;
  const storedPlayerLevel = Math.max(0, Number(localStorage.getItem('sanggi-player-level')) || 0);
  commentNicknameField.hidden = enabled;
  commentPasswordField.hidden = enabled;
  document.querySelector('#nickname').required = !enabled;
  document.querySelector('#password').required = !enabled;
  if (enabled) {
    if (accountSession?.account_id && investmentState?.nickname) {
      investorCommentHint.textContent = storedPlayerLevel
        ? `현재 표시: 레벨 ${storedPlayerLevel} · ${investmentState.nickname} — 댓글에도 작은 색상 레벨 숫자와 닉네임으로 표시됩니다.`
        : `${investmentState.nickname} — 댓글에 플레이어 레벨과 닉네임으로 표시됩니다.`;
      investorCommentHint.classList.remove('is-error');
    } else {
      investorCommentHint.textContent = '로그인하고 투자 닉네임을 설정해야 사용할 수 있습니다.';
      investorCommentHint.classList.add('is-error');
    }
  } else {
    investorCommentHint.textContent = '체크하면 로그인한 투자자의 플레이어 레벨과 고유 닉네임으로 댓글을 작성합니다.';
    investorCommentHint.classList.remove('is-error');
  }
};
investorCommentToggle.addEventListener('change', updateInvestorCommentFields);
updateInvestorCommentFields();

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const submit = form.querySelector('button');
  const formData = new FormData(form);
  const useInvestorIdentity = investorCommentToggle.checked;
  const password = formData.get('password');
  let nickname = formData.get('nickname').trim();
  let passwordHash = '';
  let authorAccountId = null;
  let investorLevel = null;
  if (useInvestorIdentity) {
    if (!accountSession?.account_id || !investmentState?.nickname) {
      status.textContent = '투자자 닉네임으로 작성하려면 로그인하고 투자 닉네임을 설정하세요.';
      investorCommentHint.classList.add('is-error');
      return;
    }
    nickname = investmentState.nickname;
    authorAccountId = accountSession.account_id;
    investorLevel = Number(investmentState.player_level) || 1;
    passwordHash = await hashPassword(accountSession.session_token);
  } else {
    passwordHash = await hashPassword(password);
  }
  submit.disabled = true;
  status.textContent = '저장하는 중...';

  try {
    if (useInvestorIdentity) {
      const created = await callCommentRpc('create_investor_comment', {
        p_session_token: accountSession.session_token,
        p_body: formData.get('comment').trim()
      });
      form.reset();
      updateInvestorCommentFields();
      if (created?.id) watchComment(created.id);
      status.textContent = '댓글이 저장되었습니다.';
      currentPage = 1;
      await loadComments();
      return;
    }
    const response = await fetch(commentsEndpoint, {
      method: 'POST',
      headers: {
        ...apiHeaders,
        'Content-Type': 'application/json',
        Prefer: 'return=representation'
      },
      body: JSON.stringify({
        nickname,
        body: formData.get('comment').trim(),
        password_hash: passwordHash,
        author_account_id: authorAccountId,
        investor_level: investorLevel
      })
    });

    if (!response.ok) throw new Error('댓글 저장에 실패했습니다.');
    const [createdComment] = await response.json();
    form.reset();
    updateInvestorCommentFields();
    if (createdComment) watchComment(createdComment.id);
    status.textContent = '댓글이 저장되었습니다.';
    currentPage = 1;
    await loadComments();
  } catch (error) {
    status.textContent = error.message;
  } finally {
    submit.disabled = false;
  }
});

requestNotifications().then(updateNotificationButton);
updateNotificationButton();
if (accountSession?.session_token) {
  loadSiteAccountState()
    .then(updateNotificationButton)
    .catch((error) => console.warn('account site state restore failed:', error.message));
}
loadComments();
window.setInterval(loadComments, 20000);
