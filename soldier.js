import * as THREE from './vendor/three.module.min.js';
import { createSoldierModel, loadCharacterTextures } from './soldier-character.mjs?v=4';
import { createHomeViewer } from './soldier-home-viewer.mjs?v=13';
import { createEquipmentInventory, inventoryWeapons, INVENTORY_LIMIT } from './soldier-inventory.mjs?v=2';
import { WEAPONS, rankProgress, DEFAULT_LOADOUT, weaponLevel, weaponLevelLabel, weaponUpgradeCost, DEFAULT_CONTROLS, COVER, SPAWNS, blocked, direction, coverDistance, targetDistance, settingsFrom } from './soldier-core.mjs?v=3';

const $ = id => document.getElementById(id);
const endpoint = 'https://ejrwrwjsgizzxhqybtff.supabase.co/rest/v1/rpc';
const apiKey = 'sb_publishable_Mr64z4NO3wlqeKObCxLbBQ_HlhvG7D8';
function read(key, fallback, storage = localStorage) {
  try { return JSON.parse(storage.getItem(key) || 'null') ?? fallback; }
  catch (error) { console.warn(`설정을 읽을 수 없습니다: ${key}`, error); return fallback; }
}
function save(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); }
  catch (error) { $('settings-status').textContent = '브라우저에 설정을 저장하지 못했습니다.'; console.warn(error); }
}
let settings = settingsFrom(read('sanggi-soldier-settings', {}));
const loadout = { ...DEFAULT_LOADOUT };
let equipment = {};
const artwork = { k2: 'soldier-weapon-k2.webp?v=2', shotgun: 'soldier-weapon-shotgun.webp?v=2', stick: 'soldier-weapon-stick.webp?v=2' };
function updateEquipment(result) {
  if (!result || !/^\d+$/.test(String(result.gold)) || !result.equipment || typeof result.equipment !== 'object' || Array.isArray(result.equipment)) {
    throw new Error('서버 장비 정보를 확인할 수 없습니다.');
  }
  for (const slot of ['primary', 'secondary', 'melee', 'character']) {
    if (inventoryWeapons(result.equipment, slot).length > INVENTORY_LIMIT) throw new Error('분류별 최대 보유 인벤토리 50개를 초과한 서버 데이터입니다.');
  }
  for (const [id, item] of Object.entries(result.equipment)) {
    if (!WEAPONS[id] || !item) throw new Error('서버 무기 정보를 확인할 수 없습니다.');
    weaponUpgradeCost(item.grade, item.level);
  }
  equipment = result.equipment;
  identity.gold = result.gold; updateWallet(identity);
  inventory.refresh();
}
function fillWeaponCard(card, id) {
  const level = weaponLevel(equipment[id]?.level);
  const grade = equipment[id]?.grade || 'D';
  card.dataset.grade = grade;
  card.querySelector('.grade-frame').src = `soldier-grade-${grade.toLowerCase()}.webp`;
  card.querySelector('.grade-frame').alt = `${grade}급`;
  card.querySelector('.weapon-level').textContent = weaponLevelLabel(level);
  const image = card.querySelector('.weapon-image');
  image.hidden = !artwork[id];
  if (artwork[id]) image.src = artwork[id];
  else image.removeAttribute('src');
  image.alt = WEAPONS[id].name;
  card.querySelector('.weapon-name').textContent = WEAPONS[id].name;
}
function renderWeaponCard(slot) {
  fillWeaponCard($(slot).querySelector('.equipment-card'), loadout[slot]);
}
for (const slot of Object.keys(loadout)) {
  renderWeaponCard(slot);
}
const inventory = createEquipmentInventory({
  getEquipment: () => equipment, getLoadout: () => loadout,
  renderCard(id) {
    if (id === 'character') {
      const card = $('character').cloneNode(true);
      card.removeAttribute('id'); card.removeAttribute('role'); card.removeAttribute('tabindex'); card.removeAttribute('aria-haspopup');
      return card;
    }
    const card = $('primary').querySelector('.equipment-card').cloneNode(true);
    fillWeaponCard(card, id); return card;
  }
});
let identity = null, room = null, myId = null, mode = 'home', online = false;
let ready = false, networkBusy = false, networkErrors = 0, lastNet = 0, lobbyTimer = null;
let entities = [], matchEnds = 0, lastFrame = performance.now(), slot = 'primary';
let player = { x: -42, y: 0, z: -42, yaw: -.8, pitch: 0, crouch: false, hp: 100, kills: 0, deaths: 0 };
let velocityY = 0, nextShot = 0, reloadEnds = 0, reloadSlot = null, respawnAt = 0, protectionEnds = 0, jumpPending = false;
let reloadRequested = null;
let ammo = {}, fireHeld = false, aiming = false, shotRequested = false, recoil = 0;
let keys = new Set(), moveTouch = null, lookTouch = null, joystick = { x: 0, y: 0 };
let audioContext = null;
const dialogOpen = () => !!document.querySelector('dialog[open]');

async function rpc(name, data) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(`${endpoint}/${name}`, {
      method: 'POST', headers: { apikey: apiKey, Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(data), signal: controller.signal
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || '서버 요청에 실패했습니다.');
    return result;
  } finally { clearTimeout(timeout); }
}
async function api(action, data = {}, roomId = room?.id) {
  return rpc('soldier_api', { p_token: identity.token, p_action: action, p_room: roomId || null, p_data: data });
}
async function connect() {
  try {
    const account = read('sangki-auth-session', null) || read('sangki-auth-session-tab', null, sessionStorage);
    identity = await rpc('soldier_connect', {
      p_client_id: localStorage.getItem('sangki-investment-client-id'),
      p_nickname: localStorage.getItem('sangki-investor-nickname'),
      p_session_token: account?.session_token || null
    });
    $('nickname').textContent = identity.nickname;
    updateRank(identity.xp);
    updateWallet(identity);
    try {
      const result = await rpc('soldier_equipment_api', { p_token: identity.token });
      updateEquipment(result);
      $('equipment-status').textContent = '';
    } catch (error) {
      $('equipment-status').textContent = `장비 불러오기 실패: ${error.message} SQL 미설치 시 soldier-equipment-upgrade.sql 실행 후 새로고침하세요.`;
      console.error('장비 불러오기 오류', error);
    }
    Object.keys(loadout).forEach(renderWeaponCard);
    ready = true;
    $('play-open').disabled = false;
    $('home-status').textContent = identity.home_version === 2 ? '장비를 선택하고 게임을 시작하세요.' : '계급 승리 보너스·재화 기능은 soldier-home-upgrade.sql 실행 후 새로고침하세요.';
  } catch (error) {
    $('nickname').textContent = '투자 닉네임 필요';
    $('home-status').textContent = `${error.message} 메인에서 투자 닉네임을 설정하세요. 온라인 서버를 처음 설정할 때는 soldier-schema.sql 실행이 필요합니다.`;
    console.error('솔져 접속 오류', error);
  }
}
function updateRank(xp) {
  identity.xp = Number(xp);
  const progress = rankProgress(identity.xp);
  $('rank').textContent = `${progress.name} · ${identity.xp.toLocaleString('ko-KR')} XP`;
  $('rank-fill').style.width = `${progress.percent}%`;
  $('rank-percent').textContent = `${Math.floor(progress.percent)}%`;
  $('rank-meter').setAttribute('aria-valuenow', String(Math.floor(progress.percent)));
  $('rank-meter').setAttribute('aria-valuetext', progress.next ? `${progress.earned.toLocaleString('ko-KR')} / ${progress.required.toLocaleString('ko-KR')} XP` : '최고 계급');
  $('rank-open').setAttribute('aria-label', `${progress.name} 계급 및 승급 정보`);
  drawRankBadge(progress.index, progress.name);
  renderRankDetail();
}
function updateWallet(profile) {
  if (profile.home_version !== 2) {
    $('gold').textContent = '0'; $('gems').textContent = '0';
    for (const name of ['gold', 'gems']) $(name).title = '재화 정보 미연결: soldier-home-upgrade.sql 실행 필요';
    return;
  }
  for (const name of ['gold', 'gems']) {
    const value = String(profile[name]);
    if (!/^\d+$/.test(value)) throw new Error('재화 정보를 확인할 수 없습니다.');
    $(name).textContent = BigInt(value).toLocaleString('ko-KR');
    $(name).removeAttribute('title');
    identity[name] = value;
  }
  identity.wins = Number(profile.wins);
  identity.home_version = profile.home_version;
  renderRankDetail();
}
function drawRankBadge(index, name) {
  const svg = $('rank-badge'), ns = 'http://www.w3.org/2000/svg';
  svg.replaceChildren(); svg.setAttribute('aria-label', `${name} 계급`);
  function shape(tag, attributes) {
    const element = document.createElementNS(ns, tag);
    for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
    svg.append(element); return element;
  }
  if (index < 8) {
    const count = index < 4 ? index + 1 : index - 3;
    for (let i = 0; i < count; i++) shape('path', { d: `M10 ${28 + i * 7} 32 ${10 + i * 7} 54 ${28 + i * 7} 54 ${35 + i * 7} 32 ${17 + i * 7} 10 ${35 + i * 7}Z`, fill: '#f1ce67', stroke: '#8e6c20', 'stroke-width': 1 });
    if (index >= 4) shape('path', { d: 'M16 53h32v5H16Z', fill: '#f1ce67' });
  } else if (index < 15) {
    const count = index < 12 ? Math.max(1, index - 8) : index - 11;
    for (let i = 0; i < count; i++) {
      const x = 32 - (count - 1) * 8 + i * 16;
      shape('path', { d: `M${x} 20 ${x + 7} 32 ${x} 44 ${x - 7} 32Z`, fill: index >= 12 ? '#eac568' : '#d1dde2', stroke: '#8d764c' });
    }
  } else {
    for (let i = 0; i < index - 14; i++) {
      const count = index - 14, x = 32 - (count - 1) * 5.5 + i * 11;
      shape('path', { d: `m${x} 23 2.6 6 6.4 .5-4.8 4.3 1.5 6.2-5.7-3.3-5.7 3.3 1.5-6.2-4.8-4.3 6.4-.5Z`, fill: '#f1ce67', stroke: '#9c7f35', 'stroke-width': .5 });
    }
  }
}
function renderRankDetail() {
  const progress = rankProgress(identity?.xp || 0);
  $('rank-detail').textContent = `현재 계급: ${progress.name} · 누적 ${(identity?.xp || 0).toLocaleString('ko-KR')} XP${identity?.home_version === 2 ? ` · ${identity.wins || 0}승` : ''}`;
  $('rank-next').textContent = progress.next ? `다음 계급: ${progress.next} · 승급까지 ${progress.remaining.toLocaleString('ko-KR')} XP 필요 (${progress.earned.toLocaleString('ko-KR')} / ${progress.required.toLocaleString('ko-KR')} XP)` : '최고 계급 원수입니다.';
  $('rank-wins').textContent = progress.next ? `승리 보너스만 기준으로 ${progress.winsNeeded.toLocaleString('ko-KR')}판 더 승리하면 승급합니다. 처치 경험치가 더해지면 더 빨리 승급할 수 있습니다.` : '더 이상 승급할 계급이 없습니다.';
}
$('rank-open').addEventListener('click', () => { renderRankDetail(); $('rank-dialog').showModal(); });
let renderer, scene, camera, homeCharacter, characterTextures, hand, flash;
try {
  homeCharacter = await createHomeViewer($('home-character'), $('character-status'));
  characterTextures = await loadCharacterTextures();
  renderer = new THREE.WebGLRenderer({ canvas: $('world'), antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  renderer.setSize(innerWidth, innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  scene = new THREE.Scene();
  scene.background = new THREE.Color('#9dbdcc');
  scene.fog = new THREE.Fog('#9dbdcc', 55, 150);
  camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, .05, 200);
  camera.rotation.order = 'YXZ';
  scene.add(new THREE.HemisphereLight('#eff7ff', '#52604a', 2.2));
  const sun = new THREE.DirectionalLight('#fff1cd', 2);
  sun.position.set(25, 40, 20); scene.add(sun);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(110, 110), new THREE.MeshStandardMaterial({ color: '#778569', roughness: 1 }));
  ground.rotation.x = -Math.PI / 2; scene.add(ground);
  makeMap();
  scene.add(camera);
  hand = new THREE.Group(); camera.add(hand);
  flash = new THREE.PointLight('#ffc67b', 0, 4); flash.position.set(.3, -.2, -.9); camera.add(flash);
  equip('primary');
} catch (error) {
  renderer = null;
  $('home-status').textContent = `${error.message} 3D 화면을 시작할 수 없습니다. 새로고침하거나 WebGL을 지원하는 최신 브라우저와 하드웨어 가속을 사용하세요.`;
  console.error('3D 초기화 오류', error);
}
function cube(parent, x, y, z, w, h, d, color) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial({ color, roughness: .8 }));
  mesh.position.set(x, y, z); parent.add(mesh); return mesh;
}
function makeMap() {
  cube(scene, 0, .015, 0, 100, .025, 9, '#65747b');
  cube(scene, 0, .016, 0, 9, .025, 100, '#65747b');
  for (const [x, z, w, d, h] of COVER) {
    cube(scene, x, h / 2, z, w, h, d, h > 4 ? '#c1b39a' : '#68765f');
    if (h > 4) {
      cube(scene, x, h + .25, z, w + .5, .5, d + .5, '#455465');
      for (const offset of [-3, 0, 3]) cube(scene, x + offset, 4.5, z - d / 2 - .02, 1.4, 2, .05, '#3b6175');
    } else cube(scene, x, h + .1, z, w, .2, d, '#879375');
  }
  for (const [x, z, w, d] of [[0, -50, 100, 1], [0, 50, 100, 1], [-50, 0, 1, 100], [50, 0, 1, 100]]) cube(scene, x, 2, z, w, 4, d, '#455465');
  for (let i = -40; i <= 40; i += 20) {
    cube(scene, i, 1.2, 47, .6, 2.4, .6, '#665646');
    const crown = new THREE.Mesh(new THREE.SphereGeometry(2.8, 8, 6), new THREE.MeshStandardMaterial({ color: '#406b45' }));
    crown.position.set(i, 4, 47); scene.add(crown);
  }
}
function makeSoldier(color, label) {
  const body = new THREE.Group();
  const character = createSoldierModel(true, characterTextures);
  // Gameplay's forward vector is -Z; the home model faces +Z.
  character.rotation.y = Math.PI;
  body.add(character);
  if (label) {
    const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 64;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#112537cc'; ctx.fillRect(0, 0, 256, 64);
    ctx.font = 'bold 24px sans-serif'; ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.fillText(label.slice(0, 16), 128, 42);
    const texture = new THREE.CanvasTexture(canvas);
    const name = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: true }));
    name.position.y = 2.4; name.scale.set(2.5, .625, 1); body.add(name);
  }
  return body;
}
function dispose(group) {
  const materials = new Set(), maps = new Set();
  group.traverse(object => {
    object.geometry?.dispose();
    if (object.material) {
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        materials.add(material);
        if (material.map && !material.map.userData.persistent) maps.add(material.map);
      }
    }
  });
  for (const map of maps) map.dispose();
  for (const material of materials) material.dispose();
  group.removeFromParent();
}
function equip(next) {
  slot = next; aiming = false; fireHeld = false; shotRequested = false; reloadRequested = null; $('scope').hidden = true;
  if (hand) {
    for (const child of [...hand.children]) dispose(child);
    const id = loadout[slot], gun = new THREE.Group();
    hand.add(gun);
    if (slot === 'melee') {
      cube(gun, .35, -.35, -.65, .07, .07, .65, '#796348');
      if (id === 'stick') cube(gun, .35, -.3, -.95, .08, .08, .4, '#796348');
      else cube(gun, .35, -.25, -.95, id === 'kukri' ? .08 : .34, id === 'kukri' ? .15 : .28, .15, '#a4b2b8');
    } else {
      const length = id === 'pistol' ? .35 : id === 'sniper' ? 1.2 : .8;
      cube(gun, .3, -.3, -.55, .13, .18, .38, id === 'ak47' ? '#735c46' : '#37463d');
      cube(gun, .3, -.28, -.6 - length / 2, .065, .065, length, '#283039');
      cube(gun, .3, -.44, -.56, .09, .23, .13, '#2d3337');
      if (id === 'sniper' || id === 'aug64') cube(gun, .3, -.17, -.7, .09, .09, .3, '#283039');
    }
  }
  for (const button of document.querySelectorAll('[data-slot]')) button.setAttribute('aria-pressed', String(button.dataset.slot === slot));
  updateHud();
}
function resetAmmo() {
  ammo = Object.fromEntries(Object.entries(loadout).map(([key, id]) => [key, WEAPONS[id].magazine]));
}
function applyControls() {
  for (const [id, config] of Object.entries(settings.controls)) {
    const element = $(id);
    const height = id === 'weapon-buttons' ? Math.max(148, config.size * 1.6) : config.size;
    const x = Math.max(config.size / 2 + 4, Math.min(innerWidth - config.size / 2 - 4, innerWidth * config.x / 100));
    const y = Math.max(height / 2 + 4, Math.min(innerHeight - height / 2 - 4, innerHeight * config.y / 100));
    Object.assign(element.style, { left: `${x}px`, top: `${y}px`, width: `${config.size}px`, height: `${height}px`, transform: 'translate(-50%, -50%)' });
    if (id === 'weapon-buttons') {
      for (const button of element.children) {
        button.style.flex = '1';
        button.style.fontSize = `${Math.max(11, config.size / 92 * 12)}px`;
      }
    }
    if (id === 'joystick') {
      $('joystick').firstElementChild.style.left = `${config.size / 2 - 16}px`;
      $('joystick').firstElementChild.style.top = `${config.size / 2 - 16}px`;
    }
  }
}
function buildSettings() {
  $('auto-fire').checked = settings.autoFire; $('sensitivity').value = settings.sensitivity;
  $('control-settings').replaceChildren();
  for (const [id, config] of Object.entries(settings.controls)) {
    const row = document.createElement('div'); row.className = 'setting-row';
    const title = document.createElement('strong'); title.textContent = config.name; row.append(title);
    for (const [key, name, min, max] of [['x', '가로 위치', 5, 95], ['y', '세로 위치', 10, 90], ['size', '크기', 44, 150]]) {
      const label = document.createElement('label'), input = document.createElement('input'), output = document.createElement('output');
      label.append(document.createTextNode(name)); input.type = 'range'; input.min = min; input.max = max; input.step = 1; input.value = config[key];
      input.setAttribute('aria-label', `${config.name} ${name}`);
      output.textContent = config[key]; label.append(input, output); row.append(label);
      input.addEventListener('input', () => {
        settings.controls[id][key] = Number(input.value); output.textContent = input.value; applyControls(); saveSettings();
      });
    }
    $('control-settings').append(row);
  }
}
function saveSettings() { save('sanggi-soldier-settings', settings); }
$('auto-fire').addEventListener('change', () => { settings.autoFire = $('auto-fire').checked; saveSettings(); });
$('sensitivity').addEventListener('input', () => { settings.sensitivity = Number($('sensitivity').value); saveSettings(); });
$('settings-reset').addEventListener('click', () => { settings = settingsFrom({ autoFire: settings.autoFire }); buildSettings(); applyControls(); saveSettings(); });
function openSettings() {
  resetInput(); document.exitPointerLock?.(); $('settings').showModal();
}
$('settings-open').addEventListener('click', openSettings);
$('game-settings-open').addEventListener('click', openSettings);
for (const button of document.querySelectorAll('[data-close]')) button.addEventListener('click', () => button.closest('dialog').close());
$('play-open').addEventListener('click', () => { if (ready) $('play-dialog').showModal(); });
$('ai-start').addEventListener('click', () => startMatch(false));
$('find-rooms').addEventListener('click', findRooms);
$('create-form').addEventListener('submit', async event => {
  event.preventDefault();
  await enterRoom('create', { name: $('room-name').value.trim(), loadout });
});
async function findRooms() {
  $('play-status').textContent = '방 목록을 불러오는 중…';
  try {
    const rooms = await api('list');
    $('room-list').replaceChildren();
    for (const entry of rooms) {
      const row = document.createElement('div'); row.className = 'room-row';
      const text = document.createElement('span'); text.textContent = `${entry.name} · ${entry.count}/8명`;
      const button = document.createElement('button'); button.type = 'button'; button.textContent = '참가';
      button.addEventListener('click', () => enterRoom('join', { loadout }, entry.id));
      row.append(text, button); $('room-list').append(row);
    }
    $('play-status').textContent = rooms.length ? '' : '대기 중인 방이 없습니다. 새 방을 만들어 주세요.';
  } catch (error) { $('play-status').textContent = error.message; }
}
let entering = false;
async function enterRoom(action, data, id) {
  if (entering) return;
  entering = true; $('play-status').textContent = '방에 접속 중…';
  try {
    const state = await api(action, data, id);
    room = state.room; myId = state.self; online = true;
    $('play-dialog').close(); $('lobby').showModal();
    applySnapshot(state);
    lobbyTimer = setInterval(pollLobby, 1000);
  } catch (error) { $('play-status').textContent = error.message; }
  finally { entering = false; }
}
async function pollLobby() {
  if (networkBusy || !room || mode === 'game') return;
  networkBusy = true;
  try { applySnapshot(await api('state')); }
  catch (error) { $('lobby-status').textContent = error.message; }
  finally { networkBusy = false; }
}
$('room-start').addEventListener('click', async () => {
  $('room-start').disabled = true;
  try { applySnapshot(await api('start')); }
  catch (error) { $('lobby-status').textContent = error.message; $('room-start').disabled = false; }
});
$('room-leave').addEventListener('click', leaveRoom);
$('lobby').addEventListener('cancel', event => { event.preventDefault(); leaveRoom(); });
async function leaveRoom() {
  if (room && online) {
    try { await api('leave'); }
    catch (error) { $('home-status').textContent = `${error.message} 방 목록에서 12초 후 접속이 정리됩니다.`; }
  }
  clearInterval(lobbyTimer); lobbyTimer = null; room = null; online = false; $('lobby').close();
  goHome();
}
function startMatch(isOnline) {
  if (!ready || !renderer) return;
  online = isOnline; mode = 'game';
  $('play-dialog').close(); $('lobby').close(); clearInterval(lobbyTimer); lobbyTimer = null;
  homeCharacter.cancelDrag();
  $('home').hidden = true; $('hud').hidden = false;
  fireHeld = false; aiming = false; keys.clear(); joystick = { x: 0, y: 0 };
  resetAmmo(); reloadEnds = 0; respawnAt = 0; protectionEnds = performance.now() / 1000 + 2;
  player = { ...player, x: -42, y: 0, z: -42, yaw: -Math.PI * .75, pitch: 0, crouch: false, hp: 100, kills: 0, deaths: 0 };
  velocityY = 0; matchEnds = performance.now() / 1000 + 180; nextShot = 0;
  clearEntities();
  if (!online) {
    for (let i = 1; i <= 5; i++) {
      const [x, z] = SPAWNS[i];
      const body = makeSoldier('#9b574a', `AI ${i}`); scene.add(body);
      entities.push({ id: `bot${i}`, nickname: `AI ${i}`, x, y: 0, z, yaw: 0, crouch: false, hp: 100, kills: 0, deaths: 0, body, nextShot: 0, respawn: 0, protected: 0 });
    }
  }
  $('match-name').textContent = online ? room.name : 'AI 연습';
  $('game-status').textContent = '';
  $('crouch').setAttribute('aria-pressed', 'false');
  equip('primary'); applyControls(); updateHud();
}
function clearEntities() { for (const entity of entities) dispose(entity.body); entities = []; }
function applySnapshot(state) {
  if (!state?.room) throw new Error('서버 경기 정보를 확인할 수 없습니다.');
  room = state.room; myId = state.self;
  if (room.status === 'waiting') {
    $('lobby-name').textContent = room.name;
    $('lobby-players').replaceChildren(...state.players.map(p => {
      const li = document.createElement('li'); li.textContent = `${p.nickname}${p.id === room.host ? ' (방장)' : ''}`; return li;
    }));
    $('room-start').hidden = room.host !== myId;
    $('room-start').disabled = state.players.length < 2;
    return;
  }
  const startingMatch = room.status === 'playing' && mode !== 'game';
  if (startingMatch) startMatch(true);
  if (room.status === 'finished') { updateRank(state.xp); updateWallet(state); finish(state.players); return; }
  const own = state.players.find(p => p.id === myId);
  if (!own) throw new Error('방 연결이 끊겼습니다.');
  if (startingMatch) player.yaw = Math.atan2(own.x, own.z);
  const respawned = player.hp <= 0 && own.hp > 0;
  if (respawned || Math.hypot(player.x - own.x, player.z - own.z) > 1.5) { player.x = own.x; player.z = own.z; player.y = own.y; velocityY = 0; }
  if (player.hp > own.hp) $('game-status').textContent = own.hp ? '피격!' : '전투불능 · 3초 후 부활';
  player.hp = own.hp; player.kills = own.kills; player.deaths = own.deaths;
  if (respawned) $('game-status').textContent = '';
  ammo = state.ammo;
  reloadEnds = state.reload_until ? performance.now() / 1000 + Math.max(0, (Date.parse(state.reload_until) - Date.parse(room.server_time)) / 1000) : 0;
  matchEnds = performance.now() / 1000 + Math.max(0, (Date.parse(room.ends_at) - Date.parse(room.server_time)) / 1000);
  updateRank(state.xp);
  updateWallet(state);
  const others = state.players.filter(p => p.id !== myId);
  for (const entity of [...entities]) {
    if (!others.some(p => p.id === entity.id)) { dispose(entity.body); entities.splice(entities.indexOf(entity), 1); }
  }
  for (const other of others) {
    let entity = entities.find(p => p.id === other.id);
    if (!entity) {
      const body = makeSoldier('#9b574a', other.nickname); scene.add(body);
      entity = { ...other, body, tx: other.x, tz: other.z }; entities.push(entity);
    }
    entity.tx = other.x; entity.tz = other.z; entity.y = other.y; entity.yaw = other.yaw;
    entity.hp = other.hp; entity.crouch = other.crouch; entity.kills = other.kills;
  }
  updateHud();
}
async function networkAction(action, data) {
  if (networkBusy || !room || mode !== 'game') return false;
  networkBusy = true;
  try {
    const state = await api(action, data);
    if (mode === 'game' && online) applySnapshot(state);
    networkErrors = 0; return true;
  } catch (error) {
    $('game-status').textContent = `연결 오류: ${error.message}`;
    networkErrors++;
    if (networkErrors >= 3) { $('home-status').textContent = '서버 연결이 끊겨 경기를 중단했습니다. 12초 후 다시 참가하세요.'; room = null; goHome(); }
    return false;
  } finally { networkBusy = false; }
}
function updateHud() {
  if (!player) return;
  $('health').textContent = `HP ${player.hp}`;
  $('score').textContent = `${player.kills} 처치 · ${player.deaths} 사망`;
  const weapon = WEAPONS[loadout[slot]];
  const reloading = reloadEnds > performance.now() / 1000;
  $('ammo').textContent = `${weapon.name} · ${slot === 'melee' ? '근접 무기' : `${ammo[slot] ?? weapon.magazine}/${weapon.magazine}`}${reloading ? ' · 장전 중' : ''}`;
}
function finish(scores) {
  if (mode !== 'game') return;
  mode = 'result'; resetInput(); document.exitPointerLock?.(); $('hud').hidden = true;
  const all = scores || [{ nickname: identity.nickname, kills: player.kills, deaths: player.deaths }, ...entities];
  $('result-scores').replaceChildren(...all.slice().sort((a, b) => b.kills - a.kills).map((p, i) => {
    const row = document.createElement('p'); row.textContent = `${i + 1}. ${p.nickname} · ${p.kills} 처치 / ${p.deaths} 사망`; return row;
  }));
  $('result').showModal();
}
$('result-close').addEventListener('click', async () => { $('result').close(); await leaveRoom(); });
$('result').addEventListener('cancel', event => { event.preventDefault(); $('result').close(); leaveRoom(); });
$('leave').addEventListener('click', () => { if (confirm('경기를 나가시겠습니까?')) leaveRoom(); });
function goHome() {
  mode = 'home'; resetInput(); clearEntities(); document.exitPointerLock?.();
  camera.fov = 75; camera.updateProjectionMatrix();
  $('hud').hidden = true; $('home').hidden = false; hand.visible = false;
}
function resetInput() {
  keys.clear(); fireHeld = false; aiming = false; shotRequested = false; reloadRequested = null; moveTouch = null; lookTouch = null; joystick = { x: 0, y: 0 };
  $('scope').hidden = true; $('joystick').firstElementChild.style.transform = '';
}
function origin() { return { x: player.x, y: player.y + (player.crouch ? 1.1 : 1.65), z: player.z }; }
function targeted() {
  const o = origin(), d = direction(player.yaw, player.pitch);
  let nearest = Math.min(WEAPONS[loadout[slot]].range, coverDistance(o, d)), target = null;
  for (const entity of entities) {
    if (entity.hp <= 0) continue;
    const distance = targetDistance(o, d, entity);
    if (distance < nearest) { nearest = distance; target = entity; }
  }
  return target;
}
function gunSound() {
  try {
    const AudioClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioClass) return;
    if (!audioContext) audioContext = new AudioClass();
    audioContext.resume().catch(error => console.warn('효과음 재생 제한', error));
    const oscillator = audioContext.createOscillator(), gain = audioContext.createGain(), t = audioContext.currentTime;
    oscillator.type = 'triangle'; oscillator.frequency.setValueAtTime(slot === 'melee' ? 220 : 95, t); oscillator.frequency.exponentialRampToValueAtTime(35, t + .12);
    gain.gain.setValueAtTime(.09, t); gain.gain.exponentialRampToValueAtTime(.001, t + .13);
    oscillator.connect(gain); gain.connect(audioContext.destination); oscillator.start(t); oscillator.stop(t + .14);
    oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
  } catch (error) { console.warn('효과음 오류', error); }
}
function shoot() {
  const now = performance.now() / 1000, weapon = WEAPONS[loadout[slot]];
  if (mode !== 'game' || dialogOpen() || player.hp <= 0 || now < nextShot || now < reloadEnds) return;
  if (online && networkBusy) { shotRequested = true; return; }
  shotRequested = false;
  if (slot !== 'melee' && ammo[slot] <= 0) { reload(); return; }
  nextShot = now + weapon.delay; recoil = .08; flash.intensity = slot === 'melee' ? 0 : 3; gunSound();
  if (online) {
    networkAction('fire', { slot, yaw: player.yaw, pitch: player.pitch });
  } else {
    if (slot !== 'melee') ammo[slot]--;
    const target = targeted();
    if (target && now >= target.protected) {
      target.hp = Math.max(0, target.hp - weapon.damage); $('game-status').textContent = '명중';
      if (target.hp === 0) { player.kills++; target.deaths++; target.respawn = now + 3; $('game-status').textContent = 'AI 처치'; }
    }
    updateHud();
  }
}
function reload() {
  const weapon = WEAPONS[loadout[slot]], now = performance.now() / 1000;
  if (player.hp <= 0 || slot === 'melee' || now < reloadEnds || ammo[slot] >= weapon.magazine) return;
  if (online) {
    if (networkBusy) reloadRequested = slot;
    else networkAction('reload', { slot });
  }
  else { reloadSlot = slot; reloadEnds = now + weapon.reload; updateHud(); }
}
function jump() {
  if (player.hp <= 0 || player.y > .01) return;
  velocityY = 5; jumpPending = true;
}
function crouch() { player.crouch = !player.crouch; $('crouch').setAttribute('aria-pressed', String(player.crouch)); }
function pressFire() { if (mode !== 'game') return; fireHeld = true; if (loadout[slot] === 'sniper') { aiming = true; $('scope').hidden = false; } else shoot(); }
function releaseFire(cancel = false) {
  if (aiming && !cancel) shoot();
  fireHeld = false; aiming = false; $('scope').hidden = true;
}
$('fire').addEventListener('pointerdown', event => { event.preventDefault(); $('fire').setPointerCapture(event.pointerId); pressFire(); });
$('fire').addEventListener('pointerup', () => releaseFire());
$('fire').addEventListener('pointercancel', () => releaseFire(true));
$('fire').addEventListener('click', event => { if (event.detail === 0) { pressFire(); releaseFire(); } });
$('jump').addEventListener('click', jump); $('crouch').addEventListener('click', crouch); $('reload').addEventListener('click', reload);
for (const button of document.querySelectorAll('[data-slot]')) button.addEventListener('click', () => equip(button.dataset.slot));
function turn(dx, dy) {
  player.yaw -= dx * .003 * settings.sensitivity * (aiming ? .4 : 1);
  player.yaw %= Math.PI * 2;
  player.pitch = Math.max(-1.4, Math.min(1.4, player.pitch - dy * .003 * settings.sensitivity * (aiming ? .4 : 1)));
}
document.addEventListener('keydown', event => {
  if (mode !== 'game' || dialogOpen() || event.target instanceof HTMLInputElement) return;
  if (['Space', 'KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(event.code)) event.preventDefault();
  keys.add(event.code);
  if (!event.repeat) {
    if (event.code === 'Space') jump();
    if (event.code === 'KeyC') crouch();
    if (event.code === 'KeyR') reload();
    if (['Digit1', 'Digit2', 'Digit3'].includes(event.code)) equip(['primary', 'secondary', 'melee'][Number(event.code.slice(-1)) - 1]);
  }
});
document.addEventListener('keyup', event => keys.delete(event.code));
window.addEventListener('blur', resetInput);
document.addEventListener('visibilitychange', () => { if (document.hidden) resetInput(); });
document.addEventListener('pointerlockchange', () => {
  $('capture-mouse').hidden = document.pointerLockElement === $('world'); releaseFire(true);
});
document.addEventListener('mousemove', event => {
  if (mode === 'game' && document.pointerLockElement === $('world') && !dialogOpen()) turn(event.movementX, event.movementY);
});
function captureMouse() {
  try { const request = $('world').requestPointerLock(); request?.catch(error => { $('game-status').textContent = `마우스 조준을 활성화하지 못했습니다: ${error.message}`; }); }
  catch (error) { $('game-status').textContent = error.message; }
}
$('capture-mouse').addEventListener('click', captureMouse);
document.addEventListener('pointerdown', event => {
  if (mode !== 'game' || dialogOpen() || event.button !== 0) return;
  if (event.pointerType === 'mouse' && event.target === $('world')) {
    if (document.pointerLockElement === $('world')) pressFire(); else captureMouse();
    return;
  }
  if (event.pointerType === 'mouse') return;
  if (event.target.closest('button') || (event.target !== $('world') && !event.target.closest('#joystick'))) return;
  if (event.clientX < innerWidth * .45 && !moveTouch) {
    moveTouch = { id: event.pointerId, x: event.clientX, y: event.clientY };
  } else if (!lookTouch) lookTouch = { id: event.pointerId, x: event.clientX, y: event.clientY };
  event.target.setPointerCapture(event.pointerId); event.preventDefault();
});
document.addEventListener('pointermove', event => {
  if (mode !== 'game' || dialogOpen()) return;
  if (moveTouch?.id === event.pointerId) {
    const dx = event.clientX - moveTouch.x, dy = event.clientY - moveTouch.y, radius = settings.controls.joystick.size / 2;
    const factor = Math.max(radius, Math.hypot(dx, dy));
    joystick = { x: dx / factor, y: dy / factor };
    $('joystick').firstElementChild.style.transform = `translate(${joystick.x * radius * .6}px,${joystick.y * radius * .6}px)`;
  }
  if (lookTouch?.id === event.pointerId) {
    turn(event.clientX - lookTouch.x, event.clientY - lookTouch.y);
    lookTouch.x = event.clientX; lookTouch.y = event.clientY;
  }
});
function endPointer(event) {
  if (event.pointerType === 'mouse') releaseFire(event.type === 'pointercancel');
  if (moveTouch?.id === event.pointerId) { moveTouch = null; joystick = { x: 0, y: 0 }; $('joystick').firstElementChild.style.transform = ''; }
  if (lookTouch?.id === event.pointerId) lookTouch = null;
}
document.addEventListener('pointerup', endPointer); document.addEventListener('pointercancel', endPointer);
function moveBody(body, dx, dz) {
  if (!blocked(body.x + dx, body.z)) body.x += dx;
  if (!blocked(body.x, body.z + dz)) body.z += dz;
}
function updateBots(dt, now) {
  for (const bot of entities) {
    if (bot.hp <= 0) {
      if (now >= bot.respawn) {
        const spawn = SPAWNS[Math.floor(Math.random() * SPAWNS.length)];
        Object.assign(bot, { x: spawn[0], z: spawn[1], hp: 100, protected: now + 2 });
      } else continue;
    }
    const dx = player.x - bot.x, dz = player.z - bot.z, dist = Math.hypot(dx, dz);
    bot.yaw = Math.atan2(-dx, -dz);
    if (dist > 10 && player.hp > 0) {
      let angle = Math.atan2(dz, dx);
      if (blocked(bot.x + Math.cos(angle), bot.z + Math.sin(angle))) angle += Math.sin(now + Number(bot.id.slice(3))) > 0 ? 1.5 : -1.5;
      moveBody(bot, Math.cos(angle) * dt * 2.6, Math.sin(angle) * dt * 2.6);
    }
    if (dist < 55 && player.hp > 0 && now > bot.nextShot && now > protectionEnds) {
      bot.nextShot = now + .8 + Math.random() * .5;
      const o = { x: bot.x, y: 1.65, z: bot.z }, diff = new THREE.Vector3(player.x - bot.x, origin().y - 1.65, player.z - bot.z).normalize();
      if (coverDistance(o, diff) > dist && Math.random() < .42) {
        player.hp = Math.max(0, player.hp - 12); $('game-status').textContent = player.hp ? 'AI에게 피격!' : '전투불능 · 3초 후 부활';
        if (player.hp === 0) { player.deaths++; bot.kills++; respawnAt = now + 3; releaseFire(true); }
        updateHud();
      }
    }
  }
}
function frame(time) {
  requestAnimationFrame(frame);
  if (!renderer) return;
  const dt = Math.min(.05, (time - lastFrame) / 1000), now = time / 1000; lastFrame = time;
  if (mode !== 'game') {
    hand.visible = false;
    return;
  } else {
    if (!online && now >= matchEnds) { finish(); return; }
    if (!online && player.hp <= 0 && now >= respawnAt) {
      const [x, z] = SPAWNS[(player.deaths + 2) % SPAWNS.length];
      Object.assign(player, { x, z, y: 0, hp: 100 }); velocityY = 0; protectionEnds = now + 2; resetAmmo(); reloadEnds = 0; $('game-status').textContent = ''; updateHud();
    }
    if (player.hp > 0 && !dialogOpen()) {
      const forward = Number(keys.has('KeyW')) - Number(keys.has('KeyS')) - joystick.y;
      const right = Number(keys.has('KeyD')) - Number(keys.has('KeyA')) + joystick.x;
      const norm = Math.max(1, Math.hypot(forward, right)), speed = (player.crouch ? 3 : 6) * dt;
      moveBody(player, (-Math.sin(player.yaw) * forward + Math.cos(player.yaw) * right) * speed / norm,
        (-Math.cos(player.yaw) * forward - Math.sin(player.yaw) * right) * speed / norm);
      player.y = Math.max(0, player.y + velocityY * dt); velocityY -= 10 * dt;
      if (player.y === 0) velocityY = 0;
      if (reloadRequested && !networkBusy) {
        const requestedSlot = reloadRequested; reloadRequested = null;
        networkAction('reload', { slot: requestedSlot });
      }
      if (fireHeld && WEAPONS[loadout[slot]].automatic) shoot();
      if (shotRequested && !networkBusy && !aiming) shoot();
      if (settings.autoFire && loadout[slot] !== 'sniper' && slot !== 'melee' && targeted()) shoot();
    }
    if (!online) {
      if (reloadEnds && now >= reloadEnds) { ammo[reloadSlot] = WEAPONS[loadout[reloadSlot]].magazine; reloadEnds = 0; updateHud(); }
      if (!dialogOpen()) updateBots(dt, now);
      else matchEnds += dt;
    } else if (time - lastNet > 200 && !networkBusy) {
      lastNet = time;
      const jump = jumpPending; jumpPending = false;
      networkAction('move', { x: player.x, z: player.z, yaw: player.yaw, pitch: player.pitch, crouch: player.crouch, jump, slot });
    }
    for (const entity of entities) {
      if (online) { entity.x += (entity.tx - entity.x) * Math.min(1, dt * 12); entity.z += (entity.tz - entity.z) * Math.min(1, dt * 12); }
      entity.body.visible = entity.hp > 0;
      entity.body.position.set(entity.x, entity.y, entity.z); entity.body.rotation.y = entity.yaw; entity.body.scale.y = entity.crouch ? .65 : 1;
    }
    camera.position.set(player.x, origin().y, player.z); camera.rotation.set(player.pitch, player.yaw, 0);
    const fov = aiming ? 28 : 75; if (camera.fov !== fov) { camera.fov = fov; camera.updateProjectionMatrix(); }
    hand.visible = player.hp > 0 && !aiming; hand.position.z = recoil; recoil *= Math.exp(-dt * 18); flash.intensity *= Math.exp(-dt * 25);
    $('timer').textContent = `${Math.floor(Math.max(0, matchEnds - now) / 60)}:${String(Math.floor(Math.max(0, matchEnds - now) % 60)).padStart(2, '0')}`;
  }
  renderer.render(scene, camera);
}
window.addEventListener('resize', () => {
  if (renderer) { renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); }
  applyControls();
});
window.addEventListener('pagehide', () => {
  if (room && identity) {
    fetch(`${endpoint}/soldier_api`, { method: 'POST', headers: { apikey: apiKey, Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_token: identity.token, p_action: 'leave', p_room: room.id }), keepalive: true }).catch(error => console.warn('방 나가기 전송 오류', error));
  }
});
drawRankBadge(0, '이등병'); buildSettings(); applyControls();
if (renderer) { connect(); requestAnimationFrame(frame); }
