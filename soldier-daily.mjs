import { SUPPLY_PRODUCTS, supplyArtwork } from './soldier-supply.mjs?v=8';
export const ROULETTE_PRIZES = [
  ['gems',1,1500],['gems',3,1000],['gems',5,300],['gems',100,100],
  ['crate',1,500,'normal'],['crate',3,300,'normal'],['crate',1,300,'advanced'],['crate',2,100,'advanced'],
  ['crate',1,10,'special'],['crate',2,1,'special'],['crate',1,50,'guaranteed-b'],['crate',1,39,'guaranteed-a'],
  ['gold',1000,1500],['gold',3000,1000],['gold',10000,300],['xp',200,2000],['xp',1000,1000]
].map(([kind,amount,weight,product]) => ({kind,amount,weight,...(product ? {product} : {})}));
export const ATTENDANCE_TABLES = [
  [['gems',5],['gold',1000],['xp',200],['gems',3],['gold',2000],['crate',1,'advanced'],['crate',1,'normal'],['gems',5],['gold',2000],['xp',200],['gems',3],['gold',1000],['crate',1,'advanced'],['gems',3],['gold',1000],['crate',1,'advanced'],['gems',3],['gems',5],['gems',10],['crate',1,'guaranteed-b']],
  [['gold',2000],['gold',2000],['crate',1,'normal'],['gems',1],['xp',200],['xp',300],['gold',1000],['gold',2000],['crate',1,'advanced'],['xp',200],['gold',1000],['gold',2000],['gems',1],['gold',1000],['xp',200],['gems',3],['xp',200],['gold',1000],['gems',1],['crate',1,'special']],
  [['crate',1,'normal'],['xp',200],['xp',200],['xp',200],['crate',1,'advanced'],['gems',1],['xp',200],['gold',1000],['xp',200],['gems',3],['gold',1000],['xp',200],['xp',300],['xp',200],['gold',2000],['gems',1],['crate',1,'advanced'],['crate',2,'advanced'],['crate',3,'advanced'],['crate',1,'guaranteed-a']]
].map(table => table.map(([kind,amount,product]) => ({kind,amount,...(product ? {product} : {})})));
export function rewardLabel(reward) {
  return reward.kind === 'crate' ? `${SUPPLY_PRODUCTS.find(item => item.id === reward.product)?.name || reward.product} ×${reward.amount}`
    : reward.kind === 'gems' ? `보석 ${reward.amount}개` : reward.kind === 'gold' ? `${reward.amount.toLocaleString('ko-KR')} 골드` : `경험치 ${reward.amount}`;
}
let rewardIconId = 0;
function rewardIcon(reward) {
  if (reward.kind === 'crate') {
    const image = document.createElement('img');
    image.src = supplyArtwork(reward.product);
    image.alt = '';
    image.className = 'reward-icon reward-crate-icon';
    return image;
  }
  if (reward.kind === 'xp') {
    const image = document.createElement('img');
    image.src = 'soldier-xp-icon.svg?v=1';
    image.alt = '';
    image.className = 'reward-icon';
    return image;
  }
  const currencyName = { gold: 'gold', gems: 'gems' }[reward.kind];
  if (!currencyName) throw new Error(`지원하지 않는 보상 아이콘입니다: ${reward.kind}`);
  const currency = document.querySelector(`.currency.${currencyName} svg`);
  if (!currency) throw new Error(`보상 아이콘을 찾을 수 없습니다: ${reward.kind}`);
  const icon = currency.cloneNode(true);
  const prefix = `soldier-reward-${++rewardIconId}-`;
  const ids = new Map([...icon.querySelectorAll('[id]')].map(element => [element.id, `${prefix}${element.id}`]));
  for (const element of [icon, ...icon.querySelectorAll('*')]) {
    for (const attribute of [...element.attributes]) {
      let value = attribute.value;
      for (const [previous, next] of ids) value = value.replaceAll(`#${previous}`, `#${next}`);
      element.setAttribute(attribute.name, value);
    }
    if (ids.has(element.id)) element.id = ids.get(element.id);
  }
  icon.classList.add('reward-icon', `currency-${currencyName}-icon`);
  icon.setAttribute('aria-hidden', 'true');
  return icon;
}
export function rewardDisplay(reward, className = 'reward-display') {
  const display = document.createElement('span');
  display.className = className;
  const icon = rewardIcon(reward);
  const label = document.createElement('span');
  label.textContent = rewardLabel(reward);
  display.append(icon, label);
  return display;
}
function validReward(reward) {
  return reward && ['gems','gold','xp','crate'].includes(reward.kind) && Number.isSafeInteger(reward.amount) && reward.amount>0
    && (reward.kind !== 'crate' || SUPPLY_PRODUCTS.some(item => item.id === reward.product));
}
export function validateDaily(result, owner, action, request) {
  if (!result || result.daily_version !== 1 || result.client_id !== owner || result.action !== action || result.request !== request
    || typeof result.replayed !== 'boolean' || !/^\d+$/.test(result.gems) || !/^\d+$/.test(result.gold) || !/^\d+$/.test(result.xp)
    || !Number.isInteger(result.free_spins) || result.free_spins<0 || result.free_spins>3
    || !Number.isInteger(result.attendance_step) || result.attendance_step<0 || result.attendance_step>20
    || (result.attendance_table !== null && ![1,2,3].includes(result.attendance_table))
    || typeof result.attendance_available !== 'boolean' || typeof result.can_select !== 'boolean'
    || !Array.isArray(result.mail) || result.mail.some(mail => !validReward(mail.reward) || typeof mail.claimed !== 'boolean'
      || !/^[0-9a-f-]{36}$/i.test(mail.id) || !['attendance','roulette'].includes(mail.source))) {
    throw new Error('일일 보상 응답을 확인할 수 없습니다. 같은 작업으로 다시 확인하세요.');
  }
  if (['spin','attendance'].includes(action) && (!validReward(result.outcome?.reward) || !result.outcome.mail_id)) throw new Error('우편 보상을 확인할 수 없습니다.');
  if (action === 'spin') {
    const prize = ROULETTE_PRIZES[result.outcome.reward.index];
    if (!prize || prize.kind !== result.outcome.reward.kind || prize.amount !== result.outcome.reward.amount
      || prize.product !== result.outcome.reward.product) throw new Error('룰렛 결과를 확인할 수 없습니다.');
  }
  return result;
}
export function createDailyRewards({ request, showSupply }) {
  const $ = id => document.getElementById(id);
  let state = null, busy = false, rotation = 0, preview = 1;
  const roulette = $('roulette-dialog'), attendance = $('attendance-dialog'), mailbox = $('mailbox-dialog');
  const notice = $('reward-notice-dialog');
  function report(error, dialog) {
    dialog.querySelector('[role="status"]').textContent = error.message;
    console.error('일일 보상 오류', error);
  }
  function notify(text) {
    $('reward-notice-message').textContent = text;
    return new Promise(resolve => {
      notice.addEventListener('close', resolve, { once: true }); notice.showModal();
    });
  }
  async function refresh(dialog) {
    dialog.querySelector('[role="status"]').textContent = '보상을 불러오는 중…';
    try { state = await request('read'); render(); dialog.querySelector('[role="status"]').textContent = ''; }
    catch (error) { report(error, dialog); }
  }
  function render() {
    if (!state) return;
    $('mailbox-count').textContent = String(state.mail.filter(mail => !mail.claimed).length);
    $('roulette-free').textContent = `오늘 무료 ${state.free_spins}/3회 · 이후 3보석 · 보유 ${state.gems}보석`;
    $('roulette-spin').textContent = state.free_spins ? '무료 룰렛 돌리기' : '룰렛 돌리기 · 3보석';
    $('roulette-spin').disabled = busy;
    renderAttendance(); renderMailbox();
  }
  async function action(name, args, dialog, after) {
    if (busy) return;
    busy = true; render();
    try {
      const result = await request(name, args);
      if (after) await after(result);
      state = result; render();
      dialog.querySelector('[role="status"]').textContent = '';
    } catch (error) { report(error, dialog); }
    finally { busy = false; render(); }
  }
  const wheel = $('roulette-wheel');
  wheel.style.background = `conic-gradient(from ${-180/17}deg,${ROULETTE_PRIZES.map((_,index) => `${['#244b61','#375362','#28595a','#4b4266'][index%4]} ${index*360/17}deg ${(index+1)*360/17}deg`).join(',')})`;
  ROULETTE_PRIZES.forEach((prize,index) => {
    const label = document.createElement('span'); label.className = 'roulette-sector'; label.style.setProperty('--angle', `${index*360/17}deg`);
    label.textContent = prize.kind === 'crate' ? `상자 ×${prize.amount}` : `${{gems:'◆',gold:'G',xp:'XP'}[prize.kind]} ${prize.amount}`;
    wheel.append(label);
    const line = document.createElement('li');
    line.append(rewardDisplay(prize), document.createTextNode(` · ${prize.weight/100}%`)); $('roulette-prizes').append(line);
  });
  $('roulette-spin').addEventListener('click', () => action('spin', {}, roulette, async result => {
    const end = rotation + 360*6 + ((360 - result.outcome.reward.index*360/17 - rotation%360)+360)%360;
    if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
      const animation = wheel.animate([{transform:`rotate(${rotation}deg)`},{transform:`rotate(${end}deg)`}],
        {duration:3600,easing:'cubic-bezier(.12,.65,.18,1)',fill:'forwards'});
      await animation.finished;
      wheel.style.transform = `rotate(${end}deg)`; animation.cancel();
    }
    rotation = end;
    await notify(`${rewardLabel(result.outcome.reward)} · 우편함에 저장되었습니다.`);
  }));
  function renderAttendance() {
    const locked = !state.can_select;
    const table = locked && state.attendance_table ? state.attendance_table : preview;
    $('attendance-summary').textContent = `한국 시간 자정 갱신 · ${state.attendance_step}/20일 완료 · ${state.attendance_available ? '오늘 수령 가능' : '오늘 수령 완료'}`;
    $('attendance-choices').replaceChildren();
    for (let index=1; index<=3; index++) {
      const button = document.createElement('button'); button.type = 'button'; button.textContent = `보상표 ${index}`;
      button.setAttribute('aria-pressed', String(table === index)); button.disabled = busy || (locked && table !== index);
      button.addEventListener('click', () => { preview=index;renderAttendance(); }); $('attendance-choices').append(button);
    }
    $('attendance-grid').replaceChildren();
    ATTENDANCE_TABLES[table-1].forEach((reward,index) => {
      const cell = document.createElement('div'); cell.className = 'attendance-day';
      const done = state.attendance_table === table && index<state.attendance_step && !state.can_select;
      cell.classList.toggle('claimed',done);
      const day = document.createElement('strong');day.textContent=`DAY ${index+1}${done ? ' · 완료' : ''}`;
      cell.append(day,rewardDisplay(reward,'attendance-reward'));
      $('attendance-grid').append(cell);
    });
    $('attendance-claim').disabled = busy || !state.attendance_available;
    $('attendance-claim').textContent = state.can_select ? `보상표 ${table} 선택하고 첫 보상 받기` : '오늘 출석 보상 받기';
  }
  $('attendance-claim').addEventListener('click', () => action('attendance',{table:state.can_select ? preview : state.attendance_table},attendance,
    result => notify(`${rewardLabel(result.outcome.reward)} · 우편함에 저장되었습니다.`)));
  function renderMailbox() {
    $('mailbox-list').replaceChildren();
    const pending = state.mail.filter(mail => !mail.claimed);
    if (!pending.length) $('mailbox-list').textContent = '받지 않은 우편이 없습니다.';
    for (const mail of pending) {
      const row = document.createElement('article'); row.className = 'mailbox-item';
      const title = rewardDisplay(mail.reward,'mailbox-reward');
      const info = document.createElement('small');info.textContent=`${mail.source === 'attendance' ? '출석 체크' : '룰렛'} · ${new Date(mail.created_at).toLocaleString('ko-KR')}`;
      const claim = document.createElement('button');claim.type='button';claim.textContent='받기';claim.disabled=busy;
      claim.addEventListener('click', () => action('claim',{mail:mail.id},mailbox,async result => {
        if (result.outcome.weapons?.length) await showSupply(result.outcome.weapons, mail.reward.product);
        await notify(`${rewardLabel(mail.reward)} · 수령 완료`);
      }));
      row.append(title,info,claim);$('mailbox-list').append(row);
    }
  }
  for (const [button,dialog] of [['roulette-open',roulette],['attendance-open',attendance],['mailbox-open',mailbox]]) {
    $(button).addEventListener('click', () => { if (busy) return; dialog.showModal();refresh(dialog); });
    dialog.addEventListener('cancel', event => { if (busy) event.preventDefault(); });
    dialog.querySelector('[data-daily-close]').addEventListener('click', () => { if (!busy) dialog.close(); });
  }
  return { refresh: () => refresh(mailbox) };
}
