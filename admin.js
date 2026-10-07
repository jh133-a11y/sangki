const SUPABASE_URL = 'https://ejrwrwjsgizzxhqybtff.supabase.co';
const SUPABASE_KEY = 'sb_publishable_Mr64z4NO3wlqeKObCxLbBQ_HlhvG7D8';
const rpcEndpoint = `${SUPABASE_URL}/rest/v1/rpc`;
const apiHeaders = {
  apikey: SUPABASE_KEY,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json'
};

const adminItemIcons = {
  low_missile: '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="m7 36 21-21 6 6-21 21H7v-6Z" fill="#d9ff36" stroke="#171717" stroke-width="2.5"/><path d="m31 18 6-6 6 6-6 6" fill="none" stroke="#171717" stroke-width="3"/><path d="m12 42-5 5m12-5-5 5" stroke="#ff5b36" stroke-width="3"/></svg>',
  mid_missile: '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="m5 36 25-25 8 8-25 25H5v-8Z" fill="#ffb02e" stroke="#171717" stroke-width="2.5"/><path d="m32 15 6-6 7 7-6 6" fill="none" stroke="#171717" stroke-width="3"/><path d="m10 43-5 5m13-5-5 5" stroke="#ff5b36" stroke-width="3"/></svg>',
  high_missile: '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="m3 36 28-28 10 10-28 28H3V36Z" fill="#ff5b36" stroke="#171717" stroke-width="2.5"/><path d="m34 14 6-6 7 7-6 6" fill="none" stroke="#171717" stroke-width="3"/><path d="m8 44-5 5m14-5-5 5" stroke="#d9ff36" stroke-width="3"/></svg>',
  nuclear_missile: '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M5 35 27 13l10 10-22 22H5v-10Z" fill="#b9c0c8" stroke="#171717" stroke-width="2.5"/><path d="M29 11c4-5 10-7 15-6-1 5-3 10-8 13" fill="#d9ff36" stroke="#171717" stroke-width="2.5"/><path d="m9 43-5 5m13-5-5 5" stroke="#ff5b36" stroke-width="3"/></svg>',
  missile_shield: '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M24 4 40 10v12c0 10-6 17-16 22C14 39 8 32 8 22V10l16-6Z" fill="#8ed8d2" stroke="#171717" stroke-width="2.5"/><path d="m15 24 6 6 12-13" fill="none" stroke="#d9ff36" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  nickname_ticket: '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M7 12h34v24H7z" fill="#d9ff36" stroke="#171717" stroke-width="2.5"/><path d="M15 12v24M33 12v24" stroke="#171717" stroke-width="2" stroke-dasharray="3 3"/><path d="M20 20h8M20 25h8M20 30h5" stroke="#ff5b36" stroke-width="2.5" stroke-linecap="round"/></svg>',
  letter: '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M5 11h38v27H5z" fill="#8ed8d2" stroke="#171717" stroke-width="2.5"/><path d="m6 13 18 14 18-14M6 36l13-13m23 13L29 23" fill="none" stroke="#171717" stroke-width="2.5"/><path d="M35 5v10M30 10h10" stroke="#ff5b36" stroke-width="2.5"/></svg>',
  megaphone: '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="m8 25 24-9v16L8 23Z" fill="#ff5b36" stroke="#171717" stroke-width="2.5"/><path d="M32 16h7v16h-7M13 24l3 15h6l-3-14M39 20c4 2 4 7 0 9" fill="none" stroke="#171717" stroke-width="2.5" stroke-linejoin="round"/></svg>',
  normal_potion: '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M18 5h12M20 5v9L10 25v14a4 4 0 0 0 4 4h20a4 4 0 0 0 4-4V25L28 14V5" fill="#e8f7ff" stroke="#171717" stroke-width="2.5"/><path d="M10 29h28v10a4 4 0 0 1-4 4H14a4 4 0 0 1-4-4Z" fill="#398fe5"/></svg>',
  advanced_potion: '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M18 5h12M20 5v9L10 25v14a4 4 0 0 0 4 4h20a4 4 0 0 0 4-4V25L28 14V5" fill="#fff8d0" stroke="#171717" stroke-width="2.5"/><path d="M10 29h28v10a4 4 0 0 1-4 4H14a4 4 0 0 1-4-4Z" fill="#e6a62f"/></svg>',
  legendary_potion: '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M18 5h12M20 5v9L10 25v14a4 4 0 0 0 4 4h20a4 4 0 0 0 4-4V25L28 14V5" fill="#f3e7ff" stroke="#171717" stroke-width="2.5"/><path d="M10 29h28v10a4 4 0 0 1-4 4H14a4 4 0 0 1-4-4Z" fill="#8b3fd6"/></svg>',
  sanggi_hanbok: '<img src="sanggi-hanbok.png" alt="" aria-hidden="true">',
  sanggi_spacesuit: '<img src="sanggi-spacesuit.png" alt="" aria-hidden="true">',
  juseong_hanbok: '<img src="juseong-hanbok.png" alt="" aria-hidden="true">',
  juseong_spacesuit: '<img src="juseong-spacesuit.png" alt="" aria-hidden="true">',
  cash_box: '<span class="bag-cash-box-icon">₩</span>',
  weird_cash_box: '<span class="bag-cash-box-icon bag-cash-box-weird">?</span>'
  ,gambling_box: '<span class="bag-cash-box-icon bag-cash-box-gamble">?</span>'
};

const itemDefinitions = [
  ['low_missile', '하급 미사일'], ['mid_missile', '중급 미사일'],
  ['high_missile', '고급 미사일'], ['nuclear_missile', '핵 미사일'],
  ['missile_shield', '미사일 방어막'], ['nickname_ticket', '닉네임 변경권'],
  ['letter', '편지'], ['normal_potion', '일반 물약'],
  ['gambling_box', '도박 중독자 상자'],
  ['megaphone', '확성기'],
  ['advanced_potion', '고급 물약'], ['legendary_potion', '전설 물약'],
  ['sanggi_hanbok', '상기 한복'], ['sanggi_spacesuit', '상기 우주복'],
  ['juseong_hanbok', '주성 한복'], ['juseong_spacesuit', '주성 우주복'],
  ['cash_box', '랜덤 현금 박스'], ['weird_cash_box', '이상한 랜덤 현금 박스']
];

const itemGrid = document.querySelector('#admin-item-grid');
const targetUser = document.querySelector('#admin-target-user');
const quantityInput = document.querySelector('#admin-grant-quantity');
const messageInput = document.querySelector('#admin-grant-message');
const selectedItemLabel = document.querySelector('#admin-selected-item');
const grantForm = document.querySelector('#admin-grant-form');
const grantAllButton = document.querySelector('#admin-grant-all');
const removeTargetButton = document.querySelector('#admin-remove-target');
const status = document.querySelector('#admin-status');
let selectedItemType = '';
let adminPassword = sessionStorage.getItem('sangki-admin-auth') || '';

const callRpc = async (name, payload) => {
  const response = await fetch(`${rpcEndpoint}/${name}`, {
    method: 'POST',
    headers: apiHeaders,
    body: JSON.stringify(payload)
  });
  const result = await response.json();
  if (!response.ok) {
    throw new Error(result.message || result.details || result.hint || '관리자 요청에 실패했습니다.');
  }
  return result;
};

const renderItems = () => {
  itemGrid.replaceChildren(...itemDefinitions.map(([type, name]) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'admin-item-card';
    button.dataset.itemType = type;
    const icon = document.createElement('span');
    icon.className = 'admin-item-visual';
    icon.innerHTML = adminItemIcons[type];
    const label = document.createElement('strong');
    label.textContent = name;
    button.append(icon, label);
    button.addEventListener('click', () => {
      selectedItemType = type;
      selectedItemLabel.textContent = name;
      itemGrid.querySelectorAll('.admin-item-card').forEach((item) => {
        item.classList.toggle('is-selected', item === button);
      });
    });
    return button;
  }));
};

const updateRemoveButtonLabel = () => {
  removeTargetButton.textContent = targetUser.value
    ? '선택 유저에게서 차감'
    : '모든 유저에게서 차감';
};

const loadUsers = async () => {
  if (!adminPassword) adminPassword = window.prompt('관리자 비밀번호를 입력하세요.') || '';
  if (!adminPassword) throw new Error('관리자 비밀번호가 필요합니다.');
  const users = await callRpc('investment_admin_get_users', {
    p_admin_password: adminPassword
  });
  targetUser.replaceChildren(new Option('모든 유저', ''));
  users.forEach((user) => {
    targetUser.append(new Option(
      user.nickname || '닉네임 없음',
      user.client_id
    ));
  });
  updateRemoveButtonLabel();
};

const grantItems = async (targetClientId) => {
  if (!selectedItemType) throw new Error('지급할 아이템을 선택하세요.');
  const quantity = Number(quantityInput.value);
  if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 1000000) {
    throw new Error('수량은 1개 이상 1,000,000개 이하로 입력하세요.');
  }
  const message = messageInput.value.trim();
  if (!message) throw new Error('전달할 메시지를 입력하세요.');
  const result = await callRpc('investment_admin_grant_item', {
    p_admin_password: adminPassword,
    p_target_client_id: targetClientId || null,
    p_item_type: selectedItemType,
    p_quantity: quantity,
    p_message: message
  });
  status.textContent = `${result.user_count}명에게 지급했습니다.`;
  messageInput.value = '';
};

const removeItems = async (targetClientId) => {
  if (!selectedItemType) throw new Error('차감할 아이템을 선택하세요.');
  const quantity = Number(quantityInput.value);
  if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 1000000) {
    throw new Error('수량은 1개 이상 1,000,000개 이하로 입력하세요.');
  }
  const message = messageInput.value.trim();
  if (!message) throw new Error('전달할 메시지를 입력하세요.');
  const normalizedTargetClientId = targetClientId.trim() || null;
  await callRpc('investment_admin_remove_item', {
    p_admin_password: adminPassword,
    p_target_client_id: normalizedTargetClientId,
    p_item_type: selectedItemType,
    p_quantity: quantity,
    p_message: message
  });
  status.textContent = normalizedTargetClientId
    ? '선택한 유저의 아이템을 차감했습니다.'
    : '모든 유저의 아이템을 차감했습니다.';
  messageInput.value = '';
};

grantForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  grantForm.querySelectorAll('button').forEach((button) => { button.disabled = true; });
  status.textContent = '지급 처리 중...';
  try {
    await grantItems(targetUser.value);
  } catch (error) {
    status.textContent = error.message;
    if (error.message.includes('비밀번호')) sessionStorage.removeItem('sangki-admin-auth');
  } finally {
    grantForm.querySelectorAll('button').forEach((button) => { button.disabled = false; });
  }
});

removeTargetButton.addEventListener('click', async () => {
  grantForm.querySelectorAll('button').forEach((button) => { button.disabled = true; });
  status.textContent = '차감 처리 중...';
  try {
    await removeItems(targetUser.value);
  } catch (error) {
    status.textContent = error.message;
    if (error.message.includes('비밀번호')) sessionStorage.removeItem('sangki-admin-auth');
  } finally {
    grantForm.querySelectorAll('button').forEach((button) => { button.disabled = false; });
  }
});

targetUser.addEventListener('change', updateRemoveButtonLabel);

grantAllButton.addEventListener('click', async () => {
  targetUser.value = '';
  grantForm.requestSubmit();
});

renderItems();
loadUsers().catch((error) => {
  status.textContent = error.message;
  sessionStorage.removeItem('sangki-admin-auth');
});
