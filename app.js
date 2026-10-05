const SUPABASE_URL = 'https://ejrwrwjsgizzxhqybtff.supabase.co';
const SUPABASE_KEY = 'sb_publishable_Mr64z4NO3wlqeKObCxLbBQ_HlhvG7D8';
const commentsEndpoint = `${SUPABASE_URL}/rest/v1/comments`;

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

const escapeDate = (value) => new Intl.DateTimeFormat('ko-KR', {
  dateStyle: 'medium',
  timeStyle: 'short'
}).format(new Date(value));

const renderComments = (items) => {
  if (!items.length) {
    comments.innerHTML = '<p class="comments-empty">아직 남겨진 흔적이 없습니다. 첫 번째 댓글을 남겨보세요.</p>';
    return;
  }

  comments.replaceChildren(...items.map((item) => {
    const article = document.createElement('article');
    article.className = 'comment';
    article.innerHTML = `
      <strong class="comment-author"></strong>
      <p class="comment-body"></p>
      <time class="comment-date"></time>
    `;
    article.querySelector('.comment-author').textContent = item.nickname;
    article.querySelector('.comment-body').textContent = item.body;
    article.querySelector('.comment-date').textContent = escapeDate(item.created_at);
    return article;
  }));
};

const loadComments = async () => {
  try {
    const response = await fetch(`${commentsEndpoint}?select=id,nickname,body,created_at&order=created_at.desc`, {
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` }
    });
    if (!response.ok) throw new Error('댓글을 불러오지 못했습니다.');
    renderComments(await response.json());
  } catch (error) {
    comments.innerHTML = '<p class="comments-empty">댓글을 불러오지 못했습니다. 잠시 후 다시 확인해주세요.</p>';
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
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
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
    await loadComments();
  } catch (error) {
    status.textContent = error.message;
  } finally {
    submit.disabled = false;
  }
});

loadComments();
