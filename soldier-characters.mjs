export const CHARACTERS = {
  'black-water': { name: 'Black Water', image: 'soldier-character-black-water.webp', model: 'soldier-home-model.glb?v=4', price: 0 },
  'fsb-agent': { name: 'FSB Agent', image: 'soldier-character-fsb-agent.webp', model: 'soldier-fsb-agent.glb?v=1', price: 125 },
  'roka-swc': { name: 'ROKA-SWC', image: 'soldier-character-roka-swc.webp', model: 'soldier-roka-swc.glb?v=1', price: 125 }
};
export const CHARACTER_MAX_LEVEL = 10;
export const CHARACTER_UPGRADE_COST = 10000;
export function characterStats(id, level = 1) {
  if (!CHARACTERS[id] || !Number.isInteger(level) || level < 1 || level > CHARACTER_MAX_LEVEL) {
    throw new Error('캐릭터 또는 레벨이 올바르지 않습니다.');
  }
  const step = level - 1;
  if (id === 'roka-swc') return { hp: 125 + step * 8, evasion: (40 + step) / 1000 };
  if (id === 'fsb-agent') return { hp: 98 + step * 5, evasion: (20 + step) / 100 };
  return { hp: 110 + step * 5, evasion: (40 + step) / 1000 };
}
export function characterLevelLabel(level) {
  characterStats('black-water', level);
  return level === CHARACTER_MAX_LEVEL ? 'MAX' : `Lv.${level}`;
}
export function ownedCharacterLevel(state, id) {
  return id === 'black-water' ? state.defaultLevel || 1 : state.characters[id]?.level || 1;
}
export function evadesAttack(evasion, roll = Math.random()) {
  if (!Number.isFinite(evasion) || evasion < 0 || evasion > 1 || !Number.isFinite(roll) || roll < 0 || roll >= 1) {
    throw new Error('회피 판정 값이 올바르지 않습니다.');
  }
  return roll < evasion;
}
export function characterCard(id, level = 1) {
  const character = CHARACTERS[id];
  if (!character) throw new Error('캐릭터 정보를 확인할 수 없습니다.');
  characterStats(id, level);
  const card = document.createElement('div'); card.className = 'character-card';
  const image = document.createElement('img'); image.src = `${character.image}?v=2`; image.alt = character.name;
  const label = document.createElement('span'); label.className = level === CHARACTER_MAX_LEVEL ? 'character-level character-max' : 'character-level';
  label.textContent = level === CHARACTER_MAX_LEVEL ? 'MAX' : String(level);
  label.setAttribute('aria-label', `레벨 ${level}`);
  card.append(image, label); return card;
}
