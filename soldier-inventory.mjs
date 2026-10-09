import { WEAPONS, weaponLevelLabel } from './soldier-core.mjs?v=3';

export const INVENTORY_LIMIT = 50;
export function inventoryWeapons(equipment, slot) {
  return Object.keys(equipment).filter(id => WEAPONS[id]?.slot === slot);
}
export function weaponInventoryStats(id) {
  const weapon = WEAPONS[id];
  if (!weapon) throw new Error('무기 정보를 확인할 수 없습니다.');
  return [
    ['탄창/보유탄환', weapon.magazine ? `${weapon.magazine} / 미설정` : '해당 없음', '탄창은 실제 장탄수입니다. 별도 보유탄환 수량은 아직 구현되지 않았습니다.'],
    ['위력', weapon.damage, '현재 서버에서 사용하는 기본 피해량입니다.'],
    ['연사속도', Math.round(60 / weapon.delay), '현재 공격 간격을 분당 공격 횟수로 환산한 값입니다.'],
    ['정확도', '미설정', '별도 정확도 수치는 아직 설정되지 않았습니다.'],
    ['반동제어', '미설정', '별도 무기별 반동제어 수치는 아직 설정되지 않았습니다.'],
    ['무게', '미설정', '무기 무게와 무게에 따른 이동 효과는 아직 설정되지 않았습니다.'],
    ['크리티컬 확률', '미설정', '확률 기반 크리티컬 피해는 아직 구현되지 않았습니다.']
  ];
}

export function createEquipmentInventory({ getEquipment, getLoadout, renderCard }) {
  const $ = id => document.getElementById(id);
  const dialog = $('equipment-dialog');
  const tabs = [...dialog.querySelectorAll('[data-equipment-tab]')];
  let slot = 'primary', sorted = false;
  function updateWallet() {
    const wallet = $('inventory-wallet');
    wallet.replaceChildren(...[...document.querySelectorAll('.currency-bar .currency')].map(currency => {
      const copy = currency.cloneNode(true);
      for (const element of copy.querySelectorAll('[id]')) {
        if (element.tagName.toLowerCase() === 'lineargradient') {
          const previous = element.id; element.id = `inventory-${previous}`;
          for (const path of copy.querySelectorAll(`[fill="url(#${previous})"]`)) path.setAttribute('fill', `url(#${element.id})`);
        } else element.removeAttribute('id');
      }
      return copy;
    }));
  }
  function stats(id) {
    const list = document.createElement('dl');
    const values = id === 'character'
      ? [['이름', 'Black Water'], ['분류', '기본 캐릭터'], ['레벨', 'Lv.1']]
      : weaponInventoryStats(id);
    for (const [name, value, explanation] of values) {
      const dt = document.createElement('dt'), dd = document.createElement('dd');
      dt.textContent = name; dd.textContent = value;
      if (explanation) dd.title = explanation;
      list.append(dt, dd);
    }
    return list;
  }
  function content(id) {
    const body = document.createElement('div'); body.className = 'inventory-item-detail';
    body.append(renderCard(id), stats(id)); return body;
  }
  function render() {
    const equipment = getEquipment(), loadout = getLoadout();
    const current = slot === 'character' ? 'character' : loadout[slot];
    for (const tab of tabs) {
      const selected = tab.dataset.equipmentTab === slot;
      tab.setAttribute('aria-selected', String(selected)); tab.tabIndex = selected ? 0 : -1;
    }
    $('equipment-panel').setAttribute('aria-labelledby', `tab-${slot}`);
    $('inventory-level').textContent = weaponLevelLabel(equipment[current]?.level || 1);
    $('inventory-current').replaceChildren(content(current));
    const prompt = document.createElement('p'); prompt.textContent = '비교할 장비를 선택해 주세요';
    $('inventory-comparison').replaceChildren(prompt);
    let ids = inventoryWeapons(equipment, slot);
    if (sorted) ids = ids.sort((a, b) => (WEAPONS[a]?.name || a).localeCompare(WEAPONS[b]?.name || b, 'ko'));
    $('inventory-count').textContent = `${ids.length} / ${INVENTORY_LIMIT}`;
    $('inventory-items').replaceChildren();
    if (!ids.length) {
      const empty = document.createElement('p');
      empty.textContent = '보유 장비가 없습니다.';
      $('inventory-items').append(empty);
    }
    for (const id of ids) {
      const button = document.createElement('button'); button.type = 'button';
      button.className = 'inventory-item'; button.setAttribute('aria-label', `${WEAPONS[id]?.name || 'Black Water'} 비교`);
      button.append(renderCard(id));
      button.addEventListener('click', () => {
        const title = document.createElement('h2');
        title.textContent = id === current ? '현재 장착된 장비와 동일합니다' : '선택한 장비';
        $('inventory-comparison').replaceChildren(title, content(id));
      });
      $('inventory-items').append(button);
    }
  }
  function open(next) {
    slot = next; render(); updateWallet();
    dialog.showModal(); $('home').hidden = true;
    tabs.find(tab => tab.dataset.equipmentTab === slot).focus();
  }
  for (const tab of tabs) {
    tab.addEventListener('click', () => { slot = tab.dataset.equipmentTab; render(); });
    tab.addEventListener('keydown', event => {
      const index = tabs.indexOf(tab);
      let next;
      if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
      if (event.key === 'ArrowLeft') next = (index + tabs.length - 1) % tabs.length;
      if (event.key === 'Home') next = 0;
      if (event.key === 'End') next = tabs.length - 1;
      if (next === undefined) return;
      event.preventDefault(); tabs[next].click(); tabs[next].focus();
    });
  }
  $('inventory-sort').addEventListener('click', () => {
    sorted = !sorted; $('inventory-sort').textContent = sorted ? '기본순 정렬' : '이름순 정렬'; render();
  });
  $('equipment-back').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => { $('home').hidden = false; $(slot).focus(); });
  for (const name of ['primary', 'secondary', 'melee', 'character']) {
    const card = $(name);
    card.setAttribute('role', 'button'); card.tabIndex = 0;
    card.setAttribute('aria-haspopup', 'dialog');
    card.addEventListener('click', () => open(name));
    card.addEventListener('keydown', event => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault(); open(name);
    });
  }
  return { refresh() { if (dialog.open) { render(); updateWallet(); } } };
}
