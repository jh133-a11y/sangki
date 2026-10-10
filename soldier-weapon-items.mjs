import { WEAPONS, EQUIPMENT_GRADES, WEAPON_COLORS, WEAPON_COLOR_LABELS, weaponLevelLabel, weaponUpgradeCost } from './soldier-core.mjs?v=7';

const WEAPON_ART_FILES = {
  k2: 'soldier-weapon-k2.webp?v=3',
  shotgun: 'soldier-weapon-shotgun.webp?v=3',
  stick: 'soldier-weapon-stick.webp?v=3',
  psg1: 'soldier-weapon-psg1.webp?v=1',
  m249: 'soldier-weapon-m249.webp?v=1',
  p90: 'soldier-weapon-p90.webp?v=1',
  auga3: 'soldier-weapon-auga3.webp?v=1',
  g36c: 'soldier-weapon-g36c.webp?v=1',
  akm: 'soldier-weapon-akm.webp?v=1'
};
export const WEAPON_ARTWORK = Object.fromEntries(Object.entries(WEAPON_ART_FILES).map(([weapon, standard]) => [
  weapon, Object.fromEntries(WEAPON_COLORS.map(color => [color,
    color === 'standard' ? standard : `soldier-weapon-${weapon}-${color}.webp?v=1`]))
]));
export function weaponArtwork(weapon, color = 'standard') {
  return WEAPON_ARTWORK[weapon]?.[color] || null;
}
export const WEAPON_REWARDS = Object.entries(WEAPON_ARTWORK).flatMap(([weapon, images]) =>
  WEAPON_COLORS.flatMap(color => EQUIPMENT_GRADES.map(grade => ({
    id: `${weapon}-${grade.toLowerCase()}-${color}`, weapon, grade, color,
    name: WEAPONS[weapon].name, slot: WEAPONS[weapon].slot,
    image: images[color], frame: weaponGradeArtwork(grade)
  })))
);
export function weaponGradeArtwork(grade) {
  if (!EQUIPMENT_GRADES.includes(grade)) throw new Error('무기 등급이 올바르지 않습니다.');
  return `soldier-grade-${grade === 'S+' ? 's-plus' : grade.toLowerCase()}.webp?v=${grade === 'D' ? 3 : 2}`;
}
export function weaponColorLabel(color) {
  return WEAPON_COLOR_LABELS[color] || '';
}

export function weaponLevelXp(grade) {
  const xp = { D:25, C:50, B:100, A:200, S:400, 'S+':800 };
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
  const costs = { D: 1000, C: 2000, B: 4000, A: 8000, S: 16000, 'S+':32000 };
  if (!Object.hasOwn(costs, grade)) throw new Error('강화 등급이 올바르지 않습니다.');
  return costs[grade];
}
export function upgradeMaterials(items, target) {
  return items.filter(item => item.id !== target.id
    && !item.equipped && item.source !== 'default');
}
export function selectBulkUpgradeMaterials(target, candidates, selected, grade) {
  const result = [...selected];
  const ids = new Set(result.map(item => item.id));
  for (const item of candidates) {
    if (weaponUpgradePreview(target, result).level === 7) break;
    if (!ids.has(item.id) && item.grade === grade && item.level === 1 && item.upgrade_xp === 0
      && !item.equipped && item.source !== 'default' && item.id !== target.id) {
      result.push(item); ids.add(item.id);
    }
  }
  return result;
}

export function validateWeaponItems(result) {
  if (!result || !/^\d+$/.test(String(result.gold)) || !Array.isArray(result.items)) {
    throw new Error('서버 보상 장비 정보를 확인할 수 없습니다.');
  }
  const counts = {}, ids = new Set(), equipped = new Set();
  for (const item of result.items) {
    if (!item || typeof item.id !== 'string' || !item.id || ids.has(item.id)
      || !WEAPON_ARTWORK[item.weapon] || !WEAPON_COLORS.includes(item.color ?? 'standard')
      || typeof item.equipped !== 'boolean') {
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
  const items = result.items.map(item => ({ ...item, color: item.color ?? 'standard' }));
  return result.material_version === 2
    ? items.map(item => ({ ...item, materialReady: result.material_rate === 83 })) : items;
}

export function fillWeaponCard(card, weapon, item = { grade: 'D', level: 1 }) {
  if (!WEAPONS[weapon]) throw new Error('무기 정보를 확인할 수 없습니다.');
  weaponUpgradeCost(item.grade, item.level);
  card.dataset.grade = item.grade;
  card.dataset.source = item.source || '';
  card.dataset.itemId = item.id || '';
  card.dataset.color = item.color || 'standard';
  const frame = card.querySelector('.grade-frame');
  frame.src = weaponGradeArtwork(item.grade);
  frame.alt = `${item.grade}급`;
  card.querySelector('.weapon-level').textContent = weaponLevelLabel(item.level);
  const image = card.querySelector('.weapon-image');
  const imageSource = weaponArtwork(weapon, item.color || 'standard');
  image.hidden = !imageSource;
  if (imageSource) image.src = imageSource;
  else image.removeAttribute('src');
  image.alt = WEAPONS[weapon].name;
  const colorLabel = card.querySelector('.weapon-color-label');
  colorLabel.textContent = weaponColorLabel(item.color);
  colorLabel.hidden = !colorLabel.textContent;
  card.querySelector('.weapon-name').textContent = WEAPONS[weapon].name;
}
