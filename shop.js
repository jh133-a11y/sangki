const SHOP_URL = 'https://ejrwrwjsgizzxhqybtff.supabase.co';
const SHOP_KEY = 'sb_publishable_Mr64z4NO3wlqeKObCxLbBQ_HlhvG7D8';
const shopRpc = `${SHOP_URL}/rest/v1/rpc`;
const shopHeaders = { apikey: SHOP_KEY, Authorization: `Bearer ${SHOP_KEY}`, 'Content-Type': 'application/json' };
const shopInvestmentKey = 'sangki-investment-client-id';
const shopSessionKey = 'sangki-auth-session';
const shopTabSessionKey = 'sangki-auth-session-tab';
const shopKeepKey = 'sangki-keep-login';
const shopLegacyInvestmentKey = 'sangki-legacy-investment-client-id';
const shopNicknameKey = 'sangki-investor-nickname';
const balance = document.querySelector('#shop-balance');
const status = document.querySelector('#shop-status');
const confirmBackdrop = document.querySelector('#shop-confirm-backdrop');
const confirmModal = document.querySelector('#shop-confirm-modal');
const confirmMessage = document.querySelector('#shop-confirm-message');
const confirmTitle = document.querySelector('#shop-confirm-title');
const quantityInput = document.querySelector('#shop-modal-quantity');
const quantityLabel = document.querySelector('#shop-quantity-label');
const maxQuantityButton = document.querySelector('#shop-modal-max');
const confirmOk = document.querySelector('#shop-confirm-ok');
const confirmCancel = document.querySelector('#shop-confirm-cancel');
let confirmResolve = null;
let currentCashExact = '0';
let currentItems = [];

const shopTabs = document.querySelectorAll('.shop-tab');
const shopPanels = document.querySelectorAll('.shop-products[role="tabpanel"]');
const shopCategoryByItem = {
  letter: 'shop-message',
  megaphone: 'shop-message',
  low_missile: 'shop-missile',
  mid_missile: 'shop-missile',
  high_missile: 'shop-missile',
  nuclear_missile: 'shop-missile',
  missile_shield: 'shop-protection',
  nickname_ticket: 'shop-other',
  gambling_box: 'shop-items'
};
document.querySelectorAll('.shop-buy[data-item]').forEach((button) => {
  const category = shopCategoryByItem[button.dataset.item];
  const card = button.closest('.shop-card');
  if (category && card) document.querySelector(`#${category}`)?.append(card);
});
shopTabs.forEach((tab) => {
  tab.addEventListener('click', () => {
    shopTabs.forEach((item) => {
      const active = item === tab;
      item.classList.toggle('is-active', active);
      item.setAttribute('aria-selected', String(active));
    });
    shopPanels.forEach((panel) => {
      panel.hidden = panel.id !== tab.getAttribute('aria-controls');
    });
  });
});

const siteConfirm = (message) => new Promise((resolve) => {
  confirmResolve = resolve;
  confirmMessage.textContent = message;
  confirmTitle.textContent = '구매 확인';
  quantityLabel.hidden = true;
  maxQuantityButton.hidden = true;
  confirmCancel.hidden = false;
  confirmOk.textContent = '확인';
  confirmOk.onclick = () => closeConfirm(true);
  confirmModal.hidden = false;
  confirmBackdrop.hidden = false;
});
const chooseQuantity = (itemName, itemPrice, price, cash, ownedQuantity = 0n, itemType = '') => new Promise((resolve) => {
  confirmResolve = resolve;
  confirmTitle.textContent = `${itemName} 구매`;
  confirmMessage.textContent = `${itemPrice}\n구매할 수량을 선택하세요.`;
  quantityLabel.hidden = false;
  maxQuantityButton.hidden = false;
  quantityInput.value = '1';
  maxQuantityButton.onclick = () => {
    const affordable = price > 0n ? BigInt(cash) / price : 0n;
    const ownershipLimit = 100n - ownedQuantity;
    const dailyLimit = itemType === 'gambling_box' ? 3n : ownershipLimit;
    const maximum = dailyLimit < ownershipLimit ? dailyLimit : ownershipLimit;
    quantityInput.value = String(affordable < maximum
      ? affordable
      : maximum);
  };
  confirmOk.textContent = '다음';
  confirmCancel.hidden = false;
  confirmModal.hidden = false;
  confirmBackdrop.hidden = false;
  confirmOk.onclick = () => {
    const value = quantityInput.value.trim();
    if (!/^[0-9]+$/.test(value) || BigInt(value) < 1n) {
      quantityInput.focus();
      return;
    }
    closeConfirm(value);
  };
});
const closeConfirm = (result) => {
  confirmModal.hidden = true;
  confirmBackdrop.hidden = true;
  if (confirmResolve) confirmResolve(result);
  confirmResolve = null;
};
confirmCancel.addEventListener('click', () => closeConfirm(false));
confirmBackdrop.addEventListener('click', () => closeConfirm(false));
const siteNotice = (message) => {
  confirmMessage.textContent = message;
  confirmCancel.hidden = true;
  confirmOk.textContent = '확인';
  confirmModal.hidden = false;
  confirmBackdrop.hidden = false;
  confirmOk.onclick = () => {
    closeConfirm(true);
  };
};
window.alert = siteNotice;

const shopSession = () => {
  try {
    const raw = localStorage.getItem(shopSessionKey)
      || sessionStorage.getItem(shopTabSessionKey);
    return JSON.parse(raw || 'null');
  } catch {
    return null;
  }
};
const shopClientId = () => {
  const session = shopSession();
  if (session?.account_id) return session.account_id;
  let id = localStorage.getItem(shopInvestmentKey);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(shopInvestmentKey, id);
  }
  return id;
};
let activeShopClientId = null;
const resolveShopClientId = async () => {
  if (activeShopClientId) return activeShopClientId;
  const session = shopSession();
  if (!session?.account_id) {
    activeShopClientId = shopClientId();
    return activeShopClientId;
  }

  const legacyId = localStorage.getItem(shopLegacyInvestmentKey);
  if (legacyId && legacyId !== session.account_id) {
    try {
      await rpc('investment_link_account', {
        p_session_token: session.session_token,
        p_old_client_id: legacyId
      });
      localStorage.setItem(shopInvestmentKey, session.account_id);
      localStorage.removeItem(shopLegacyInvestmentKey);
    } catch (error) {
      console.warn('shop investment linking failed:', error.message);
    }
  }
  activeShopClientId = session.account_id;
  return activeShopClientId;
};
const won = (value) => `₩${BigInt(String(value || 0)).toLocaleString('ko-KR')}`;
const rpc = async (name, payload) => {
  const response = await fetch(`${shopRpc}/${name}`, {
    method: 'POST',
    headers: shopHeaders,
    body: JSON.stringify(payload)
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.message || result.hint || '상점 요청에 실패했습니다.');
  return result;
};
const refreshShop = async () => {
  const clientId = await resolveShopClientId();
  const state = await rpc('shop_get_state', {
    p_client_id: clientId,
    p_nickname: localStorage.getItem(shopNicknameKey) || null
  });
  if (state.client_id) {
    activeShopClientId = state.client_id;
    localStorage.setItem(shopInvestmentKey, state.client_id);
  }
  const cashExact = String(state.cash_exact || state.cash || '0');
  currentCashExact = cashExact;
  currentItems = state.items || [];
  balance.textContent = `보유 현금 ${won(cashExact)}`;
};
document.querySelectorAll('.shop-buy').forEach((button) => {
  button.addEventListener('click', async () => {
    const card = button.closest('.shop-card');
    const itemName = card?.querySelector('h2')?.textContent || '상품';
    const itemPrice = card?.querySelector('.shop-price')?.textContent || '';
    const cardStatus = card?.querySelector('.shop-card-status');
    const price = BigInt(itemPrice.replace(/[^\d]/g, '') || '0');
    const ownedQuantity = BigInt(String(
      currentItems.find((item) => item.item_type === button.dataset.item)?.quantity || 0
    ));
    if (ownedQuantity >= 100n) {
      const message = '이 아이템은 이미 최대 보유 수량인 100개입니다.';
      if (cardStatus) cardStatus.textContent = message;
      else status.textContent = message;
      return;
    }
    const quantityText = await chooseQuantity(
      itemName,
      itemPrice,
      price,
      currentCashExact,
      ownedQuantity,
      button.dataset.item
    );
    if (!quantityText) {
      status.textContent = '구매를 취소했습니다.';
      return;
    }
    if (!await siteConfirm(`${itemName} ${itemPrice}\n${quantityText}개를 정말 구매하시겠습니까?`)) return;
    button.disabled = true;
    if (cardStatus) cardStatus.textContent = '';
    status.textContent = '구매 처리 중...';
    try {
      const clientId = await resolveShopClientId();
      const result = await rpc('shop_purchase', {
        p_client_id: clientId,
        p_item_type: button.dataset.item,
        p_quantity: quantityText
      });
      status.textContent = `${result.message} 홈 화면의 가방에서 확인하세요.`;
      await refreshShop();
    } catch (error) {
      if (cardStatus && button.dataset.item === 'gambling_box') {
        cardStatus.textContent = error.message;
        status.textContent = '';
      } else {
        status.textContent = error.message;
      }
      window.alert(`구매 실패: ${error.message}`);
    } finally {
      button.disabled = false;
    }
  });
});
refreshShop().catch((error) => {
  balance.textContent = error.message;
});
