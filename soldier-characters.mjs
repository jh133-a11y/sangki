export const CHARACTERS = {
  'black-water': { name: 'JAMES', image: 'soldier-character-james.webp', cardImage: 'soldier-character-james-cutout.webp', model: 'soldier-james.glb?v=1', price: 0, ability: '없음' },
  'fighter': { name: 'FIGHTER', image: 'soldier-character-fighter.webp', cardImage: 'soldier-character-fighter-cutout.webp', model: 'soldier-fighter.glb?v=1', price: 150, ability: '밸런스' },
  'thief': { name: 'THIEF', image: 'soldier-character-thief.webp', cardImage: 'soldier-character-thief-cutout.webp', model: 'soldier-thief.glb?v=1', price: 150, ability: '높은 회피율' },
  'korean-girl': { name: 'KOREAN\nGIRL', image: 'soldier-character-korean-girl.webp', cardImage: 'soldier-character-korean-girl-cutout.webp', model: 'soldier-korean-girl.glb?v=1', price: 250, ability: '위력 증가 / 크리티컬 확률 증가' },
  'roka-swc': { name: 'RKS', image: 'soldier-character-roka-swc-portrait.webp', cardImage: 'soldier-character-roka-swc-cutout.webp', model: 'soldier-roka-swc.glb?v=2', price: 125, ability: '높은 체력' }
};
export const CHARACTER_MAX_LEVEL = 10;
export const CHARACTER_UPGRADE_COST = 10000;
export function characterStats(id, level = 1) {
  if (!CHARACTERS[id] || !Number.isInteger(level) || level < 1 || level > CHARACTER_MAX_LEVEL) {
    throw new Error('캐릭터 또는 레벨이 올바르지 않습니다.');
  }
  const step = level - 1;
  const bonuses = { damageBonus: 0, criticalBonus: 0 };
  if (id === 'roka-swc') return { hp: 125 + step * 8, evasion: (40 + step) / 1000, ...bonuses };
  if (id === 'thief') return { hp: 98 + step * 5, evasion: (20 + step) / 100, ...bonuses };
  if (id === 'fighter') return { hp: 115 + step * 6, evasion: (60 + step) / 1000, ...bonuses };
  if (id === 'korean-girl') {
    const bonus = level === CHARACTER_MAX_LEVEL ? 3 : 1;
    return { hp: 105 + step * 7, evasion: (10 + step) / 100, damageBonus: bonus, criticalBonus: bonus };
  }
  return { hp: 110 + step * 5, evasion: (40 + step) / 1000, ...bonuses };
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
  const background = document.createElement('img');
  background.className = 'character-background'; background.src = 'soldier-character-frame.webp';
  background.alt = ''; background.setAttribute('aria-hidden', 'true');
  const image = document.createElement('img'); image.className = 'character-portrait';
  image.src = `${character.cardImage}?v=1`; image.alt = character.name.replace('\n', ' ');
  const name = document.createElement('span'); name.className = 'character-name'; name.textContent = character.name;
  const label = document.createElement('span'); label.className = level === CHARACTER_MAX_LEVEL ? 'character-level character-max' : 'character-level';
  label.textContent = level === CHARACTER_MAX_LEVEL ? 'MAX' : String(level);
  label.setAttribute('aria-label', `레벨 ${level}`);
  card.append(background, image, name, label); return card;
}
