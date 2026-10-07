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
  if (!accountSession?.session_token) {
    onlineUsersList.replaceChildren(Object.assign(document.createElement('li'), {
      textContent: '로그인 후 표시됩니다.'
    }));
    return;
  }
  try {
    const users = await callInvestmentRpc('site_account_online_users', {});
    onlineUsersList.replaceChildren(...(users.length
      ? users.map((user) => Object.assign(document.createElement('li'), {
        textContent: user.nickname
      }))
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
let accountMode = 'login';
let accountSession = null;
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
  accountButton.textContent = accountSession?.username
    ? `${accountSession.username} · 로그아웃`
    : '로그인';
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
  const previousClientId = localStorage.getItem(investmentClientKey);
  const previousNickname = localStorage.getItem('sangki-investor-nickname');
  const oldClientId = previousClientId && previousClientId !== result.account_id
    ? previousClientId
    : null;
  accountSession = result;
  if (rememberUsername.checked) {
    localStorage.setItem(rememberedUsernameKey, normalizedUsername);
  } else {
    localStorage.removeItem(rememberedUsernameKey);
  }
  if (keepLogin.checked) {
    localStorage.setItem(keepLoginKey, 'true');
    localStorage.setItem(accountStorageKey, JSON.stringify(result));
    sessionStorage.removeItem(accountSessionStorageKey);
  } else {
    localStorage.removeItem(keepLoginKey);
    localStorage.removeItem(accountStorageKey);
    sessionStorage.setItem(accountSessionStorageKey, JSON.stringify(result));
  }
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
  updateAccountButton();
  const savedAccountNickname = localStorage.getItem(
    `sangki-account-nickname-${accountSession.account_id}`
  );
  if (savedAccountNickname) {
    investorNickname.value = savedAccountNickname;
    await loadInvestmentState(savedAccountNickname);
  }
};
accountButton.addEventListener('click', () => {
  if (accountSession) {
    if (!window.confirm('정말로 로그아웃하시겠습니까?')) return;
    accountSession = null;
    localStorage.removeItem(accountStorageKey);
    sessionStorage.removeItem(accountSessionStorageKey);
    clearInvestmentView();
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
  const storedSession = localStorage.getItem(keepLoginKey) === 'true'
    ? localStorage.getItem(accountStorageKey)
    : sessionStorage.getItem(accountSessionStorageKey);
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
const logoutAccount = () => {
  accountSession = null;
  localStorage.removeItem(accountStorageKey);
  sessionStorage.removeItem(accountSessionStorageKey);
  clearInvestmentView();
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
settingsLogout.addEventListener('click', () => {
  if (!accountSession) {
    settingsStatus.textContent = '로그인된 계정이 없습니다.';
    return;
  }
  logoutAccount();
});
settingsDeleteAccount.addEventListener('click', async () => {
  if (!accountSession) {
    settingsStatus.textContent = '로그인된 계정이 없습니다.';
    return;
  }
  if (!window.confirm('아이디와 연결된 투자 정보, 세션을 모두 삭제할까요? 이 작업은 되돌릴 수 없습니다.')) return;
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
const investmentRefresh = document.querySelector('#investment-refresh');
const investmentHoldings = document.querySelector('#investment-holdings');
const holdingsList = document.querySelector('#holdings-list');
const investmentRankingList = document.querySelector('#investment-ranking-list');
const investmentRankingPagination = document.querySelector('#investment-ranking-pagination');
const investmentAdminButton = document.querySelector('#investment-admin-button');
const investmentAdminPanel = document.querySelector('#investment-admin-panel');
const adminAssetSelect = document.querySelector('#admin-asset-select');
const adminResetAsset = document.querySelector('#admin-reset-asset');
const adminResetAllAssets = document.querySelector('#admin-reset-all-assets');
const adminSaveVolatility = document.querySelector('#admin-save-volatility');
const adminMarketStatus = document.querySelector('#admin-market-status');
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

updateOnlinePresence();
window.setInterval(updateOnlinePresence, 60000);

const renderInvestmentState = (state) => {
  investmentState = state;
  investorNickname.value = state.nickname;
  investorNickname.disabled = true;
  investorForm.querySelector('button').disabled = true;
  portfolioSummary.hidden = false;
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
    if (asset.split_notice) notices.push('주식 분할 된 상품입니다');
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
    quantity.type = 'number';
    quantity.min = '1';
    quantity.step = '1';
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
      quantity.value = String(Math.floor(state.cash / asset.current_price));
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
    quantity.type = 'number';
    quantity.min = '1';
    quantity.step = '1';
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
      quantity.value = String(Math.floor(state.cash / asset.current_price));
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
    name.textContent = entry.nickname;
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

const grantInvestmentCash = async (clientId, amountInput) => {
  const amount = Number(amountInput.value);
  if (!Number.isSafeInteger(amount) || amount < 1) {
    window.alert('지급액은 1원 이상의 정수로 입력하세요.');
    return;
  }
  if (!window.confirm(`${formatWon(amount)}을 지급할까요?`)) return;
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
  if (!window.confirm(`${formatWon(amount)}을 차감할까요?`)) return;
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

adminResetAllAssets.addEventListener('click', () => {
  if (!window.confirm('모든 종목의 가격과 변동률을 초기화할까요?')) return;
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

const loadInvestmentState = async (nickname = investorNickname.value.trim()) => {
  if (!nickname) return;
  const state = await callInvestmentRpc('investment_get_state', {
    p_client_id: getInvestmentClientId(),
    p_nickname: nickname
  });
  renderInvestmentState(state);
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
  const quantity = Number(quantityInput.value);
  if (!Number.isInteger(quantity) || quantity < 1) {
    window.alert('수량은 1주 이상 정수로 입력하세요.');
    return;
  }
  try {
    quantityInput.disabled = true;
    const state = await callInvestmentRpc('investment_trade', {
      p_client_id: getInvestmentClientId(),
      p_symbol: symbol,
      p_side: side,
      p_quantity: quantity
    });
    investorStatus.textContent = side === 'buy' ? `${quantity}주 매수했습니다.` : `${quantity}주 매도했습니다.`;
    renderInvestmentState(state);
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

window.setInterval(() => {
  if (investmentState) loadInvestmentState().catch(() => {});
}, 60000);

const form = document.querySelector('#comment-form');
const comments = document.querySelector('#comments');
const status = document.querySelector('#form-status');
const refreshButton = document.querySelector('#comments-refresh');
const notificationToggle = document.querySelector('#notification-toggle');
const pagination = document.querySelector('#comments-pagination');
const COMMENTS_PER_PAGE = 10;
let currentPage = 1;
let allComments = [];
let commentsInitialized = false;
const WATCHED_COMMENTS_KEY = 'sangki-watched-comments';
const NOTIFICATIONS_ENABLED_KEY = 'sangki-notifications-enabled';
const notifiedEvents = new Set();

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
  } else {
    await requestNotifications();
    if (Notification.permission === 'granted') {
      localStorage.setItem(NOTIFICATIONS_ENABLED_KEY, 'true');
    }
  }
  updateNotificationButton();
});

const escapeDate = (value) => new Intl.DateTimeFormat('ko-KR', {
  dateStyle: 'medium',
  timeStyle: 'short'
}).format(new Date(value));

const renderComment = (item, isReply = false) => {
  const article = document.createElement('article');
  article.className = isReply ? 'comment comment-reply' : 'comment';
  article.innerHTML = `
    <strong class="comment-author"></strong>
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
  article.querySelector('.comment-author').textContent = item.nickname;
  article.querySelector('.comment-body').textContent = item.body;
  article.querySelector('.comment-date').textContent = escapeDate(item.created_at);
  article.querySelector('.edited').textContent = item.edited_at ? '(edited)' : '';
  const replyButton = article.querySelector('[data-action="reply"]');
  if (isReply) {
    replyButton.remove();
  } else {
    replyButton.addEventListener('click', () => addReply(item.id));
  }
  article.querySelector('[data-action="edit"]').addEventListener('click', () => editComment(item));
  article.querySelector('[data-action="delete"]').addEventListener('click', () => deleteComment(item.id));
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
  pageItems.forEach((item) => {
    nodes.push(renderComment(item));
    (replies.get(item.id) || [])
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .forEach((reply) => nodes.push(renderComment(reply, true)));
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
    const response = await fetch(`${commentsEndpoint}?select=id,nickname,body,created_at,edited_at,parent_id&order=created_at.asc`, {
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

const deleteComment = async (id) => {
  const password = requestPassword();
  if (password === null) return;
  const isAdmin = password === '8170';
  if (!window.confirm(isAdmin ? '관리자 권한으로 이 댓글을 삭제할까요?' : '이 댓글을 삭제할까요?')) return;

  try {
    const deleted = await callCommentRpc('delete_comment', {
      p_id: id,
      p_password_hash: await hashPassword(password),
      p_admin_password: isAdmin ? password : ''
    });
    if (!deleted) {
      throw new Error('비밀번호가 틀렸거나 댓글을 삭제할 수 없습니다.');
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
  if (password === null || !window.confirm('이 랭킹 기록을 삭제할까요?')) return;

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

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const submit = form.querySelector('button');
  const formData = new FormData(form);
  const password = formData.get('password');
  submit.disabled = true;
  status.textContent = '저장하는 중...';

  try {
    const response = await fetch(commentsEndpoint, {
      method: 'POST',
      headers: {
        ...apiHeaders,
        'Content-Type': 'application/json',
        Prefer: 'return=representation'
      },
      body: JSON.stringify({
        nickname: formData.get('nickname').trim(),
        body: formData.get('comment').trim(),
        password_hash: await hashPassword(password)
      })
    });
    if (!response.ok) throw new Error('댓글 저장에 실패했습니다.');
    const [createdComment] = await response.json();
    form.reset();
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
loadComments();
window.setInterval(loadComments, 20000);
