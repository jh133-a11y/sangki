const SUPABASE_URL = 'https://ejrwrwjsgizzxhqybtff.supabase.co';
const SUPABASE_KEY = 'sb_publishable_Mr64z4NO3wlqeKObCxLbBQ_HlhvG7D8';
const rpcEndpoint = `${SUPABASE_URL}/rest/v1/rpc`;
const apiHeaders = { apikey: SUPABASE_KEY, Authorization: 'Bearer ' + SUPABASE_KEY };
const $ = (selector) => document.querySelector(selector);
const backdrop = $('#records-backdrop');
const modalIds = ['records-post-modal', 'records-comment-modal', 'records-notice-modal'];
const page = document.body;
let posts = [];
let notices = [];
let activeTab = 'all';
let adminPassword = '';

const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
}[char]));

const hashPassword = async (password) => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(password));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
};

const rpc = async (name, payload = {}) => {
  const response = await fetch(`${rpcEndpoint}/${name}`, {
    method: 'POST',
    headers: { ...apiHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const result = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(result?.message || result?.hint || result?.details || '요청을 처리하지 못했습니다.');
  }
  return result;
};

const formatDate = (value) => {
  const date = new Date(value);
  const now = new Date();
  return date.toDateString() === now.toDateString()
    ? date.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })
    : date.toLocaleDateString('ko-KR', { month: '2-digit', day: '2-digit' });
};

const openModal = (id) => {
  modalIds.forEach((modalId) => { $(`#${modalId}`).hidden = modalId !== id; });
  const isComposer = id === 'records-post-modal';
  page.classList.toggle('records-writing', isComposer);
  backdrop.hidden = isComposer;
};

const closeModals = () => {
  modalIds.forEach((id) => { $(`#${id}`).hidden = true; });
  backdrop.hidden = true;
  page.classList.remove('records-writing');
};

const setStatus = (id, message) => { $(`#${id}`).textContent = message || ''; };

const filteredPosts = () => activeTab === 'notice' ? [] : posts;

const renderNotices = () => {
  $('#records-notices').innerHTML = activeTab === 'general' ? '' : notices.map((notice, index) => `
    <article class="records-row records-notice-row">
      <span>${index + 1}</span>
      <span>공지</span>
      <div class="records-title-cell">
        <strong>${escapeHtml(notice.title)}</strong>
        <p>${escapeHtml(notice.body)}</p>
      </div>
      <span>운영자</span>
      <time>${formatDate(notice.created_at)}</time>
      <span>-</span>
      <span>-</span>
      ${adminPassword ? `<div class="records-row-actions">
        <button data-notice-edit="${notice.id}" type="button">수정</button>
        <button data-notice-delete="${notice.id}" type="button">삭제</button>
      </div>` : ''}
    </article>`).join('');
};

const renderPosts = () => {
  const visiblePosts = filteredPosts();
  $('#records-count').textContent = `${posts.length + notices.length}개`;
  $('#records-list').innerHTML = visiblePosts.length ? visiblePosts.map((post, index) => `
    <article class="records-post-group" data-post-id="${post.id}">
      <div class="records-row">
        <span>${posts.length - index}</span>
        <span>일반</span>
        <div class="records-title-cell">
          <strong>${escapeHtml(post.title)} <em>${post.comment_count ? `[${post.comment_count}]` : ''}</em></strong>
          <p>${escapeHtml(post.body)}</p>
        </div>
        <span>${escapeHtml(post.nickname)}</span>
        <time>${formatDate(post.created_at)}</time>
        <span>-</span>
        <span>${post.upvotes}</span>
      </div>
      <div class="records-row-actions">
        <button data-vote="1" type="button">추천 ${post.upvotes}</button>
        <button data-vote="-1" type="button">비추천 ${post.downvotes}</button>
        <button data-comment="${post.id}" type="button">댓글 ${post.comment_count}</button>
        <button data-edit="${post.id}" type="button">수정</button>
        <button data-delete="${post.id}" type="button">삭제</button>
      </div>
      <div class="record-comments" id="comments-${post.id}"></div>
    </article>`).join('') : '<p class="records-empty">표시할 게시물이 없습니다.</p>';
  visiblePosts.forEach((post) => loadComments(post.id));
};

const loadComments = async (postId) => {
  try {
    const comments = await rpc('record_get_comments', { p_post_id: postId });
    const container = $(`#comments-${postId}`);
    if (!container) return;
    const render = (parentId, depth = 0) => comments
      .filter((comment) => comment.parent_id === parentId)
      .map((comment) => `
        <div class="record-comment ${depth ? 'is-reply' : ''}">
          <div><strong>${escapeHtml(comment.nickname)}</strong><time>${formatDate(comment.created_at)}</time></div>
          <p>${escapeHtml(comment.body)}</p>
          <div class="record-comment-actions">
            <button data-reply="${postId}" data-parent="${comment.id}" type="button">답글</button>
            <button data-comment-edit="${comment.id}" type="button">수정</button>
            <button data-comment-delete="${comment.id}" type="button">삭제</button>
          </div>
          ${render(comment.id, depth + 1)}
        </div>`).join('');
    container.innerHTML = render(null);
  } catch (error) {
    $('#records-status').textContent = error.message;
  }
};

const loadBoard = async () => {
  const result = await rpc('record_get_board');
  posts = Array.isArray(result.posts) ? result.posts : [];
  notices = Array.isArray(result.notices) ? result.notices : [];
  renderNotices();
  renderPosts();
};

document.querySelectorAll('.records-tabs button').forEach((button, index) => {
  button.addEventListener('click', () => {
    activeTab = ['all', 'general', 'notice'][index];
    document.querySelectorAll('.records-tabs button').forEach((item) => item.classList.toggle('is-active', item === button));
    renderNotices();
    renderPosts();
  });
});

$('#records-write-button').addEventListener('click', () => {
  $('#records-post-form').reset();
  $('#records-post-id').value = '';
  $('#records-post-title').textContent = '글쓰기';
  setStatus('records-post-form-status', '');
  openModal('records-post-modal');
});

$('#records-post-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const payload = {
    p_nickname: $('#records-post-nickname').value.trim(),
    p_password_hash: await hashPassword($('#records-post-password').value),
    p_title: $('#records-post-subject').value.trim(),
    p_body: $('#records-post-body').value.trim()
  };
  try {
    await rpc('record_create_post', payload);
    closeModals();
    await loadBoard();
  } catch (error) {
    setStatus('records-post-form-status', error.message);
  }
});

$('#records-comment-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const payload = {
    p_post_id: $('#records-comment-post-id').value,
    p_parent_id: $('#records-comment-parent-id').value || null,
    p_nickname: $('#records-comment-nickname').value.trim(),
    p_password_hash: await hashPassword($('#records-comment-password').value),
    p_body: $('#records-comment-body').value.trim()
  };
  try {
    await rpc('record_create_comment', payload);
    closeModals();
    await loadBoard();
  } catch (error) {
    setStatus('records-comment-form-status', error.message);
  }
});

$('#records-notice-button').addEventListener('click', () => {
  const password = prompt('공지 작성은 관리자만 할 수 있습니다. 관리자 비밀번호를 입력하세요.');
  if (password !== '8170') {
    if (password !== null) alert('관리자 비밀번호가 올바르지 않습니다.');
    return;
  }
  adminPassword = password;
  $('#records-notice-form').reset();
  $('#records-notice-id').value = '';
  setStatus('records-notice-form-status', '');
  openModal('records-notice-modal');
});

$('#records-notice-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    const noticeId = $('#records-notice-id').value;
    const payload = noticeId
      ? { p_id: noticeId, p_admin_password: adminPassword, p_title: $('#records-notice-subject').value.trim(), p_body: $('#records-notice-body').value.trim() }
      : { p_admin_password: adminPassword, p_title: $('#records-notice-subject').value.trim(), p_body: $('#records-notice-body').value.trim() };
    await rpc(noticeId ? 'record_update_notice' : 'record_create_notice', payload);
    closeModals();
    await loadBoard();
  } catch (error) {
    setStatus('records-notice-form-status', error.message);
  }
});

document.addEventListener('click', async (event) => {
  const button = event.target.closest('button');
  if (!button) return;
  if (button.hasAttribute('data-close-modal')) {
    closeModals();
    return;
  }
  const post = posts.find((item) => item.id === button.closest('[data-post-id]')?.dataset.postId);
  try {
    if (button.dataset.vote && post) {
      const key = localStorage.getItem('records-voter-key') || crypto.randomUUID();
      localStorage.setItem('records-voter-key', key);
      await rpc('record_vote_post', { p_post_id: post.id, p_voter_key: key, p_vote: Number(button.dataset.vote) });
      await loadBoard();
    } else if (button.dataset.comment) {
      $('#records-comment-form').reset();
      $('#records-comment-post-id').value = button.dataset.comment;
      $('#records-comment-parent-id').value = '';
      openModal('records-comment-modal');
    } else if (button.dataset.reply) {
      $('#records-comment-form').reset();
      $('#records-comment-post-id').value = button.dataset.reply;
      $('#records-comment-parent-id').value = button.dataset.parent;
      openModal('records-comment-modal');
    } else if (button.dataset.delete && post) {
      const password = prompt('게시물 비밀번호 또는 관리자 비밀번호를 입력하세요.');
      if (password !== null && confirm('게시물을 삭제할까요?')) {
        await rpc('record_delete_post', { p_id: post.id, p_password_hash: await hashPassword(password), p_admin_password: password });
        await loadBoard();
      }
    } else if (button.dataset.edit && post) {
      const password = prompt('게시물 비밀번호를 입력하세요.');
      if (password === null) return;
      const title = prompt('제목을 입력하세요.', post.title);
      const body = prompt('내용을 입력하세요.', post.body);
      if (title !== null && body !== null) {
        await rpc('record_update_post', { p_id: post.id, p_password_hash: await hashPassword(password), p_title: title, p_body: body });
        await loadBoard();
      }
    } else if (button.dataset.noticeDelete) {
      const password = prompt('관리자 비밀번호를 입력하세요.');
      if (password === '8170' && confirm('공지를 삭제할까요?')) {
        await rpc('record_delete_notice', { p_id: button.dataset.noticeDelete, p_admin_password: password });
        await loadBoard();
      }
    } else if (button.dataset.noticeEdit) {
      const password = prompt('관리자 비밀번호를 입력하세요.');
      if (password !== '8170') return;
      adminPassword = password;
      const notice = notices.find((item) => item.id === button.dataset.noticeEdit);
      $('#records-notice-id').value = notice.id;
      $('#records-notice-subject').value = notice.title;
      $('#records-notice-body').value = notice.body;
      openModal('records-notice-modal');
    } else if (button.dataset.commentEdit) {
      const password = prompt('댓글 비밀번호를 입력하세요.');
      const body = prompt('댓글 내용을 입력하세요.');
      if (password !== null && body !== null) {
        await rpc('record_update_comment', { p_id: button.dataset.commentEdit, p_password_hash: await hashPassword(password), p_body: body });
        await loadBoard();
      }
    } else if (button.dataset.commentDelete) {
      const password = prompt('댓글 비밀번호 또는 관리자 비밀번호를 입력하세요.');
      if (password !== null && confirm('댓글을 삭제할까요?')) {
        await rpc('record_delete_comment', { p_id: button.dataset.commentDelete, p_password_hash: await hashPassword(password), p_admin_password: password });
        await loadBoard();
      }
    }
  } catch (error) {
    $('#records-status').textContent = error.message;
  }
});

backdrop.addEventListener('click', closeModals);
loadBoard().catch((error) => {
  $('#records-status').textContent = error.message;
  $('#records-list').innerHTML = '<p class="records-empty">게시판을 불러오지 못했습니다. Supabase SQL 적용 여부를 확인하세요.</p>';
});
