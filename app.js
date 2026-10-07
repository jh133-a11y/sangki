const SUPABASE_URL = 'https://ejrwrwjsgizzxhqybtff.supabase.co';
const SUPABASE_KEY = 'sb_publishable_Mr64z4NO3wlqeKObCxLbBQ_HlhvG7D8';
const commentsEndpoint = `${SUPABASE_URL}/rest/v1/comments`;
const rpcEndpoint = `${SUPABASE_URL}/rest/v1/rpc`;
const scoresEndpoint = `${SUPABASE_URL}/rest/v1/speed_game_scores`;
const investmentClientKey = 'sangki-investment-client-id';
const apiHeaders = {
  apikey: SUPABASE_KEY,
  Authorization: `Bearer ${SUPABASE_KEY}`
};

const accountStorageKey = 'sangki-auth-session';
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

const accountHeaders = () => apiHeaders;
const setAccountStatus = (message) => { accountStatus.textContent = message; };
const updateAccountButton = () => {
  accountButton.textContent = accountSession?.username ? `${accountSession.username} - Logout` : 'Login';
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
  accountSession = result;
  localStorage.setItem(accountStorageKey, JSON.stringify(result));
  const linkResponse = await fetch(`${rpcEndpoint}/investment_link_account`, {
    method: 'POST',
    headers: { ...apiHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_session_token: accountSession.session_token, p_old_client_id: getInvestmentClientId() })
  });
  if (!linkResponse.ok) throw new Error('기존 투자 정보를 계정에 연결하지 못했습니다.');
  localStorage.setItem(investmentClientKey, accountSession.account_id);
};
accountButton.addEventListener('click', () => {
  if (accountSession) {
    accountSession = null;
    localStorage.removeItem(accountStorageKey);
    updateAccountButton();
    return;
  }
  accountModal.hidden = false;
  accountBackdrop.hidden = false;
  accountUsername.focus();
});
accountClose.addEventListener('click', closeAccountModal);
accountBackdrop.addEventListener('click', closeAccountModal);
accountSwitch.addEventListener('click', () => {
  accountMode = accountMode === 'login' ? 'signup' : 'login';
  accountSubmit.textContent = accountMode === 'login' ? 'Login' : 'Sign up';
  accountSwitch.textContent = accountMode === 'login' ? 'Switch to sign up' : 'Switch to login';
});
accountForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  accountSubmit.disabled = true;
  setAccountStatus('Processing...');
  try {
    await authenticateAccount(accountUsername.value, accountPassword.value);
    closeAccountModal();
    if (document.querySelector('#investor-nickname')?.value.trim()) await loadInvestmentState();
  } catch (error) {
    setAccountStatus(error.message);
  } finally {
    accountSubmit.disabled = false;
  }
});try {
  accountSession = JSON.parse(localStorage.getItem(accountStorageKey) || 'null');
} catch {
  accountSession = null;
}
if (accountSession?.account_id) {
  localStorage.setItem(investmentClientKey, accountSession.account_id);
}
updateAccountButton();

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
  menuToggle.setAttribute('aria-label', '?ъ씠?쒕컮 ?닿린');
  sideMenu.setAttribute('aria-hidden', 'true');
};

menuToggle.addEventListener('click', () => {
  const isOpen = sideMenu.classList.toggle('is-open');
  sideMenuBackdrop.classList.toggle('is-open', isOpen);
  menuToggle.setAttribute('aria-expanded', String(isOpen));
  menuToggle.setAttribute('aria-label', isOpen ? '?ъ씠?쒕컮 ?リ린' : '?ъ씠?쒕컮 ?닿린');
  sideMenu.setAttribute('aria-hidden', String(!isOpen));
});

sideMenuClose.addEventListener('click', closeSideMenu);
sideMenuBackdrop.addEventListener('click', closeSideMenu);

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

const formatWon = (value) => `??{Number(value || 0).toLocaleString('ko-KR')}`;

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
    throw new Error(detail || '?ъ옄???붿껌???ㅽ뙣?덉뒿?덈떎.');
  }
  return response.json();
};

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
  marketUpdated.textContent = `${state.market_date} 쨌 5遺꾨쭏??媛깆떊`;

  investmentProducts.replaceChildren(...state.assets.map((asset) => {
    const row = document.createElement('article');
    row.className = 'investment-product';
    const name = document.createElement('div');
    name.innerHTML = `<strong class="investment-product-name"></strong><span class="investment-product-symbol"></span><small class="investment-product-notices"></small>`;
    name.querySelector('strong').textContent = asset.name;
    name.querySelector('span').textContent = asset.listed ? asset.symbol : '?곸옣?먯? 쨌 ?ㅼ쓬 媛깆떊 ???ъ긽??;
    const notices = [];
    if (asset.split_notice) notices.push('二쇱떇 遺꾪븷 ???곹뭹?낅땲??);
    if (asset.was_delisted && asset.listed) notices.push('?댁쟾???곸옣?먯? ?섏뿀???곹뭹?낅땲??);
    name.querySelector('.investment-product-notices').textContent = notices.join(' 쨌 ');
    const price = document.createElement('strong');
    price.className = 'investment-price';
    price.textContent = asset.listed ? formatWon(asset.current_price) : '??;
    const change = document.createElement('span');
    change.className = 'investment-change';
    if (!asset.listed) {
      change.classList.add('flat');
      change.textContent = '?곸옣?먯?';
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
    buy.textContent = '留ㅼ닔';
    buy.disabled = !asset.listed;
    buy.addEventListener('click', () => tradeInvestment(asset.symbol, 'buy', quantity));
    const sell = document.createElement('button');
    sell.type = 'button';
    sell.textContent = '留ㅻ룄';
    sell.disabled = !asset.listed;
    sell.addEventListener('click', () => tradeInvestment(asset.symbol, 'sell', quantity));
    const maxBuy = document.createElement('button');
    maxBuy.type = 'button';
    maxBuy.textContent = '理쒕? 留ㅼ닔';
    maxBuy.disabled = !asset.listed;
    maxBuy.addEventListener('click', () => {
      quantity.value = String(Math.floor(state.cash / asset.current_price));
    });
    const maxSell = document.createElement('button');
    maxSell.type = 'button';
    maxSell.textContent = '理쒕? 留ㅻ룄';
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
    name.querySelector('small').textContent = `${holding.quantity}二?蹂댁쑀`;
    const change = document.createElement('span');
    const changePct = asset ? Number(asset.change_pct) : 0;
    change.className = `holding-change ${changePct > 0 ? 'positive' : changePct < 0 ? 'negative' : 'flat'}`;
    change.textContent = asset && asset.listed
      ? `${changePct > 0 ? '+' : ''}${changePct.toFixed(2)}%`
      : '?곸옣?먯?';
    const total = document.createElement('strong');
    total.className = 'holding-value';
    total.innerHTML = '<span></span><small></small>';
    total.querySelector('span').textContent = formatWon(value);
    total.querySelector('small').textContent = `?ъ옄湲덉븸 ${formatWon(invested)}`;
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
    buy.textContent = '留ㅼ닔';
    buy.disabled = !asset || !asset.listed;
    buy.addEventListener('click', () => tradeInvestment(holding.symbol, 'buy', quantity));
    const sell = document.createElement('button');
    sell.type = 'button';
    sell.textContent = '留ㅻ룄';
    sell.disabled = !asset || !asset.listed;
    sell.addEventListener('click', () => tradeInvestment(holding.symbol, 'sell', quantity));
    const maxBuy = document.createElement('button');
    maxBuy.type = 'button';
    maxBuy.textContent = '理쒕? 留ㅼ닔';
    maxBuy.disabled = !asset || !asset.listed;
    maxBuy.addEventListener('click', () => {
      quantity.value = String(Math.floor(state.cash / asset.current_price));
    });
    const maxSell = document.createElement('button');
    maxSell.type = 'button';
    maxSell.textContent = '理쒕? 留ㅻ룄';
    maxSell.disabled = !asset || !asset.listed;
    maxSell.addEventListener('click', () => {
      quantity.value = String(holding.quantity);
    });
    trade.append(quantity, buy, sell, maxBuy, maxSell);
    total.dataset.return = returnPct;
    const returnValue = document.createElement('span');
    returnValue.className = `holding-return ${returnPct > 0 ? 'positive' : returnPct < 0 ? 'negative' : 'flat'}`;
    returnValue.textContent = `?섏씡瑜?${returnPct > 0 ? '+' : ''}${returnPct.toFixed(2)}%`;
    row.append(name, total, returnValue, change, trade);
    return row;
  }) : [Object.assign(document.createElement('p'), {
    className: 'investment-empty',
    textContent: '?꾩쭅 蹂댁쑀??醫낅ぉ???놁뒿?덈떎.'
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
      const grant = document.createElement('div');
      grant.className = 'ranking-grant';
      const amount = document.createElement('input');
      amount.type = 'number';
      amount.min = '1';
      amount.step = '1000';
      amount.placeholder = '吏湲됱븸';
      const grantButton = document.createElement('button');
      grantButton.type = 'button';
      grantButton.textContent = '?꾧툑 吏湲?;
      grantButton.addEventListener('click', () => grantInvestmentCash(entry.client_id, amount));
      const deductButton = document.createElement('button');
      deductButton.type = 'button';
      deductButton.textContent = '?꾧툑 李④컧';
      deductButton.addEventListener('click', () => adjustInvestmentCash(entry.client_id, amount, 'subtract'));
      grant.append(amount, grantButton, deductButton);
      item.append(grant);
    }
    return item;
  }) : [Object.assign(document.createElement('li'), {
    className: 'ranking-empty',
    textContent: '?꾩쭅 ?ъ옄?먭? ?놁뒿?덈떎.'
  })]));
  const previous = document.createElement('button');
  previous.type = 'button';
  previous.className = 'investment-page-button';
  previous.textContent = '???댁쟾';
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
  next.textContent = '?ㅼ쓬 ??;
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
    window.alert('吏湲됱븸? 1???댁긽???뺤닔濡??낅젰?섏꽭??');
    return;
  }
  if (!window.confirm(`${formatWon(amount)}??吏湲됲븷源뚯슂?`)) return;
  try {
    amountInput.disabled = true;
    await callInvestmentRpc('investment_admin_grant_cash', {
      p_admin_password: '8170',
      p_target_client_id: clientId,
      p_amount: amount
    });
    amountInput.value = '';
    await loadInvestmentState();
    investorStatus.textContent = '?꾧툑 吏湲됱씠 ?꾨즺?섏뿀?듬땲??';
  } catch (error) {
    window.alert(error.message);
  } finally {
    amountInput.disabled = false;
  }
};

const adjustInvestmentCash = async (clientId, amountInput, action) => {
  const amount = Number(amountInput.value);
  if (!Number.isSafeInteger(amount) || amount < 1) {
    window.alert('李④컧?≪? 1???댁긽???뺤닔濡??낅젰?섏꽭??');
    return;
  }
  if (!window.confirm(`${formatWon(amount)}??李④컧?좉퉴??`)) return;
  try {
    amountInput.disabled = true;
    await callInvestmentRpc('investment_admin_adjust_cash', {
      p_admin_password: '8170',
      p_target_client_id: clientId,
      p_amount: action === 'subtract' ? -amount : amount
    });
    amountInput.value = '';
    await loadInvestmentState();
    investorStatus.textContent = '?꾧툑 李④컧???꾨즺?섏뿀?듬땲??';
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
    investmentAdminButton.textContent = '愿由ъ옄 紐⑤뱶';
    if (investmentState) renderInvestmentState(investmentState);
    return;
  }
  const password = window.prompt('愿由ъ옄 鍮꾨?踰덊샇瑜??낅젰?섏꽭??');
  if (password !== '8170') {
    if (password !== null) window.alert('愿由ъ옄 鍮꾨?踰덊샇媛 ??몄뒿?덈떎.');
    return;
  }
  investmentAdminMode = true;
  investmentAdminPanel.hidden = false;
  investmentAdminButton.textContent = '愿由ъ옄 紐⑤뱶 醫낅즺';
  if (investmentState) renderInvestmentState(investmentState);
});

const requireInvestmentAdmin = () => {
  if (!investmentAdminMode) {
    window.alert('癒쇱? 愿由ъ옄 紐⑤뱶瑜??쒖꽦?뷀븯?몄슂.');
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
    '?좏깮??醫낅ぉ??媛寃⑷낵 蹂?숇쪧??珥덇린?뷀뻽?듬땲??'
  );
});

adminResetAllAssets.addEventListener('click', () => {
  if (!window.confirm('紐⑤뱺 醫낅ぉ??媛寃⑷낵 蹂?숇쪧??珥덇린?뷀븷源뚯슂?')) return;
  runAdminMarketAction(
    'investment_admin_reset_all_assets',
    {},
    '紐⑤뱺 醫낅ぉ??媛寃⑷낵 蹂?숇쪧??珥덇린?뷀뻽?듬땲??'
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
    adminMarketStatus.textContent = '蹂?숈꽦 媛믪쓣 ?レ옄濡??낅젰?섏꽭??';
    return;
  }
  runAdminMarketAction(
    'investment_admin_set_surge_volatility',
    values,
    '湲됰벑二?蹂?숈꽦????ν뻽?듬땲??'
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
    investorStatus.textContent = '癒쇱? 怨좎쑀 ?됰꽕?꾩쓣 ?ㅼ젙?섏꽭??';
    return;
  }
  investmentRefresh.disabled = true;
  investmentRefresh.textContent = '遺덈윭?ㅻ뒗 以?..';
  try {
    await loadInvestmentState();
    investorStatus.textContent = '?ъ옄??媛寃⑷낵 ??궧???덈줈怨좎묠?덉뒿?덈떎.';
  } catch (error) {
    investorStatus.textContent = error.message;
  } finally {
    investmentRefresh.disabled = false;
    investmentRefresh.textContent = '?덈줈怨좎묠 ??;
  }
});

const tradeInvestment = async (symbol, side, quantityInput) => {
  const quantity = Number(quantityInput.value);
  if (!Number.isInteger(quantity) || quantity < 1) {
    window.alert('?섎웾? 1二??댁긽 ?뺤닔濡??낅젰?섏꽭??');
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
    investorStatus.textContent = side === 'buy' ? `${quantity}二?留ㅼ닔?덉뒿?덈떎.` : `${quantity}二?留ㅻ룄?덉뒿?덈떎.`;
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
  investorStatus.textContent = '?ъ옄?μ쓣 ?щ뒗 以?..';
  try {
    await loadInvestmentState(nickname);
    localStorage.setItem('sangki-investor-nickname', nickname);
    investorStatus.textContent = '?됰꽕?꾩? ??釉뚮씪?곗??먯꽌 蹂寃쏀븷 ???놁뒿?덈떎.';
  } catch (error) {
    button.disabled = false;
    investorStatus.textContent = error.message;
  }
});

try {
  const savedNickname = localStorage.getItem('sangki-investor-nickname');
  if (savedNickname) {
    investorNickname.value = savedNickname;
    loadInvestmentState(savedNickname).catch(() => {});
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
    notificationToggle.textContent = '?뚮┝ 誘몄???;
    notificationToggle.disabled = true;
    return;
  }
  const permission = Notification.permission;
  const enabled = localStorage.getItem(NOTIFICATIONS_ENABLED_KEY) !== 'false';
  notificationToggle.classList.toggle('is-enabled', permission === 'granted' && enabled);
  notificationToggle.classList.toggle('is-blocked', permission === 'denied' || !enabled);
  notificationToggle.textContent = permission === 'granted'
    ? enabled ? '?뚮┝ 耳쒖쭚' : '?뚮┝ 爰쇱쭚'
    : permission === 'denied'
      ? '?뚮┝ 李⑤떒??
      : '?뚮┝ ?덉슜';
};

notificationToggle.addEventListener('click', async () => {
  if (!('Notification' in window)) return;
  if (Notification.permission === 'denied') {
    window.alert('釉뚮씪?곗? ?ъ씠???ㅼ젙?먯꽌 ?뚮┝???덉슜?????ㅼ떆 ?쒕룄?댁＜?몄슂.');
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
        <button class="comment-action" type="button" data-action="reply">?듦?</button>
        <button class="comment-action" type="button" data-action="edit">?섏젙</button>
        <button class="comment-action" type="button" data-action="delete">??젣</button>
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
    comments.innerHTML = '<p class="comments-empty">?꾩쭅 ?④꺼吏??붿쟻???놁뒿?덈떎. 泥?踰덉㎏ ?볤????④꺼蹂댁꽭??</p>';
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
  previous.textContent = '???댁쟾';
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
  next.textContent = '?ㅼ쓬 ??;
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
    if (!response.ok) throw new Error('?볤???遺덈윭?ㅼ? 紐삵뻽?듬땲??');
    const nextComments = await response.json();
    if (commentsInitialized) {
      const watched = new Set(getWatchedComments());
      const previousById = new Map(allComments.map((item) => [item.id, item]));
      nextComments.forEach((item) => {
        if (item.parent_id && watched.has(item.parent_id) && !previousById.has(item.id)) {
          showNotification('???듦????щ졇?듬땲??, `${item.nickname}?섏씠 ?뚯썝?섏쓽 ?볤????듦????④꼈?듬땲??`, `reply-${item.id}`);
        }
      });
      allComments.forEach((item) => {
        if (watched.has(item.id) && !nextComments.some((next) => next.id === item.id)) {
          showNotification('?볤?????젣?섏뿀?듬땲??, '?뚯썝?섏쓽 ?볤???愿由ъ옄 ?먮뒗 ?묒꽦?먯뿉 ?섑빐 ??젣?섏뿀?듬땲??', `deleted-${item.id}`);
        }
      });
    }
    allComments = nextComments;
    commentsInitialized = true;
    renderComments(allComments);
  } catch (error) {
    comments.innerHTML = '<p class="comments-empty">?볤???遺덈윭?ㅼ? 紐삵뻽?듬땲?? ?좎떆 ???ㅼ떆 ?뺤씤?댁＜?몄슂.</p>';
  }
};

const addReply = async (parentId) => {
  const nickname = window.prompt('?듦? ?묒꽦?먯쓽 ?됰꽕?꾩쓣 ?낅젰?섏꽭??');
  if (nickname === null || !nickname.trim()) return;
  const password = requestPassword();
  if (password === null) return;
  const body = window.prompt('?듦????낅젰?섏꽭??');
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
    if (!response.ok) throw new Error('?듦? ??μ뿉 ?ㅽ뙣?덉뒿?덈떎.');
    const [createdReply] = await response.json();
    watchComment(parentId);
    if (createdReply) watchComment(createdReply.id);
    await loadComments();
  } catch (error) {
    window.alert(error.message);
  }
};

const requestPassword = () => {
  const password = window.prompt('?볤???4?먮━ 鍮꾨?踰덊샇瑜??낅젰?섏꽭??');
  if (password === null) return null;
  if (!/^\d{4}$/.test(password)) {
    window.alert('鍮꾨?踰덊샇???レ옄 4?먮━?ъ빞 ?⑸땲??');
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
    throw new Error(detail || 'Supabase ?붿껌???ㅽ뙣?덉뒿?덈떎.');
  }
  return response.json();
};

refreshButton.addEventListener('click', async () => {
  refreshButton.disabled = true;
  refreshButton.textContent = '遺덈윭?ㅻ뒗 以?..';
  await loadComments();
  refreshButton.disabled = false;
  refreshButton.textContent = '?덈줈怨좎묠 ??;
});

const editComment = async (item) => {
  const password = requestPassword();
  if (password === null) return;
  const body = window.prompt('?섏젙???볤????낅젰?섏꽭??', item.body);
  if (body === null || !body.trim()) return;

  try {
    const updated = await callCommentRpc('update_comment', {
      p_id: item.id,
      p_password_hash: await hashPassword(password),
      p_body: body
    });
    if (!updated) throw new Error('鍮꾨?踰덊샇媛 ??멸굅???볤????섏젙?????놁뒿?덈떎.');
    await loadComments();
  } catch (error) {
    window.alert(error.message);
  }
};

const deleteComment = async (id) => {
  const password = requestPassword();
  if (password === null) return;
  const isAdmin = password === '8170';
  if (!window.confirm(isAdmin ? '愿由ъ옄 沅뚰븳?쇰줈 ???볤?????젣?좉퉴??' : '???볤?????젣?좉퉴??')) return;

  try {
    const deleted = await callCommentRpc('delete_comment', {
      p_id: id,
      p_password_hash: await hashPassword(password),
      p_admin_password: isAdmin ? password : ''
    });
    if (!deleted) {
      throw new Error('鍮꾨?踰덊샇媛 ??멸굅???볤?????젣?????놁뒿?덈떎.');
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
  gameQuestion.textContent = `${first} 횞 ${second}`;
};

const endGame = async (message) => {
  window.clearInterval(gameTimer);
  gameTimer = null;
  gameAnswer.disabled = true;
  document.querySelector('#game-submit').disabled = true;
  gameStart.disabled = false;
  gameStart.textContent = '?ㅼ떆 ?쒖옉';
  const answer = gameState.first * gameState.second;
  gameMessage.textContent = `${message} ?뺣떟? ${answer}?낅땲?? 珥?${gameState.solved}臾몄젣瑜???덉뒿?덈떎.`;

  try {
    const response = await fetch(scoresEndpoint, {
      method: 'POST',
      headers: { ...apiHeaders, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ nickname: gameState.nickname, solved_count: gameState.solved })
    });
    if (!response.ok) throw new Error('??궧 ??μ뿉 ?ㅽ뙣?덉뒿?덈떎.');
    await loadGameRanking();
  } catch (error) {
    gameMessage.textContent += ` ${error.message}`;
  }
};

const tickGame = () => {
  gameState.remaining -= .1;
  gameTime.textContent = Math.max(0, gameState.remaining).toFixed(1);
  if (gameState.remaining <= 0) endGame('?쒓컙???앸궗?듬땲??');
};

const startGame = () => {
  const nickname = window.prompt('?됰꽕?꾩쓣 ?낅젰?섏꽭??');
  if (nickname === null || !nickname.trim()) return;
  gameState = { nickname: nickname.trim().slice(0, 24), questionNumber: 1, solved: 0, remaining: 10 };
  gamePlayer.textContent = `player ??${gameState.nickname}`;
  gameQuestionNumber.textContent = '1';
  gameTime.textContent = '10.0';
  gameAnswer.disabled = false;
  document.querySelector('#game-submit').disabled = false;
  gameStart.disabled = true;
  gameMessage.textContent = '?뺣떟???낅젰?섍퀬 Enter瑜??꾨Ⅴ?몄슂.';
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
      ? '3?먮━ 횞 2?먮━ 臾몄젣?낅땲?? 怨꾩냽 鍮좊Ⅴ寃???대낫?몄슂.'
      : '?뺣떟?낅땲?? ?ㅼ쓬 臾몄젣!';
  } else {
    gameMessage.textContent = '?ㅻ떟?낅땲?? ?ㅼ떆 ?낅젰?섏꽭??';
    gameAnswer.select();
  }
});

const loadGameRanking = async () => {
  try {
    const response = await fetch(`${scoresEndpoint}?select=id,nickname,solved_count,created_at&order=solved_count.desc,created_at.asc&limit=1000`, {
      headers: apiHeaders
    });
    if (!response.ok) throw new Error('??궧??遺덈윭?ㅼ? 紐삵뻽?듬땲??');
    const scores = await response.json();
    if (!scores.length) {
      gameRankingList.innerHTML = '<li class="ranking-empty">?꾩쭅 湲곕줉???놁뒿?덈떎.</li>';
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
      value.textContent = `${score.solved_count}臾몄젣`;
      const deleteButton = document.createElement('button');
      deleteButton.className = 'ranking-delete';
      deleteButton.type = 'button';
      deleteButton.textContent = '愿由ъ옄 ??젣';
      deleteButton.addEventListener('click', () => deleteGameScore(score.id));
      item.append(name, value, deleteButton);
      return item;
    }));
    const previous = document.createElement('button');
    previous.type = 'button';
    previous.className = 'game-page-button';
    previous.textContent = '???댁쟾';
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
    next.textContent = '?ㅼ쓬 ??;
    next.disabled = gameRankingPage === totalPages;
    next.addEventListener('click', () => {
      gameRankingPage += 1;
      loadGameRanking();
    });

    gameRankingPagination.replaceChildren(previous, pageNumber, next);
  } catch {
    gameRankingList.innerHTML = '<li class="ranking-empty">??궧??遺덈윭?ㅼ? 紐삵뻽?듬땲??</li>';
    gameRankingPagination.replaceChildren();
  }
};

const deleteGameScore = async (id) => {
  const password = window.prompt('愿由ъ옄 鍮꾨?踰덊샇瑜??낅젰?섏꽭??');
  if (password === null || !window.confirm('????궧 湲곕줉????젣?좉퉴??')) return;

  try {
    const response = await fetch(`${rpcEndpoint}/delete_speed_game_score`, {
      method: 'POST',
      headers: { ...apiHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_id: id, p_admin_password: password })
    });
    if (!response.ok || !(await response.json())) {
      throw new Error('愿由ъ옄 鍮꾨?踰덊샇媛 ??멸굅????젣?????놁뒿?덈떎.');
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
  status.textContent = '??ν븯??以?..';

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
    if (!response.ok) throw new Error('?볤? ??μ뿉 ?ㅽ뙣?덉뒿?덈떎.');
    const [createdComment] = await response.json();
    form.reset();
    if (createdComment) watchComment(createdComment.id);
    status.textContent = '?볤?????λ릺?덉뒿?덈떎.';
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
