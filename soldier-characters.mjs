export const CHARACTERS = {
  'black-water': { name: 'Black Water', image: 'soldier-character-black-water.webp', price: 0 },
  'fsb-agent': { name: 'FSB Agent', image: 'soldier-character-fsb-agent.webp', price: 125 },
  'roka-swc': { name: 'ROKA-SWC', image: 'soldier-character-roka-swc.webp', price: 125 }
};
export function characterCard(id, level = 1) {
  const character = CHARACTERS[id];
  if (!character) throw new Error('캐릭터 정보를 확인할 수 없습니다.');
  const card = document.createElement('div'); card.className = 'character-card';
  const image = document.createElement('img'); image.src = `${character.image}?v=2`; image.alt = character.name;
  const label = document.createElement('span'); label.className = 'character-level'; label.textContent = String(level);
  label.setAttribute('aria-label', `레벨 ${level}`);
  card.append(image, label); return card;
}
