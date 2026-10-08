import test from 'node:test';
import assert from 'node:assert/strict';
import { nextTrackIndex, recoveryTrackIndex, stalledAtEnd, tracksForPlaylist, searchTracks, uploadType } from './music-queue.mjs';

test('sequential playback stops at the end without repeat', () => {
  assert.equal(nextTrackIndex(3, 0, 'off', 1, true), 1);
  assert.equal(nextTrackIndex(3, 2, 'off', 1, true), -1);
  assert.equal(nextTrackIndex(3, 0, 'off', -1), -1);
});
test('one repeats on ended but manual next and previous still navigate', () => {
  assert.equal(nextTrackIndex(3, 1, 'one', 1, true), 1);
  assert.equal(nextTrackIndex(3, 1, 'one'), 2);
  assert.equal(nextTrackIndex(3, 1, 'one', -1), 0);
});
test('all wraps in both directions including a single-track playlist', () => {
  assert.equal(nextTrackIndex(3, 2, 'all', 1, true), 0);
  assert.equal(nextTrackIndex(3, 0, 'all', -1), 2);
  assert.equal(nextTrackIndex(1, 0, 'all', 1, true), 0);
});
test('empty or invalid queues never navigate', () => {
  assert.equal(nextTrackIndex(0, -1, 'all'), -1);
  assert.equal(nextTrackIndex(2, -1, 'one', 1, true), -1);
  assert.equal(nextTrackIndex(2, 2, 'off'), -1);
});
test('end watchdog only advances a stalled final half-second', () => {
  assert.equal(stalledAtEnd(60, 59.5, 4000), true);
  assert.equal(stalledAtEnd(60, 59.5, 3999), false);
  assert.equal(stalledAtEnd(60, 59.4, 10000), false);
  assert.equal(stalledAtEnd(Infinity, 60, 10000), false);
  assert.equal(stalledAtEnd(NaN, 60, 10000), false);
  assert.equal(stalledAtEnd(0, 0, 10000), false);
});
test('playback errors retry repeat-one once, skip failed tracks and stop boundedly', () => {
  const failures = new Map([[0, 1]]);
  assert.equal(recoveryTrackIndex(3, 0, 'one', failures), 0);
  failures.set(0, 2);
  assert.equal(recoveryTrackIndex(3, 0, 'one', failures), 1);
  failures.set(1, 2);
  assert.equal(recoveryTrackIndex(3, 1, 'all', failures), 2);
  failures.set(2, 2);
  assert.equal(recoveryTrackIndex(3, 2, 'all', failures), -1);
  assert.equal(recoveryTrackIndex(3, 2, 'one', failures), -1);
  assert.equal(recoveryTrackIndex(3, 2, 'off', new Map([[2, 1]])), -1);
  assert.equal(recoveryTrackIndex(1, 0, 'one', new Map([[0, 1]])), 0);
  assert.equal(recoveryTrackIndex(1, 0, 'one', new Map([[0, 2]])), -1);
  assert.equal(recoveryTrackIndex(1, 0, 'all', new Map([[0, 1]])), 0);
  assert.equal(recoveryTrackIndex(1, 0, 'all', new Map([[0, 2]])), -1);
  assert.equal(recoveryTrackIndex(0, -1, 'all', failures), -1);
});
const tracks = [
  { id: 'a', name: '봄 노래' }, { id: 'b', name: 'Night SONG' }, { id: 'c', name: '봄비' }
];
test('playlist playback preserves membership order and omits missing tracks', () => {
  assert.deepEqual(tracksForPlaylist(tracks, { track_ids: ['c', 'missing', 'a'] }), [tracks[2], tracks[0]]);
  assert.deepEqual(tracksForPlaylist(tracks, { track_ids: [] }), []);
  assert.equal(tracksForPlaylist(tracks, null), tracks);
});
test('search handles Korean, case, whitespace, empty and no matches', () => {
  assert.deepEqual(searchTracks(tracks, ' 봄 '), [tracks[0], tracks[2]]);
  assert.deepEqual(searchTracks(tracks, 'song'), [tracks[1]]);
  assert.deepEqual(searchTracks(tracks, ''), tracks);
  assert.deepEqual(searchTracks(tracks, '없는 곡'), []);
});
test('upload validation accepts exact limit and supported extensions only', () => {
  assert.equal(uploadType({ name: '곡.MP3', size: 10 * 1024 * 1024 }), 'audio/mpeg');
  assert.equal(uploadType({ name: '곡.m4a', size: 1 }), 'audio/mp4');
  assert.throws(() => uploadType({ name: '곡.mp3', size: 0 }));
  assert.throws(() => uploadType({ name: '곡.mp3', size: 10 * 1024 * 1024 + 1 }));
  assert.throws(() => uploadType({ name: '악성.html', size: 1 }));
});
