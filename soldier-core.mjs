export const WEAPONS = {
  k2: { name: 'K2', slot: 'primary', damage: 24, delay: .16, range: 85, magazine: 30, reload: 2, automatic: true },
  ak47: { name: 'AK47', slot: 'primary', damage: 30, delay: .2, range: 80, magazine: 30, reload: 2.3, automatic: true },
  aug64: { name: 'AUG64', slot: 'primary', damage: 22, delay: .13, range: 85, magazine: 30, reload: 2, automatic: true },
  sniper: { name: '스나이퍼', slot: 'primary', damage: 100, delay: 1.3, range: 140, magazine: 5, reload: 2.8, automatic: false },
  pistol: { name: '권총', slot: 'secondary', damage: 28, delay: .32, range: 55, magazine: 12, reload: 1.5, automatic: false },
  shotgun: { name: 'M870', slot: 'secondary', damage: 75, delay: .9, range: 22, magazine: 6, reload: 2.4, automatic: false },
  kukri: { name: '쿠쿠리', slot: 'melee', damage: 45, delay: .55, range: 2.8, magazine: 0, reload: 0, automatic: false },
  axe: { name: '도끼', slot: 'melee', damage: 65, delay: .85, range: 2.7, magazine: 0, reload: 0, automatic: false },
  shovel: { name: '삽', slot: 'melee', damage: 50, delay: .7, range: 3, magazine: 0, reload: 0, automatic: false },
  stick: { name: 'M9', slot: 'melee', damage: 35, delay: .4, range: 3.2, magazine: 0, reload: 0, automatic: false }
};
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
export const EQUIPMENT_GRADES = ['D', 'C', 'B', 'A', 'S'];
const UPGRADE_COSTS = { D: [1000, 1000], C: [3000, 1000], B: [5000, 2000], A: [10000, 5000], S: [20000, 10000] };
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
