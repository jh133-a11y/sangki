const SUPABASE_URL = 'https://ejrwrwjsgizzxhqybtff.supabase.co';
const SUPABASE_KEY = 'sb_publishable_Mr64z4NO3wlqeKObCxLbBQ_HlhvG7D8';
const rpcEndpoint = `${SUPABASE_URL}/rest/v1/rpc`;
const apiHeaders = {
  apikey: SUPABASE_KEY,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json'
};

const itemDefinitions = [
  ['low_missile', '하급 미사일', '▰', '아이콘'],
  ['mid_missile', '중급 미사일', '◈', '아이콘'],
  ['high_missile', '고급 미사일', '◆', '아이콘'],
  ['nuclear_missile', '핵 미사일', '☢', '아이콘'],
  ['missile_shield', '미사일 방어막', '◇', '아이콘'],
  ['nickname_ticket', '닉네임 변경권', '✂', '아이콘'],
  ['letter', '편지', '✉', '아이콘'],
  ['normal_potion', '일반 물약', '●', '아이콘'],
  ['advanced_potion', '고급 물약', '●', '아이콘'],
  ['legendary_potion', '전설 물약', '●', '아이콘'],
  ['sanggi_hanbok', '상기 한복', 'sanggi-hanbok.png', '이미지'],
  ['sanggi_spacesuit', '상기 우주복', 'sanggi-spacesuit.png', '이미지'],
  ['juseong_hanbok', '주성 한복', 'juseong-hanbok.png', '이미지'],
  ['juseong_spacesuit', '주성 우주복', 'juseong-spacesuit.png', '이미지'],
  ['cash_box', '랜덤 현금 박스', '₩', '아이콘'],
  ['weird_cash_box', '이상한 랜덤 현금 박스', '?', '아이콘']
];

const itemGrid = document.querySelector('#admin-item-grid');
const targetUser = document.querySelector('#admin-target-user');
const quantityInput = document.querySelector('#admin-grant-quantity');
const messageInput = document.querySelector('#admin-grant-message');
const selectedItemLabel = document.querySelector('#admin-selected-item');
const grantForm = document.querySelector('#admin-grant-form');
const grantAllButton = document.querySelector('#admin-grant-all');
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
  itemGrid.replaceChildren(...itemDefinitions.map(([type, name, visual, visualType]) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'admin-item-card';
    button.dataset.itemType = type;
    const icon = document.createElement('span');
    icon.className = `admin-item-visual ${visualType === '이미지' ? 'is-image' : ''}`;
    if (visualType === '이미지') {
      const image = document.createElement('img');
      image.src = visual;
      image.alt = '';
      icon.append(image);
    } else {
      icon.textContent = visual;
    }
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

grantAllButton.addEventListener('click', async () => {
  targetUser.value = '';
  grantForm.requestSubmit();
});

renderItems();
loadUsers().catch((error) => {
  status.textContent = error.message;
  sessionStorage.removeItem('sangki-admin-auth');
});
