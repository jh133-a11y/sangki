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
let currentPage = 1;
const pageSize = 10;
let adminPassword = '';

const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
}[char]));

const hashPassword = async (password) => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(password));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
};

const renderPoll = (poll) => poll ? `
  <div class="records-poll" data-poll-id="${poll.id}">
    <strong>${escapeHtml(poll.question)}</strong>
    <div class="records-poll-options">${(poll.options || []).map((option) => `
      <button data-poll-vote="${option.id}" type="button">
        <span>${escapeHtml(option.text)}</span><em>${option.votes || 0}</em>
      </button>`).join('')}</div>
  </div>` : '';

const openPostDetail = (post) => {
  if (!post) return;
  const detail = $('#records-detail-page');
  detail.innerHTML = `
    <div class="records-detail-head">
      <button class="records-compose-back" data-close-detail type="button">목록으로</button>
      <span>일반 게시물</span>
    </div>
    <article class="records-detail-card" data-post-id="${post.id}">
      <div class="records-detail-meta"><strong>${escapeHtml(post.nickname)}</strong><time>${formatDate(post.created_at)}</time></div>
      <h1>${escapeHtml(post.title)}</h1>
      <div class="records-detail-body">${escapeHtml(post.body)}</div>
      ${renderPoll(post.poll)}
      <div class="records-row-actions">
        <button data-vote="1" type="button">추천 ${post.upvotes}</button>
        <button data-vote="-1" type="button">비추천 ${post.downvotes}</button>
        <button data-comment="${post.id}" type="button">댓글 ${post.comment_count}</button>
        <button data-edit="${post.id}" type="button">수정</button>
        <button data-delete="${post.id}" type="button">삭제</button>
      </div>
      <div class="record-comments" id="comments-detail-${post.id}"></div>
    </article>`;
  page.classList.add('records-detailing');
  detail.hidden = false;
  loadComments(post.id, `comments-detail-${post.id}`);
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
  const isComposer = id === 'records-post-modal' || id === 'records-notice-modal';
  if (isComposer) {
    page.classList.remove('records-detailing');
    $('#records-detail-page').hidden = true;
  }
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
const visiblePosts = () => {
  const start = (currentPage - 1) * pageSize;
  return filteredPosts().slice(start, start + pageSize);
};

const addPollOptionInput = (value = '') => {
  const container = $('#records-poll-options');
  if (container.children.length >= 6) return;
  const wrapper = document.createElement('div');
  wrapper.className = 'records-poll-option-input';
  wrapper.innerHTML = `<input class="records-poll-option" maxlength="80" placeholder="선택지 ${container.children.length + 1}" value="${escapeHtml(value)}" required><button class="records-remove-option" type="button" aria-label="선택지 삭제">×</button>`;
  container.appendChild(wrapper);
};

const setPollVisibility = (visible) => {
  const fieldset = $('#records-poll-fieldset');
  fieldset.hidden = !visible;
  $('#records-add-poll').hidden = visible;
  fieldset.querySelectorAll('input').forEach((input) => { input.disabled = !visible; });
};

const resetPollForm = () => {
  $('#records-poll-question').value = '';
  $('#records-poll-options').innerHTML = '';
  addPollOptionInput();
  addPollOptionInput();
  setPollVisibility(false);
};

const renderPagination = () => {
  const totalPages = Math.max(1, Math.ceil(filteredPosts().length / pageSize));
  if (currentPage > totalPages) currentPage = totalPages;
  $('#records-pagination').innerHTML = totalPages <= 1 ? '' : Array.from({ length: totalPages }, (_, index) => {
    const pageNumber = index + 1;
    return `<button class="${pageNumber === currentPage ? 'is-active' : ''}" data-page="${pageNumber}" type="button">${pageNumber}</button>`;
  }).join('');
};

const renderNotices = () => {
  $('#records-notices').innerHTML = activeTab === 'general' ? '' : notices.map((notice, index) => `
    <article class="records-row records-notice-row">
      <span>공지</span>
      <div class="records-title-cell">
        <strong>${escapeHtml(notice.title)}</strong>
        <p>${escapeHtml(notice.body)}</p>
      </div>
      <span>-</span>
      <span>-</span>
      ${adminPassword ? `<div class="records-row-actions">
        <button data-notice-edit="${notice.id}" type="button">수정</button>
        <button data-notice-delete="${notice.id}" type="button">삭제</button>
      </div>` : ''}
    </article>`).join('');
};

const renderPosts = () => {
  const pagePosts = visiblePosts();
  $('#records-count').textContent = `${posts.length + notices.length}개`;
  $('#records-list').innerHTML = pagePosts.length ? pagePosts.map((post, index) => {
    const postNumber = posts.length - ((currentPage - 1) * pageSize + index);
    return `
    <article class="records-post-group" data-post-id="${post.id}">
      <div class="records-row">
        <span>${postNumber}</span>
        <div class="records-title-cell"><strong>${escapeHtml(post.title)}</strong></div>
        <span>${post.view_count ?? 0}</span>
        <span>${post.comment_count || 0}</span>
      </div>
    </article>`;
  }).join('') : '<p class="records-empty">표시할 게시물이 없습니다.</p>';
  renderPagination();
};

const loadComments = async (postId, containerId = `comments-${postId}`) => {
  try {
    const comments = await rpc('record_get_comments', { p_post_id: postId });
    const container = $(`#${containerId}`);
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
    currentPage = 1;
    document.querySelectorAll('.records-tabs button').forEach((item) => item.classList.toggle('is-active', item === button));
    renderNotices();
    renderPosts();
  });
});

$('#records-write-button').addEventListener('click', () => {
  $('#records-post-form').reset();
  $('#records-post-id').value = '';
  $('#records-post-title').textContent = '글쓰기';
  resetPollForm();
  setStatus('records-post-form-status', '');
  openModal('records-post-modal');
});

$('#records-add-poll').addEventListener('click', () => {
  setPollVisibility(true);
  $('#records-poll-question').focus();
});

$('#records-post-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const payload = {
    p_nickname: $('#records-post-nickname').value.trim(),
    p_password_hash: await hashPassword($('#records-post-password').value),
    p_title: $('#records-post-subject').value.trim(),
    p_body: $('#records-post-body').value.trim(),
    p_poll_question: $('#records-poll-question').value.trim(),
    p_poll_options: Array.from(document.querySelectorAll('.records-poll-option')).map((input) => input.value.trim()).filter(Boolean)
  };
  if (payload.p_poll_question && payload.p_poll_options.length < 2) {
    setStatus('records-post-form-status', '투표 선택지는 2개 이상 입력하세요.');
    return;
  }
  if (!payload.p_poll_question) payload.p_poll_options = [];
  try {
    const createPayload = payload.p_poll_question
      ? payload
      : {
        p_nickname: payload.p_nickname,
        p_password_hash: payload.p_password_hash,
        p_title: payload.p_title,
        p_body: payload.p_body
      };
    try {
      await rpc('record_create_post', createPayload);
    } catch (error) {
      const missingPollFunction = payload.p_poll_question
        && error.message.includes('Could not find the function public.record_create_post');
      if (!missingPollFunction) throw error;
      setStatus('records-post-form-status', '투표 기능 SQL이 아직 적용되지 않았습니다. Supabase SQL을 먼저 실행하세요.');
      return;
    }
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
  if (button.hasAttribute('data-close-detail')) {
    page.classList.remove('records-detailing');
    $('#records-detail-page').hidden = true;
    return;
  }
  if (button.id === 'records-add-option') {
    addPollOptionInput();
    return;
  }
  if (button.classList.contains('records-remove-option')) {
    if ($('#records-poll-options').children.length > 2) button.parentElement.remove();
    return;
  }
  if (button.dataset.page) {
    currentPage = Number(button.dataset.page);
    renderPosts();
    return;
  }
  const post = posts.find((item) => item.id === button.closest('[data-post-id]')?.dataset.postId);
  try {
    if (button.dataset.vote && post) {
      const key = localStorage.getItem('records-voter-key') || crypto.randomUUID();
      localStorage.setItem('records-voter-key', key);
      await rpc('record_vote_post', { p_post_id: post.id, p_voter_key: key, p_vote: Number(button.dataset.vote) });
      await loadBoard();
    } else if (button.dataset.pollVote && post) {
      const key = localStorage.getItem('records-voter-key') || crypto.randomUUID();
      localStorage.setItem('records-voter-key', key);
      await rpc('record_vote_poll', { p_poll_id: button.closest('[data-poll-id]').dataset.pollId, p_option_id: button.dataset.pollVote, p_voter_key: key });
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
document.addEventListener('click', (event) => {
  const postGroup = event.target.closest('.records-post-group');
  if (!postGroup || event.target.closest('button')) return;
  openPostDetail(posts.find((post) => post.id === postGroup.dataset.postId));
});
loadBoard().catch((error) => {
  $('#records-status').textContent = error.message;
  $('#records-list').innerHTML = '<p class="records-empty">게시판을 불러오지 못했습니다. Supabase SQL 적용 여부를 확인하세요.</p>';
});
