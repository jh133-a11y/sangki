import { WEAPONS, EQUIPMENT_GRADES, weaponLevelLabel, weaponUpgradeCost } from './soldier-core.mjs?v=4';

export const WEAPON_ARTWORK = {
  k2: 'soldier-weapon-k2.webp?v=3',
  shotgun: 'soldier-weapon-shotgun.webp?v=3',
  stick: 'soldier-weapon-stick.webp?v=3'
};
export const WEAPON_REWARDS = Object.entries(WEAPON_ARTWORK).flatMap(([weapon, image]) =>
  EQUIPMENT_GRADES.map(grade => ({
    id: `${weapon}-${grade.toLowerCase()}`, weapon, grade,
    name: WEAPONS[weapon].name, slot: WEAPONS[weapon].slot,
    image, frame: `soldier-grade-${grade.toLowerCase()}.webp`
  }))
);

export function weaponLevelXp(grade) {
  const xp = { D:25, C:50, B:100, A:200, S:400 };
  if (!Object.hasOwn(xp, grade)) throw new Error('강화 등급이 올바르지 않습니다.');
  return xp[grade];
}
function investedWeaponXp(item) {
  return weaponLevelXp(item.grade) * item.level + item.upgrade_xp;
}
export function weaponMaterialXp(item) {
  return investedWeaponXp(item) * 83 / 100;
}
export function weaponUpgradePreview(item, materials) {
  const required = weaponLevelXp(item.grade);
  const added = Math.floor(materials.reduce((total, material) => total + investedWeaponXp(material), 0) * 83 / 100);
  const total = item.upgrade_xp + added;
  const level = Math.min(7, item.level + Math.floor(total / required));
  const xp = level === 7 ? 0 : total % required;
  const overflow = Math.max(0, total - (7 - item.level) * required);
  return { added, level, xp, percent: Math.round(xp * 1000 / required) / 10, overflow,
    cost: materialCost(item.grade) * materials.length };
}
export function materialCost(grade) {
  const costs = { D: 0, C: 2000, B: 4000, A: 8000, S: 16000 };
  if (!Object.hasOwn(costs, grade)) throw new Error('강화 등급이 올바르지 않습니다.');
  return costs[grade];
}
export function upgradeMaterials(items, target) {
  return items.filter(item => item.id !== target.id
    && !item.equipped && item.source !== 'default');
}

export function validateWeaponItems(result) {
  if (!result || !/^\d+$/.test(String(result.gold)) || !Array.isArray(result.items)) {
    throw new Error('서버 보상 장비 정보를 확인할 수 없습니다.');
  }
  const counts = {}, ids = new Set(), equipped = new Set();
  for (const item of result.items) {
    if (!item || typeof item.id !== 'string' || !item.id || ids.has(item.id)
      || !WEAPON_ARTWORK[item.weapon] || typeof item.equipped !== 'boolean') {
      throw new Error('서버 보상 무기 정보를 확인할 수 없습니다.');
    }
    weaponUpgradeCost(item.grade, item.level);
    if (result.material_version === 2 && (!Number.isInteger(item.upgrade_xp)
      || item.upgrade_xp < 0 || item.upgrade_xp >= weaponLevelXp(item.grade)
      || !Number.isFinite(item.upgrade_progress)
      || item.upgrade_progress !== Math.round(item.upgrade_xp * 1000 / weaponLevelXp(item.grade)) / 10
      || (item.level === 7 && item.upgrade_xp !== 0))) {
      throw new Error('서버 강화 진행률을 확인할 수 없습니다.');
    }
    ids.add(item.id);
    const slot = WEAPONS[item.weapon].slot;
    counts[slot] = (counts[slot] || 0) + 1;
    if (counts[slot] > 50) throw new Error('분류별 최대 보유 인벤토리 50개를 초과했습니다.');
    if (item.equipped && equipped.has(slot)) throw new Error('동일 분류의 중복 장착 정보입니다.');
    if (item.equipped) equipped.add(slot);
  }
  return result.material_version === 2
    ? result.items.map(item => ({ ...item, materialReady: result.material_rate === 83 })) : result.items;
}

export function fillWeaponCard(card, weapon, item = { grade: 'D', level: 1 }) {
  if (!WEAPONS[weapon]) throw new Error('무기 정보를 확인할 수 없습니다.');
  weaponUpgradeCost(item.grade, item.level);
  card.dataset.grade = item.grade;
  card.dataset.source = item.source || '';
  card.dataset.itemId = item.id || '';
  const frame = card.querySelector('.grade-frame');
  frame.src = `soldier-grade-${item.grade.toLowerCase()}.webp`;
  frame.alt = `${item.grade}급`;
  card.querySelector('.weapon-level').textContent = weaponLevelLabel(item.level);
  const image = card.querySelector('.weapon-image');
  image.hidden = !WEAPON_ARTWORK[weapon];
  if (WEAPON_ARTWORK[weapon]) image.src = WEAPON_ARTWORK[weapon];
  else image.removeAttribute('src');
  image.alt = WEAPONS[weapon].name;
  card.querySelector('.weapon-name').textContent = WEAPONS[weapon].name;
}
