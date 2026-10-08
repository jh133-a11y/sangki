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

const imageIcon = (item) => (Array.isArray(item.images) && item.images.length
  ? '<svg class="records-image-icon" viewBox="0 0 16 16" width="13" height="13" aria-label="사진 첨부" role="img"><rect x="1.5" y="2.5" width="13" height="11" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.3"/><circle cx="5.5" cy="6" r="1.2" fill="currentColor"/><path d="M2.5 12l3.5-3.5 2.5 2.5 2-2 3 3" fill="none" stroke="currentColor" stroke-width="1.3"/></svg>'
  : '');

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
        <button class="${myPostVotes[notice.id] === 1 ? 'is-voted-pick' : ''}" data-vote="1" type="button">추천 ${notice.upvotes || 0}</button>
        <button class="${myPostVotes[notice.id] === -1 ? 'is-voted-pick' : ''}" data-vote="-1" type="button">비추천 ${notice.downvotes || 0}</button>
        <button data-comment="${notice.id}" data-kind="notice" type="button">댓글 ${notice.comment_count || 0}</button>
        <button data-notice-edit="${notice.id}" type="button">수정</button>
        <button data-notice-delete="${notice.id}" type="button">삭제</button>
      </div>
    </article>
    <section class="records-comments-section">
      <h3>댓글</h3>
      ${commentFormHtml({ mode: 'create', target: notice.id, kind: 'notice' })}
      <div class="record-comments" id="comments-detail-${notice.id}"></div>
    </section>`;
  pushSub(`#notice=${notice.id}`);
  page.classList.add('records-detailing');
  detail.hidden = false;
  loadComments(notice.id, `comments-detail-${notice.id}`, 'notice');
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
    </article>
    <section class="records-comments-section">
      <h3>댓글</h3>
      ${commentFormHtml({ mode: 'create', target: post.id, kind: 'post' })}
      <div class="record-comments" id="comments-detail-${post.id}"></div>
    </section>`;
  pushSub(`#post=${post.id}`);
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
let pendingDetail = null;
const basePath = location.pathname + location.search;
const pushSub = (hash = '') => {
  if (subOpen) {
    history.replaceState(history.state, '', basePath + hash);
    return;
  }
  subOpen = true;
  history.pushState({ records: 'sub' }, '', basePath + hash);
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
{
  const initialHash = location.hash;
  const match = initialHash.match(/^#(post|notice)=([0-9a-f-]{36})$/);
  history.replaceState({ records: 'root' }, '', basePath);
  history.pushState({ records: 'list' }, '', basePath);
  if (match) {
    pendingDetail = [match[1], match[2]];
    subOpen = true;
    history.pushState({ records: 'sub' }, '', basePath + initialHash);
  }
}
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
        <strong>${escapeHtml(notice.title)}${imageIcon(notice)}</strong>
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
        <div class="records-title-cell"><strong>${escapeHtml(post.title)}${imageIcon(post)}</strong></div>
        <span>${post.view_count ?? 0}</span>
        <span>${post.comment_count || 0}</span>
      </div>
    </article>`;
  }).join('') : '<p class="records-empty">표시할 게시물이 없습니다.</p>';
  renderPagination();
};

const commentCache = {};

const commentFormHtml = ({ mode, target, kind, parent = '', id = '', body = '' }) => {
  const needsBody = mode !== 'delete';
  const needsNick = mode === 'create' || mode === 'reply';
  const label = { create: '댓글 등록', reply: '답글 등록', edit: '수정 저장', delete: '삭제' }[mode];
  return `
    <form class="record-inline-form" data-mode="${mode}" data-target="${target}" data-kind="${kind}" data-parent="${parent}" data-id="${id}">
      ${needsNick ? '<input name="nickname" maxlength="24" placeholder="닉네임" required>' : ''}
      <input name="password" type="password" maxlength="72" ${mode === 'create' || mode === 'reply' ? 'minlength="4"' : ''} placeholder="${mode === 'delete' ? '댓글 비밀번호 또는 관리자 비밀번호' : '비밀번호'}" required>
      ${needsBody ? `<textarea name="body" maxlength="1000" rows="3" placeholder="내용" required>${escapeHtml(body)}</textarea>` : ''}
      <div class="record-inline-buttons">
        <button type="submit">${label}</button>
        ${mode === 'create' ? '' : '<button type="button" data-close-modal>취소</button>'}
      </div>
      <p class="records-form-status record-inline-status"></p>
    </form>`;
};

const loadComments = async (targetId, containerId = `comments-${targetId}`, kind = 'post') => {
  try {
    const comments = await rpc(kind === 'notice' ? 'record_get_notice_comments' : 'record_get_comments',
      kind === 'notice' ? { p_notice_id: targetId } : { p_post_id: targetId });
    const container = $(`#${containerId}`);
    if (!container) return;
    comments.forEach((comment) => { commentCache[comment.id] = comment; });
    const render = (parentId, depth = 0) => comments
      .filter((comment) => comment.parent_id === parentId)
      .map((comment) => `
        <div class="record-comment ${depth ? 'is-reply' : ''}" style="--depth:${Math.min(depth, 4)}">
          <div>${depth ? '<span class="record-reply-arrow" aria-hidden="true">↳</span>' : ''}<strong>${escapeHtml(comment.nickname)}</strong><time>${formatDate(comment.created_at)}</time></div>
          <p>${escapeHtml(comment.body)}</p>
          <div class="record-comment-actions">
            <button data-reply="${targetId}" data-kind="${kind}" data-parent="${comment.id}" type="button">답글</button>
            <button data-comment-edit="${comment.id}" type="button">수정</button>
            <button data-comment-delete="${comment.id}" type="button">삭제</button>
          </div>
        </div>${render(comment.id, depth + 1)}`).join('');
    container.innerHTML = render(null) || '<p class="record-comments-empty">아직 댓글이 없습니다.</p>';
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
  } else if (pendingDetail) {
    const [kind, id] = pendingDetail;
    pendingDetail = null;
    const target = kind === 'notice' ? notices.find((item) => item.id === id) : posts.find((item) => item.id === id);
    if (!target) leaveSub();
    else if (kind === 'notice') openNoticeDetail(target);
    else openPostDetail(target, false);
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

const openActionModal = (title, html) => {
  $('#records-action-title').textContent = title;
  $('#records-action-body').innerHTML = html;
  openModal('records-comment-modal');
  $('#records-action-body').querySelector('input, textarea')?.focus();
};
document.addEventListener('submit', async (event) => {
  const form = event.target.closest('.record-inline-form');
  if (!form || form.dataset.entryMode) return;
  event.preventDefault();
  const { mode, target, kind, parent, id } = form.dataset;
  const status = form.querySelector('.record-inline-status');
  const password = form.elements.password.value;
  const bodyField = form.elements.body;
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    const passwordHash = await hashPassword(password);
    if (mode === 'create' || mode === 'reply') {
      const isNotice = kind === 'notice';
      await rpc(isNotice ? 'record_create_notice_comment' : 'record_create_comment', {
        [isNotice ? 'p_notice_id' : 'p_post_id']: target,
        p_parent_id: parent || null,
        p_nickname: form.elements.nickname.value.trim(),
        p_password_hash: passwordHash,
        p_body: bodyField.value.trim()
      });
    } else if (mode === 'edit') {
      await rpc('record_update_comment', { p_id: id, p_password_hash: passwordHash, p_body: bodyField.value.trim() });
    } else {
      await rpc('record_delete_comment', { p_id: id, p_password_hash: passwordHash, p_admin_password: password });
    }
    await loadComments(target, `comments-detail-${target}`, kind);
    if (mode === 'create') form.reset(); else closeModals();
    loadBoard();
  } catch (error) {
    status.textContent = error.message;
    button.disabled = false;
  }
});

$('#records-notice-button').addEventListener('click', () => {
  openActionModal('공지 작성', `
    <form class="record-inline-form" data-entry-mode="notice-gate">
      <input name="password" type="password" maxlength="72" placeholder="관리자 비밀번호" required>
      <div class="record-inline-buttons">
        <button type="submit">확인</button>
        <button type="button" data-close-modal>취소</button>
      </div>
      <p class="records-form-status record-inline-status"></p>
    </form>`);
});

const startNoticeCompose = (password) => {
  adminPassword = password;
  $('#records-post-form').reset();
  $('#records-post-id').value = '';
  editingNoticeId = '';
  resetPollForm();
  clearPendingImages();
  setComposeMode('notice');
  setStatus('records-post-form-status', '');
  openModal('records-post-modal');
};

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
  const notice = notices.find((item) => item.id === button.closest('[data-notice-id]')?.dataset.noticeId);
  try {
    if (button.dataset.vote && notice) {
      const key = voterKey();
      await rpc('record_vote_notice', { p_notice_id: notice.id, p_voter_key: key, p_vote: Number(button.dataset.vote) });
      myPostVotes[notice.id] = Number(button.dataset.vote);
      localStorage.setItem('records-post-votes', JSON.stringify(myPostVotes));
      await loadBoard();
    } else if (button.dataset.vote && post) {
      const key = localStorage.getItem('records-voter-key') || crypto.randomUUID();
      localStorage.setItem('records-voter-key', key);
      await rpc('record_vote_post', { p_post_id: post.id, p_voter_key: key, p_vote: Number(button.dataset.vote) });
            myPostVotes[post.id] = Number(button.dataset.vote);
            localStorage.setItem('records-post-votes', JSON.stringify(myPostVotes));
            await loadBoard();
    } else if (button.dataset.comment) {
      document.querySelector('.records-comments-section > .record-inline-form [name="body"]')?.focus();
    } else if (button.dataset.reply || button.dataset.commentEdit || button.dataset.commentDelete) {
      const commentId = button.dataset.parent || button.dataset.commentEdit || button.dataset.commentDelete;
      const mode = button.dataset.reply ? 'reply' : button.dataset.commentEdit ? 'edit' : 'delete';
      const createForm = button.closest('.records-comments-section').querySelector('.record-inline-form');
      openActionModal(
        { reply: '답글 쓰기', edit: '댓글 수정', delete: '댓글 삭제' }[mode],
        commentFormHtml({
          mode, target: createForm.dataset.target, kind: createForm.dataset.kind,
          parent: button.dataset.parent || '', id: commentId,
          body: mode === 'edit' ? (commentCache[commentId]?.body || '') : ''
        })
      );
    } else if (button.dataset.delete || button.dataset.edit || button.dataset.noticeDelete || button.dataset.noticeEdit) {
      const isNotice = Boolean(button.dataset.noticeDelete || button.dataset.noticeEdit);
      const item = isNotice ? notice : post;
      if (!item) return;
      const mode = button.dataset.edit || button.dataset.noticeEdit ? 'edit' : 'delete';
      const passwordHint = isNotice ? '관리자 비밀번호' : (mode === 'edit' ? '게시물 비밀번호' : '게시물 비밀번호 또는 관리자 비밀번호');
      openActionModal(`${isNotice ? '공지' : '게시물'} ${mode === 'edit' ? '수정' : '삭제'}`, `
        <form class="record-inline-form" data-entry-mode="${mode}" data-entry-kind="${isNotice ? 'notice' : 'post'}" data-id="${item.id}">
          <input name="password" type="password" maxlength="72" placeholder="${passwordHint}" required>
          <div class="record-edit-fields"></div>
          <div class="record-inline-buttons">
            <button type="submit">${mode === 'edit' ? '확인' : '삭제'}</button>
            <button type="button" data-close-modal>취소</button>
          </div>
          <p class="records-form-status record-inline-status"></p>
        </form>`);
    }
  } catch (error) {
    $('#records-status').textContent = error.message;
  }
});

document.addEventListener('submit', async (event) => {
  const form = event.target.closest('[data-entry-mode]');
  if (!form) return;
  event.preventDefault();
  const { entryMode: mode, entryKind: kind, id } = form.dataset;
  if (mode === 'notice-gate') {
    if (form.elements.password.value !== '8170') {
      form.querySelector('.record-inline-status').textContent = '관리자 비밀번호가 올바르지 않습니다.';
      return;
    }
    closeModals();
    startNoticeCompose(form.elements.password.value);
    return;
  }
  const isNotice = kind === 'notice';
  const status = form.querySelector('.record-inline-status');
  const submit = form.querySelector('button[type="submit"]');
  const password = form.elements.password.value;
  const list = isNotice ? notices : posts;
  const item = list.find((entry) => entry.id === id);
  submit.disabled = true;
  try {
    if (isNotice && password !== '8170') throw new Error('관리자 비밀번호가 올바르지 않습니다.');
    if (mode === 'edit' && !form.elements.title) {
      if (!isNotice && item) {
        await rpc('record_update_post', { p_id: id, p_password_hash: await hashPassword(password), p_title: item.title, p_body: item.body });
      }
      form.elements.password.readOnly = true;
      form.querySelector('.record-edit-fields').innerHTML = `
        <input name="title" maxlength="80" value="${escapeHtml(item.title)}" required>
        <textarea name="body" rows="6" required>${escapeHtml(item.body)}</textarea>`;
      submit.textContent = '수정 저장';
      submit.disabled = false;
      form.elements.title.focus();
      return;
    }
    if (mode === 'edit') {
      const title = form.elements.title.value.trim();
      const body = form.elements.body.value.trim();
      if (isNotice) {
        adminPassword = password;
        await rpc('record_update_notice', { p_id: id, p_admin_password: password, p_title: title, p_body: body });
      } else {
        await rpc('record_update_post', { p_id: id, p_password_hash: await hashPassword(password), p_title: title, p_body: body });
      }
      const card = document.querySelector(`.records-detail-card[data-${isNotice ? 'notice' : 'post'}-id="${id}"]`);
      card.querySelector('h1').textContent = title;
      card.querySelector('.records-detail-body').textContent = body;
      if (item) { item.title = title; item.body = body; }
      closeModals();
      loadBoard();
    } else {
      if (isNotice) {
        await rpc('record_delete_notice', { p_id: id, p_admin_password: password });
      } else {
        await rpc('record_delete_post', { p_id: id, p_password_hash: await hashPassword(password), p_admin_password: password });
      }
      if (item) await deletePostImages(item.images);
      hideViews();
      leaveSub();
      await loadBoard();
    }
  } catch (error) {
    status.textContent = error.message;
    submit.disabled = false;
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
