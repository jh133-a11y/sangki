import { WEAPONS, weaponLevelLabel, weaponUpgradeCost } from './soldier-core.mjs?v=3';
import { CHARACTERS } from './soldier-characters.mjs?v=3';

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
export function characterInventoryStats(id) {
  if (!CHARACTERS[id]) throw new Error('캐릭터 정보를 확인할 수 없습니다.');
  return [
    ['체력', 100, '현재 모든 경기 캐릭터의 기본 체력입니다. 캐릭터별 보너스는 아직 적용되지 않습니다.'],
    ['회피율', '미설정', '확률 기반 회피는 아직 구현되지 않았습니다.']
  ];
}

export function createEquipmentInventory({ getEquipment, getLoadout, getCharacters, equipCharacter, renderCard,
  getWeaponItems = () => [], changeWeaponItem }) {
  const $ = id => document.getElementById(id);
  const dialog = $('equipment-dialog');
  const tabs = [...dialog.querySelectorAll('[data-equipment-tab]')];
  let slot = 'primary', sorted = false, keyboardOpened = false, weaponBusy = false;
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
    const values = CHARACTERS[id]
      ? characterInventoryStats(id)
      : weaponInventoryStats(id);
    for (const [name, value, explanation] of values) {
      const dt = document.createElement('dt'), dd = document.createElement('dd');
      dt.textContent = name; dd.textContent = value;
      if (explanation) dd.title = explanation;
      list.append(dt, dd);
    }
    return list;
  }
  function weaponAction(label, action, item, weapon) {
    const button = document.createElement('button'); button.type = 'button';
    button.className = 'weapon-item-action';
    button.textContent = label; button.disabled = weaponBusy;
    button.addEventListener('click', async () => {
      if (weaponBusy) return;
      if (action === 'upgrade' && !window.confirm(`${WEAPONS[item.weapon].name} ${item.grade}급을 ${weaponUpgradeCost(item.grade, item.level).toLocaleString('ko-KR')}골드로 강화할까요? 전투 수치는 변경되지 않습니다.`)) return;
      weaponBusy = true; render();
      $('inventory-status').textContent = '무기 정보를 저장하는 중입니다…';
      try {
        await changeWeaponItem(action, item, weapon);
        $('inventory-status').textContent = action === 'upgrade'
          ? '무기 레벨을 강화했습니다. 등급별 전투 보너스는 아직 적용되지 않습니다.'
          : '무기 카드를 장착했습니다.';
      } catch (error) {
        $('inventory-status').textContent = `무기 변경 실패: ${error.message}`;
        console.error('무기 변경 오류', error);
        try { await changeWeaponItem('read'); }
        catch (refreshError) {
          $('inventory-status').textContent += ` 장비 재확인 실패: ${refreshError.message} 새로고침하세요.`;
          console.error('무기 재확인 오류', refreshError);
        }
      } finally { weaponBusy = false; render(); updateWallet(); }
    });
    return button;
  }
  function content(id, item) {
    const body = document.createElement('div'); body.className = 'inventory-item-detail';
    body.append(renderCard(id, item), stats(id));
    if (item && changeWeaponItem) {
      const cost = weaponUpgradeCost(item.grade, item.level);
      if (cost !== null) body.append(weaponAction(`강화 · ${cost.toLocaleString('ko-KR')}골드`, 'upgrade', item));
      else {
        const max = document.createElement('p'); max.textContent = '최대 레벨 (MAX)'; body.append(max);
      }
    }
    if (CHARACTERS[id]) {
      body.classList.add('character-item-detail');
      const specialty = document.createElement('p'); specialty.className = 'character-specialty';
      specialty.textContent = '특기: 없음';
      specialty.title = '상점의 특기 소개 문구는 아직 전투 효과로 적용되지 않습니다.';
      const upgrade = document.createElement('button'); upgrade.type = 'button'; upgrade.className = 'character-upgrade';
      upgrade.textContent = '강화'; upgrade.disabled = true; upgrade.title = '캐릭터 강화는 준비 중입니다.';
      body.append(specialty, upgrade);
    }
    return body;
  }
  function render() {
    const equipment = getEquipment(), loadout = getLoadout();
    const current = slot === 'character' ? getCharacters().equipped : loadout[slot];
    const currentItem = getWeaponItems().find(item => item.weapon === current && item.equipped);
    dialog.classList.toggle('character-inventory', slot === 'character');
    for (const tab of tabs) {
      const selected = tab.dataset.equipmentTab === slot;
      tab.setAttribute('aria-selected', String(selected)); tab.tabIndex = selected ? 0 : -1;
    }
    $('equipment-panel').setAttribute('aria-labelledby', `tab-${slot}`);
    $('inventory-level').textContent = weaponLevelLabel(slot === 'character' ? getCharacters().characters[current]?.level || 1 : currentItem?.level || equipment[current]?.level || 1);
    if (slot === 'character') {
      const level = getCharacters().characters[current]?.level || 1;
      const progress = document.createElement('span'); progress.className = 'character-level-bar';
      progress.setAttribute('role', 'meter'); progress.setAttribute('aria-label', '캐릭터 레벨');
      progress.setAttribute('aria-valuemin', '1'); progress.setAttribute('aria-valuemax', '7'); progress.setAttribute('aria-valuenow', String(level));
      for (let index = 1; index <= 7; index++) {
        const segment = document.createElement('i'); segment.classList.toggle('filled', index <= level); progress.append(segment);
      }
      $('inventory-level').append(progress);
    }
    $('inventory-current').replaceChildren(content(current, currentItem));
    if (currentItem && changeWeaponItem) {
      $('inventory-current').append(weaponAction('기본 D급 무기 장착', 'restore', null, current));
    }
    if (slot === 'character' && current !== 'black-water') {
      const restore = document.createElement('button'); restore.type = 'button'; restore.textContent = '기본 캐릭터 장착';
      restore.className = 'character-restore';
      restore.addEventListener('click', async () => {
        restore.disabled = true;
        $('inventory-status').textContent = '기본 캐릭터의 3D 모델을 준비하고 장착하는 중입니다…';
        try { await equipCharacter('black-water'); render(); $('inventory-status').textContent = '기본 캐릭터와 3D 모델을 장착했습니다.'; }
        catch (error) { $('inventory-status').textContent = `장착 실패: ${error.message}`; console.error(error); restore.disabled = false; }
      });
      $('inventory-current').append(restore);
    }
    const prompt = document.createElement('p'); prompt.textContent = '비교할 장비를 선택해 주세요';
    $('inventory-comparison').replaceChildren(prompt);
    let entries = slot === 'character'
      ? Object.keys(getCharacters().characters).map(id => ({ id }))
      : [
        ...inventoryWeapons(equipment, slot).map(id => ({ id })),
        ...getWeaponItems().filter(item => WEAPONS[item.weapon].slot === slot).map(item => ({ id: item.weapon, item }))
      ];
    if (sorted) entries.sort((a, b) => (WEAPONS[a.id]?.name || CHARACTERS[a.id]?.name || a.id).localeCompare(WEAPONS[b.id]?.name || CHARACTERS[b.id]?.name || b.id, 'ko'));
    $('inventory-count').textContent = `${entries.length} / ${INVENTORY_LIMIT}`;
    $('inventory-items').replaceChildren();
    if (!entries.length) {
      const empty = document.createElement('p');
      empty.textContent = '보유 장비가 없습니다.';
      $('inventory-items').append(empty);
    }
    for (const { id, item } of entries) {
      const button = document.createElement('button'); button.type = 'button';
      button.className = 'inventory-item'; button.setAttribute('aria-label', `${WEAPONS[id]?.name || CHARACTERS[id]?.name}${item ? ` ${item.grade}급 ${weaponLevelLabel(item.level)}` : ''} 비교`);
      button.disabled = weaponBusy;
      button.append(renderCard(id, item));
      button.addEventListener('click', () => {
        const title = document.createElement('h2');
        title.textContent = (item ? item.equipped : id === current && !currentItem) ? '현재 장착된 장비와 동일합니다' : '선택한 장비';
        $('inventory-comparison').replaceChildren(title, content(id, item));
        if (item && !item.equipped && changeWeaponItem) {
          $('inventory-comparison').append(weaponAction('무기 장착', 'equip', item));
        }
        if (slot === 'character' && id !== current) {
          const equip = document.createElement('button'); equip.type = 'button'; equip.textContent = '캐릭터 장착';
          equip.addEventListener('click', async () => {
            equip.disabled = true;
            $('inventory-status').textContent = `${CHARACTERS[id].name}의 3D 모델을 준비하고 장착하는 중입니다…`;
            try { await equipCharacter(id); render(); $('inventory-status').textContent = `${CHARACTERS[id].name}과 3D 모델을 장착했습니다.`; }
            catch (error) {
              $('inventory-status').textContent = `장착 실패: ${error.message}`;
              console.error('캐릭터 장착 오류', error); equip.disabled = false;
            }
          });
          $('inventory-comparison').append(equip);
        }
      });
      $('inventory-items').append(button);
    }
  }
  function open(next, keyboard = false) {
    keyboardOpened = keyboard;
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
  dialog.addEventListener('close', () => {
    if ($('shop-dialog').open) return;
    $('home').hidden = false;
    if (keyboardOpened) $(slot).focus();
    else if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  });
  for (const name of ['primary', 'secondary', 'melee', 'character']) {
    const card = $(name);
    card.setAttribute('role', 'button'); card.tabIndex = 0;
    card.setAttribute('aria-haspopup', 'dialog');
    card.addEventListener('click', () => open(name));
    card.addEventListener('keydown', event => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault(); open(name, true);
    });
  }
  return { refresh() { if (dialog.open) { render(); updateWallet(); } } };
}
