const SUPABASE_URL = 'https://ejrwrwjsgizzxhqybtff.supabase.co';
const SUPABASE_KEY = 'sb_publishable_Mr64z4NO3wlqeKObCxLbBQ_HlhvG7D8';
const rpcEndpoint = `${SUPABASE_URL}/rest/v1/rpc`;
const apiHeaders = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` };

const $ = (selector) => document.querySelector(selector);
const backdrop = $('#records-backdrop');
const status = $('#records-status');
const modalIds = ['records-post-modal', 'records-comment-modal', 'records-notice-modal'];
let posts = [];
let notices = [];
let adminPassword = '';

const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
}[char]));

const hashPassword = async (password) => {
  const bytes = new TextEncoder().encode(password);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
};

const rpc = async (name, payload = {}) => {
  const response = await fetch(`${rpcEndpoint}/${name}`, {
    method: 'POST',
    headers: { ...apiHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const result = await response.json().catch(() => null);
  if (!response.ok) throw new Error(result?.message || result?.hint || result?.details || '요청을 처리하지 못했습니다.');
  return result;
};

const openModal = (id) => {
  modalIds.forEach((modalId) => { $(`#${modalId}`).hidden = modalId !== id; });
  backdrop.hidden = false;
};
const closeModals = () => {
  modalIds.forEach((id) => { $(`#${id}`).hidden = true; });
  backdrop.hidden = true;
};
const setFormStatus = (id, message) => { $(`#${id}`).textContent = message || ''; };
const formatDate = (value) => new Date(value).toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' });

const renderNotices = () => {
  $('#records-notices').innerHTML = notices.map((notice) => `
    <article class="record-notice">
      <div>
        <strong>공지</strong>
        <h2>${escapeHtml(notice.title)}</h2>
        <p>${escapeHtml(notice.body)}</p>
        <time>${formatDate(notice.created_at)}</time>
      </div>
      ${adminPassword ? `<div class="record-actions"><button data-notice-edit="${notice.id}" type="button">수정</button><button data-notice-delete="${notice.id}" type="button">삭제</button></div>` : ''}
    </article>
  `).join('');
};

const renderPosts = () => {
  $('#records-count').textContent = `${posts.length}개의 기록`;
  if (!posts.length) {
    $('#records-list').innerHTML = '<p class="records-empty">아직 기록이 없습니다. 첫 글을 남겨보세요.</p>';
    return;
  }
  $('#records-list').innerHTML = posts.map((post) => `
    <article class="record-card" data-post-id="${post.id}">
      <div class="record-card-head">
        <div><span class="record-number">#${escapeHtml(post.id.slice(0, 8))}</span><h2>${escapeHtml(post.title)}</h2></div>
        <time>${formatDate(post.created_at)}</time>
      </div>
      <p class="record-author">${escapeHtml(post.nickname)} ${post.edited_at ? '<em>(수정됨)</em>' : ''}</p>
      <p class="record-body">${escapeHtml(post.body)}</p>
      <div class="record-card-footer">
        <span>추천 ${post.upvotes} · 비추천 ${post.downvotes} · 댓글 ${post.comment_count}</span>
        <div class="record-actions">
          <button data-vote="1" type="button">추천</button><button data-vote="-1" type="button">비추천</button>
          <button data-comment="${post.id}" type="button">댓글</button><button data-edit="${post.id}" type="button">수정</button><button data-delete="${post.id}" type="button">삭제</button>
        </div>
      </div>
      <div class="record-comments" id="comments-${post.id}"></div>
    </article>
  `).join('');
  posts.forEach((post) => loadComments(post.id));
};

const loadBoard = async () => {
  const result = await rpc('record_get_board');
  posts = result.posts || [];
  notices = result.notices || [];
  renderNotices();
  renderPosts();
};

const loadComments = async (postId) => {
  const comments = await rpc('record_get_comments', { p_post_id: postId });
  const container = $(`#comments-${postId}`);
  if (!container) return;
  const children = (parentId) => comments.filter((comment) => comment.parent_id === parentId);
  const render = (parentId, depth = 0) => children(parentId).map((comment) => `
    <div class="record-comment ${depth ? 'is-reply' : ''}">
      <div><strong>${escapeHtml(comment.nickname)}</strong><time>${formatDate(comment.created_at)}</time></div>
      <p>${escapeHtml(comment.body)}</p>
      <div class="record-comment-actions">
        <button data-reply="${postId}" data-parent="${comment.id}" type="button">답글</button>
        <button data-comment-edit="${comment.id}" type="button">수정</button>
        <button data-comment-delete="${comment.id}" type="button">삭제</button>
      </div>
      ${render(comment.id, depth + 1)}
    </div>
  `).join('');
  container.innerHTML = render(null) || '<p class="record-no-comments">댓글이 없습니다.</p>';
};

$('#records-write-button').addEventListener('click', () => {
  $('#records-post-form').reset();
  $('#records-post-id').value = '';
  $('#records-post-password').required = true;
  $('#records-post-title').textContent = '글쓰기';
  setFormStatus('records-post-form-status', '');
  openModal('records-post-modal');
});

$('#records-post-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const id = $('#records-post-id').value;
  const payload = {
    p_nickname: $('#records-post-nickname').value.trim(),
    p_password_hash: await hashPassword($('#records-post-password').value),
    p_title: $('#records-post-subject').value.trim(),
    p_body: $('#records-post-body').value.trim()
  };
  try {
    if (id) { payload.p_id = id; await rpc('record_update_post', payload); }
    else await rpc('record_create_post', payload);
    closeModals(); await loadBoard();
  } catch (error) { setFormStatus('records-post-form-status', error.message); }
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
    const postId = payload.p_post_id;
    closeModals(); await loadBoard(); await loadComments(postId);
  } catch (error) { setFormStatus('records-comment-form-status', error.message); }
});

$('#records-notice-button').addEventListener('click', () => {
  const password = prompt('공지 작성은 관리자만 가능합니다. 관리자 비밀번호를 입력하세요.');
  if (password === null) return;
  adminPassword = password;
  $('#records-notice-form').reset();
  $('#records-notice-id').value = '';
  setFormStatus('records-notice-form-status', '');
  $('#records-notice-title').textContent = '공지 작성';
  openModal('records-notice-modal');
});

$('#records-notice-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    const payload = { p_admin_password: adminPassword, p_title: $('#records-notice-subject').value.trim(), p_body: $('#records-notice-body').value.trim() };
    if ($('#records-notice-id').value) { payload.p_id = $('#records-notice-id').value; await rpc('record_update_notice', payload); }
    else await rpc('record_create_notice', payload);
    closeModals(); await loadBoard();
  } catch (error) { setFormStatus('records-notice-form-status', error.message); }
});

document.addEventListener('click', async (event) => {
  const button = event.target.closest('button');
  if (!button) return;
  if (button.hasAttribute('data-close-modal') || event.target === backdrop) closeModals();
  const post = posts.find((item) => item.id === button.closest('[data-post-id]')?.dataset.postId);
  try {
    if (button.dataset.vote && post) {
      const key = localStorage.getItem('records-voter-key') || crypto.randomUUID();
      localStorage.setItem('records-voter-key', key);
      await rpc('record_vote_post', { p_post_id: post.id, p_voter_key: key, p_vote: Number(button.dataset.vote) });
      await loadBoard();
    } else if (button.dataset.comment) {
      $('#records-comment-form').reset(); $('#records-comment-post-id').value = button.dataset.comment; $('#records-comment-parent-id').value = ''; openModal('records-comment-modal');
    } else if (button.dataset.reply) {
      $('#records-comment-form').reset(); $('#records-comment-post-id').value = button.dataset.reply; $('#records-comment-parent-id').value = button.dataset.parent; openModal('records-comment-modal');
    } else if (button.dataset.edit && post) {
      const password = prompt('게시물 비밀번호를 입력하세요.');
      if (password === null) return;
      const newTitle = prompt('새 제목을 입력하세요.', post.title);
      const newBody = prompt('새 내용을 입력하세요.', post.body);
      if (newTitle === null || newBody === null) return;
      await rpc('record_update_post', { p_id: post.id, p_password_hash: await hashPassword(password), p_title: newTitle, p_body: newBody });
      await loadBoard();
    } else if (button.dataset.delete && post) {
      const password = prompt('게시물 비밀번호 또는 관리자 비밀번호를 입력하세요.');
      if (password !== null && confirm('이 게시물을 삭제할까요?')) {
        await rpc('record_delete_post', { p_id: post.id, p_password_hash: await hashPassword(password), p_admin_password: password }); await loadBoard();
      }
    } else if (button.dataset.noticeDelete) {
      const password = prompt('공지 삭제를 위해 관리자 비밀번호를 입력하세요.');
      if (password === '8170' && confirm('공지를 삭제할까요?')) { await rpc('record_delete_notice', { p_id: button.dataset.noticeDelete, p_admin_password: password }); await loadBoard(); }
    } else if (button.dataset.noticeEdit) {
      const password = prompt('공지 수정을 위해 관리자 비밀번호를 입력하세요.');
      if (password !== '8170') throw new Error('관리자 비밀번호가 올바르지 않습니다.');
      adminPassword = password;
      const notice = notices.find((item) => item.id === button.dataset.noticeEdit);
      $('#records-notice-id').value = notice.id; $('#records-notice-subject').value = notice.title; $('#records-notice-body').value = notice.body; openModal('records-notice-modal');
    } else if (button.dataset.commentEdit) {
      const password = prompt('댓글 비밀번호를 입력하세요.');
      const body = prompt('새 댓글 내용을 입력하세요.');
      if (password !== null && body !== null) await rpc('record_update_comment', { p_id: button.dataset.commentEdit, p_password_hash: await hashPassword(password), p_body: body }), await loadBoard();
    } else if (button.dataset.commentDelete) {
      const password = prompt('댓글 비밀번호 또는 관리자 비밀번호를 입력하세요.');
      if (password !== null && confirm('댓글을 삭제할까요?')) await rpc('record_delete_comment', { p_id: button.dataset.commentDelete, p_password_hash: await hashPassword(password), p_admin_password: password }), await loadBoard();
    }
  } catch (error) { status.textContent = error.message; }
});

backdrop.addEventListener('click', closeModals);
loadBoard().catch((error) => { status.textContent = error.message; $('#records-list').innerHTML = '<p class="records-empty">게시판을 불러오지 못했습니다.</p>'; });
