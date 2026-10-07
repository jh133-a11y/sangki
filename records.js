const SUPABASE_URL = 'https://ejrwrwjsgizzxhqybtff.supabase.co';
const SUPABASE_KEY = 'sb_publishable_Mr64z4NO3wlqeKObCxLbBQ_HlhvG7D8';
const rpcEndpoint = `${SUPABASE_URL}/rest/v1/rpc`;
const apiHeaders = { apikey: SUPABASE_KEY, Authorization: 'Bearer ' + SUPABASE_KEY };
const $ = (selector) => document.querySelector(selector);
const backdrop = $('#records-backdrop');
const modalIds = ['records-post-modal', 'records-comment-modal', 'records-notice-modal'];
let posts = [];
let notices = [];
let adminPassword = '';

const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char]));
const hashPassword = async (password) => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(password));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
};
const rpc = async (name, payload = {}) => {
  const response = await fetch(`${rpcEndpoint}/${name}`, { method: 'POST', headers: { ...apiHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  const result = await response.json().catch(() => null);
  if (!response.ok) throw new Error(result?.message || result?.hint || result?.details || '?붿껌??泥섎━?섏? 紐삵뻽?듬땲??');
  return result;
};
const formatDate = (value) => {
  const date = new Date(value);
  const now = new Date();
  return date.toDateString() === now.toDateString()
    ? date.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })
    : date.toLocaleDateString('ko-KR', { month: '2-digit', day: '2-digit' });
};
const openModal = (id) => { modalIds.forEach((modalId) => { $(`#${modalId}`).hidden = modalId !== id; }); backdrop.hidden = false; };
const closeModals = () => { modalIds.forEach((id) => { $(`#${id}`).hidden = true; }); backdrop.hidden = true; };
const setStatus = (id, message) => { $(`#${id}`).textContent = message || ''; };

const renderNotices = () => {
  $('#records-notices').innerHTML = notices.map((notice, index) => `
    <article class="records-row records-notice-row">
      <span>${index + 1}</span><span>怨듭?</span>
      <div class="records-title-cell"><strong>${escapeHtml(notice.title)}</strong><p>${escapeHtml(notice.body)}</p></div>
      <span>?댁쁺??/span><time>${formatDate(notice.created_at)}</time><span>-</span><span>-</span>
      ${adminPassword ? `<div class="records-row-actions"><button data-notice-edit="${notice.id}" type="button">?섏젙</button><button data-notice-delete="${notice.id}" type="button">??젣</button></div>` : ''}
    </article>`).join('');
};
const renderPosts = () => {
  $('#records-count').textContent = `${posts.length}媛?;
  $('#records-list').innerHTML = posts.length ? posts.map((post, index) => `
    <article class="records-post-group" data-post-id="${post.id}">
      <div class="records-row">
        <span>${posts.length - index}</span><span>?쇰컲</span>
        <div class="records-title-cell"><strong>${escapeHtml(post.title)}</strong><p>${escapeHtml(post.body)}</p></div>
        <span>${escapeHtml(post.nickname)}</span><time>${formatDate(post.created_at)}</time><span>-</span><span>${post.upvotes}</span>
      </div>
      <div class="records-row-actions"><button data-vote="1" type="button">異붿쿇 ${post.upvotes}</button><button data-vote="-1" type="button">鍮꾩텛泥?${post.downvotes}</button><button data-comment="${post.id}" type="button">?볤? ${post.comment_count}</button><button data-edit="${post.id}" type="button">?섏젙</button><button data-delete="${post.id}" type="button">??젣</button></div>
      <div class="record-comments" id="comments-${post.id}"></div>
    </article>`).join('') : '<p class="records-empty">?꾩쭅 寃뚯떆臾쇱씠 ?놁뒿?덈떎. 泥?湲???④꺼蹂댁꽭??</p>';
  posts.forEach((post) => loadComments(post.id));
};
const loadComments = async (postId) => {
  const comments = await rpc('record_get_comments', { p_post_id: postId });
  const container = $(`#comments-${postId}`);
  if (!container) return;
  const render = (parentId, depth = 0) => comments.filter((comment) => comment.parent_id === parentId).map((comment) => `
    <div class="record-comment ${depth ? 'is-reply' : ''}"><div><strong>${escapeHtml(comment.nickname)}</strong><time>${formatDate(comment.created_at)}</time></div><p>${escapeHtml(comment.body)}</p><div class="record-comment-actions"><button data-reply="${postId}" data-parent="${comment.id}" type="button">?듦?</button><button data-comment-edit="${comment.id}" type="button">?섏젙</button><button data-comment-delete="${comment.id}" type="button">??젣</button></div>${render(comment.id, depth + 1)}</div>`).join('');
  container.innerHTML = render(null) || '';
};
const loadBoard = async () => {
  const result = await rpc('record_get_board');
  posts = result.posts || []; notices = result.notices || [];
  renderNotices(); renderPosts();
};

$('#records-write-button').addEventListener('click', () => {
  $('#records-post-form').reset(); $('#records-post-id').value = ''; $('#records-post-title').textContent = '湲?곌린'; setStatus('records-post-form-status', ''); openModal('records-post-modal');
});
$('#records-post-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const payload = { p_nickname: $('#records-post-nickname').value.trim(), p_password_hash: await hashPassword($('#records-post-password').value), p_title: $('#records-post-subject').value.trim(), p_body: $('#records-post-body').value.trim() };
  try { await rpc('record_create_post', payload); closeModals(); await loadBoard(); } catch (error) { setStatus('records-post-form-status', error.message); }
});
$('#records-comment-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const payload = { p_post_id: $('#records-comment-post-id').value, p_parent_id: $('#records-comment-parent-id').value || null, p_nickname: $('#records-comment-nickname').value.trim(), p_password_hash: await hashPassword($('#records-comment-password').value), p_body: $('#records-comment-body').value.trim() };
  try { await rpc('record_create_comment', payload); closeModals(); await loadBoard(); } catch (error) { setStatus('records-comment-form-status', error.message); }
});
$('#records-notice-button').addEventListener('click', () => {
  const password = prompt('怨듭? ?묒꽦? 愿由ъ옄留?媛?ν빀?덈떎. 愿由ъ옄 鍮꾨?踰덊샇瑜??낅젰?섏꽭??');
  if (password !== '8170') { if (password !== null) alert('愿由ъ옄 鍮꾨?踰덊샇媛 ?щ컮瑜댁? ?딆뒿?덈떎.'); return; }
  adminPassword = password; $('#records-notice-form').reset(); $('#records-notice-id').value = ''; setStatus('records-notice-form-status', ''); openModal('records-notice-modal');
});
$('#records-notice-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  try { await rpc('record_create_notice', { p_admin_password: adminPassword, p_title: $('#records-notice-subject').value.trim(), p_body: $('#records-notice-body').value.trim() }); closeModals(); await loadBoard(); } catch (error) { setStatus('records-notice-form-status', error.message); }
});
document.addEventListener('click', async (event) => {
  const button = event.target.closest('button');
  if (!button) return;
  if (button.hasAttribute('data-close-modal')) { closeModals(); return; }
  const post = posts.find((item) => item.id === button.closest('[data-post-id]')?.dataset.postId);
  try {
    if (button.dataset.vote && post) {
      const key = localStorage.getItem('records-voter-key') || crypto.randomUUID(); localStorage.setItem('records-voter-key', key);
      await rpc('record_vote_post', { p_post_id: post.id, p_voter_key: key, p_vote: Number(button.dataset.vote) }); await loadBoard();
    } else if (button.dataset.comment) {
      $('#records-comment-form').reset(); $('#records-comment-post-id').value = button.dataset.comment; $('#records-comment-parent-id').value = ''; openModal('records-comment-modal');
    } else if (button.dataset.reply) {
      $('#records-comment-form').reset(); $('#records-comment-post-id').value = button.dataset.reply; $('#records-comment-parent-id').value = button.dataset.parent; openModal('records-comment-modal');
    } else if (button.dataset.delete && post) {
      const password = prompt('寃뚯떆臾?鍮꾨?踰덊샇 ?먮뒗 愿由ъ옄 鍮꾨?踰덊샇瑜??낅젰?섏꽭??');
      if (password !== null && confirm('寃뚯떆臾쇱쓣 ??젣?좉퉴??')) { await rpc('record_delete_post', { p_id: post.id, p_password_hash: await hashPassword(password), p_admin_password: password }); await loadBoard(); }
    } else if (button.dataset.edit && post) {
      const password = prompt('寃뚯떆臾?鍮꾨?踰덊샇瑜??낅젰?섏꽭??'); if (password === null) return;
      const title = prompt('???쒕ぉ', post.title); const body = prompt('???댁슜', post.body);
      if (title !== null && body !== null) { await rpc('record_update_post', { p_id: post.id, p_password_hash: await hashPassword(password), p_title: title, p_body: body }); await loadBoard(); }
    } else if (button.dataset.noticeDelete) {
      const password = prompt('愿由ъ옄 鍮꾨?踰덊샇瑜??낅젰?섏꽭??');
      if (password === '8170' && confirm('怨듭?瑜???젣?좉퉴??')) { await rpc('record_delete_notice', { p_id: button.dataset.noticeDelete, p_admin_password: password }); await loadBoard(); }
    } else if (button.dataset.noticeEdit) {
      const password = prompt('愿由ъ옄 鍮꾨?踰덊샇瑜??낅젰?섏꽭??'); if (password !== '8170') return;
      adminPassword = password; const notice = notices.find((item) => item.id === button.dataset.noticeEdit);
      $('#records-notice-id').value = notice.id; $('#records-notice-subject').value = notice.title; $('#records-notice-body').value = notice.body; openModal('records-notice-modal');
    } else if (button.dataset.commentEdit) {
      const password = prompt('?볤? 鍮꾨?踰덊샇瑜??낅젰?섏꽭??'); const body = prompt('???볤? ?댁슜');
      if (password !== null && body !== null) { await rpc('record_update_comment', { p_id: button.dataset.commentEdit, p_password_hash: await hashPassword(password), p_body: body }); await loadBoard(); }
    } else if (button.dataset.commentDelete) {
      const password = prompt('?볤? 鍮꾨?踰덊샇 ?먮뒗 愿由ъ옄 鍮꾨?踰덊샇瑜??낅젰?섏꽭??');
      if (password !== null && confirm('?볤?????젣?좉퉴??')) { await rpc('record_delete_comment', { p_id: button.dataset.commentDelete, p_password_hash: await hashPassword(password), p_admin_password: password }); await loadBoard(); }
    }
  } catch (error) { $('#records-status').textContent = error.message; }
});
backdrop.addEventListener('click', closeModals);
loadBoard().catch((error) => { $('#records-status').textContent = error.message; $('#records-list').innerHTML = '<p class="records-empty">寃뚯떆?먯쓣 遺덈윭?ㅼ? 紐삵뻽?듬땲??</p>'; });
