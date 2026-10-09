import { WEAPONS, EQUIPMENT_GRADES, weaponLevelLabel, weaponUpgradeCost } from './soldier-core.mjs?v=3';

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
    ids.add(item.id);
    const slot = WEAPONS[item.weapon].slot;
    counts[slot] = (counts[slot] || 0) + 1;
    if (counts[slot] > 50) throw new Error('분류별 최대 보유 인벤토리 50개를 초과했습니다.');
    if (item.equipped && equipped.has(slot)) throw new Error('동일 분류의 중복 장착 정보입니다.');
    if (item.equipped) equipped.add(slot);
  }
  return result.items;
}

export function fillWeaponCard(card, weapon, item = { grade: 'D', level: 1 }) {
  if (!WEAPONS[weapon]) throw new Error('무기 정보를 확인할 수 없습니다.');
  weaponUpgradeCost(item.grade, item.level);
  card.dataset.grade = item.grade;
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
