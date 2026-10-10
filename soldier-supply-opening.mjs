import { SUPPLY_PRODUCTS, supplyArtwork } from './soldier-supply.mjs?v=7';

export const OPENING_TIMING = { turn: 200, lid: 360, flash: 400, reveal: 780, finish: 1300 };

export function createSupplyOpening(renderCard, reportError) {
  const dialog = document.createElement('dialog'); dialog.id = 'supply-opening-dialog';
  dialog.setAttribute('aria-labelledby','supply-opening-title');
  const title = document.createElement('h2'); title.id = 'supply-opening-title'; title.className='supply-accessible-status';
  const counter = document.createElement('span'); counter.className='supply-opening-counter';
  counter.setAttribute('aria-label','남은 보급함');
  const stage = document.createElement('div'); stage.className = 'supply-opening-stage';
  const crate = document.createElement('div'); crate.className = 'supply-opening-crate';
  crate.setAttribute('aria-hidden','true');
  const body = document.createElement('img'); body.className = 'supply-crate-body'; body.alt = '';
  const lid = document.createElement('img'); lid.className = 'supply-crate-lid'; lid.alt = '';
  crate.append(body,lid);
  const burst = document.createElement('div'); burst.className = 'supply-burst';
  const particles = document.createElement('div'); particles.className = 'supply-particles';
  for (let i=0;i<24;i++) {
    const spark = document.createElement('i'); spark.style.setProperty('--angle',`${i*137.5}deg`);
    spark.style.setProperty('--distance',`${90+i%6*22}px`);
    spark.style.setProperty('--delay',`${i%7*25}ms`); particles.append(spark);
  }
  const reward = document.createElement('div'); reward.className = 'supply-opening-reward';
  stage.append(crate,burst,particles,reward);
  const status = document.createElement('p'); status.setAttribute('role','status'); status.className='supply-accessible-status';
  const hint = document.createElement('p'); hint.className = 'supply-opening-hint';
  dialog.append(title,counter,stage,hint,status);
  document.body.append(dialog);
  let current=0, rewards=[], resolveClose, context, timers=[], finishTimer=0, deadline=0, remaining=0, generation=0;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  function clear() {
    clearTimeout(finishTimer); finishTimer=0;
    for (const timer of timers) clearTimeout(timer);
    timers=[];
  }
  function tone(frequency,duration,delay,volume) {
    if (!context || context.state !== 'running') return;
    timers.push(setTimeout(() => {
      if (!dialog.open || document.hidden) return;
      const osc=context.createOscillator(), gain=context.createGain();
      osc.type='triangle'; osc.frequency.setValueAtTime(frequency,context.currentTime);
      osc.frequency.exponentialRampToValueAtTime(frequency*.45,context.currentTime+duration);
      gain.gain.setValueAtTime(volume,context.currentTime);
      gain.gain.exponentialRampToValueAtTime(.001,context.currentTime+duration);
      osc.connect(gain); gain.connect(context.destination); osc.start(); osc.stop(context.currentTime+duration);
    },delay));
  }
  function finish() {
    clear(); dialog.dataset.phase='revealed';
    status.textContent=`${current+1}/${rewards.length} · ${rewards[current].grade}급 무기 획득 · 인벤토리에 저장됨 · 터치하여 계속`;
    hint.textContent=current+1<rewards.length ? '클릭 · 터치 · Enter로 다음 보급함' : '클릭 · 터치 · Enter로 상점 돌아가기';
    counter.textContent=`× ${rewards.length-current-1}`;
  }
  function scheduleFinish(duration) {
    remaining=duration; deadline=0;
    if (document.hidden) return;
    deadline=performance.now()+duration;
    finishTimer=setTimeout(finish,duration);
  }
  async function play() {
    clear();
    const index=current, sequence=++generation;
    counter.textContent=`× ${rewards.length-current}`;
    status.textContent=`보급함 개봉 중 · ${current+1}/${rewards.length}`;
    hint.textContent='보급함 개봉 중…';
    dialog.dataset.phase='loading';
    reward.replaceChildren(renderCard(rewards[current].weapon,rewards[current]));
    try {
      await Promise.all([...stage.querySelectorAll('img')].map(image => image.decode()));
    } catch (error) {
      if (!dialog.open || current!==index || sequence!==generation) return;
      console.error('보급함 개봉 이미지 준비 실패',error);
      reportError(`개봉 이미지를 준비할 수 없습니다: ${error.message}. 인벤토리에 저장된 획득 결과를 표시합니다.`);
      finish(); return;
    }
    if (!dialog.open || current!==index || sequence!==generation) return;
    if (reduced.matches) { finish(); return; }
    // Decode the shared artwork before compositor animations start.
    dialog.dataset.phase='idle';
    void stage.offsetWidth;
    dialog.dataset.paused=String(document.hidden);
    dialog.dataset.phase='opening';
    tone(260,.12,0,.07); tone(420,.15,240,.07); tone(1100,.4,400,.08); tone(1600,.25,780,.04);
    scheduleFinish(OPENING_TIMING.finish);
  }
  function advance() {
    if (!dialog.open || dialog.dataset.phase!=='revealed') return;
    if (current+1<rewards.length) { current++; play(); } else dialog.close();
  }
  document.addEventListener('visibilitychange',() => {
    if (!dialog.open || dialog.dataset.phase!=='opening') return;
    dialog.dataset.paused=String(document.hidden);
    if (document.hidden) {
      if (finishTimer) remaining=Math.max(0,deadline-performance.now());
      clearTimeout(finishTimer); finishTimer=0;
    } else scheduleFinish(remaining);
  });
  dialog.addEventListener('click',advance);
  dialog.addEventListener('keydown',event => {
    if (event.key==='Enter' || event.key===' ') { event.preventDefault(); if (!event.repeat) advance(); }
  });
  dialog.addEventListener('close',() => { generation++; clear(); resolveClose?.(); resolveClose=null; });
  return {
    async open(product,items) {
      const spec=SUPPLY_PRODUCTS.find(entry => entry.id===product);
      if (!spec || !items.length) throw new Error('개봉할 보급함 보상이 없습니다.');
      if (dialog.open) throw new Error('이전 보급함 개봉을 먼저 완료하세요.');
      rewards=items; current=0; counter.hidden=product!=='special';
      const sequence=++generation;
      body.src=lid.src=supplyArtwork(product);
      title.textContent=spec.name; dialog.tabIndex=-1;
      dialog.dataset.phase='loading'; dialog.showModal(); dialog.focus();
      const closed=new Promise(resolve => { resolveClose=resolve; });
      try {
        const Audio=window.AudioContext||window.webkitAudioContext;
        if (Audio) {
          context ||= new Audio();
          await context.resume();
        }
      } catch (error) { console.warn('보급함 효과음 시작 실패',error); reportError('효과음을 재생할 수 없습니다.'); }
      if (dialog.open && sequence===generation) await play();
      return closed;
    }
  };
}
