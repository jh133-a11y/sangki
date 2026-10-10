import { WEAPONS, weaponStats, weaponLevelLabel, weaponSetColor, weaponSetBonus, weaponSetDescription } from './soldier-core.mjs?v=8';
import { CHARACTERS, characterStats, ownedCharacterLevel, characterLevelLabel, CHARACTER_MAX_LEVEL, CHARACTER_UPGRADE_COST } from './soldier-characters.mjs?v=8';
import { upgradeMaterials, selectBulkUpgradeMaterials, weaponMaterialXp, weaponUpgradePreview } from './soldier-weapon-items.mjs?v=12';

export const INVENTORY_LIMIT = 50;
export function sortInventoryEntries(entries, equipment, mode = 'grade', selectedKey = null) {
  const ranks = { 'S+': 6, S: 5, A: 4, B: 3, C: 2, D: 1 };
  const name = entry => WEAPONS[entry.id]?.name || CHARACTERS[entry.id]?.name || entry.id;
  const grade = entry => ranks[(entry.item || equipment[entry.id])?.grade] || 0;
  return [...entries].sort((a, b) =>
    Number((b.item?.id || b.id) === selectedKey) - Number((a.item?.id || a.id) === selectedKey)
    || (mode === 'grade' ? grade(b) - grade(a) : 0) || name(a).localeCompare(name(b), 'ko'));
}
export function inventoryCharacters(state) {
  return [...new Set(['black-water', ...Object.keys(state.characters)])]
    .filter(id => id !== state.equipped);
}
export function characterInventoryCount(state) {
  return new Set(['black-water', ...Object.keys(state.characters)]).size;
}
export function inventoryWeapons(equipment, slot) {
  return Object.keys(equipment).filter(id => WEAPONS[id]?.slot === slot);
}
export function weaponInventoryStats(id, grade = 'D', level = 1, color = 'standard', setColor = null) {
  const weapon = WEAPONS[id] && weaponStats(id, grade, level, color);
  if (!weapon) throw new Error('무기 정보를 확인할 수 없습니다.');
  const matchingSet = typeof setColor === 'object' && setColor !== null
    ? setColor.grade === grade && setColor.color === color : setColor === color;
  if (matchingSet) {
    const bonus = weaponSetBonus(grade, color);
    weapon.damage += bonus.damage;
    weapon.critical += bonus.critical;
    if (bonus.weightPercent && Number.isInteger(weapon.weight)) {
      weapon.weight = Math.round(weapon.weight * (100 - bonus.weightPercent) / 100);
    }
  }
  return [
    ['탄창/보유탄환', weapon.slot === 'melee' ? '-' : `${weapon.magazine} / ${weapon.reserve ?? '미설정'}`, '초기 탄창/추가 보유탄환입니다. 근접무기는 탄환을 소모하지 않습니다.'],
    ['위력', weapon.damage, '현재 서버에서 사용하는 기본 피해량입니다.'],
    ['연사속도', Math.round(60 / weapon.delay), '현재 공격 간격을 분당 공격 횟수로 환산한 값입니다.'],
    ['정확도', weapon.accuracy ?? '-', '설정된 정확도입니다. 수치별 탄 퍼짐 계산식은 아직 적용하지 않습니다.'],
    ['반동제어', weapon.recoilControl ?? '-', '설정된 반동제어입니다. 수치별 조준 반동 계산식은 아직 적용하지 않습니다.'],
    ['무게', weapon.weight ?? '-', '설정된 무게입니다. 무게별 이동속도 계산식은 아직 적용하지 않습니다.'],
    ['크리티컬 확률', `${weapon.critical}%`, '명중 시 해당 확률로 위력의 2배 피해를 줍니다.']
  ];
}
export function characterInventoryStats(id, level = 1) {
  if (!CHARACTERS[id]) throw new Error('캐릭터 정보를 확인할 수 없습니다.');
  const values = characterStats(id, level);
  return [
    ['체력', values.hp, '캐릭터와 레벨에 따른 최대 체력입니다.'],
    ['회피율', `${Number((values.evasion * 100).toFixed(1))}%`, '명중한 공격의 피해를 무효화할 확률입니다.'],
    ['위력 증가', `+${values.damageBonus ?? 0}`, '캐릭터 능력으로 추가되는 공격 위력입니다.'],
    ['크리티컬 확률 증가', `+${values.criticalBonus ?? 0}%`, '캐릭터 능력으로 추가되는 크리티컬 확률입니다.']
  ];
}

export function formatWeaponSetStats(values, set) {
  if (!set) return values;
  const bonus = weaponSetBonus(set.grade, set.color);
  return values.map(([name, value, explanation]) => {
    if (name === '위력' && bonus.damage) value = `${value} + ${bonus.damage}`;
    if (name === '크리티컬 확률' && bonus.critical) value = `${value} + ${bonus.critical}%`;
    if (name === '무게' && bonus.weightPercent && Number.isInteger(value)) value = `${value} - ${bonus.weightPercent}%`;
    return [name, value, explanation];
  });
}

export function createEquipmentInventory({ getEquipment, getLoadout, getCharacters, equipCharacter, renderCard,
  getWeaponItems = () => [], getWeaponItemsError = () => null,
  changeWeaponItem, sellWeaponItems, operateWeapon, getGems = () => null, upgradeCharacter }) {
  const $ = id => document.getElementById(id);
  const dialog = $('equipment-dialog');
  const tabs = [...dialog.querySelectorAll('[data-equipment-tab]')];
  let slot = 'primary', sortMode = 'grade', keyboardOpened = false, weaponBusy = false, characterBusy = false;
  const selectedWeapons = {};
  const saleDialog = document.createElement('dialog');
  saleDialog.setAttribute('aria-label', '무기 판매 확인');
  const saleMessage = document.createElement('p');
  const saleForm = document.createElement('form'); saleForm.method = 'dialog';
  for (const [value, label] of [['cancel', '취소'], ['sell', '판매']]) {
    const button = document.createElement('button'); button.type = 'submit';
    button.value = value; button.textContent = label; saleForm.append(button);
  }
  saleDialog.append(saleMessage, saleForm); document.body.append(saleDialog);
  const salePicker = document.createElement('dialog');
  salePicker.id = 'weapon-sale-dialog'; salePicker.setAttribute('aria-label', '판매할 무기 선택');
  document.body.append(salePicker);
  salePicker.addEventListener('cancel', event => { if (weaponBusy) event.preventDefault(); });
  function openSalePicker() {
    if (weaponBusy || !sellWeaponItems || slot === 'character') return;
    const header = document.createElement('header'); header.className = 'weapon-operation-header';
    const title = document.createElement('h2'); title.textContent = '판매';
    const close = document.createElement('button'); close.type = 'button'; close.textContent = '×';
    close.setAttribute('aria-label', '닫기'); close.addEventListener('click', () => salePicker.close());
    header.append(title, close);
    const target = document.createElement('section'); target.className = 'weapon-operation-slot';
    target.textContent = '판매할 무기를 선택하세요';
    const controls = document.createElement('section'); controls.className = 'weapon-operation-controls';
    const price = document.createElement('strong');
    const selected = new Set(), options = [];
    const sell = document.createElement('button'); sell.type = 'button'; sell.textContent = '선택 판매';
    sell.className = 'weapon-item-action';
    const selectAll = document.createElement('button'); selectAll.type = 'button'; selectAll.textContent = '전체 선택';
    const reset = document.createElement('button'); reset.type = 'button'; reset.textContent = '선택초기화';
    controls.append(price, selectAll, reset, sell);
    const top = document.createElement('div'); top.className = 'weapon-operation-top'; top.append(target, controls);
    const choices = document.createElement('div'); choices.className = 'weapon-operation-choices';
    const candidates = [
      ...inventoryWeapons(getEquipment(), slot).filter(id => id !== getLoadout()[slot]).map(id => ({ id })),
      ...getWeaponItems().filter(item => !item.equipped && WEAPONS[item.weapon].slot === slot)
        .map(item => ({ id: item.weapon, item }))
    ];
    for (const { id, item } of candidates) {
      const option = document.createElement('button'); option.type = 'button'; option.className = 'weapon-operation-choice';
      option.setAttribute('aria-label', `${WEAPONS[id].name} 판매 선택`);
      option.setAttribute('aria-pressed', 'false');
      option.append(inventoryCard(id, item));
      const entry = { id, item };
      options.push({ option, entry });
      option.addEventListener('click', () => {
        if (weaponBusy) return;
        if (selected.has(entry)) selected.delete(entry); else selected.add(entry);
        updateSelection();
      });
      choices.append(option);
    }
    if (!candidates.length) choices.textContent = '판매할 미장착 무기가 없습니다.';
    const status = document.createElement('p'); status.className = 'weapon-operation-status'; status.setAttribute('role', 'status');
    function updateSelection() {
      price.textContent = `${selected.size}개 선택 · ${(selected.size * 100).toLocaleString('ko-KR')} 골드`;
      target.textContent = '미장착 무기를 여러 개 선택할 수 있습니다.';
      for (const { option, entry } of options) {
        option.setAttribute('aria-pressed', String(selected.has(entry))); option.disabled = weaponBusy;
      }
      sell.disabled = weaponBusy || !selected.size;
      selectAll.disabled = reset.disabled = weaponBusy || !candidates.length;
      close.disabled = weaponBusy;
    }
    selectAll.addEventListener('click', () => { options.forEach(({ entry }) => selected.add(entry)); updateSelection(); });
    reset.addEventListener('click', () => { selected.clear(); updateSelection(); });
    sell.addEventListener('click', async () => {
      if (weaponBusy || !selected.size) return;
      const entries = [...selected];
      weaponBusy = true; updateSelection();
      try {
        if (!await confirmSale(entries.length)) return;
        status.textContent = '선택한 무기를 판매하는 중입니다…'; render();
        await sellWeaponItems(entries);
        salePicker.close();
        $('inventory-status').textContent = `${entries.length}개 판매 완료 · ${(entries.length * 100).toLocaleString('ko-KR')}골드를 획득했습니다.`;
      } catch (error) {
        status.textContent = `무기 판매 실패: ${error.message}`;
        $('inventory-status').textContent = status.textContent;
        console.error('무기 일괄 판매 오류', error);
      } finally { weaponBusy = false; updateSelection(); render(); updateWallet(); }
    });
    updateSelection();
    salePicker.replaceChildren(header, top, choices, status); salePicker.showModal();
  }
  function confirmSale(count) {
    saleMessage.textContent = `선택한 무기 ${count}개를 ${(count * 100).toLocaleString('ko-KR')}골드에 판매하시겠습니까?`;
    saleDialog.returnValue = 'cancel';
    return new Promise(resolve => {
      saleDialog.addEventListener('close', () => resolve(saleDialog.returnValue === 'sell'), { once: true });
      saleDialog.showModal(); saleForm.querySelector('button').focus();
    });
  }
  const materialDialog = document.createElement('dialog');
  materialDialog.id = 'weapon-material-dialog'; materialDialog.setAttribute('aria-label', '무기 강화재료 선택');
  document.body.append(materialDialog);
  const operationDialog = document.createElement('dialog');
  operationDialog.id = 'weapon-operation-dialog'; operationDialog.setAttribute('aria-label', '무기 조합 및 분해');
  document.body.append(operationDialog);
  const characterConfirmation = document.createElement('dialog');
  characterConfirmation.id = 'character-upgrade-dialog';
  characterConfirmation.setAttribute('aria-label', '캐릭터 강화 확인');
  const characterMessage = document.createElement('p');
  const characterForm = document.createElement('form'); characterForm.method = 'dialog';
  characterForm.className = 'shop-confirm-actions';
  for (const [value, label] of [['cancel', '취소'], ['upgrade', '강화']]) {
    const button = document.createElement('button'); button.type = 'submit';
    button.value = value; button.textContent = label; characterForm.append(button);
  }
  characterConfirmation.append(characterMessage, characterForm);
  document.body.append(characterConfirmation);
  function confirmCharacterUpgrade(id, level) {
    characterMessage.textContent = `${CHARACTERS[id].name.replace('\n', ' ')}을 ${CHARACTER_UPGRADE_COST.toLocaleString('ko-KR')}골드로 Lv.${level + 1}로 강화할까요?`;
    characterConfirmation.returnValue = 'cancel';
    return new Promise(resolve => {
      characterConfirmation.addEventListener('close', () => resolve(characterConfirmation.returnValue === 'upgrade'), { once: true });
      characterConfirmation.showModal(); characterForm.querySelector('button').focus();
    });
  }
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
  function equippedSet() {
    const bySlot = Object.fromEntries(getWeaponItems()
      .filter(item => item.equipped && WEAPONS[item.weapon])
      .map(item => [WEAPONS[item.weapon].slot, item]));
    const color = weaponSetColor(bySlot);
    return color ? { color, grade: bySlot.primary.grade } : null;
  }
  function equippedCharacterStats() {
    const characters = getCharacters();
    return characterStats(characters.equipped, ownedCharacterLevel(characters, characters.equipped));
  }
  function inventoryCard(id, item) {
    const card = renderCard(id, item);
    const set = item?.equipped ? equippedSet() : null;
    if (set && set.grade === item.grade && set.color === (item.color || 'standard')) {
      card.dataset.setColor = set.color;
    } else {
      delete card.dataset.setColor;
    }
    return card;
  }
  function stats(id, item) {
    const list = document.createElement('dl');
    const set = item?.equipped ? equippedSet() : null;
    let values = CHARACTERS[id]
      ? characterInventoryStats(id, ownedCharacterLevel(getCharacters(), id))
      : weaponInventoryStats(id, item?.grade || getEquipment()[id]?.grade || 'D',
        item?.level || getEquipment()[id]?.level || 1, item?.color || 'standard');
    if (!CHARACTERS[id]) values = formatWeaponSetStats(addCharacterStats(values), set);
    for (const [name, value, explanation] of values) {
      const dt = document.createElement('dt'), dd = document.createElement('dd');
      dt.textContent = name; dd.textContent = value;
      if (explanation) dd.title = explanation;
      list.append(dt, dd);
    }
    return list;
  }
  function addCharacterStats(values) {
      const character = equippedCharacterStats();
      if (!Number.isFinite(character.damageBonus) || !Number.isFinite(character.criticalBonus)) {
        throw new Error('캐릭터 무기 보너스 정보를 확인할 수 없습니다.');
      }
      const damage = values.find(([label]) => label === '위력');
      if (damage && Number.isFinite(damage[1])) damage[1] += character.damageBonus;
      const critical = values.find(([label]) => label === '크리티컬 확률');
      if (critical && typeof critical[1] === 'string') {
        const base = Number.parseFloat(critical[1]);
        if (!Number.isFinite(base)) throw new Error('무기 크리티컬 정보를 확인할 수 없습니다.');
        critical[1] = `${base + character.criticalBonus}%`;
      }
    return values;
  }
  function weaponAction(label, action, item, weapon) {
    const button = document.createElement('button'); button.type = 'button';
    button.className = 'weapon-item-action';
    button.textContent = label; button.disabled = weaponBusy;
    button.addEventListener('click', async () => {
      if (weaponBusy) return;
      weaponBusy = true; render();
      $('inventory-status').textContent = '무기 정보를 저장하는 중입니다…';
      try {
        await changeWeaponItem(action, item, weapon);
        $('inventory-status').textContent = '무기 카드를 장착했습니다.';
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
  function selectMaterials(item) {
    const heading = document.createElement('h2');
    const toolIcon = document.createElement('span'); toolIcon.className = 'weapon-material-tool-icon';
    toolIcon.textContent = '⚒'; toolIcon.setAttribute('aria-hidden', 'true');
    const headingText = document.createElement('span'); headingText.textContent = '강화';
    heading.append(toolIcon, headingText);
    const warning = document.createElement('p');
    warning.className = 'weapon-material-warning';
    warning.textContent = '재료로 사용한 무기는 소모되어 사라집니다.';
    const list = document.createElement('div'); list.className = 'weapon-material-list';
    const summary = document.createElement('p'); summary.setAttribute('role', 'status');
    const cancel = document.createElement('button'); cancel.type = 'button'; cancel.textContent = '×';
    cancel.className = 'weapon-material-close'; cancel.setAttribute('aria-label', '강화 취소');
    const submit = document.createElement('button'); submit.type = 'button'; submit.textContent = '강화시작';
    const footer = document.createElement('div'); footer.className = 'weapon-material-footer';
    const actions = document.createElement('div'); actions.className = 'weapon-material-actions';
    const cost = document.createElement('div'); cost.className = 'weapon-material-cost';
    const coin = document.createElement('span'); coin.textContent = 'G'; coin.setAttribute('aria-hidden', 'true');
    const price = document.createElement('strong'); price.setAttribute('aria-label', '강화 비용');
    cost.append(coin, price); actions.append(cancel, submit); footer.append(cost, actions);
    const header = document.createElement('header'); header.className = 'weapon-material-header';
    header.append(heading, warning);
    const target = document.createElement('section'); target.className = 'weapon-material-target';
    target.setAttribute('aria-label', '강화할 무기 및 예상 능력치');
    const targetHeading = document.createElement('div'); targetHeading.className = 'weapon-material-target-heading';
    const title = document.createElement('strong'); title.textContent = '강화할 무기';
    const nextLevel = document.createElement('strong');
    const progress = document.createElement('progress'); progress.max = 100; progress.setAttribute('aria-label', '강화 후 예상 진행률');
    const percent = document.createElement('span');
    const meter = document.createElement('div'); meter.className = 'weapon-material-meter'; meter.append(progress, percent);
    targetHeading.append(title, nextLevel, meter);
    const detail = document.createElement('div'); detail.className = 'weapon-material-target-detail';
    const table = document.createElement('table'); table.className = 'weapon-material-stats';
    table.setAttribute('aria-label', '현재 능력치와 강화 후 능력치 비교');
    const setColor = item.equipped ? equippedSet() : null;
    const before = addCharacterStats(weaponInventoryStats(item.weapon, item.grade, item.level, item.color, setColor));
    const rows = before.map(([name, value, explanation]) => {
      const row = document.createElement('tr');
      const label = document.createElement('th'); label.scope = 'row'; label.textContent = name; label.title = explanation;
      const current = document.createElement('td'); current.textContent = value; current.setAttribute('aria-label', '현재');
      const arrow = document.createElement('td'); arrow.className = 'weapon-material-arrow'; arrow.setAttribute('aria-hidden', 'true');
      const after = document.createElement('td'); after.className = 'weapon-material-stat-next'; after.setAttribute('aria-label', '강화 후');
      row.append(label, current, arrow, after); table.append(row);
      return { arrow, after };
    });
    detail.append(inventoryCard(item.weapon, item), table); target.append(targetHeading, detail);
    const top = document.createElement('div'); top.className = 'weapon-material-top'; top.append(target, footer);
    const toolbar = document.createElement('div'); toolbar.className = 'weapon-material-toolbar';
    const count = document.createElement('strong'); count.className = 'weapon-material-count'; toolbar.append(count);
    const choices = [], candidates = upgradeMaterials(getWeaponItems(), item);
    let materialSorted = false;
    function tool(label, action) {
      const button = document.createElement('button'); button.type = 'button'; button.textContent = label;
      button.addEventListener('click', action); toolbar.append(button); return button;
    }
    const sortButton = tool('↓ 정렬', () => {
      materialSorted = !materialSorted;
      const order = [...candidates];
      if (materialSorted) order.sort((a, b) => weaponMaterialXp(b) - weaponMaterialXp(a)
        || WEAPONS[a.weapon].name.localeCompare(WEAPONS[b.weapon].name, 'ko'));
      list.replaceChildren(...order.map(material => choices.find(input => input.value === material.id).parentElement));
      sortButton.textContent = materialSorted ? '기본순' : '↓ 정렬';
    });
    const bulkButtons = [];
    for (const grade of ['C', 'D', 'B']) {
      const button = tool(`${grade}등급 선택`, () => {
        const currentIds = new Set(selected().map(input => input.value));
        const picked = selectBulkUpgradeMaterials(item, candidates, candidates.filter(material => currentIds.has(material.id)), grade);
        const ids = new Set(picked.map(material => material.id));
        choices.forEach(input => { input.checked = ids.has(input.value); });
        update();
      });
      button.title = `${grade}급 Lv.1 · 강화 진행률 0% 무기만 선택합니다. MAX에 도달하면 멈춥니다.`;
      bulkButtons.push({ button, grade });
    }
    tool('선택초기화', () => { choices.forEach(input => { input.checked = false; }); update(); });
    for (const material of candidates) {
      const label = document.createElement('label'), input = document.createElement('input');
      input.type = 'checkbox'; input.value = material.id; input.dataset.material = material.id;
      input.dataset.grade = material.grade;
      const name = document.createElement('span');
      name.className = 'weapon-material-description';
      name.textContent = `${WEAPONS[material.weapon].name} ${material.grade}급 ${weaponLevelLabel(material.level)} · ${material.upgrade_progress}%`;
      label.title = name.textContent;
      const check = document.createElement('span'); check.className = 'weapon-material-check'; check.textContent = '✓'; check.setAttribute('aria-hidden', 'true');
      label.append(input, inventoryCard(material.weapon, material), check, name); list.append(label); choices.push(input);
    }
    if (!choices.length) { list.textContent = '사용 가능한 미장착 무기가 없습니다.'; sortButton.disabled = true; }
    const selected = () => choices.filter(input => input.checked);
    function update() {
      const ids = new Set(selected().map(input => input.value));
      const preview = weaponUpgradePreview(item, candidates.filter(material => ids.has(material.id)));
      summary.textContent = `${weaponLevelLabel(item.level)} ${item.upgrade_progress}% → ${weaponLevelLabel(preview.level)} ${preview.level === 7 ? '' : `${preview.percent}%`} · ${ids.size}개 소모${preview.overflow ? ' · MAX를 초과한 강화분은 소멸합니다.' : ''}`;
      warning.textContent = preview.overflow
        ? '재료 무기는 사라집니다. MAX를 초과한 강화분은 소멸합니다.'
        : '재료로 사용한 무기는 소모되어 사라집니다.';
      count.textContent = `선택된 아이템 : ${ids.size}`;
      price.textContent = preview.cost.toLocaleString('ko-KR');
      nextLevel.textContent = `LV${preview.level}`;
      progress.value = preview.level === 7 ? 100 : preview.percent;
      percent.textContent = `${progress.value}%`;
      choices.forEach(input => { input.disabled = !input.checked && preview.level === 7; });
      for (const { button, grade } of bulkButtons) {
        button.disabled = preview.level === 7 || !candidates.some(material => material.grade === grade
          && material.level === 1 && material.upgrade_xp === 0 && !ids.has(material.id));
      }
      const after = addCharacterStats(weaponInventoryStats(item.weapon, item.grade, preview.level, item.color, setColor));
      rows.forEach((row, index) => {
        const changed = before[index][1] !== after[index][1];
        row.arrow.textContent = changed ? '»' : '';
        row.after.textContent = changed ? after[index][1] : '';
      });
      submit.disabled = !ids.size;
    }
    choices.forEach(input => input.addEventListener('change', update));
    cancel.addEventListener('click', () => materialDialog.close());
    submit.addEventListener('click', async () => {
      if (weaponBusy || submit.disabled) return;
      const ids = selected().map(input => input.value), request = crypto.randomUUID();
      weaponBusy = true; materialDialog.close(); render();
      $('inventory-status').textContent = '강화재료와 골드를 처리하는 중입니다…';
      try {
        await changeWeaponItem('material', item, null, { ids, request });
        const updated = getWeaponItems().find(entry => entry.id === item.id);
        $('inventory-status').textContent = updated.level > item.level
          ? `${WEAPONS[item.weapon].name} ${weaponLevelLabel(updated.level)} 강화 완료`
          : `${WEAPONS[item.weapon].name} 강화 진행률 ${updated.upgrade_progress}%`;
      } catch (error) {
        $('inventory-status').textContent = `강화 실패: ${error.message}`;
        console.error('재료 강화 오류', error);
        try { await changeWeaponItem('read'); }
        catch (refreshError) { $('inventory-status').textContent += ` 재확인 실패: ${refreshError.message} 새로고침하세요.`; console.error(refreshError); }
      } finally { weaponBusy = false; render(); updateWallet(); }
    });
    const help = document.createElement('p'); help.className = 'weapon-material-help';
    help.textContent = '기본·장착 무기는 재료로 사용할 수 없습니다. 등급 일괄 선택은 Lv.1·0% 무기만 선택하며 MAX에 도달하면 추가 선택이 중단됩니다. 마지막 재료의 초과 강화분은 소멸합니다.';
    materialDialog.replaceChildren(header, top, summary, toolbar, list, help);
    heading.tabIndex = -1;
    update(); materialDialog.showModal(); heading.focus({ preventScroll: true });
  }
  function openWeaponOperation(action, item) {
    if (!operateWeapon) return;
    const isCombine = action === 'combine';
    let selected = null, request = crypto.randomUUID(), pending = false;
    const heading = document.createElement('h2'); heading.textContent = isCombine ? '조합' : '분해';
    const close = document.createElement('button'); close.type = 'button'; close.className = 'weapon-operation-close';
    close.textContent = '×'; close.setAttribute('aria-label', '닫기');
    close.addEventListener('click', () => operationDialog.close());
    const header = document.createElement('header'); header.className = 'weapon-operation-header';
    header.append(heading, close);
    const status = document.createElement('p'); status.className = 'weapon-operation-status'; status.setAttribute('role', 'status');
    const slots = document.createElement('div'); slots.className = 'weapon-operation-slots';
    const first = document.createElement('section'); first.className = 'weapon-operation-slot';
    const firstLabel = document.createElement('strong'); firstLabel.textContent = isCombine ? '베이스' : '분해할 무기';
    first.append(firstLabel, inventoryCard(item.weapon, item));
    slots.append(first);
    if (isCombine) {
      const plus = document.createElement('span'); plus.className = 'weapon-operation-plus'; plus.textContent = '+';
      const second = document.createElement('section'); second.className = 'weapon-operation-slot';
      const secondLabel = document.createElement('strong'); secondLabel.textContent = '재료';
      const secondCard = document.createElement('div'); secondCard.className = 'weapon-operation-empty'; secondCard.textContent = 'MAX 무기를 선택하세요';
      second.append(secondLabel, secondCard); slots.append(plus, second);
    }
    const warning = document.createElement('p'); warning.className = 'weapon-operation-warning';
    warning.textContent = isCombine
      ? `같은 등급의 MAX 무기 2개가 필요하며 재료 무기는 사라집니다. ${item.grade}급 2개를 조합하면 다음 등급 무기 1개를 획득합니다.`
      : item.grade === 'S+'
        ? 'S+급 무기를 분해하면 같은 분류의 S급 Lv.1 무기 2개를 획득합니다.'
        : 'S급 무기를 분해하면 같은 분류의 A급 무기 2개를 획득합니다.';
    const cost = document.createElement('strong'); cost.className = 'weapon-operation-cost';
    const price = isCombine ? ({ D: 5, C: 10, B: 20, A: 50, S: 100 }[item.grade]) : 0;
    if (isCombine) {
      const gem = document.querySelector('.currency.gems svg').cloneNode(true);
      const amount = document.createElement('span'); amount.textContent = `${price} 보석`;
      cost.append(gem, amount);
    } else cost.textContent = item.grade === 'S+' ? 'S급 Lv.1 무기 2개' : 'A급 무기 2개';
    const submit = document.createElement('button'); submit.type = 'button';
    submit.className = 'weapon-operation-submit'; submit.textContent = isCombine ? '조합 시작' : '분해 시작';
    const controls = document.createElement('section'); controls.className = 'weapon-operation-controls';
    controls.append(warning, cost, submit);
    const top = document.createElement('div'); top.className = 'weapon-operation-top'; top.append(slots, controls);
    const choices = document.createElement('div'); choices.className = 'weapon-operation-choices';
    const results = document.createElement('div'); results.className = 'weapon-operation-results';
    const eligible = isCombine
      ? getWeaponItems().filter(candidate => candidate.id !== item.id && candidate.grade === item.grade
        && candidate.level === 7)
      : [];
    function update() {
      const availableGems = Number(getGems());
      submit.disabled = pending || (isCombine && (!selected || (Number.isFinite(availableGems) && availableGems < price)));
      if (isCombine) {
        const secondSlot = slots.querySelector('.weapon-operation-slot:last-child');
        secondSlot.replaceChildren(secondSlot.querySelector('strong'));
        if (selected) secondSlot.append(inventoryCard(selected.weapon, selected));
        else {
          const empty = document.createElement('div'); empty.className = 'weapon-operation-empty';
          empty.textContent = 'MAX 무기를 선택하세요'; secondSlot.append(empty);
        }
      }
    }
    if (isCombine) {
      for (const candidate of eligible) {
        const option = document.createElement('button'); option.type = 'button'; option.className = 'weapon-operation-choice';
        option.setAttribute('aria-label', `${WEAPONS[candidate.weapon].name} ${candidate.grade}급 MAX 무기 선택`);
        option.append(inventoryCard(candidate.weapon, candidate));
        option.addEventListener('click', () => { selected = candidate; choices.querySelectorAll('.weapon-operation-choice').forEach(button => button.removeAttribute('aria-pressed')); option.setAttribute('aria-pressed', 'true'); update(); });
        choices.append(option);
      }
      if (!eligible.length) choices.textContent = '같은 등급의 MAX 무기가 없습니다.';
    }
    else choices.hidden = true;
    submit.addEventListener('click', async () => {
      if (submit.disabled) return;
      pending = true; status.textContent = '무기 작업을 처리하는 중입니다…'; update();
      try {
        const result = await operateWeapon(action, item, selected, request);
        const rewardCards = (result.results || []).map(reward => renderCard(reward.weapon, reward));
        status.textContent = isCombine ? '조합 완료' : '분해 완료';
        submit.hidden = true; choices.hidden = true; top.hidden = true;
        if (!isCombine) {
          if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
            results.replaceChildren(...rewardCards);
          } else {
            const stage = document.createElement('div'); stage.className = 'weapon-disassembly-stage';
            const source = inventoryCard(item.weapon, item);
            const shards = ['left', 'right'].map(side => {
              const shard = document.createElement('div'); shard.className = `weapon-disassembly-shard weapon-disassembly-shard-${side}`;
              shard.append(source.cloneNode(true)); return shard;
            });
            const resultRow = document.createElement('div'); resultRow.className = 'weapon-disassembly-results';
            resultRow.append(...rewardCards);
            stage.append(...shards, resultRow); results.replaceChildren(stage);
            requestAnimationFrame(() => {
              stage.dataset.phase = 'splitting';
              setTimeout(() => {
                shards.forEach(shard => shard.remove());
                stage.dataset.phase = 'revealed';
              }, 720);
            });
          }
        } else results.replaceChildren(...rewardCards);
      } catch (error) {
        pending = false; status.textContent = `무기 ${isCombine ? '조합' : '분해'} 실패: ${error.message}`;
        console.error('무기 조합·분해 오류', error); update();
      }
    });
    operationDialog.replaceChildren(header, top, choices, status, results);
    update(); operationDialog.showModal();
  }
  function content(id, item) {
    const body = document.createElement('div'); body.className = 'inventory-item-detail';
    body.append(inventoryCard(id, item), stats(id, item));
    if (item && changeWeaponItem) {
      if (item.level < 7) {
        const button = document.createElement('button'); button.type = 'button';
        button.className = 'weapon-item-action';
        button.textContent = '강화';
        button.disabled = weaponBusy || !item.materialReady;
        button.addEventListener('click', () => selectMaterials(item));
        button.title = item.materialReady ? '강화재료 선택' : 'soldier-weapon-material-upgrade.sql 실행 후 강화 가능합니다.';
        body.append(button);
      }
      else {
        const max = document.createElement('button'); max.type = 'button'; max.className = 'weapon-item-action';
        max.textContent = '강화'; max.disabled = true; max.title = '최대 레벨 (MAX)'; body.append(max);
      }
    }
    if (item && operateWeapon) {
      const actions = document.createElement('div'); actions.className = 'weapon-operation-item-actions';
      const combine = document.createElement('button'); combine.type = 'button'; combine.className = 'weapon-item-action';
      combine.textContent = '조합'; combine.disabled = weaponBusy || item.level !== 7 || item.grade === 'S+';
      combine.title = item.grade === 'S+' ? 'S+급은 조합할 수 없습니다.'
        : item.level !== 7 ? 'MAX 레벨 무기만 조합할 수 있습니다.' : '같은 등급의 MAX 무기 2개를 조합합니다.';
      combine.addEventListener('click', () => openWeaponOperation('combine', item)); actions.append(combine);
      if (item.grade === 'S' || item.grade === 'S+') {
        const disassemble = document.createElement('button'); disassemble.type = 'button'; disassemble.className = 'weapon-item-action';
        disassemble.textContent = '분해'; disassemble.disabled = weaponBusy || item.equipped || item.source === 'default';
        disassemble.title = item.grade === 'S+' ? 'S+ 무기를 같은 분류의 S급 Lv.1 무기 2개로 분해합니다.'
          : 'S급 무기를 같은 분류의 A급 무기 2개로 분해합니다.';
        disassemble.addEventListener('click', () => openWeaponOperation('disassemble', item)); actions.append(disassemble);
      }
      body.append(actions);
    }
    if (CHARACTERS[id]) {
      body.classList.add('character-item-detail');
      const upgrade = document.createElement('button'); upgrade.type = 'button'; upgrade.className = 'character-upgrade';
      const level = ownedCharacterLevel(getCharacters(), id);
      upgrade.textContent = level === CHARACTER_MAX_LEVEL ? 'MAX' : '강화';
      upgrade.disabled = characterBusy || level === CHARACTER_MAX_LEVEL || !getCharacters().upgradeReady;
      upgrade.title = getCharacters().upgradeReady ? '강화 1회당 10,000골드' : 'soldier-character-upgrade.sql 실행 후 새로고침하세요.';
      upgrade.addEventListener('click', async () => {
        if (characterBusy) return;
        characterBusy = true; render();
        try {
          if (!await confirmCharacterUpgrade(id, level)) return;
          $('inventory-status').textContent = '캐릭터를 강화하는 중입니다…';
          await upgradeCharacter(id, level);
          $('inventory-status').textContent = `${CHARACTERS[id].name} ${characterLevelLabel(level + 1)} 강화 완료`;
        } catch (error) {
          $('inventory-status').textContent = `캐릭터 강화 실패: ${error.message}`;
          console.error('캐릭터 강화 오류', error);
          try { await upgradeCharacter(); }
          catch (refreshError) { $('inventory-status').textContent += ` 재확인 실패: ${refreshError.message} 새로고침하세요.`; console.error(refreshError); }
        } finally { characterBusy = false; render(); updateWallet(); }
      });
      body.append(upgrade);
    }
    if (!CHARACTERS[id]) {
      const actions = document.createElement('div'); actions.className = 'inventory-weapon-actions';
      for (const child of [...body.children]) {
        if (child.matches('.weapon-item-action')) actions.append(child);
        else if (child.matches('.weapon-operation-item-actions')) {
          actions.append(...child.children); child.remove();
        }
      }
      const option = document.createElement('button'); option.type = 'button'; option.className = 'weapon-item-action';
      option.textContent = '옵션'; option.disabled = true; option.title = '옵션 기능은 준비 중입니다.';
      actions.append(option);
      if (item && changeWeaponItem) {
        const equip = weaponAction('장착', 'equip', item); equip.disabled = weaponBusy || item.equipped;
        actions.append(equip);
      }
      body.append(actions);
    }
    return body;
  }
  function render() {
    const equipment = getEquipment(), loadout = getLoadout();
    const loadError = slot === 'character' ? null : getWeaponItemsError();
    const current = slot === 'character' ? getCharacters().equipped : loadout[slot];
    const currentItem = getWeaponItems().find(item => item.weapon === current && item.equipped);
    $('inventory-sell').disabled = slot === 'character' || weaponBusy || !sellWeaponItems || !!loadError;
    dialog.classList.toggle('character-inventory', slot === 'character');
    for (const tab of tabs) {
      const selected = tab.dataset.equipmentTab === slot;
      tab.setAttribute('aria-selected', String(selected)); tab.tabIndex = selected ? 0 : -1;
    }
    $('equipment-panel').setAttribute('aria-labelledby', `tab-${slot}`);
    $('inventory-level').textContent = slot === 'character'
      ? characterLevelLabel(ownedCharacterLevel(getCharacters(), current))
      : weaponLevelLabel(currentItem?.level || equipment[current]?.level || 1);
    if (slot === 'character') {
      const level = ownedCharacterLevel(getCharacters(), current);
      const progress = document.createElement('span'); progress.className = 'character-level-bar';
      progress.setAttribute('role', 'meter'); progress.setAttribute('aria-label', '캐릭터 레벨');
      progress.setAttribute('aria-valuemin', '1'); progress.setAttribute('aria-valuemax', String(CHARACTER_MAX_LEVEL)); progress.setAttribute('aria-valuenow', String(level));
      for (let index = 1; index <= CHARACTER_MAX_LEVEL; index++) {
        const segment = document.createElement('i'); segment.classList.toggle('filled', index <= level); progress.append(segment);
      }
      $('inventory-level').append(progress);
    }
    const meter = $('inventory-progress');
    meter.hidden = slot === 'character';
    if (slot !== 'character') {
      const level = currentItem?.level || equipment[current]?.level || 1;
      const percent = level === 7 ? 100 : currentItem?.upgrade_progress ?? 0;
      $('inventory-progress-value').value = percent;
      $('inventory-progress-percent').textContent = `${percent}%`;
    }
    $('inventory-current').replaceChildren(content(current, currentItem));
    const set = equippedSet();
    $('inventory-set-effect').dataset.setColor = set?.color || '';
    $('inventory-set-effect').textContent = set ? weaponSetDescription(set.grade, set.color) : '';
    $('inventory-set-effect').hidden = !set;
    const prompt = document.createElement('p'); prompt.textContent = '비교할 장비를 선택해 주세요';
    $('inventory-comparison').replaceChildren(prompt);
    let entries = slot === 'character'
      ? inventoryCharacters(getCharacters()).map(id => ({ id }))
      : [
        ...inventoryWeapons(equipment, slot).map(id => ({ id })),
        ...getWeaponItems().filter(item => WEAPONS[item.weapon].slot === slot).map(item => ({ id: item.weapon, item }))
      ];
    const count = slot === 'character' ? characterInventoryCount(getCharacters()) : entries.length;
    if (slot !== 'character') entries = entries.filter(({ item }) => !item?.equipped);
    entries = sortInventoryEntries(entries, equipment, sortMode, selectedWeapons[slot]);
    $('inventory-sort').textContent = sortMode === 'grade' ? '등급순 정렬' : '이름순 정렬';
    $('inventory-sort').setAttribute('aria-label', `${sortMode === 'grade' ? '등급순 정렬 중, 이름순' : '이름순 정렬 중, 등급순'} 정렬로 변경`);
    $('inventory-count').textContent = `${loadError ? '?' : count} / ${INVENTORY_LIMIT}`;
    $('inventory-items').replaceChildren();
    if (!entries.length) {
      const empty = document.createElement('p');
      empty.textContent = loadError ? `장비 목록을 불러오지 못했습니다: ${loadError}`
        : count ? '보유 장비는 현재 장착 중입니다.' : '보유 장비가 없습니다.';
      $('inventory-items').append(empty);
    }
    let restoreComparison = null;
    for (const { id, item } of entries) {
      const key = item?.id || id;
      const selected = slot !== 'character' && key === selectedWeapons[slot];
      const button = document.createElement('button'); button.type = 'button';
      button.className = 'inventory-item'; button.setAttribute('aria-label', `${WEAPONS[id]?.name || CHARACTERS[id]?.name}${item ? ` ${item.grade}급 ${item.color || 'standard'} ${weaponLevelLabel(item.level)}` : ''} 비교`);
      button.setAttribute('aria-pressed', String(selected));
      button.disabled = weaponBusy || characterBusy;
      button.append(inventoryCard(id, item));
      function showComparison() {
        const title = document.createElement('h2');
        const label = document.createElement('span');
        label.textContent = (item ? item.equipped : id === current && !currentItem) ? '현재 장착된 장비와 동일합니다' : '선택한 장비';
        title.append(label);
        if (slot !== 'character') {
          const level = item?.level || equipment[id]?.level || 1;
          const levelLabel = document.createElement('span'); levelLabel.className = 'inventory-selected-level';
          levelLabel.textContent = weaponLevelLabel(level);
          const selectedMeter = meter.cloneNode(true);
          selectedMeter.removeAttribute('id');
          for (const element of selectedMeter.querySelectorAll('[id]')) element.removeAttribute('id');
          selectedMeter.hidden = false;
          const progress = selectedMeter.querySelector('progress');
          const percent = level === 7 ? 100 : item?.upgrade_progress ?? 0;
          progress.value = percent;
          progress.setAttribute('aria-label', '선택한 무기 강화 진행률');
          selectedMeter.querySelector('span').textContent = `${percent}%`;
          title.append(levelLabel, selectedMeter);
        }
        $('inventory-comparison').replaceChildren(title, content(id, item));
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
      }
      if (selected) restoreComparison = showComparison;
      button.addEventListener('click', () => {
        if (slot !== 'character') {
          selectedWeapons[slot] = key;
          $('inventory-items').querySelectorAll('.inventory-item').forEach(option => option.setAttribute('aria-pressed', String(option === button)));
          $('inventory-items').prepend(button);
          $('inventory-items').scrollLeft = 0;
        }
        showComparison();
        if (matchMedia('(max-width: 900px), (max-height: 600px)').matches) {
          $('inventory-comparison').scrollIntoView({ block: 'nearest' });
        }
      });
      $('inventory-items').append(button);
    }
    if (restoreComparison) restoreComparison();
    else if (slot !== 'character') delete selectedWeapons[slot];
  }
  const itemScroller = $('inventory-items');
  itemScroller.addEventListener('wheel', event => {
    if (event.ctrlKey || itemScroller.scrollWidth <= itemScroller.clientWidth) return;
    const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
    const scale = event.deltaMode === 1 ? 20 : event.deltaMode === 2 ? itemScroller.clientWidth : 1;
    const next = Math.max(0, Math.min(itemScroller.scrollWidth - itemScroller.clientWidth, itemScroller.scrollLeft + delta * scale));
    if (next === itemScroller.scrollLeft) return;
    event.preventDefault(); itemScroller.scrollLeft = next;
  }, { passive: false });
  let drag = null, suppressClickUntil = 0;
  itemScroller.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    drag = { x: event.clientX, y: event.clientY, scrollLeft: itemScroller.scrollLeft, moved: false };
  });
  itemScroller.addEventListener('pointermove', event => {
    if (!drag) return;
    if (Math.abs(event.clientX - drag.x) > 8
      && Math.abs(event.clientX - drag.x) > Math.abs(event.clientY - drag.y)) drag.moved = true;
  });
  itemScroller.addEventListener('pointerup', () => {
    if (drag && (drag.moved || Math.abs(itemScroller.scrollLeft - drag.scrollLeft) > 6)) {
      suppressClickUntil = Date.now() + 350;
    }
    drag = null;
  });
  itemScroller.addEventListener('pointercancel', () => { drag = null; });
  itemScroller.addEventListener('click', event => {
    if (Date.now() > suppressClickUntil || !event.target.closest('.inventory-item')) return;
    event.preventDefault(); event.stopImmediatePropagation(); suppressClickUntil = 0;
  }, true);
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
    sortMode = sortMode === 'grade' ? 'name' : 'grade'; render();
  });
  $('inventory-sell').addEventListener('click', openSalePicker);
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
