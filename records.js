const SUPABASE_URL = 'https://ejrwrwjsgizzxhqybtff.supabase.co';
const SUPABASE_KEY = 'sb_publishable_Mr64z4NO3wlqeKObCxLbBQ_HlhvG7D8';
const rpcEndpoint = `${SUPABASE_URL}/rest/v1/rpc`;
const apiHeaders = { apikey: SUPABASE_KEY, Authorization: 'Bearer ' + SUPABASE_KEY };
const $ = (selector) => document.querySelector(selector);
const backdrop = $('#records-backdrop');
const modalIds = ['records-post-modal', 'records-comment-modal'];
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

const voterKey = () => {
  const key = localStorage.getItem('records-voter-key') || crypto.randomUUID();
  localStorage.setItem('records-voter-key', key);
  return key;
};
let myPollVotes = JSON.parse(localStorage.getItem('records-poll-votes') || '{}');
const myPostVotes = JSON.parse(localStorage.getItem('records-post-votes') || '{}');
const pendingPollChoice = {};

const IMAGE_BUCKET = 'record-images';
const MAX_IMAGES = 100;
const MAX_SOURCE_BYTES = 10 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 300 * 1024;
const MAX_DIMENSION = 1280;
let pendingImages = [];
const imageUrl = (path) => `${SUPABASE_URL}/storage/v1/object/public/${IMAGE_BUCKET}/${path.split('/').map(encodeURIComponent).join('/')}`;

const compressImage = async (file) => {
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  const toBlob = (type, quality) => new Promise((resolve) => canvas.toBlob(resolve, type, quality));
  let scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height));
  let type = 'image/webp';
  let blob = null;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    for (const quality of [0.82, 0.7, 0.58, 0.46]) {
      blob = await toBlob(type, quality);
      if (blob && blob.type !== type) { type = 'image/jpeg'; blob = await toBlob(type, quality); }
      if (blob && blob.size <= MAX_OUTPUT_BYTES) { bitmap.close?.(); return blob; }
    }
    scale *= 0.8;
  }
  bitmap.close?.();
  if (!blob || blob.size > 900 * 1024) throw new Error('compress failed');
  return blob;
};

const renderImagePreviews = () => {
  $('#records-image-count').textContent = pendingImages.length ? `${pendingImages.length}/${MAX_IMAGES}장` : '';
  $('#records-image-previews').innerHTML = pendingImages.map((item, index) => `
    <figure><img src="${item.preview}" alt=""><button data-image-remove="${index}" type="button" aria-label="사진 삭제">×</button></figure>`).join('');
};

const clearPendingImages = () => {
  pendingImages.forEach((item) => URL.revokeObjectURL(item.preview));
  pendingImages = [];
  renderImagePreviews();
};

const uploadPostImages = async (postId, passwordHash, isNotice = false) => {
  const paths = new Array(pendingImages.length);
  let next = 0;
  const worker = async () => {
    while (next < pendingImages.length) {
      const index = next++;
      const blob = pendingImages[index].blob;
      const ext = blob.type === 'image/webp' ? 'webp' : 'jpg';
      const path = `${postId}/${String(index).padStart(3, '0')}-${crypto.randomUUID().slice(0, 8)}.${ext}`;
      const response = await fetch(`${SUPABASE_URL}/storage/v1/object/${IMAGE_BUCKET}/${path}`, {
        method: 'POST',
        headers: { ...apiHeaders, 'Content-Type': blob.type, 'x-upsert': 'false' },
        body: blob
      });
      if (!response.ok) throw new Error('사진 업로드에 실패했습니다. 이미지 SQL이 적용되었는지 확인하세요.');
      paths[index] = path;
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, pendingImages.length) }, worker));
  await rpc(isNotice ? 'record_set_notice_images' : 'record_set_post_images',
    isNotice
      ? { p_id: postId, p_admin_password: passwordHash, p_images: paths }
      : { p_id: postId, p_password_hash: passwordHash, p_images: paths });
};

const deletePostImages = async (images) => {
  if (!images?.length) return;
  await fetch(`${SUPABASE_URL}/storage/v1/object/${IMAGE_BUCKET}`, {
    method: 'DELETE',
    headers: { ...apiHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ prefixes: images })
  }).catch(() => {});
};
const saveMyPollVotes = () => localStorage.setItem('records-poll-votes', JSON.stringify(myPollVotes));

const renderPoll = (poll) => {
  if (!poll) return '';
  const voted = myPollVotes[poll.id];
  const pending = pendingPollChoice[poll.id];
  const total = (poll.options || []).reduce((sum, option) => sum + (option.votes || 0), 0);
  return `
  <div class="records-poll" data-poll-id="${poll.id}">
    <strong>${escapeHtml(poll.question)}</strong>
    <div class="records-poll-options">${(poll.options || []).map((option) => `
      <button class="${option.id === voted ? 'is-voted' : option.id === pending && !voted ? 'is-selected' : ''}" data-poll-select="${option.id}" type="button" ${voted ? 'disabled' : ''}>
        <span>${option.id === voted ? '✔ ' : ''}${escapeHtml(option.text)}</span><em>${option.votes || 0}표</em>
      </button>`).join('')}</div>
    <div class="records-poll-footer">
      <small>총 ${total}표</small>
      ${voted
        ? '<button class="records-poll-submit is-cancel" data-poll-cancel type="button">선택 해제</button>'
        : `<button class="records-poll-submit" data-poll-submit type="button" ${pending ? '' : 'disabled'}>투표</button>`}
    </div>
  </div>`;
};

const imagesHtml = (images) => (Array.isArray(images) && images.length
  ? `<div class="records-detail-images">${images.map((path) => `<a href="${imageUrl(path)}" target="_blank" rel="noopener"><img src="${imageUrl(path)}" alt="첨부 사진" loading="lazy"></a>`).join('')}</div>`
  : '');

const openNoticeDetail = (notice) => {
  if (!notice) return;
  const detail = $('#records-detail-page');
  detail.innerHTML = `
    <div class="records-detail-head">
      <button class="records-compose-back" data-close-detail type="button">목록으로</button>
      <span>공지</span>
    </div>
    <article class="records-detail-card" data-notice-id="${notice.id}">
      <div class="records-detail-meta"><strong>관리자</strong><time>${formatDate(notice.created_at)}</time></div>
      <h1>${escapeHtml(notice.title)}</h1>
      <div class="records-detail-body">${escapeHtml(notice.body)}</div>
      ${imagesHtml(notice.images)}
      ${renderPoll(notice.poll)}
      <div class="records-row-actions">
        <button data-notice-edit="${notice.id}" type="button">수정</button>
        <button data-notice-delete="${notice.id}" type="button">삭제</button>
      </div>
    </article>`;
  pushSub();
  page.classList.add('records-detailing');
  detail.hidden = false;
};

const openPostDetail = (post, countView = true) => {
  if (!post) return;
  if (countView) {
    post.view_count = (post.view_count || 0) + 1;
    rpc('record_increment_view', { p_post_id: post.id }).catch(() => {});
    renderPosts();
  }
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
      ${imagesHtml(post.images)}
      ${renderPoll(post.poll)}
      <div class="records-row-actions">
        <button class="${myPostVotes[post.id] === 1 ? 'is-voted-pick' : ''}" data-vote="1" type="button">추천 ${post.upvotes}</button>
        <button class="${myPostVotes[post.id] === -1 ? 'is-voted-pick' : ''}" data-vote="-1" type="button">비추천 ${post.downvotes}</button>
        <button data-comment="${post.id}" type="button">댓글 ${post.comment_count}</button>
        <button data-edit="${post.id}" type="button">수정</button>
        <button data-delete="${post.id}" type="button">삭제</button>
      </div>
      <div class="record-comments" id="comments-detail-${post.id}"></div>
    </article>`;
  pushSub();
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

let subOpen = false;
const pushSub = () => {
  if (subOpen) return;
  subOpen = true;
  history.pushState({ records: 'sub' }, '');
};
const leaveSub = () => {
  if (subOpen) history.back();
};
const hideViews = () => {
  modalIds.forEach((id) => { $(`#${id}`).hidden = true; });
  backdrop.hidden = true;
  page.classList.remove('records-writing', 'records-detailing');
  $('#records-detail-page').hidden = true;
};
history.replaceState({ records: 'root' }, '');
history.pushState({ records: 'list' }, '');
window.addEventListener('popstate', (event) => {
  const state = event.state && event.state.records;
  if (state === 'sub') return;
  subOpen = false;
  if (state === 'list') hideViews();
  else location.replace('index.html');
});

const openModal = (id) => {
  modalIds.forEach((modalId) => { $(`#${modalId}`).hidden = modalId !== id; });
  const isComposer = id === 'records-post-modal';
  if (isComposer) {
    pushSub();
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
  if ($('#records-detail-page').hidden) leaveSub();
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
  $('#records-pagination').innerHTML = Array.from({ length: totalPages }, (_, index) => {
    const pageNumber = index + 1;
    return `<button class="${pageNumber === currentPage ? 'is-active' : ''}" data-page="${pageNumber}" type="button">${pageNumber}</button>`;
  }).join('');
};

const renderNotices = () => {
  $('#records-notices').innerHTML = activeTab === 'general' ? '' : notices.map((notice) => `
    <article class="records-row records-notice-row" data-notice-id="${notice.id}">
      <span>공지</span>
      <div class="records-title-cell">
        <strong>${escapeHtml(notice.title)}</strong>
      </div>
      <span>-</span>
      <span>-</span>
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
  try {
    const mine = await rpc('record_get_my_poll_votes', { p_voter_key: voterKey() });
    if (mine && typeof mine === 'object') { myPollVotes = mine; saveMyPollVotes(); }
  } catch (error) { /* 서버 함수가 없으면 브라우저 저장값을 사용 */ }
  renderNotices();
  renderPosts();
  const detail = $('#records-detail-page');
  const openId = detail.hidden ? null : detail.querySelector('[data-post-id]')?.dataset.postId;
  const openNoticeId = detail.hidden ? null : detail.querySelector('[data-notice-id]')?.dataset.noticeId;
  if (openNoticeId) {
    const openNotice = notices.find((item) => item.id === openNoticeId);
    if (openNotice) openNoticeDetail(openNotice);
    else { page.classList.remove('records-detailing'); detail.hidden = true; }
  } else if (openId) {
    const openPost = posts.find((item) => item.id === openId);
    if (openPost) openPostDetail(openPost, false);
    else { page.classList.remove('records-detailing'); detail.hidden = true; }
  }
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

let composeMode = 'post';
let editingNoticeId = '';

const setComposeMode = (mode, editing = false) => {
  composeMode = mode;
  const isNotice = mode === 'notice';
  document.querySelectorAll('[data-post-only]').forEach((label) => {
    label.hidden = isNotice;
    label.querySelector('input').disabled = isNotice;
  });
  $('#records-post-title').textContent = isNotice ? (editing ? '공지 수정' : '공지 작성') : '글쓰기';
  $('#records-post-help').textContent = isNotice
    ? '게시판 상단에 표시될 공지를 작성합니다.'
    : '게시판에 표시될 글을 작성합니다. 닉네임과 비밀번호를 입력해 주세요.';
  $('#records-post-submit').textContent = isNotice ? '공지 저장' : '등록하기';
  $('.records-image-field').hidden = editing;
  $('#records-add-poll').hidden = editing;
  if (editing) $('#records-poll-fieldset').hidden = true;
};

$('#records-write-button').addEventListener('click', () => {
  $('#records-post-form').reset();
  $('#records-post-id').value = '';
  editingNoticeId = '';
  resetPollForm();
  setComposeMode('post');
  clearPendingImages();
  setStatus('records-post-form-status', '');
  openModal('records-post-modal');
});

$('#records-add-image').addEventListener('click', () => $('#records-image-input').click());

$('#records-image-input').addEventListener('change', async (event) => {
  const files = Array.from(event.target.files);
  event.target.value = '';
  const status = 'records-post-form-status';
  const submit = $('#records-post-form .records-submit');
  submit.disabled = true;
  try {
    for (const file of files) {
      if (pendingImages.length >= MAX_IMAGES) {
        setStatus(status, `사진은 최대 ${MAX_IMAGES}장까지 첨부할 수 있습니다.`);
        break;
      }
      if (!file.type.startsWith('image/')) { setStatus(status, '이미지 파일만 첨부할 수 있습니다.'); continue; }
      if (file.size > MAX_SOURCE_BYTES) { setStatus(status, `${file.name}: 10MB를 넘는 사진은 올릴 수 없습니다.`); continue; }
      setStatus(status, `사진 압축 중... (${pendingImages.length + 1})`);
      try {
        const blob = await compressImage(file);
        pendingImages.push({ blob, preview: URL.createObjectURL(blob) });
        renderImagePreviews();
        setStatus(status, '');
      } catch (error) {
        setStatus(status, `${file.name}: 사진을 처리하지 못했습니다.`);
      }
    }
  } finally {
    submit.disabled = false;
  }
});

$('#records-image-previews').addEventListener('click', (event) => {
  const button = event.target.closest('[data-image-remove]');
  if (!button) return;
  const [removed] = pendingImages.splice(Number(button.dataset.imageRemove), 1);
  URL.revokeObjectURL(removed.preview);
  renderImagePreviews();
});

$('#records-add-poll').addEventListener('click', () => {
  setPollVisibility(true);
  $('#records-poll-question').focus();
});

$('#records-post-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (composeMode === 'notice') {
    const title = $('#records-post-subject').value.trim();
    const body = $('#records-post-body').value.trim();
    const question = $('#records-poll-question').value.trim();
    const options = Array.from(document.querySelectorAll('.records-poll-option')).map((input) => input.value.trim()).filter(Boolean);
    try {
      if (editingNoticeId) {
        await rpc('record_update_notice', { p_id: editingNoticeId, p_admin_password: adminPassword, p_title: title, p_body: body });
      } else {
        if (question && options.length < 2) {
          setStatus('records-post-form-status', '투표 선택지는 2개 이상 입력하세요.');
          return;
        }
        const noticeId = await rpc('record_create_notice', {
          p_admin_password: adminPassword, p_title: title, p_body: body,
          p_poll_question: question, p_poll_options: question ? options : []
        });
        if (pendingImages.length) {
          setStatus('records-post-form-status', '사진 업로드 중...');
          try {
            await uploadPostImages(noticeId, adminPassword, true);
          } catch (error) {
            closeModals();
            clearPendingImages();
            await loadBoard();
            window.alert(`공지는 등록되었지만 ${error.message}`);
            return;
          }
        }
      }
      clearPendingImages();
      closeModals();
      await loadBoard();
    } catch (error) {
      setStatus('records-post-form-status', error.message);
    }
    return;
  }
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
    let postId;
    try {
      postId = await rpc('record_create_post', createPayload);
    } catch (error) {
      const missingPollFunction = payload.p_poll_question
        && error.message.includes('Could not find the function public.record_create_post');
      if (!missingPollFunction) throw error;
      setStatus('records-post-form-status', '투표 기능 SQL이 아직 적용되지 않았습니다. Supabase SQL을 먼저 실행하세요.');
      return;
    }
    if (pendingImages.length) {
      setStatus('records-post-form-status', '사진 업로드 중...');
      try {
        await uploadPostImages(postId, payload.p_password_hash);
      } catch (error) {
        closeModals();
        clearPendingImages();
        await loadBoard();
        window.alert(`글은 등록되었지만 ${error.message}`);
        return;
      }
    }
    clearPendingImages();
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
  $('#records-post-form').reset();
  $('#records-post-id').value = '';
  editingNoticeId = '';
  resetPollForm();
  clearPendingImages();
  setComposeMode('notice');
  setStatus('records-post-form-status', '');
  openModal('records-post-modal');
});

document.addEventListener('click', async (event) => {
  const button = event.target.closest('button');
  if (!button) return;
  if (button.hasAttribute('data-close-modal')) {
    closeModals();
    return;
  }
  if (button.hasAttribute('data-close-detail')) {
    hideViews();
    leaveSub();
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
  const pollBox = button.closest('[data-poll-id]');
  if (button.dataset.pollSelect && pollBox) {
    pendingPollChoice[pollBox.dataset.pollId] = button.dataset.pollSelect;
    pollBox.querySelectorAll('[data-poll-select]').forEach((item) => item.classList.toggle('is-selected', item === button));
    pollBox.querySelector('[data-poll-submit]')?.removeAttribute('disabled');
    return;
  }
  if ((button.hasAttribute('data-poll-submit') || button.hasAttribute('data-poll-cancel')) && pollBox) {
    const pollId = pollBox.dataset.pollId;
    try {
      if (button.hasAttribute('data-poll-submit')) {
        const optionId = pendingPollChoice[pollId];
        if (!optionId) return;
        await rpc('record_vote_poll', { p_poll_id: pollId, p_option_id: optionId, p_voter_key: voterKey() });
        myPollVotes[pollId] = optionId;
      } else {
        await rpc('record_cancel_poll_vote', { p_poll_id: pollId, p_voter_key: voterKey() });
        delete myPollVotes[pollId];
        delete pendingPollChoice[pollId];
      }
      saveMyPollVotes();
      await loadBoard();
    } catch (error) {
      setStatus('records-status', error.message);
    }
    return;
  }
  const post = posts.find((item) => item.id === button.closest('[data-post-id]')?.dataset.postId);
  try {
    if (button.dataset.vote && post) {
      const key = localStorage.getItem('records-voter-key') || crypto.randomUUID();
      localStorage.setItem('records-voter-key', key);
      await rpc('record_vote_post', { p_post_id: post.id, p_voter_key: key, p_vote: Number(button.dataset.vote) });
            myPostVotes[post.id] = Number(button.dataset.vote);
            localStorage.setItem('records-post-votes', JSON.stringify(myPostVotes));
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
        await deletePostImages(post.images);
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
      if (password !== null && password !== '8170') alert('관리자 비밀번호가 올바르지 않습니다.');
      if (password === '8170' && confirm('공지를 삭제할까요?')) {
        const target = notices.find((item) => item.id === button.dataset.noticeDelete);
        await rpc('record_delete_notice', { p_id: button.dataset.noticeDelete, p_admin_password: password });
        if (target) await deletePostImages(target.images);
        hideViews();
        leaveSub();
        await loadBoard();
      }
    } else if (button.dataset.noticeEdit) {
      const password = prompt('관리자 비밀번호를 입력하세요.');
      if (password === null) return;
      if (password !== '8170') { alert('관리자 비밀번호가 올바르지 않습니다.'); return; }
      adminPassword = password;
      const notice = notices.find((item) => item.id === button.dataset.noticeEdit);
      const title = prompt('제목을 입력하세요.', notice.title);
      const body = prompt('내용을 입력하세요.', notice.body);
      if (title !== null && body !== null) {
        await rpc('record_update_notice', { p_id: notice.id, p_admin_password: password, p_title: title, p_body: body });
        await loadBoard();
      }
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
  const noticeRow = event.target.closest('.records-notice-row');
  if (noticeRow && !event.target.closest('button')) {
    openNoticeDetail(notices.find((item) => item.id === noticeRow.dataset.noticeId));
    return;
  }
  const postGroup = event.target.closest('.records-post-group');
  if (!postGroup || event.target.closest('button')) return;
  openPostDetail(posts.find((post) => post.id === postGroup.dataset.postId));
});
loadBoard().catch((error) => {
  $('#records-status').textContent = error.message;
  $('#records-list').innerHTML = '<p class="records-empty">게시판을 불러오지 못했습니다. Supabase SQL 적용 여부를 확인하세요.</p>';
});
