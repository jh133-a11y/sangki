export function nextTrackIndex(length, index, repeat, direction = 1, ended = false) {
  if (length === 0 || index < 0 || index >= length) return -1;
  if (ended && repeat === 'one') return index;
  const next = index + direction;
  if (next >= 0 && next < length) return next;
  return repeat === 'all' ? (next + length) % length : -1;
}

export function stalledAtEnd(duration, position, idleMilliseconds) {
  return Number.isFinite(duration) && duration > 0 && position > 0
    && duration - position <= 0.5 && idleMilliseconds >= 4000;
}

export function recoveryTrackIndex(length, index, repeat, failures) {
  if (index < 0 || index >= length) return -1;
  if ((repeat === 'one' || (repeat === 'all' && length === 1))
    && (failures.get(index) || 0) === 1) return index;
  for (let step = 1; step <= length; step += 1) {
    let next = index + step;
    if (next >= length) {
      if (repeat === 'off') return -1;
      next %= length;
    }
    if (!failures.has(next)) return next;
  }
  return -1;
}

export function tracksForPlaylist(tracks, playlist) {
  if (!playlist) return tracks;
  const byId = new Map(tracks.map((track) => [track.id, track]));
  return playlist.track_ids.map((id) => byId.get(id)).filter(Boolean);
}

export function searchTracks(tracks, query) {
  const search = query.trim().toLocaleLowerCase('ko');
  return tracks.filter((track) => track.name.toLocaleLowerCase('ko').includes(search));
}

const audioTypes = {
  mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg',
  flac: 'audio/flac', m4a: 'audio/mp4', webm: 'audio/webm', aac: 'audio/aac'
};

export function uploadType(file) {
  if (file.size <= 0 || file.size > 10 * 1024 * 1024) {
    throw new Error('음악 파일 크기는 1바이트 이상, 10 MB 이하여야 합니다.');
  }
  const type = audioTypes[file.name.split('.').pop().toLowerCase()];
  if (!type) throw new Error('MP3, WAV, OGG, FLAC, M4A, WebM, AAC 파일을 선택하세요.');
  return type;
}
