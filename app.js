const SUPABASE_URL = 'https://ejrwrwjsgizzxhqybtff.supabase.co';
const SUPABASE_KEY = 'sb_publishable_Mr64z4NO3wlqeKObCxLbBQ_HlhvG7D8';
const commentsEndpoint = `${SUPABASE_URL}/rest/v1/comments`;
const rpcEndpoint = `${SUPABASE_URL}/rest/v1/rpc`;
const apiHeaders = {
  apikey: SUPABASE_KEY,
  Authorization: `Bearer ${SUPABASE_KEY}`
};

document.querySelectorAll('a[href^="#"]').forEach((link) => {
  link.addEventListener('click', (event) => {
    const target = document.querySelector(link.getAttribute('href'));

    if (target) {
      event.preventDefault();
      target.scrollIntoView({ behavior: 'smooth' });
    }
  });
});

const form = document.querySelector('#comment-form');
const comments = document.querySelector('#comments');
const status = document.querySelector('#form-status');
const refreshButton = document.querySelector('#comments-refresh');
const pagination = document.querySelector('#comments-pagination');
const COMMENTS_PER_PAGE = 10;
let currentPage = 1;
let allComments = [];

const escapeDate = (value) => new Intl.DateTimeFormat('ko-KR', {
  dateStyle: 'medium',
  timeStyle: 'short'
}).format(new Date(value));

const renderComment = (item, isReply = false) => {
  const article = document.createElement('article');
  article.className = isReply ? 'comment comment-reply' : 'comment';
  article.innerHTML = `
    <strong class="comment-author"></strong>
    <p class="comment-body"></p>
    <div class="comment-meta">
      <time class="comment-date"></time>
      <span class="edited"></span>
      <div class="comment-actions">
        <button class="comment-action" type="button" data-action="reply">답글</button>
        <button class="comment-action" type="button" data-action="edit">수정</button>
        <button class="comment-action" type="button" data-action="delete">삭제</button>
      </div>
    </div>
  `;
  article.querySelector('.comment-author').textContent = item.nickname;
  article.querySelector('.comment-body').textContent = item.body;
  article.querySelector('.comment-date').textContent = escapeDate(item.created_at);
  article.querySelector('.edited').textContent = item.edited_at ? '(edited)' : '';
  const replyButton = article.querySelector('[data-action="reply"]');
  if (isReply) {
    replyButton.remove();
  } else {
    replyButton.addEventListener('click', () => addReply(item.id));
  }
  article.querySelector('[data-action="edit"]').addEventListener('click', () => editComment(item));
  article.querySelector('[data-action="delete"]').addEventListener('click', () => deleteComment(item.id));
  return article;
};

const renderComments = (items) => {
  if (!items.length) {
    comments.innerHTML = '<p class="comments-empty">아직 남겨진 흔적이 없습니다. 첫 번째 댓글을 남겨보세요.</p>';
    pagination.replaceChildren();
    return;
  }

  const rootComments = items
    .filter((item) => !item.parent_id)
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  const totalPages = Math.ceil(rootComments.length / COMMENTS_PER_PAGE);
  currentPage = Math.min(currentPage, totalPages);
  const pageStart = (currentPage - 1) * COMMENTS_PER_PAGE;
  const pageItems = rootComments.slice(pageStart, pageStart + COMMENTS_PER_PAGE);
  const replies = new Map();
  items.filter((item) => item.parent_id).forEach((item) => {
    if (!replies.has(item.parent_id)) replies.set(item.parent_id, []);
    replies.get(item.parent_id).push(item);
  });
  const nodes = [];
  pageItems.forEach((item) => {
    nodes.push(renderComment(item));
    (replies.get(item.id) || [])
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .forEach((reply) => nodes.push(renderComment(reply, true)));
  });
  comments.replaceChildren(...nodes);
  renderPagination(totalPages);
};

const renderPagination = (totalPages) => {
  if (totalPages <= 1) {
    pagination.replaceChildren();
    return;
  }

  const previous = document.createElement('button');
  previous.className = 'comments-page-button';
  previous.type = 'button';
  previous.textContent = '← 이전';
  previous.disabled = currentPage === 1;
  previous.addEventListener('click', () => {
    currentPage -= 1;
    renderComments(allComments);
  });

  const number = document.createElement('span');
  number.className = 'comments-page-number';
  number.textContent = `${currentPage} / ${totalPages}`;

  const next = document.createElement('button');
  next.className = 'comments-page-button';
  next.type = 'button';
  next.textContent = '다음 →';
  next.disabled = currentPage === totalPages;
  next.addEventListener('click', () => {
    currentPage += 1;
    renderComments(allComments);
  });

  pagination.replaceChildren(previous, number, next);
};

const loadComments = async () => {
  try {
    const response = await fetch(`${commentsEndpoint}?select=id,nickname,body,created_at,edited_at,parent_id&order=created_at.asc`, {
      headers: apiHeaders
    });
    if (!response.ok) throw new Error('댓글을 불러오지 못했습니다.');
    allComments = await response.json();
    renderComments(allComments);
  } catch (error) {
    comments.innerHTML = '<p class="comments-empty">댓글을 불러오지 못했습니다. 잠시 후 다시 확인해주세요.</p>';
  }
};

const addReply = async (parentId) => {
  const nickname = window.prompt('답글 작성자의 닉네임을 입력하세요.');
  if (nickname === null || !nickname.trim()) return;
  const password = requestPassword();
  if (password === null) return;
  const body = window.prompt('답글을 입력하세요.');
  if (body === null || !body.trim()) return;

  try {
    const response = await fetch(commentsEndpoint, {
      method: 'POST',
      headers: { ...apiHeaders, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({
        nickname: nickname.trim(),
        body: body.trim(),
        password_hash: await hashPassword(password),
        parent_id: parentId
      })
    });
    if (!response.ok) throw new Error('답글 저장에 실패했습니다.');
    await loadComments();
  } catch (error) {
    window.alert(error.message);
  }
};

const requestPassword = () => {
  const password = window.prompt('댓글의 4자리 비밀번호를 입력하세요.');
  if (password === null) return null;
  if (!/^\d{4}$/.test(password)) {
    window.alert('비밀번호는 숫자 4자리여야 합니다.');
    return null;
  }
  return password;
};

const callCommentRpc = async (name, payload) => {
  const response = await fetch(`${rpcEndpoint}/${name}`, {
    method: 'POST',
    headers: { ...apiHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!response.ok) throw new Error('비밀번호가 틀렸거나 요청에 실패했습니다.');
  return response.json();
};

refreshButton.addEventListener('click', async () => {
  refreshButton.disabled = true;
  refreshButton.textContent = '불러오는 중...';
  await loadComments();
  refreshButton.disabled = false;
  refreshButton.textContent = '새로고침 ↻';
});

const editComment = async (item) => {
  const password = requestPassword();
  if (password === null) return;
  const body = window.prompt('수정할 댓글을 입력하세요.', item.body);
  if (body === null || !body.trim()) return;

  try {
    const updated = await callCommentRpc('update_comment', {
      p_id: item.id,
      p_password_hash: await hashPassword(password),
      p_body: body
    });
    if (!updated) throw new Error('비밀번호가 틀렸거나 댓글을 수정할 수 없습니다.');
    await loadComments();
  } catch (error) {
    window.alert(error.message);
  }
};

const deleteComment = async (id) => {
  const password = requestPassword();
  if (password === null) return;
  const isAdmin = password === '8170';
  if (!window.confirm(isAdmin ? '관리자 권한으로 모든 댓글을 삭제할까요?' : '이 댓글을 삭제할까요?')) return;

  try {
    const deleted = await callCommentRpc('delete_comment', {
      p_id: id,
      p_password_hash: await hashPassword(password),
      p_admin_password: password
    });
    if (!deleted) throw new Error('비밀번호가 틀렸거나 댓글을 삭제할 수 없습니다.');
    await loadComments();
  } catch (error) {
    window.alert(error.message);
  }
};

const hashPassword = async (password) => {
  const data = new TextEncoder().encode(password);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('');
};

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const submit = form.querySelector('button');
  const formData = new FormData(form);
  const password = formData.get('password');
  submit.disabled = true;
  status.textContent = '저장하는 중...';

  try {
    const response = await fetch(commentsEndpoint, {
      method: 'POST',
      headers: {
        ...apiHeaders,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal'
      },
      body: JSON.stringify({
        nickname: formData.get('nickname').trim(),
        body: formData.get('comment').trim(),
        password_hash: await hashPassword(password)
      })
    });
    if (!response.ok) throw new Error('댓글 저장에 실패했습니다.');
    form.reset();
    status.textContent = '댓글이 저장되었습니다.';
    currentPage = 1;
    await loadComments();
  } catch (error) {
    status.textContent = error.message;
  } finally {
    submit.disabled = false;
  }
});

loadComments();
