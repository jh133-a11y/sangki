import { CHARACTERS } from './soldier-characters.mjs?v=5';

export const SUPPLY_PRODUCTS = [
  { id: 'normal', name: '일반보급함', price: 3, description: 'D클래스 이상의 무기 1개 획득' },
  { id: 'advanced', name: '고급보급함', price: 30, description: 'C클래스 이상의 무기 1개 획득' }
];
export function createShop({ getState, buy, refresh, isReady }) {
  const $ = id => document.getElementById(id);
  const dialog = $('shop-dialog'), tabs = [...dialog.querySelectorAll('[data-shop-tab]')];
  let category = 'supply', buying = false, confirming = false, keyboardOpened = false;
  const confirmation = $('shop-confirm-dialog');
  function confirmPurchase(product) {
    $('shop-confirm-name').textContent = product.name;
    $('shop-confirm-price').textContent = `${product.price} 보석`;
    const image = $('shop-confirm-image');
    image.src = `soldier-shop-${product.id}.webp`; image.alt = product.name;
    confirmation.returnValue = 'cancel';
    return new Promise(resolve => {
      confirmation.addEventListener('close', () => resolve(confirmation.returnValue === 'buy'), { once: true });
      confirmation.showModal(); $('shop-confirm-cancel').focus();
    });
  }
  for (const name of ['gold', 'gems']) {
    const icon = document.querySelector(`.currency.${name} svg`).cloneNode(true);
    for (const gradient of icon.querySelectorAll('[id]')) {
      const previous = gradient.id; gradient.id = `shop-${previous}`;
      for (const path of icon.querySelectorAll(`[fill="url(#${previous})"]`)) path.setAttribute('fill', `url(#${gradient.id})`);
    }
    const container = $(`shop-${name}`).parentElement;
    container.firstChild.remove(); container.prepend(icon);
  }
  function wallet() {
    $('shop-gold').textContent = $('gold').textContent;
    $('shop-gems').textContent = $('gems').textContent;
  }
  function render() {
    wallet();
    for (const tab of tabs) {
      const selected = tab.dataset.shopTab === category;
      tab.setAttribute('aria-selected', String(selected)); tab.tabIndex = selected ? 0 : -1;
    }
    $('shop-products').setAttribute('aria-labelledby', `shop-tab-${category}`);
    $('shop-products').replaceChildren();
    const products = category === 'supply' ? SUPPLY_PRODUCTS : category === 'character'
      ? Object.entries(CHARACTERS).filter(([, c]) => c.price > 0).map(([id, c]) => ({ id, ...c })) : [];
    if (!products.length) {
      const message = document.createElement('p'); message.textContent = '준비 중인 상품 분류입니다.';
      $('shop-products').append(message);
    }
    for (const product of products) {
      const article = document.createElement('article'); article.className = 'shop-product';
      if (category === 'character') article.classList.add('shop-character-product');
      const price = document.createElement('div'); price.className = 'shop-price';
      price.setAttribute('aria-label', `${product.price} 보석`);
      price.textContent = String(product.price);
      price.prepend(document.querySelector('.currency.gems svg').cloneNode(true));
      const image = document.createElement('img');
      image.src = `soldier-shop-${product.id}.webp`; image.alt = product.name;
      const title = document.createElement('h2'); title.textContent = product.name;
      const text = document.createElement('p');
      if (category === 'supply') text.textContent = product.description;
      else {
        text.textContent = product.id === 'fsb-agent' ? '러시아 연방국 요원' : '대한민국 육군의 특수부대';
        const specialty = document.createElement('strong'); specialty.className = 'shop-specialty';
        specialty.textContent = product.id === 'fsb-agent' ? '[특기] 높은 회피율' : '[특기] 강한 체력';
        text.append(specialty);
      }
      const button = document.createElement('button'); button.type = 'button'; button.dataset.product = product.id;
      const owned = !!getState().characters[product.id];
      if (category === 'character' && owned) {
        price.hidden = true;
        const ribbon = document.createElement('span'); ribbon.className = 'shop-owned-ribbon';
        const label = document.createElement('span'); label.textContent = '보유함'; ribbon.append(label);
        article.append(ribbon);
      }
      button.textContent = category === 'supply' ? '확률 설정 대기' : owned ? '보유 중' : '구매';
      if (category === 'character') button.setAttribute('aria-label', `${product.name} ${owned ? '보유 중' : '125보석 구매'}`);
      button.disabled = buying || confirming || category === 'supply' || owned || !isReady();
      button.addEventListener('click', async () => {
        if (buying || confirming) return;
        confirming = true;
        const confirmed = await confirmPurchase(product);
        confirming = false;
        if (!confirmed) { button.focus(); return; }
        buying = true; render();
        try {
          await buy(product.id);
          $('shop-status').textContent = `${product.name} 구매 완료 · 캐릭터 인벤토리에 저장되었습니다.`;
        } catch (error) {
          $('shop-status').textContent = `구매 실패: ${error.message}`;
          console.error('캐릭터 구매 오류', error);
          try { await refresh(); } catch (refreshError) {
            $('shop-status').textContent += ` 잔액 재확인 실패: ${refreshError.message} 새로고침하세요.`;
            console.error('상점 재확인 오류', refreshError);
          }
        } finally {
          buying = false; render();
          if (getState().characters[product.id]) $('shop-tab-character').focus();
          else dialog.querySelector(`[data-product="${product.id}"]`).focus();
        }
      });
      article.append(price, image, title, text, button); $('shop-products').append(article);
    }
  }
  const open = (event) => {
    keyboardOpened = event?.detail === 0;
    category = 'supply'; render(); dialog.showModal(); $('home').hidden = true;
    $('shop-status').textContent = isReady()
      ? '보급함 확률은 설정 대기 중입니다. 구매한 캐릭터는 인벤토리에서 장착·강화할 수 있습니다. 강화 설치: soldier-character-upgrade.sql'
      : '상점 연결 필요: soldier-shop.sql 실행 후 새로고침하세요.';
  };
  for (const tab of tabs) {
    tab.addEventListener('click', () => { category = tab.dataset.shopTab; render(); });
    tab.addEventListener('keydown', event => {
      const index = tabs.indexOf(tab);
      const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length
        : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length
        : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : null;
      if (next === null) return;
      event.preventDefault(); tabs[next].click(); tabs[next].focus();
    });
  }
  $('shop-open').addEventListener('click', open);
  $('inventory-shop').addEventListener('click', event => { $('equipment-dialog').close(); open(event); });
  $('shop-back').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => {
    $('home').hidden = false;
    if (keyboardOpened) $('shop-open').focus();
    else if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  });
  return { refresh() { if (dialog.open) render(); } };
}
