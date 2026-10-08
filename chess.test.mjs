import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./chess.js', import.meta.url), 'utf8');
const engineSource = source.slice(0, source.lastIndexOf("  document.querySelectorAll('.chess-seg')"))
  + '\n globalThis.engine={newState,legalMoves,applyMove,inCheck,insufficient,settings,assistsAllowed};})();';
const context = vm.createContext({ document: { querySelector: () => null } });
vm.runInContext(engineSource, context);
const { newState, legalMoves, applyMove, inCheck, insufficient, settings, assistsAllowed } = context.engine;
const move = (state, from, to, promo) => {
  const chosen = legalMoves(state).find((item) => item.from === from && item.to === to && item.promo === promo);
  assert.ok(chosen, `Expected legal move ${from} -> ${to}`);
  return applyMove(state, chosen);
};

test('initial position and pawn double move', () => {
  const state = newState();
  assert.equal(legalMoves(state).length, 20);
  const next = move(state, 52, 36);
  assert.equal(next.board[36], 'P');
  assert.equal(next.turn, 'b');
  assert.equal(next.ep, 44);
});
test('scholar mate is a legal white checkmate', () => {
  let state = newState();
  for (const [from, to] of [[52,36],[12,28],[61,34],[1,18],[59,31],[6,21],[31,13]]) {
    state = move(state, from, to);
  }
  assert.equal(state.turn, 'b');
  assert.equal(inCheck(state), true);
  assert.equal(legalMoves(state).length, 0);
});
test('fool mate is a legal black checkmate', () => {
  let state = newState();
  for (const [from, to] of [[53,45],[12,28],[54,38],[3,39]]) state = move(state, from, to);
  assert.equal(state.turn, 'w');
  assert.equal(inCheck(state), true);
  assert.equal(legalMoves(state).length, 0);
});
test('en passant removes the captured pawn', () => {
  let state = newState();
  for (const [from,to] of [[52,36],[8,16],[36,28],[11,27]]) state = move(state,from,to);
  const next = move(state,28,19);
  assert.equal(next.board[27], ' ');
  assert.equal(next.board[19], 'P');
});
test('promotion choices and king safety are preserved', () => {
  const state = newState();
  state.board = Array(64).fill(' ');
  state.board[4] = 'k';
  state.board[60] = 'K';
  state.board[8] = 'P';
  const promotions = Array.from(legalMoves(state).filter((m) => m.from === 8 && m.to === 0), (m) => m.promo).sort();
  assert.deepEqual(promotions, ['b','n','q','r']);
  assert.equal(move(state,8,0,'n').board[0], 'N');
  assert.equal(insufficient(state.board.filter((_,i) => i !== 8)), true);
});
test('AI assists only on easy; local play retains its existing tools', () => {
  settings.mode = 'ai';
  for (const level of [1,2,3]) {
    settings.level = level;
    assert.equal(assistsAllowed(), level === 1);
  }
  settings.mode = 'local';
  assert.equal(assistsAllowed(), true);
});
test('guest investment identity keeps AI start enabled without account RPCs', async () => {
  const elements = new Map();
  const storage = new Map([
    ['sangki-investment-client-id', 'guest-id'],
    ['sangki-investor-nickname', '<투자 닉네임>']
  ]);
  const guestContext = vm.createContext({
    document: { querySelector: (selector) => {
      if (!elements.has(selector)) elements.set(selector, {});
      return elements.get(selector);
    } },
    localStorage: { getItem: (key) => storage.get(key) || null },
    sessionStorage: { getItem: () => null },
    fetch: () => { throw new Error('Guest must not call account RPCs'); }
  });
  vm.runInContext(source.slice(0, source.lastIndexOf("  document.querySelectorAll('.chess-seg')"))
    + '\n globalThis.loadProfile=loadProfile;})();', guestContext);
  await guestContext.loadProfile();
  assert.equal(elements.get('#chess-account').textContent, '비회원 · <투자 닉네임>');
  assert.equal(elements.get('#chess-start').disabled, false);
  assert.equal(elements.get('#chess-account-status').textContent, '');
  storage.clear();
  await guestContext.loadProfile();
  assert.equal(elements.get('#chess-account').textContent, '비로그인 · 연습 모드');
  assert.equal(elements.get('#chess-start').disabled, false);
});
test('a stalled RPC aborts at 12 seconds with an explicit recovery message', async () => {
  let expire;
  let cleared = false;
  const rpcContext = vm.createContext({
    document: { querySelector: () => null },
    AbortController,
    setTimeout: (callback, delay) => {
      assert.equal(delay, 12000);
      expire = callback;
      return 1;
    },
    clearTimeout: () => { cleared = true; },
    fetch: (_, { signal }) => new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    })
  });
  vm.runInContext(source.slice(0, source.lastIndexOf("  document.querySelectorAll('.chess-seg')"))
    + '\n globalThis.rpc=rpc;})();', rpcContext);
  const request = rpcContext.rpc('chess_move');
  expire();
  await assert.rejects(request, /서버 응답이 지연.*서버 경기 불러오기/);
  assert.equal(cleared, true);
});
test('AI speed patch matches the full migration and retains bounded server computation', () => {
  const schema = readFileSync(new URL('./chess-schema.sql', import.meta.url), 'utf8');
  const patch = readFileSync(new URL('./chess-speed-fix.sql', import.meta.url), 'utf8');
  for (const name of ['chess_search_fast', 'chess_ai']) {
    const definition = new RegExp(`create or replace function public\\.${name}\\([\\s\\S]*?\\n\\$\\$;`);
    assert.equal(patch.match(definition)?.[0], schema.match(definition)?.[0]);
  }
  assert.match(patch, /interval '750 milliseconds'/);
  assert.match(patch, /limit 6 loop/);
  assert.match(patch, /revoke all on function public\.chess_search_fast/);
});
