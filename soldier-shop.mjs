import { CHARACTERS } from './soldier-characters.mjs?v=5';
import { SUPPLY_PRODUCTS } from './soldier-supply.mjs?v=5';
import { createSupplyOpening } from './soldier-supply-opening.mjs?v=3';

export { SUPPLY_PRODUCTS };
export const GOLD_PRODUCTS = [
  { id: 'gold-5000', name: '5,000 골드', price: 10, gold: 5000, description: '골드 5,000 획득' },
  { id: 'gold-30000', name: '30,000 골드', price: 50, gold: 30000, description: '골드 25,000 + 보너스 5,000' },
  { id: 'gold-65000', name: '65,000 골드', price: 100, gold: 65000, description: '골드 50,000 + 보너스 15,000' }
];
export function createShop({ getState, buy, refresh, isReady, buySupply, isSupplyReady, getSupplyCapacity, getSupplyError, getSupplyErrorCode, buyGold, isGoldReady, renderCard }) {
  const $ = id => document.getElementById(id);
  const dialog = $('shop-dialog'), tabs = [...dialog.querySelectorAll('[data-shop-tab]')];
  let category = 'supply', buying = false, confirming = false, keyboardOpened = false;
  const confirmation = $('shop-confirm-dialog');
  const opening = createSupplyOpening(renderCard, message => { $('shop-status').textContent += ` ${message}`; });
  function confirmPurchase(product, productCategory) {
    $('shop-confirm-title').textContent = productCategory === 'supply' ? '보급함 구매 확인'
      : productCategory === 'gold' ? '골드 구매 확인' : '캐릭터 구매 확인';
    $('shop-confirm-name').textContent = product.name;
    $('shop-confirm-price').textContent = `${product.price} 보석`;
    const image = $('shop-confirm-image');
    image.hidden = productCategory === 'gold';
    if (productCategory !== 'gold') {
      image.src = productCategory === 'supply' ? `soldier-supply-${product.id}.webp?v=1` : `soldier-shop-${product.id}.webp`;
    }
    image.dataset.supply = productCategory === 'supply' ? product.id : ''; image.alt = product.name;
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
  function supplyErrorNotice() {
    const message = getSupplyError() || '연결 상태를 확인할 수 없습니다.';
    return getSupplyErrorCode() === 'P0001' && message.includes('세션이 만료되었습니다')
      ? `보급함 서버 연결 실패: ${message} 사이트 메인에서 다시 접속한 뒤 새로고침하세요.`
      : `보급함 서버 연결 실패: ${message} 최신 soldier-supply.sql 실행 여부를 확인한 뒤 새로고침하세요.`;
  }
  function render() {
    wallet();
    for (const tab of tabs) {
      const selected = tab.dataset.shopTab === category;
      tab.setAttribute('aria-selected', String(selected)); tab.tabIndex = selected ? 0 : -1;
      tab.disabled = buying || confirming;
    }
    $('shop-products').setAttribute('aria-labelledby', `shop-tab-${category}`);
    $('shop-products').replaceChildren();
    const products = category === 'supply' ? SUPPLY_PRODUCTS : category === 'character'
      ? Object.entries(CHARACTERS).filter(([, c]) => c.price > 0).map(([id, c]) => ({ id, ...c }))
      : category === 'gold' ? GOLD_PRODUCTS : [];
    if (!products.length) {
      const message = document.createElement('p'); message.textContent = '준비 중인 상품 분류입니다.';
      $('shop-products').append(message);
    }
    for (const product of products) {
      const article = document.createElement('article'); article.className = 'shop-product';
      if (category === 'character') article.classList.add('shop-character-product');
      if (category === 'gold') article.classList.add('shop-gold-product');
      if (category === 'supply') { article.classList.add('shop-supply-product'); article.dataset.supply = product.id; }
      const price = document.createElement('div'); price.className = 'shop-price';
      price.setAttribute('aria-label', `${product.price} 보석`);
      price.textContent = String(product.price);
      price.prepend(document.querySelector('.currency.gems svg').cloneNode(true));
      let art;
      if (category === 'gold') {
        art = document.createElement('div'); art.className = 'shop-gold-art';
        const emblem = document.createElement('span'); emblem.setAttribute('aria-hidden', 'true'); emblem.textContent = 'G';
        const amount = document.createElement('strong'); amount.textContent = product.gold.toLocaleString('ko-KR');
        const label = document.createElement('small'); label.textContent = 'GOLD';
        art.append(emblem, amount, label);
      } else {
        const image = document.createElement('img');
        image.src = category === 'supply' ? `soldier-supply-${product.id}.webp?v=1` : `soldier-shop-${product.id}.webp`;
        image.alt = product.name;
        art = image;
      }
      const title = document.createElement('h2'); title.textContent = product.name;
      const text = document.createElement('p');
      if (category === 'supply' || category === 'gold') {
        text.textContent = product.description;
        if (category === 'supply' && product.specialty) {
          const specialty = document.createElement('strong'); specialty.className = 'shop-specialty';
          specialty.textContent = product.specialty; text.append(specialty);
        }
      }
      else {
        text.textContent = product.id === 'fsb-agent' ? '러시아 연방국 요원' : '대한민국 육군의 특수부대';
        const specialty = document.createElement('strong'); specialty.className = 'shop-specialty';
        specialty.textContent = product.id === 'fsb-agent' ? '[특기] 높은 회피율' : '[특기] 강한 체력';
        text.append(specialty);
      }
      const button = document.createElement('button'); button.type = 'button'; button.dataset.product = product.id;
      const owned = category === 'character' && !!getState().characters[product.id];
      if (category === 'character' && owned) {
        price.hidden = true;
        const ribbon = document.createElement('span'); ribbon.className = 'shop-owned-ribbon';
        const label = document.createElement('span'); label.textContent = '보유함'; ribbon.append(label);
        article.append(ribbon);
      }
      button.textContent = owned ? '보유 중' : '구매';
      button.setAttribute('aria-label', `${product.name} ${product.price}보석 구매`);
      if (category === 'character') button.setAttribute('aria-label', `${product.name} ${owned ? '보유 중' : '125보석 구매'}`);
      const productCategory = category;
      const supplyCapacity = productCategory === 'supply' ? getSupplyCapacity(product) : true;
      button.disabled = buying || confirming || owned || !(productCategory === 'supply' ? isSupplyReady() && supplyCapacity
        : productCategory === 'gold' ? isGoldReady() : isReady());
      if (productCategory === 'supply' && !supplyCapacity) {
        button.title = `인벤토리 여유 공간이 부족합니다. 보급 무기 ${product.count}개를 받을 공간을 확보하세요.`;
      }
      button.addEventListener('click', async () => {
        if (buying || confirming) return;
        const purchaseCategory = productCategory;
        confirming = true;
        render();
        const confirmed = await confirmPurchase(product, purchaseCategory);
        confirming = false;
        if (!confirmed) { render(); dialog.querySelector(`[data-product="${product.id}"]`)?.focus(); return; }
        buying = true; render();
        let purchased = false;
        try {
          if (purchaseCategory === 'supply') {
            const rewards = await buySupply(product.id);
            purchased = true;
            $('shop-status').textContent = `${product.name} 구매 완료 · 무기 ${rewards.length}개가 인벤토리에 저장되었습니다.`;
            wallet();
            await opening.open(product.id,rewards);
          } else if (purchaseCategory === 'gold') {
            const result = await buyGold(product.id);
            $('shop-status').textContent = `${product.gold.toLocaleString('ko-KR')} 골드 구매 완료 · 보유 골드 ${Number(result.gold).toLocaleString('ko-KR')}`;
          } else {
            await buy(product.id);
            $('shop-status').textContent = `${product.name} 구매 완료 · 캐릭터 인벤토리에 저장되었습니다.`;
          }
        } catch (error) {
          $('shop-status').textContent = `${purchased ? '구매는 완료되었지만 개봉 연출 실패' : '구매 실패'}: ${error.message}`;
          console.error('상점 구매 오류', error);
          try { await refresh(); } catch (refreshError) {
            $('shop-status').textContent += ` 잔액 재확인 실패: ${refreshError.message} 새로고침하세요.`;
            console.error('상점 재확인 오류', refreshError);
          }
        } finally {
          buying = false; render();
          if (purchaseCategory === 'character' && getState().characters[product.id]) $('shop-tab-character').focus();
          else dialog.querySelector(`[data-product="${product.id}"]`).focus();
        }
      });
      if (category === 'supply') {
        const supplyArt = document.createElement('div'); supplyArt.className = 'shop-supply-art'; supplyArt.append(art);
        const odds = document.createElement('details'); odds.className = 'shop-supply-odds';
        const summary = document.createElement('summary'); summary.textContent = '획득 확률';
        const description = document.createElement('p'); description.textContent = product.odds;
        odds.append(summary,description);
        article.append(price,supplyArt,title,text,button,odds);
      } else article.append(price, art, title, text, button);
      $('shop-products').append(article);
    }
  }
  const open = (event) => {
    keyboardOpened = event?.detail === 0;
    category = 'supply'; render(); dialog.showModal(); $('home').hidden = true;
    $('shop-status').textContent = !isSupplyReady()
      ? supplyErrorNotice()
      : !getSupplyCapacity(SUPPLY_PRODUCTS.find(product => product.id === 'normal'))
        ? '인벤토리 공간이 부족해 보급함을 구매할 수 없습니다. 무기를 판매하거나 재료로 사용해 공간을 확보하세요.'
        : '보급함은 구매 즉시 개봉됩니다. 지급된 무기는 인벤토리에서 장착·강화할 수 있습니다.';
  };
  for (const tab of tabs) {
    tab.addEventListener('click', () => {
      if (!buying && !confirming) {
        category = tab.dataset.shopTab; render();
        $('shop-status').textContent = category === 'gold' && !isGoldReady()
          ? '골드 교환 연결 필요: 최신 soldier-shop.sql 실행 후 새로고침하세요.'
          : category === 'supply' && !isSupplyReady()
            ? supplyErrorNotice()
            : category === 'supply' && !getSupplyCapacity(SUPPLY_PRODUCTS.find(product => product.id === 'normal'))
              ? '인벤토리 공간이 부족해 보급함을 구매할 수 없습니다. 무기를 판매하거나 재료로 사용해 공간을 확보하세요.' : '';
      }
    });
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
  $('shop-back').addEventListener('click', () => { if (!buying && !confirming) dialog.close(); });
  dialog.addEventListener('cancel',event => { if (buying || confirming) event.preventDefault(); });
  dialog.addEventListener('close', () => {
    $('home').hidden = false;
    if (keyboardOpened) $('shop-open').focus();
    else if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  });
  return { refresh() { if (dialog.open) render(); } };
}
