export const WEAPONS = {
  k2: { name: 'K-200', slot: 'primary', damage: 19, delay: .09230769230769231, range: 85, magazine: 30, reserve: 90, accuracy: 76, recoilControl: 86, weight: 4040, critical: 5, reload: 2, automatic: true },
  ak47: { name: 'AK47', slot: 'primary', damage: 30, delay: .2, range: 80, magazine: 30, accuracy: 68, recoilControl: 65, weight: 4100, reload: 2.3, automatic: true },
  aug64: { name: 'AUG64', slot: 'primary', damage: 22, delay: .13, range: 85, magazine: 30, accuracy: 82, recoilControl: 82, weight: 3400, reload: 2, automatic: true },
  sniper: { name: '스나이퍼', slot: 'primary', damage: 100, delay: 1.3, range: 140, magazine: 5, accuracy: 100, recoilControl: 75, weight: 8100, reload: 2.8, automatic: false },
  psg1: { name: 'P-SR1', slot: 'primary', damage: 90, delay: 60 / 500, range: 140, magazine: 5, reserve: 15, accuracy: 100, recoilControl: 70, weight: 8100, critical: 1, reload: 2.8, automatic: false },
  m249: { name: 'M-24', slot: 'primary', damage: 68, delay: 60 / 600, range: 85, magazine: 100, reserve: 100, accuracy: 68, recoilControl: 86, weight: 9460, critical: 1, reload: 3, automatic: true },
  p90: { name: 'PDW-90', slot: 'primary', damage: 58, delay: 60 / 620, range: 80, magazine: 50, reserve: 100, accuracy: 63, recoilControl: 72, weight: 3900, critical: 1, reload: 2, automatic: true },
  auga3: { name: 'AUG-BP', slot: 'primary', damage: 40, delay: 60 / 620, range: 85, magazine: 30, reserve: 90, accuracy: 78, recoilControl: 83, weight: 3800, critical: 14, reload: 2, automatic: true },
  g36c: { name: 'G36C', slot: 'primary', damage: 26, delay: 60 / 700, range: 80, magazine: 30, reserve: 90, accuracy: 76, recoilControl: 86, weight: 3400, critical: 4, reload: 2, automatic: true },
  akm: { name: 'ARK-M', slot: 'primary', damage: 53, delay: 60 / 600, range: 80, magazine: 30, reserve: 90, accuracy: 74, recoilControl: 54, weight: 3950, critical: 12, reload: 2.3, automatic: true },
  pistol: { name: '권총', slot: 'secondary', damage: 28, delay: .32, range: 55, magazine: 12, accuracy: 80, recoilControl: 75, weight: 900, reload: 1.5, automatic: false },
  shotgun: { name: 'S-870', slot: 'secondary', damage: 45, delay: 3, range: 22, magazine: 4, reserve: 16, accuracy: 61, recoilControl: 4, weight: 3550, critical: 6, reload: 2.4, automatic: false },
  kukri: { name: '쿠쿠리', slot: 'melee', damage: 45, delay: .55, range: 2.8, magazine: 0, reload: 0, automatic: false },
  axe: { name: '도끼', slot: 'melee', damage: 65, delay: .85, range: 2.7, magazine: 0, reload: 0, automatic: false },
  shovel: { name: '삽', slot: 'melee', damage: 50, delay: .7, range: 3, magazine: 0, reload: 0, automatic: false },
  stick: { name: 'M-90B', slot: 'melee', damage: 135, delay: .75, range: 3.2, magazine: 0, accuracy: null, recoilControl: null, weight: null, critical: 31, reload: 0, automatic: false }
};
export const WEAPON_COLORS = ['standard', 'gold', 'red', 'silver'];
export const WEAPON_COLOR_LABELS = { gold: 'GOLD', red: 'RED', silver: 'SILVER' };

export function weaponStats(id, grade = 'D', level = 1, color = 'standard') {
  const weapon = Object.hasOwn(WEAPONS, id) && WEAPONS[id];
  const rules = { D: [0, 1, 0, 0], C: [6, 1, 0, 0], B: [12, 1, 0, 0],
    A: [18, 2, 0, 1], S: [30, 3, 3, 2], 'S+': [48, 3, 9, 1] };
  const growth = Object.hasOwn(rules, grade) && rules[grade];
  if (!weapon || !growth || !Number.isInteger(level) || level < 1 || level > 7 || !WEAPON_COLORS.includes(color)) {
    throw new RangeError('무기 등급과 레벨이 올바르지 않습니다.');
  }
  const gradeIndex = Math.min(4, EQUIPMENT_GRADES.indexOf(grade));
  const firearmGrowth = weapon.slot === 'melee' ? {} : {
    accuracy: weapon.accuracy + gradeIndex * 3,
    recoilControl: weapon.recoilControl + gradeIndex * 3,
    weight: Math.round(weapon.weight * [1, .95, .9025, .857375, .81450625][gradeIndex])
  };
  const stats = { ...weapon, ...firearmGrowth, grade, level, color,
    damage: weapon.damage + growth[0] + (level - 1) * growth[1],
    critical: (weapon.critical || 0) + growth[2] + (grade === 'S+' ? level - 1 : Math.floor((level - 1) / 2)) * growth[3] };
  if (color === 'gold') stats.damage += 5;
  if (color === 'red') stats.critical += 5;
  if (color === 'silver' && Number.isInteger(stats.weight)) stats.weight = Math.round(stats.weight * .9);
  return stats;
}
export const WEAPON_SET_BONUSES = {
  D: { damage: 1, critical: 1, weightPercent: 10 },
  C: { damage: 1, critical: 2, weightPercent: 12 },
  B: { damage: 2, critical: 3, weightPercent: 14 },
  A: { damage: 2, critical: 4, weightPercent: 16 },
  S: { damage: 3, critical: 5, weightPercent: 18 },
  'S+': { damage: 4, critical: 6, weightPercent: 20 }
};
export function weaponSetBonus(grade, color) {
  const bonus = WEAPON_SET_BONUSES[grade];
  if (!bonus || !['gold', 'red', 'silver'].includes(color)) throw new RangeError('무기 세트 정보가 올바르지 않습니다.');
  return { damage: color === 'gold' ? bonus.damage : 0, critical: color === 'red' ? bonus.critical : 0,
    weightPercent: color === 'silver' ? bonus.weightPercent : 0 };
}
export function weaponSetDescription(grade, color) {
  const bonus = weaponSetBonus(grade, color);
  const effect = color === 'gold' ? `위력 +${bonus.damage}`
    : color === 'red' ? `크리티컬 +${bonus.critical}%` : `무게 -${bonus.weightPercent}%`;
  return `${grade} ${color.toUpperCase()} 세트 · 장착 무기 ${effect}`;
}
export function applyWeaponSetBonuses(weapons) {
  const entries = Object.entries(weapons);
  const setColor = weaponSetColor(weapons);
  const bonus = setColor ? weaponSetBonus(weapons.primary.grade, setColor) : null;
  return Object.fromEntries(entries.map(([slot, weapon]) => {
    const stats = { ...weapon };
    if (bonus) {
      stats.damage += bonus.damage;
      stats.critical += bonus.critical;
      if (bonus.weightPercent && Number.isInteger(stats.weight)) stats.weight = Math.round(stats.weight * (100 - bonus.weightPercent) / 100);
    }
    return [slot, stats];
  }));
}
export function weaponSetColor(weapons) {
  const slots = ['primary', 'secondary', 'melee'];
  const first = weapons.primary;
  return first && ['gold', 'red', 'silver'].includes(first.color)
    && slots.every(slot => weapons[slot]?.color === first.color && weapons[slot]?.grade === first.grade)
    ? first.color : null;
}
export function applyCharacterBonuses(weapons, character) {
  if (!character || !Number.isInteger(character.damageBonus) || character.damageBonus < 0
    || !Number.isInteger(character.criticalBonus) || character.criticalBonus < 0) {
    throw new RangeError('캐릭터 무기 능력치가 올바르지 않습니다.');
  }
  return Object.fromEntries(Object.entries(weapons).map(([slot, stats]) =>
    [slot, { ...stats, damage: stats.damage + character.damageBonus, critical: stats.critical + character.criticalBonus }]));
}
export function initialWeaponAmmo(loadout) {
  const ammo = {};
  for (const [slot, id] of Object.entries(loadout)) {
    const weapon = Object.hasOwn(WEAPONS, id) && WEAPONS[id];
    if (!weapon || weapon.slot !== slot) throw new RangeError('무기 칸이 올바르지 않습니다.');
    ammo[slot] = weapon.magazine;
    if (weapon.reserve !== undefined) ammo[`${slot}_reserve`] = weapon.reserve;
  }
  return ammo;
}
export function reloadWeaponAmmo(ammo, slot, weapon) {
  if (weapon.slot === 'melee') return { ...ammo };
  const reserveKey = `${slot}_reserve`, reserve = ammo[reserveKey];
  if (weapon.reserve !== undefined && (!Number.isInteger(reserve) || reserve < 0)) {
    throw new Error('보유탄환 정보를 확인할 수 없습니다.');
  }
  const needed = Math.max(0, weapon.magazine - ammo[slot]);
  const loaded = reserve === undefined ? needed : Math.min(needed, reserve);
  return { ...ammo, [slot]: ammo[slot] + loaded,
    ...(reserve === undefined ? {} : { [reserveKey]: reserve - loaded }) };
}
export function weaponHitDamage(weapon, random = Math.random) {
  const critical = random() < (weapon.critical || 0) / 100;
  return { damage: weapon.damage * (critical ? 2 : 1), critical };
}
export function validateCombatWeapons(state, loadout, character = { damageBonus: 0, criticalBonus: 0 }) {
  const weapons = {};
  if (state.weapon_version !== 1 || !state.weapon_stats || !state.ammo) {
    throw new Error('서버 무기 능력치 정보를 확인할 수 없습니다.');
  }
  const owned = {};
  for (const [slot, id] of Object.entries(loadout)) {
    const received = state.weapon_stats[slot];
    if (!received || received.weapon !== id) throw new Error('서버 장착 무기 정보가 일치하지 않습니다.');
    owned[slot] = weaponStats(id, received.grade, received.level, received.color);
  }
  const expectedWeapons = applyCharacterBonuses(applyWeaponSetBonuses(owned), character);
  for (const [slot, id] of Object.entries(loadout)) {
    const received = state.weapon_stats[slot], expected = expectedWeapons[slot];
    for (const [key, value] of Object.entries(expected)) {
      if (key !== 'name' && key !== 'automatic' && received[key] !== value) {
        throw new Error(`서버 무기 능력치가 일치하지 않습니다: ${key}`);
      }
    }
    if (!Number.isInteger(state.ammo[slot]) || state.ammo[slot] < 0 || state.ammo[slot] > expected.magazine
      || (expected.reserve !== undefined && (!Number.isInteger(state.ammo[`${slot}_reserve`])
        || state.ammo[`${slot}_reserve`] < 0 || state.ammo[`${slot}_reserve`] > expected.reserve))) {
      throw new Error('서버 탄환 정보를 확인할 수 없습니다.');
    }
    weapons[slot] = expected;
  }
  return weapons;
}
export const RANKS = ['이등병', '일등병', '상등병', '병장', '하사', '중사', '상사', '원사', '준위', '소위', '중위', '대위', '소령', '중령', '대령', '준장', '소장', '중장', '대장', '원수'];
export const WIN_XP = 100;
export const RANK_STEPS = RANKS.slice(0, -1).map((_, index) => Math.ceil(200 * 1.5 ** index));
export function rankProgress(xp) {
  const total = Math.max(0, Number(xp) || 0);
  let index = 0, floor = 0;
  while (index < RANK_STEPS.length && total >= floor + RANK_STEPS[index]) {
    floor += RANK_STEPS[index++];
  }
  const required = RANK_STEPS[index] || 0, earned = total - floor;
  const remaining = required ? required - earned : 0;
  return { index, name: RANKS[index], next: RANKS[index + 1] || null, earned, required, remaining,
    percent: required ? Math.min(100, earned / required * 100) : 100, winsNeeded: Math.ceil(remaining / WIN_XP) };
}
export const rankName = xp => rankProgress(xp).name;
export const DEFAULT_LOADOUT = { primary: 'k2', secondary: 'shotgun', melee: 'stick' };
export const EQUIPMENT_GRADES = ['D', 'C', 'B', 'A', 'S', 'S+'];
const UPGRADE_COSTS = { D: [1000, 1000], C: [3000, 1000], B: [5000, 2000], A: [10000, 5000], S: [20000, 10000], 'S+': [40000, 20000] };
export function weaponUpgradeCost(grade, level) {
  if (!UPGRADE_COSTS[grade] || !Number.isInteger(level) || level < 1 || level > 7) {
    throw new RangeError('무기 등급 또는 레벨이 올바르지 않습니다.');
  }
  if (level === 7) return null;
  const [base, step] = UPGRADE_COSTS[grade];
  return base + (level - 1) * step;
}
export function weaponLevel(value) {
  return Number.isInteger(value) && value >= 1 && value <= 7 ? value : 1;
}
export function weaponLevelLabel(value) {
  const level = weaponLevel(value);
  return level === 7 ? 'MAX' : `Lv.${level}`;
}
export const DEFAULT_CONTROLS = {
  joystick: { name: '이동', x: 12, y: 73, size: 92 },
  fire: { name: '발사', x: 85, y: 54, size: 72 },
  jump: { name: '점프', x: 85, y: 82, size: 56 },
  crouch: { name: '앉기', x: 73, y: 82, size: 56 },
  reload: { name: '장전', x: 72, y: 65, size: 54 },
  'weapon-buttons': { name: '무기 교체', x: 90, y: 23, size: 92 }
};
export const COVER = [
  [-25, -25, 12, 12, 8], [25, -25, 12, 12, 8], [-25, 25, 12, 12, 8], [25, 25, 12, 12, 8],
  [-8, -12, 6, 4, 2.8], [12, 8, 6, 4, 2.8], [-12, 12, 4, 8, 2.8], [8, -5, 4, 5, 2.8],
  [0, 30, 10, 3, 2.5], [0, -32, 10, 3, 2.5], [-35, 0, 3, 12, 3], [35, 0, 3, 12, 3]
];
export const SPAWNS = [[-42, -42], [42, 42], [-42, 42], [42, -42], [0, -43], [0, 43], [-43, 0], [43, 0]];
export function blocked(x, z, radius = .5) {
  return Math.abs(x) > 48 || Math.abs(z) > 48 || COVER.some(([cx, cz, w, d]) => Math.abs(x - cx) < w / 2 + radius && Math.abs(z - cz) < d / 2 + radius);
}
export function direction(yaw, pitch) {
  return { x: -Math.sin(yaw) * Math.cos(pitch), y: Math.sin(pitch), z: -Math.cos(yaw) * Math.cos(pitch) };
}
export function rayBox(origin, dir, box) {
  let near = 0, far = Infinity;
  for (const axis of ['x', 'y', 'z']) {
    if (Math.abs(dir[axis]) < 1e-8) {
      if (origin[axis] < box.min[axis] || origin[axis] > box.max[axis]) return Infinity;
    } else {
      const a = (box.min[axis] - origin[axis]) / dir[axis], b = (box.max[axis] - origin[axis]) / dir[axis];
      near = Math.max(near, Math.min(a, b)); far = Math.min(far, Math.max(a, b));
      if (near > far) return Infinity;
    }
  }
  return near;
}
export function coverDistance(origin, dir) {
  return Math.min(...COVER.map(([x, z, w, d, h]) => rayBox(origin, dir, { min: { x: x - w / 2, y: 0, z: z - d / 2 }, max: { x: x + w / 2, y: h, z: z + d / 2 } })));
}
export function targetDistance(origin, dir, target) {
  return rayBox(origin, dir, {
    min: { x: target.x - .45, y: target.y, z: target.z - .45 },
    max: { x: target.x + .45, y: target.y + (target.crouch ? 1.25 : 1.9), z: target.z + .45 }
  });
}
export function settingsFrom(saved = {}) {
  const controls = {};
  for (const [key, value] of Object.entries(DEFAULT_CONTROLS)) {
    const item = saved.controls?.[key] || {};
    const finite = (v, fallback, min, max) => Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
    controls[key] = { ...value, x: finite(item.x, value.x, 5, 95), y: finite(item.y, value.y, 10, 90), size: finite(item.size, value.size, 44, 150) };
  }
  return { autoFire: saved.autoFire === true, sensitivity: Number.isFinite(saved.sensitivity) ? Math.min(2, Math.max(.3, saved.sensitivity)) : 1, controls };
}
