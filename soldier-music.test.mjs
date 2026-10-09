import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('./soldier-music.js', import.meta.url), 'utf8');
function fixture(saved = {}, play) {
  class Element {
    listeners = new Map();
    attributes = {};
    textContent = '';
    value = '';
    on(type, event = {}) { for (const callback of this.listeners.get(type) || []) callback(event); }
    addEventListener(type, callback) {
      if (!this.listeners.has(type)) this.listeners.set(type, []);
      this.listeners.get(type).push(callback);
    }
    setAttribute(key, value) { this.attributes[key] = value; }
    closest() { return null; }
  }
  const ids = ['soldier-lobby-music', 'home', 'soldier-music-toggle', 'soldier-music-volume', 'soldier-music-volume-label', 'soldier-music-status'];
  const nodes = Object.fromEntries(ids.map(id => [id, new Element()]));
  const audio = nodes['soldier-lobby-music'], home = nodes.home;
  audio.paused = true; home.hidden = false;
  audio.play = play ? () => play(audio) : async () => { audio.paused = false; };
  audio.pause = () => { audio.paused = true; };
  audio.load = () => {};
  const document = new Element(), window = new Element();
  document.getElementById = id => nodes[id];
  const storage = new Map(Object.entries(saved));
  let observer;
  runInNewContext(source, {
    document, window, Element,
    localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
    MutationObserver: class { constructor(callback) { observer = callback; } observe() {} },
    console: { warn() {}, error() {} }
  });
  return { nodes, audio, home, window, storage, sync: () => observer() };
}
const settle = () => new Promise(resolve => setImmediate(resolve));

test('lobby playback pauses for matches, resumes at home and respects saved off/volume settings', async () => {
  const f = fixture(); await settle();
  assert.equal(f.audio.paused, false); assert.equal(f.audio.volume, .25);
  f.home.hidden = true; f.sync(); assert.equal(f.audio.paused, true);
  f.home.hidden = false; f.sync(); await settle(); assert.equal(f.audio.paused, false);
  f.nodes['soldier-music-toggle'].on('click'); assert.equal(f.audio.paused, true);
  f.nodes['soldier-music-volume'].value = '60'; f.nodes['soldier-music-volume'].on('input');
  assert.equal(f.audio.volume, .6); assert.equal(f.audio.paused, true);
  const next = fixture(Object.fromEntries(f.storage)); await settle();
  assert.equal(next.audio.paused, true); assert.equal(next.audio.volume, .6);
});

test('a pending play cannot leak audio into gameplay or a page that has been left', async () => {
  let resolvePlay;
  const f = fixture({}, audio => new Promise(resolve => {
    resolvePlay = () => { audio.paused = false; resolve(); };
  }));
  f.home.hidden = true; f.sync(); resolvePlay(); await settle();
  assert.equal(f.audio.paused, true);
  f.home.hidden = false; f.sync();
  f.window.on('pagehide'); resolvePlay(); await settle();
  assert.equal(f.audio.paused, true);
});

test('invalid saved volume is rejected and a file error exposes retry', async () => {
  const f = fixture({ 'sanggi-soldier-music-volume': 'Infinity' }); await settle();
  assert.equal(f.audio.volume, .25);
  f.audio.error = new Error('missing file'); f.audio.on('error');
  assert.equal(f.nodes['soldier-music-toggle'].textContent, '음악 재시도');
  f.audio.pause(); f.nodes['soldier-music-toggle'].on('click'); await settle();
  assert.equal(f.audio.paused, false);
});
