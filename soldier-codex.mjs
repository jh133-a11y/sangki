import { WEAPONS, EQUIPMENT_GRADES, WEAPON_COLORS, weaponSetDescription } from './soldier-core.mjs?v=10';
import { CHARACTERS, CHARACTER_MAX_LEVEL, characterCard } from './soldier-characters.mjs?v=10';
import { weaponInventoryStats, characterInventoryStats } from './soldier-inventory.mjs?v=35';
import { fillWeaponCard, WEAPON_ARTWORK } from './soldier-weapon-items.mjs?v=13';

export function createCodex() {
  const $ = id => document.getElementById(id), dialog = $('codex-dialog');
  let category = 'primary', selected = 'k2';
  const grade = $('codex-grade'), color = $('codex-color'), level = $('codex-level');
  for (const value of EQUIPMENT_GRADES) grade.add(new Option(`${value}급`,value));
  for (const value of WEAPON_COLORS) color.add(new Option(value.toUpperCase(),value));
  function render() {
    const character = category === 'character';
    grade.disabled = color.disabled = character;
    const max = character ? CHARACTER_MAX_LEVEL : 7;
    if (Number(level.value)>max) level.value=String(max);
    level.max=String(max);
    const ids = character ? Object.keys(CHARACTERS) : Object.keys(WEAPON_ARTWORK).filter(id => WEAPONS[id].slot===category);
    if (!ids.includes(selected)) selected=ids[0];
    $('codex-items').replaceChildren();
    for (const id of ids) {
      const button=document.createElement('button');button.type='button';button.textContent=(character ? CHARACTERS : WEAPONS)[id].name;
      button.setAttribute('aria-pressed',String(selected===id));
      button.addEventListener('click',()=>{selected=id;render();});$('codex-items').append(button);
    }
    $('codex-detail').replaceChildren();
    const title=document.createElement('h3');title.textContent=(character ? CHARACTERS : WEAPONS)[selected].name;
    let card;
    if (character) card=characterCard(selected,Number(level.value));
    else {
      card=document.querySelector('#primary .equipment-card').cloneNode(true);
      fillWeaponCard(card,selected,{grade:grade.value,color:color.value,level:Number(level.value)});
    }
    const stats=document.createElement('dl');
    const values=character ? characterInventoryStats(selected,Number(level.value))
      : weaponInventoryStats(selected,grade.value,Number(level.value),color.value);
    for (const [name,value] of values) {
      const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=name;dd.textContent=String(value);stats.append(dt,dd);
    }
    const set=document.createElement('p');set.className='codex-set';
    set.textContent=character ? CHARACTERS[selected].ability || ''
      : color.value!=='standard' ? `${weaponSetDescription(grade.value,color.value)} · 동일 등급/색상 3슬롯 장착 시 적용` : '색상 세트 효과 없음';
    $('codex-detail').append(title,card,stats,set);
  }
  for (const button of dialog.querySelectorAll('[data-codex-category]')) button.addEventListener('click',()=>{
    category=button.dataset.codexCategory;
    for (const tab of dialog.querySelectorAll('[data-codex-category]')) tab.setAttribute('aria-selected',String(tab===button));
    render();
  });
  for (const input of [grade,color,level]) input.addEventListener('change',()=>{
    if (!Number.isInteger(Number(level.value)) || Number(level.value)<1) level.value='1';
    render();
  });
  $('codex-open').addEventListener('click',()=>{render();dialog.showModal();});
  $('codex-close').addEventListener('click',()=>dialog.close());render();
}
