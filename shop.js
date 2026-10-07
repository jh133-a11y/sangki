const SHOP_URL = 'https://ejrwrwjsgizzxhqybtff.supabase.co';
const SHOP_KEY = 'sb_publishable_Mr64z4NO3wlqeKObCxLbBQ_HlhvG7D8';
const shopRpc = `${SHOP_URL}/rest/v1/rpc`;
const shopHeaders = { apikey: SHOP_KEY, Authorization: `Bearer ${SHOP_KEY}`, 'Content-Type': 'application/json' };
const shopInvestmentKey = 'sangki-investment-client-id';
const shopSessionKey = 'sangki-auth-session';
const shopTabSessionKey = 'sangki-auth-session-tab';
const shopKeepKey = 'sangki-keep-login';
const balance = document.querySelector('#shop-balance');
const status = document.querySelector('#shop-status');

const shopSession = () => {
  try {
    const raw = localStorage.getItem(shopKeepKey) === 'true'
      ? localStorage.getItem(shopSessionKey)
      : sessionStorage.getItem(shopTabSessionKey);
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
const won = (value) => `₩${Number(value || 0).toLocaleString('ko-KR')}`;
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
  const state = await rpc('shop_get_state', { p_client_id: shopClientId() });
  balance.textContent = `보유 현금 ${won(state.cash)}`;
};
document.querySelectorAll('.shop-buy').forEach((button) => {
  button.addEventListener('click', async () => {
    const itemName = button.closest('.shop-card')?.querySelector('h2')?.textContent || '상품';
    const itemPrice = button.closest('.shop-card')?.querySelector('.shop-price')?.textContent || '';
    if (!window.confirm(`${itemName} ${itemPrice} 상품을 정말 구매하시겠습니까?`)) {
      status.textContent = '구매를 취소했습니다.';
      return;
    }
    button.disabled = true;
    status.textContent = '구매 처리 중...';
    try {
      const result = await rpc('shop_purchase', {
        p_client_id: shopClientId(),
        p_item_type: button.dataset.item
      });
      status.textContent = `${result.message} 홈 화면의 가방에서 확인하세요.`;
      window.alert(`${result.message}\n홈 화면의 가방에서 확인하세요.`);
      await refreshShop();
    } catch (error) {
      status.textContent = error.message;
      window.alert(`구매 실패: ${error.message}`);
    } finally {
      button.disabled = false;
    }
  });
});
refreshShop().catch((error) => {
  balance.textContent = error.message;
});
