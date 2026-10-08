import { nextTrackIndex, recoveryTrackIndex, stalledAtEnd, tracksForPlaylist, searchTracks, uploadType } from './music-queue.mjs?v=2';

const SUPABASE_URL = 'https://ejrwrwjsgizzxhqybtff.supabase.co';
const SUPABASE_KEY = 'sb_publishable_Mr64z4NO3wlqeKObCxLbBQ_HlhvG7D8';
const apiHeaders = { apikey: SUPABASE_KEY, Authorization: 'Bearer ' + SUPABASE_KEY };
const $ = (selector) => document.querySelector(selector);
const audio = $('#music-audio');
const status = $('#music-status');
let session = null;
let tracks = [];
let playlists = [];
let selectedPlaylistId = null;
let queue = [];
let queueIndex = -1;
let queueName = '';
let busy = false;
let pendingUpload = null;
let playbackRequest = 0;
let accountChangePending = false;
const nativePlayer = typeof window.SangkiAndroid?.command === 'function'
  && typeof window.SangkiAndroid?.state === 'function' ? window.SangkiAndroid : null;
let nativePlaying = false;
let nativeError = '';
const playbackFailures = new Map();
let lastPosition = 0;
let lastProgressAt = performance.now();
let recoveryTimer = null;
let completing = false;

const nativeCommand = (action, details = {}) => {
  try {
    nativePlayer.command(JSON.stringify({ action, ...details }));
  } catch (error) {
    notify(`앱 플레이어 요청에 실패했습니다. ${error.message}`, true);
  }
};

const timeLabel = (milliseconds) => {
  const seconds = Math.floor(Math.max(0, milliseconds) / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
};

const notify = (message, error = false) => {
  status.textContent = message;
  status.classList.toggle('is-error', error);
};

const readSession = () => {
  const stored = localStorage.getItem('sangki-auth-session')
    || sessionStorage.getItem('sangki-auth-session-tab');
  if (!stored) return null;
  const value = JSON.parse(stored);
  if (!value || typeof value.session_token !== 'string' || typeof value.account_id !== 'string') {
    throw new Error('저장된 로그인 정보가 올바르지 않습니다. 다시 로그인하세요.');
  }
  return value;
};

const rpc = async (name, payload = {}) => {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: { ...apiHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const result = await response.json();
  if (!response.ok) {
    const error = new Error(result.message || '음악 요청에 실패했습니다.');
    error.code = result.code;
    throw error;
  }
  return result;
};

const accountPayload = () => {
  if (!session) throw new Error('로그인 후 이용하세요.');
  return { p_session_token: session.session_token };
};
const currentPlaylist = () => playlists.find((item) => item.id === selectedPlaylistId);
const currentTracks = () => tracksForPlaylist(tracks, currentPlaylist());
const repeatMode = () => $('#repeat-mode').value;
const trackUrl = (path) => `${SUPABASE_URL}/storage/v1/object/public/music-audio/${path.split('/').map(encodeURIComponent).join('/')}`;

const button = (text, action) => {
  const element = document.createElement('button');
  element.type = 'button';
  element.textContent = text;
  element.addEventListener('click', action);
  return element;
};

const renderAccount = () => {
  $('#account-state').textContent = session
    ? `${session.username} 님 · 업로드 및 내 재생목록 이용 가능`
    : '로그인 없이 음악을 들을 수 있습니다. 업로드와 재생목록 저장은 로그인 후 이용하세요.';
  $('#login-form').hidden = Boolean(session);
  $('#upload-submit').disabled = !session || busy || Boolean(pendingUpload);
  $('#playlist-submit').disabled = !session || busy;
  $('#upload-retry').hidden = !pendingUpload;
  $('#upload-retry').disabled = busy || !session;
  $('#refresh').disabled = busy;
  $('#delete-playlist').disabled = busy;
};

const renderPlayer = () => {
  const track = queue[queueIndex];
  $('#now-playing').textContent = track ? track.name : '재생할 음악을 선택하세요.';
  $('#queue-label').textContent = track
    ? `${queueName} · ${queueIndex + 1} / ${queue.length}`
    : '재생 대기열 없음';
  $('#previous-track').disabled = nextTrackIndex(queue.length, queueIndex, repeatMode(), -1) < 0;
  $('#next-track').disabled = nextTrackIndex(queue.length, queueIndex, repeatMode()) < 0;
};

const run = async (action) => {
  if (busy) return;
  busy = true;
  render();
  try {
    await action();
  } catch (error) {
    if (error.code === '28000') {
      session = null;
      playlists = [];
      selectedPlaylistId = null;
      pendingUpload = null;
      localStorage.removeItem('sangki-auth-session');
      sessionStorage.removeItem('sangki-auth-session-tab');
    }
    notify(error.message, true);
  } finally {
    busy = false;
    render();
    if (accountChangePending) {
      accountChangePending = false;
      void run(syncAccount);
    }
  }
};

const renderTracks = () => {
  const available = currentTracks();
  const filtered = searchTracks(available, $('#music-search').value);
  $('#library-title').textContent = currentPlaylist()?.name || '모든 음악';
  $('#delete-playlist').hidden = !currentPlaylist();
  $('#play-all').disabled = available.length === 0;
  $('#track-count').textContent = `${available.length}곡 · 검색 결과 ${filtered.length}곡`;
  const rows = filtered.map((track) => {
    const row = document.createElement('li');
    row.classList.toggle('is-playing', queue[queueIndex]?.id === track.id);
    const name = document.createElement('strong');
    name.className = 'music-track-name';
    name.textContent = track.name;
    const detail = document.createElement('p');
    detail.className = 'music-track-detail';
    detail.textContent = `${track.uploaded_by} · ${(track.file_size / (1024 * 1024)).toFixed(1)} MB`;
    const actions = document.createElement('div');
    actions.className = 'music-inline';
    actions.append(button('재생', () => startQueue(available, available.indexOf(track))));
    if (session && playlists.length) {
      const label = document.createElement('label');
      label.textContent = '추가할 재생목록';
      const select = document.createElement('select');
      playlists.forEach((playlist) => {
        const option = document.createElement('option');
        option.value = playlist.id;
        option.textContent = playlist.name;
        select.append(option);
      });
      select.value = selectedPlaylistId || playlists[0].id;
      label.append(select);
      const add = button('목록에 추가', () => run(async () => {
        const updated = await rpc('music_playlist_track', {
          ...accountPayload(), p_playlist_id: select.value, p_track_id: track.id, p_remove: false
        });
        updatePlaylist(updated);
        notify('재생목록에 추가했습니다.');
      }));
      add.disabled = busy;
      actions.append(label, add);
    }
    if (currentPlaylist()) {
      const remove = button('목록에서 빼기', () => run(async () => {
        const updated = await rpc('music_playlist_track', {
          ...accountPayload(), p_playlist_id: selectedPlaylistId, p_track_id: track.id, p_remove: true
        });
        updatePlaylist(updated);
        notify('재생목록에서 뺐습니다. 현재 재생 대기열은 유지됩니다.');
      }));
      remove.disabled = busy;
      actions.append(remove);
    }
    row.append(name, detail, actions);
    return row;
  });
  if (!rows.length) {
    const empty = document.createElement('li');
    empty.textContent = $('#music-search').value.trim()
      ? '검색 결과가 없습니다.'
      : currentPlaylist() ? '모든 음악에서 곡을 추가하세요.' : '아직 음악이 없습니다.';
    rows.push(empty);
  }
  $('#track-list').replaceChildren(...rows);
};

const render = () => {
  renderAccount();
  const all = button('모든 음악', () => {
    selectedPlaylistId = null;
    $('#music-search').value = '';
    render();
  });
  all.setAttribute('aria-pressed', String(!selectedPlaylistId));
  $('#library-nav').replaceChildren(all);
  $('#playlist-empty').hidden = playlists.length > 0;
  $('#playlist-list').replaceChildren(...playlists.map((playlist) => {
    const item = button(`${playlist.name} (${playlist.track_ids.length})`, () => {
      selectedPlaylistId = playlist.id;
      $('#music-search').value = '';
      render();
    });
    item.setAttribute('aria-pressed', String(selectedPlaylistId === playlist.id));
    return item;
  }));
  renderTracks();
  renderPlayer();
};

const updatePlaylist = (updated) => {
  const index = playlists.findIndex((item) => item.id === updated.id);
  if (index < 0) playlists.push(updated);
  else playlists[index] = updated;
};

const updateMediaSession = () => {
  if (!('mediaSession' in navigator)) return;
  navigator.mediaSession.playbackState = audio.paused ? 'paused' : 'playing';
  if (Number.isFinite(audio.duration) && audio.duration > 0 && navigator.mediaSession.setPositionState) {
    navigator.mediaSession.setPositionState({
      duration: audio.duration, playbackRate: audio.playbackRate,
      position: Math.min(audio.currentTime, audio.duration)
    });
  }
};

const play = async () => {
  if (nativePlayer) {
    nativeCommand('play');
    return;
  }
  const request = ++playbackRequest;
  try {
    await audio.play();
  } catch (error) {
    // Switching tracks intentionally aborts the previous play request.
    if (error.name === 'AbortError' && request !== playbackRequest) return;
    notify(`재생을 시작하지 못했습니다. 플레이어의 재생 버튼을 눌러 주세요. ${error.message}`, true);
  }
};

const loadTrack = (index) => {
  clearTimeout(recoveryTimer);
  recoveryTimer = null;
  completing = false;
  lastPosition = 0;
  lastProgressAt = performance.now();
  queueIndex = index;
  if (nativePlayer) {
    nativeCommand('queue', {
      queue: queue.map((track) => ({ ...track, url: trackUrl(track.storage_path) })),
      index, name: queueName, repeat: repeatMode()
    });
    renderPlayer();
    renderTracks();
    return;
  }
  audio.src = trackUrl(queue[index].storage_path);
  if ('mediaSession' in navigator && 'MediaMetadata' in window) {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: queue[index].name, artist: queue[index].uploaded_by, album: queueName
    });
  }
  renderPlayer();
  renderTracks();
  void play();
};

const startQueue = (items, index = 0) => {
  if (!items.length) return;
  playbackFailures.clear();
  queue = [...items];
  queueName = currentPlaylist()?.name || '모든 음악';
  loadTrack(index);
};

const advance = (direction = 1, ended = false) => {
  if (nativePlayer) {
    nativeCommand(direction === 1 ? 'next' : 'previous');
    return;
  }
  const index = nextTrackIndex(queue.length, queueIndex, repeatMode(), direction, ended);
  if (index < 0) {
    if (ended) {
      notify('목록 재생이 끝났습니다.');
      updateMediaSession();
    }
    return;
  }
  loadTrack(index);
};

const recoverPlayback = () => {
  if (nativePlayer || recoveryTimer !== null || !queue[queueIndex]) return;
  playbackFailures.set(queueIndex, (playbackFailures.get(queueIndex) || 0) + 1);
  const next = recoveryTrackIndex(queue.length, queueIndex, repeatMode(), playbackFailures);
  if (next < 0) {
    audio.pause();
    notify('음악 파일 또는 연결 오류로 자동 재생을 중단했습니다. 곡을 다시 선택하거나 연결 상태를 확인하세요.', true);
    return;
  }
  notify(next === queueIndex
    ? '재생 오류가 발생하여 현재 곡을 다시 재생합니다.'
    : '재생 오류가 발생하여 다음 재생 가능한 곡으로 넘어갑니다.', true);
  recoveryTimer = setTimeout(() => loadTrack(next), 500);
};

const completePlayback = () => {
  if (completing || recoveryTimer !== null || !queue[queueIndex]) return;
  completing = true;
  advance(1, true);
};

const refresh = async () => {
  tracks = await rpc('music_library');
  if (session) playlists = await rpc('music_my_playlists', accountPayload());
  else playlists = [];
  if (!currentPlaylist()) selectedPlaylistId = null;
};

const finishUpload = async () => {
  await rpc('music_finish_upload', { ...accountPayload(), p_track_id: pendingUpload.id });
  pendingUpload = null;
  $('#upload-form').reset();
  notify('음악을 올렸습니다.');
  await refresh();
};

$('#login-form').addEventListener('submit', (event) => {
  event.preventDefault();
  void run(async () => {
    const result = await rpc('site_account_login', {
      p_username: $('#login-username').value.trim().toLowerCase(),
      p_password: $('#login-password').value
    });
    sessionStorage.setItem('sangki-auth-session-tab', JSON.stringify(result));
    // Replace an expired remembered session without changing the user's keep-login preference.
    if (localStorage.getItem('sangki-auth-session')) {
      localStorage.setItem('sangki-auth-session', JSON.stringify(result));
    }
    session = result;
    $('#login-password').value = '';
    await refresh();
    notify('로그인했습니다.');
  });
});

$('#upload-form').addEventListener('submit', (event) => {
  event.preventDefault();
  void run(async () => {
    if (pendingUpload) throw new Error('먼저 업로드 완료 처리를 재시도하세요.');
    const file = $('#upload-file').files[0];
    if (!file) throw new Error('음악 파일을 선택하세요.');
    const name = $('#upload-name').value.trim();
    if (!name) throw new Error('음악 이름을 입력하세요.');
    const type = uploadType(file);
    const reservation = await rpc('music_reserve_upload', {
      ...accountPayload(), p_name: name, p_file_size: file.size, p_mime_type: type
    });
    notify('음악 파일 업로드 중… 이 탭을 닫지 마세요.');
    const response = await fetch(`${SUPABASE_URL}/storage/v1/object/music-audio/${reservation.storage_path}`, {
      method: 'POST',
      headers: { ...apiHeaders, 'Content-Type': type, 'x-upsert': 'false' },
      body: file
    });
    if (!response.ok) {
      throw new Error('음악 파일 업로드에 실패했습니다. 연결 상태를 확인하고 다시 시도하세요.');
    }
    pendingUpload = reservation;
    try {
      await finishUpload();
    } catch (error) {
      if (pendingUpload) {
        error.message = `파일은 업로드됐지만 목록 등록에 실패했습니다. 완료 처리 재시도 버튼을 눌러 주세요. ${error.message}`;
      }
      throw error;
    }
  });
});
$('#upload-retry').addEventListener('click', () => void run(finishUpload));

$('#playlist-form').addEventListener('submit', (event) => {
  event.preventDefault();
  void run(async () => {
    const name = $('#playlist-name').value.trim();
    if (!name) throw new Error('재생목록 이름을 입력하세요.');
    const playlist = await rpc('music_create_playlist', { ...accountPayload(), p_name: name });
    updatePlaylist(playlist);
    selectedPlaylistId = playlist.id;
    $('#playlist-form').reset();
    $('#music-search').value = '';
    notify('재생목록을 만들었습니다. 모든 음악에서 곡을 추가하세요.');
  });
});
$('#delete-playlist').addEventListener('click', () => {
  if (!currentPlaylist() || !window.confirm(`"${currentPlaylist().name}" 재생목록을 삭제할까요? 음악 파일은 삭제되지 않습니다.`)) return;
  void run(async () => {
    const id = selectedPlaylistId;
    await rpc('music_delete_playlist', { ...accountPayload(), p_playlist_id: id });
    playlists = playlists.filter((item) => item.id !== id);
    selectedPlaylistId = null;
    notify('재생목록을 삭제했습니다. 현재 재생 대기열은 유지됩니다.');
  });
});
$('#music-search').addEventListener('input', renderTracks);
$('#play-all').addEventListener('click', () => startQueue(currentTracks()));
$('#previous-track').addEventListener('click', () => advance(-1));
$('#next-track').addEventListener('click', () => advance());
$('#repeat-mode').addEventListener('change', () => {
  if (nativePlayer) nativeCommand('repeat', { repeat: repeatMode() });
  renderPlayer();
});
$('#refresh').addEventListener('click', () => void run(async () => {
  await refresh();
  notify('목록을 새로 불러왔습니다.');
}));
audio.addEventListener('ended', completePlayback);
audio.addEventListener('error', recoverPlayback);
audio.addEventListener('playing', () => {
  lastPosition = audio.currentTime;
  lastProgressAt = performance.now();
});
audio.addEventListener('seeked', () => {
  lastPosition = audio.currentTime;
  lastProgressAt = performance.now();
});
audio.addEventListener('timeupdate', () => {
  if (audio.currentTime > lastPosition + 0.05) {
    lastProgressAt = performance.now();
    if (audio.currentTime >= 1) playbackFailures.clear();
  }
  lastPosition = audio.currentTime;
});
if (!nativePlayer) setInterval(() => {
  if (!audio.paused && !audio.seeking && !audio.error
    && stalledAtEnd(audio.duration, audio.currentTime, performance.now() - lastProgressAt)) {
    notify('곡 끝에서 재생이 멈춰 반복 설정에 따라 다음 재생으로 넘어갑니다.');
    completePlayback();
  }
}, 1000);
['play', 'pause', 'loadedmetadata', 'timeupdate', 'ratechange'].forEach((event) => {
  audio.addEventListener(event, updateMediaSession);
});
if (!nativePlayer && 'mediaSession' in navigator) {
  const handlers = {
    play: () => void play(), pause: () => audio.pause(),
    previoustrack: () => advance(-1), nexttrack: () => advance(),
    seekto: (details) => { audio.currentTime = details.seekTime; }
  };
  Object.entries(handlers).forEach(([action, handler]) => {
    try {
      navigator.mediaSession.setActionHandler(action, handler);
    } catch (error) {
      if (error.name !== 'NotSupportedError') throw error;
      console.info(`Media Session action is not supported: ${action}`);
    }
  });
}
if (nativePlayer) {
  audio.hidden = true;
  $('#native-player').hidden = false;
  $('#music-background-note').textContent = '앱 전용 백그라운드 플레이어로 화면을 끄거나 다른 메뉴로 이동해도 음악이 계속 재생됩니다.';
  $('#browser-playback-note').textContent = '전체 재생은 검색 결과가 아닌 현재 목록의 모든 곡을 순서대로 재생합니다. 다른 목록이나 메뉴로 이동해도 재생 대기열은 유지됩니다. 앱 강제 종료나 기기의 배터리 제한 시 재생이 중단될 수 있습니다.';
  $('#native-play').addEventListener('click', () => nativeCommand(nativePlaying ? 'pause' : 'play'));
  $('#native-stop').addEventListener('click', () => nativeCommand('stop'));
  $('#native-seek').addEventListener('change', () => nativeCommand('seek', {
    position: Number($('#native-seek').value)
  }));
  window.sangkiNativeState = (state) => {
    const incoming = state.queue || [];
    const changed = queueIndex !== state.index || queueName !== (state.name || '')
      || queue.map((track) => track.id).join(',') !== incoming.map((track) => track.id).join(',');
    queue = incoming;
    queueIndex = state.index;
    queueName = state.name || '';
    nativePlaying = Boolean(state.playing);
    if (incoming.length) $('#repeat-mode').value = state.repeat || repeatMode();
    $('#native-play').textContent = nativePlaying ? '일시정지' : '재생';
    $('#native-play').disabled = queueIndex < 0;
    $('#native-seek').max = state.duration || 0;
    $('#native-seek').disabled = !(state.duration > 0);
    if (document.activeElement !== $('#native-seek')) {
      $('#native-seek').value = state.position || 0;
    }
    $('#native-time').textContent = `${timeLabel(state.position || 0)} / ${timeLabel(state.duration || 0)}`;
    renderPlayer();
    if (changed) renderTracks();
    if (state.error && state.error !== nativeError) notify(state.error, true);
    nativeError = state.error || '';
  };
  try {
    window.sangkiNativeState(JSON.parse(nativePlayer.state()));
  } catch (error) {
    notify(`앱 재생 상태를 읽지 못했습니다. ${error.message}`, true);
  }
}
const syncAccount = async () => {
  if (!localStorage.getItem('sangki-auth-session')) sessionStorage.removeItem('sangki-auth-session-tab');
  session = null;
  playlists = [];
  selectedPlaylistId = null;
  pendingUpload = null;
  session = readSession();
  await refresh();
};
window.addEventListener('storage', (event) => {
  if (event.key !== 'sangki-auth-session' && event.key !== null) return;
  if (busy) accountChangePending = true;
  else void run(syncAccount);
});
void run(async () => {
  try {
    session = readSession();
  } catch (error) {
    notify(error.message, true);
    localStorage.removeItem('sangki-auth-session');
    sessionStorage.removeItem('sangki-auth-session-tab');
  }
  await refresh();
});
