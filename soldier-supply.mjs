import { validateWeaponItems, WEAPON_ARTWORK } from './soldier-weapon-items.mjs?v=6';

export const SUPPLY_PRODUCTS = [
  { id: 'special', name: '스페셜보급함(11개)', price: 300, count: 11, color: '#f1a00b',
    description: 'A클래스 무기 1개 이상 100% 당첨', specialty: 'S 클래스 무기 획득가능',
    odds: '첫 번째: A 95% · S 5% / 나머지 10개: C 60% · B 25% · A 10% · S 5%' },
  { id: 'advanced', name: '고급보급함', price: 30, count: 1, color: '#b51d36',
    description: 'C클래스 이상의 무기 1개 획득', odds: 'D 0% · C 60% · B 25% · A 10% · S 5%' },
  { id: 'normal', name: '일반보급함', price: 3, count: 1, color: '#cbd1d8',
    description: 'D클래스 이상의 무기 1개 획득', odds: 'D 60% · C 30% · B 6% · A 3% · S 1%' }
];

export function validateSupply(result, product = null, request = null) {
  if (!result || result.supply_version !== 1 || typeof result.replayed !== 'boolean'
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(result.client_id)
    || !/^\d+$/.test(String(result.gems))
    || result.product !== product || result.request !== request || !Array.isArray(result.rewards)) {
    throw new Error('보급함 구매 응답을 확인할 수 없습니다. 같은 보급함으로 다시 확인하세요.');
  }
  const items = validateWeaponItems(result.inventory);
  const spec = SUPPLY_PRODUCTS.find(entry => entry.id === product);
  if (result.rewards.length !== (spec?.count || 0)) throw new Error('보급함 보상 개수를 확인할 수 없습니다.');
  const ids = new Set();
  for (const reward of result.rewards) {
    if (!reward || ids.has(reward.id) || !Object.hasOwn(WEAPON_ARTWORK, reward.weapon)
      || !['D','C','B','A','S'].includes(reward.grade) || reward.level !== 1
      || typeof reward.id !== 'string' || !reward.id
      || (!result.replayed && !items.some(item => item.id === reward.id && item.weapon === reward.weapon && item.grade === reward.grade
        && item.source === `supply-${product}`))) throw new Error('보급함 보상 정보를 확인할 수 없습니다.');
    ids.add(reward.id);
    if (product !== 'normal' && reward.grade === 'D') throw new Error('보급함 최소 등급이 올바르지 않습니다.');
  }
  if (product === 'special' && !['A','S'].includes(result.rewards[0].grade)) {
    throw new Error('스페셜보급함 보장 보상을 확인할 수 없습니다.');
  }
  return items;
}
