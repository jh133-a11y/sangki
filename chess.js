(() => {
  const $ = (selector) => document.querySelector(selector);
  const GLYPH = { k: '\u265A', q: '\u265B', r: '\u265C', b: '\u265D', n: '\u265E', p: '\u265F' };
  const VALUE = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };
  const START = 'rnbqkbnrpppppppp' + ' '.repeat(32) + 'PPPPPPPPRNBQKBNR';
  const KNIGHT = [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]];
  const KING = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];
  const DIAG = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
  const ORTHO = [[-1, 0], [1, 0], [0, -1], [0, 1]];

  const settings = { mode: 'ai', side: 'w', level: 2 };
  const boxRewards = { 1: 1, 2: 5, 3: 15 };
  let state;
  let history = [];
  let selected = -1;
  let legalCache = [];
  let flipped = false;
  let thinking = false;
  let gameOver = false;
  let lastMove = null;
  let positionCounts = {};
  let gameId = 0;
  const API_URL = 'https://ejrwrwjsgizzxhqybtff.supabase.co';
  const API_KEY = 'sb_publishable_Mr64z4NO3wlqeKObCxLbBQ_HlhvG7D8';
  let accountSession = null;
  let profile = null;
  let serverGame = null;
  let profileBusy = false;
  let accountReady = false;
  let profileRequest = 0;
  let statsFocus = null;
  let profileError = '';
  let guestNickname = '';
  const assistsAllowed = () => settings.mode === 'local' || settings.level === 1;
  const accountMessage = (text) => { $('#chess-account-status').textContent = text; };
  const rpc = async (name, payload = {}) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetch(`${API_URL}/rest/v1/rpc/${name}`, {
        method: 'POST',
        headers: { apikey: API_KEY, Authorization: 'Bearer ' + API_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal
      });
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.code === 'PGRST202'
          ? '체스 기능 설정이 필요합니다. Supabase SQL 편집기에서 chess-schema.sql을 실행하세요.'
          : result.code === '57014'
            ? '서버 AI 계산 시간이 초과되었습니다. chess-speed-fix.sql을 실행하거나 빠른 연습 경기를 이용하세요.'
            : result.message || '체스 요청에 실패했습니다.');
      }
      return result;
    } catch (error) {
      if (error.name === 'AbortError') {
        throw new Error('서버 응답이 지연되고 있습니다. 서버 경기 불러오기로 반영 여부를 확인하거나 빠른 연습 경기를 이용하세요.');
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  };
  const accountPayload = () => {
    if (!accountSession?.session_token) throw new Error('메인에서 로그인하세요.');
    return { p_session_token: accountSession.session_token };
  };
  const updateProfileView = () => {
    $('#chess-account').textContent = profile
      ? `Lv.${profile.player_level} · ${profile.nickname || '투자 닉네임 미설정'}`
      : accountSession ? '계정 정보를 불러오지 못했습니다.' : guestNickname ? `비회원 · ${guestNickname}` : '비로그인 · 연습 모드';
    $('#chess-wins').textContent = `${profile?.wins || 0}회`;
    $('#chess-draws').textContent = `${profile?.draws || 0}회`;
    $('#chess-losses').textContent = `${profile?.losses || 0}회`;
    $('#chess-win-rate').textContent = `${profile?.win_rate || 0}%`;
    $('#chess-claim').disabled = profileBusy || !profile?.pending_boxes;
    $('#chess-stats-refresh').disabled = profileBusy;
    $('#chess-resume').hidden = !profile?.active || Boolean(serverGame);
    $('#chess-start').disabled = profileBusy || thinking
      || (settings.mode === 'ai' && Boolean(accountSession) && !accountReady);
    $('#chess-stats-status').textContent = profileBusy ? '전적을 불러오는 중…' : profileError || (profile
      ? `수령 대기 랜덤 현금 박스 ${profile.pending_boxes}개 · 보유 한도 100개`
      : accountSession ? '계정 전적을 불러오지 못했습니다. 새로고침을 눌러 주세요.' : '로그인 후 전적을 확인할 수 있습니다.');
  };
  const loadProfile = async () => {
    const request = ++profileRequest;
    accountReady = false;
    profileBusy = true;
    profileError = '';
    updateProfileView();
    try {
      const stored = localStorage.getItem('sangki-auth-session') || sessionStorage.getItem('sangki-auth-session-tab');
      accountSession = JSON.parse(stored || 'null');
      guestNickname = !accountSession && localStorage.getItem('sangki-investment-client-id')
        ? localStorage.getItem('sangki-investor-nickname') || '' : '';
      profile = null;
      const next = accountSession ? await rpc('chess_profile', accountPayload()) : null;
      if (request !== profileRequest) return;
      profile = next;
      accountReady = true;
      accountMessage(profile
        ? profile.nickname ? '' : '메인에서 투자 고유 닉네임을 먼저 설정하세요.'
        : '');
    } catch (error) {
      if (request === profileRequest) {
        accountMessage(error.message);
        profileError = error.message;
      }
    } finally {
      if (request === profileRequest) {
        profileBusy = false;
        updateProfileView();
      }
    }
  };

  const pieceAt = (board, index) => board[index];
  const colorOf = (piece) => (piece ? (piece === piece.toUpperCase() ? 'w' : 'b') : null);
  const typeOf = (piece) => piece.toLowerCase();
  const inside = (r, c) => r >= 0 && r < 8 && c >= 0 && c < 8;
  const squareName = (index) => 'abcdefgh'[index % 8] + (8 - Math.floor(index / 8));

  const newState = () => ({
    board: START.split(''),
    turn: 'w',
    castling: { K: true, Q: true, k: true, q: true },
    ep: -1,
    half: 0,
    full: 1
  });

  const isAttacked = (board, square, by) => {
    const r = Math.floor(square / 8);
    const c = square % 8;
    const pawnRow = by === 'w' ? r + 1 : r - 1;
    for (const dc of [-1, 1]) {
      if (inside(pawnRow, c + dc) && board[pawnRow * 8 + c + dc] === (by === 'w' ? 'P' : 'p')) return true;
    }
    for (const [dr, dc] of KNIGHT) {
      if (inside(r + dr, c + dc) && board[(r + dr) * 8 + c + dc] === (by === 'w' ? 'N' : 'n')) return true;
    }
    for (const [dr, dc] of KING) {
      if (inside(r + dr, c + dc) && board[(r + dr) * 8 + c + dc] === (by === 'w' ? 'K' : 'k')) return true;
    }
    const slide = (dirs, kinds) => {
      for (const [dr, dc] of dirs) {
        let rr = r + dr;
        let cc = c + dc;
        while (inside(rr, cc)) {
          const piece = board[rr * 8 + cc];
          if (piece !== ' ') {
            if (colorOf(piece) === by && kinds.includes(typeOf(piece))) return true;
            break;
          }
          rr += dr;
          cc += dc;
        }
      }
      return false;
    };
    return slide(DIAG, ['b', 'q']) || slide(ORTHO, ['r', 'q']);
  };

  const findKing = (board, color) => board.indexOf(color === 'w' ? 'K' : 'k');
  const inCheck = (s, color = s.turn) => isAttacked(s.board, findKing(s.board, color), color === 'w' ? 'b' : 'w');

  const pseudoMoves = (s) => {
    const { board, turn } = s;
    const moves = [];
    const enemy = turn === 'w' ? 'b' : 'w';
    for (let from = 0; from < 64; from += 1) {
      const piece = board[from];
      if (piece === ' ' || colorOf(piece) !== turn) continue;
      const type = typeOf(piece);
      const r = Math.floor(from / 8);
      const c = from % 8;
      const add = (to, extra = {}) => moves.push({ from, to, piece, capture: board[to] !== ' ' ? board[to] : null, ...extra });
      if (type === 'p') {
        const dir = turn === 'w' ? -1 : 1;
        const startRow = turn === 'w' ? 6 : 1;
        const lastRow = turn === 'w' ? 0 : 7;
        const push = (to, extra = {}) => {
          if (Math.floor(to / 8) === lastRow) ['q', 'r', 'b', 'n'].forEach((promo) => add(to, { ...extra, promo }));
          else add(to, extra);
        };
        const one = (r + dir) * 8 + c;
        if (inside(r + dir, c) && board[one] === ' ') {
          push(one);
          const two = (r + 2 * dir) * 8 + c;
          if (r === startRow && board[two] === ' ') add(two, { double: true });
        }
        for (const dc of [-1, 1]) {
          if (!inside(r + dir, c + dc)) continue;
          const to = (r + dir) * 8 + c + dc;
          if (board[to] !== ' ' && colorOf(board[to]) === enemy) push(to);
          else if (to === s.ep) add(to, { enPassant: true, capture: turn === 'w' ? 'p' : 'P' });
        }
      } else if (type === 'n' || type === 'k') {
        for (const [dr, dc] of type === 'n' ? KNIGHT : KING) {
          if (!inside(r + dr, c + dc)) continue;
          const to = (r + dr) * 8 + c + dc;
          if (board[to] === ' ' || colorOf(board[to]) === enemy) add(to);
        }
        if (type === 'k') {
          const row = turn === 'w' ? 7 : 0;
          if (from === row * 8 + 4 && !isAttacked(board, from, enemy)) {
            const rook = turn === 'w' ? 'R' : 'r';
            const kSide = turn === 'w' ? 'K' : 'k';
            const qSide = turn === 'w' ? 'Q' : 'q';
            if (s.castling[kSide] && board[row * 8 + 7] === rook && board[row * 8 + 5] === ' ' && board[row * 8 + 6] === ' '
              && !isAttacked(board, row * 8 + 5, enemy) && !isAttacked(board, row * 8 + 6, enemy)) {
              add(row * 8 + 6, { castle: 'K' });
            }
            if (s.castling[qSide] && board[row * 8] === rook && board[row * 8 + 1] === ' ' && board[row * 8 + 2] === ' ' && board[row * 8 + 3] === ' '
              && !isAttacked(board, row * 8 + 3, enemy) && !isAttacked(board, row * 8 + 2, enemy)) {
              add(row * 8 + 2, { castle: 'Q' });
            }
          }
        }
      } else {
        const dirs = type === 'b' ? DIAG : type === 'r' ? ORTHO : [...DIAG, ...ORTHO];
        for (const [dr, dc] of dirs) {
          let rr = r + dr;
          let cc = c + dc;
          while (inside(rr, cc)) {
            const to = rr * 8 + cc;
            if (board[to] === ' ') add(to);
            else {
              if (colorOf(board[to]) === enemy) add(to);
              break;
            }
            rr += dr;
            cc += dc;
          }
        }
      }
    }
    return moves;
  };

  const applyMove = (s, move) => {
    const board = s.board.slice();
    const castling = { ...s.castling };
    const turn = s.turn;
    board[move.to] = move.promo ? (turn === 'w' ? move.promo.toUpperCase() : move.promo) : move.piece;
    board[move.from] = ' ';
    if (move.enPassant) board[move.to + (turn === 'w' ? 8 : -8)] = ' ';
    if (move.castle) {
      const row = turn === 'w' ? 7 : 0;
      if (move.castle === 'K') { board[row * 8 + 5] = board[row * 8 + 7]; board[row * 8 + 7] = ' '; }
      else { board[row * 8 + 3] = board[row * 8]; board[row * 8] = ' '; }
    }
    if (move.piece === 'K') { castling.K = false; castling.Q = false; }
    if (move.piece === 'k') { castling.k = false; castling.q = false; }
    [[63, 'K'], [56, 'Q'], [7, 'k'], [0, 'q']].forEach(([square, key]) => {
      if (move.from === square || move.to === square) castling[key] = false;
    });
    return {
      board,
      turn: turn === 'w' ? 'b' : 'w',
      castling,
      ep: move.double ? (move.from + move.to) / 2 : -1,
      half: move.capture || typeOf(move.piece) === 'p' ? 0 : s.half + 1,
      full: s.full + (turn === 'b' ? 1 : 0)
    };
  };

  const legalMoves = (s) => pseudoMoves(s).filter((move) => !inCheck(applyMove(s, move), s.turn));

  const positionKey = (s) => `${s.board.join('')}${s.turn}${Object.values(s.castling).join('')}${s.ep}`;

  const insufficient = (board) => {
    const rest = board.filter((piece) => piece !== ' ' && typeOf(piece) !== 'k');
    if (!rest.length) return true;
    if (rest.length === 1 && ['b', 'n'].includes(typeOf(rest[0]))) return true;
    return false;
  };

  const sanFor = (s, move, moves) => {
    if (move.castle) return move.castle === 'K' ? 'O-O' : 'O-O-O';
    const type = typeOf(move.piece);
    let text = '';
    if (type === 'p') {
      if (move.capture) text += `${'abcdefgh'[move.from % 8]}x`;
      text += squareName(move.to);
      if (move.promo) text += `=${move.promo.toUpperCase()}`;
    } else {
      text += type.toUpperCase();
      const others = moves.filter((m) => m.piece === move.piece && m.to === move.to && m.from !== move.from);
      if (others.length) {
        const sameFile = others.some((m) => m.from % 8 === move.from % 8);
        const sameRank = others.some((m) => Math.floor(m.from / 8) === Math.floor(move.from / 8));
        if (!sameFile) text += 'abcdefgh'[move.from % 8];
        else if (!sameRank) text += 8 - Math.floor(move.from / 8);
        else text += squareName(move.from);
      }
      if (move.capture) text += 'x';
      text += squareName(move.to);
    }
    const next = applyMove(s, move);
    if (inCheck(next)) text += legalMoves(next).length ? '+' : '#';
    return text;
  };

  /* ---------- AI ---------- */
  const centerBonus = (index) => {
    const r = Math.floor(index / 8);
    const c = index % 8;
    return 6 - (Math.abs(3.5 - r) + Math.abs(3.5 - c)) * 1.5;
  };

  const evaluate = (s) => {
    let score = 0;
    for (let i = 0; i < 64; i += 1) {
      const piece = s.board[i];
      if (piece === ' ') continue;
      const type = typeOf(piece);
      const sign = colorOf(piece) === 'w' ? 1 : -1;
      let value = VALUE[type];
      if (type === 'p') {
        const rank = colorOf(piece) === 'w' ? 7 - Math.floor(i / 8) : Math.floor(i / 8);
        value += rank * 6 + (i % 8 > 1 && i % 8 < 6 ? centerBonus(i) : 0);
      } else if (type === 'n' || type === 'b') value += centerBonus(i) * 2;
      else if (type === 'q') value += centerBonus(i) * 0.5;
      score += sign * value;
    }
    return score;
  };

  const orderMoves = (moves) => moves.sort((a, b) => {
    const score = (m) => (m.capture ? 10 * VALUE[typeOf(m.capture)] - VALUE[typeOf(m.piece)] : 0) + (m.promo ? 800 : 0);
    return score(b) - score(a);
  });

  const search = (s, depth, alpha, beta) => {
    const moves = orderMoves(legalMoves(s));
    if (!moves.length) return inCheck(s) ? (s.turn === 'w' ? -100000 - depth : 100000 + depth) : 0;
    if (depth === 0) return evaluate(s);
    if (s.turn === 'w') {
      let best = -Infinity;
      for (const move of moves) {
        best = Math.max(best, search(applyMove(s, move), depth - 1, alpha, beta));
        alpha = Math.max(alpha, best);
        if (alpha >= beta) break;
      }
      return best;
    }
    let best = Infinity;
    for (const move of moves) {
      best = Math.min(best, search(applyMove(s, move), depth - 1, alpha, beta));
      beta = Math.min(beta, best);
      if (alpha >= beta) break;
    }
    return best;
  };

  const chooseAiMove = (s, level) => {
    const moves = orderMoves(legalMoves(s));
    if (level === 1 && Math.random() < 0.35) return moves[Math.floor(Math.random() * moves.length)];
    const depth = level === 1 ? 1 : level === 2 ? 2 : 3;
    let bestScore = s.turn === 'w' ? -Infinity : Infinity;
    let bestMoves = [];
    for (const move of moves) {
      const score = search(applyMove(s, move), depth - 1, -Infinity, Infinity);
      if (score === bestScore) bestMoves.push(move);
      else if ((s.turn === 'w' && score > bestScore) || (s.turn === 'b' && score < bestScore)) {
        bestScore = score;
        bestMoves = [move];
      }
    }
    return bestMoves[Math.floor(Math.random() * bestMoves.length)];
  };

  /* ---------- UI ---------- */
  const humanTurn = () => settings.mode === 'local' || state.turn === settings.side;

  const POINTS = { p: 1, n: 3, b: 3, r: 5, q: 9 };
  const capturedFor = (color) => {
    const initial = { p: 8, n: 2, b: 2, r: 2, q: 1 };
    const count = {};
    state.board.forEach((piece) => {
      if (piece !== ' ' && colorOf(piece) !== color) count[typeOf(piece)] = (count[typeOf(piece)] || 0) + 1;
    });
    let text = '';
    let points = 0;
    ['q', 'r', 'b', 'n', 'p'].forEach((type) => {
      const lost = Math.max(0, initial[type] - (count[type] || 0));
      text += GLYPH[type].repeat(lost);
      points += lost * POINTS[type];
    });
    return { text, points };
  };

  let audioCtx = null;
  const playSound = (capture) => {
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === 'suspended') audioCtx.resume();
      const t = audioCtx.currentTime;
      const tone = (freq, end, dur, vol, type) => {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(freq, t);
        osc.frequency.exponentialRampToValueAtTime(end, t + dur);
        gain.gain.setValueAtTime(vol, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
        osc.connect(gain).connect(audioCtx.destination);
        osc.start(t);
        osc.stop(t + dur);
      };
      if (capture) {
        tone(220, 60, 0.22, 0.5, 'triangle');
        tone(900, 200, 0.08, 0.3, 'square');
      } else {
        tone(520, 180, 0.09, 0.35, 'triangle');
      }
    } catch (error) { /* 소리 재생 실패는 무시 */ }
  };

  const renderPlayers = () => {
    const bottom = flipped ? 'b' : 'w';
    const top = bottom === 'w' ? 'b' : 'w';
    const name = (color) => {
      const label = color === 'w' ? '백' : '흑';
      if (settings.mode === 'local') return `${label}`;
      return color === settings.side ? `${label} · 나` : `${label} · 컴퓨터`;
    };
    const fill = (target, color) => {
      const turnMark = !gameOver && state.turn === color ? ' ◀' : '';
      const mine = capturedFor(color === 'w' ? 'b' : 'w');
      const theirs = capturedFor(color);
      const lead = mine.points - theirs.points;
      target.innerHTML = `<strong>${name(color)}${turnMark}</strong><span class="chess-captured">${mine.text.replace(/./gu, (glyph) => `${glyph}\uFE0E`)}<b class="chess-points">${mine.points}점${lead > 0 ? ` (+${lead})` : ''}</b></span>`;
    };
    fill($('#chess-top-player'), top);
    fill($('#chess-bottom-player'), bottom);
  };

  const renderBoard = () => {
    const board = $('#chess-board');
    board.replaceChildren();
    const kingSquare = inCheck(state) ? findKing(state.board, state.turn) : -1;
    const targets = new Set(legalCache.filter((m) => m.from === selected).map((m) => m.to));
    for (let visualRow = 0; visualRow < 8; visualRow += 1) {
      for (let visualCol = 0; visualCol < 8; visualCol += 1) {
        const r = flipped ? 7 - visualRow : visualRow;
        const c = flipped ? 7 - visualCol : visualCol;
        const index = r * 8 + c;
        const piece = state.board[index];
        const cell = document.createElement('button');
        cell.type = 'button';
        cell.className = `chess-sq ${(r + c) % 2 ? 'dark' : 'light'}`;
        cell.dataset.index = index;
        if (lastMove && (lastMove.from === index || lastMove.to === index)) cell.classList.add('is-last');
        if (index === selected) cell.classList.add('is-selected');
        if (index === kingSquare) cell.classList.add('is-check');
        if (targets.has(index)) cell.classList.add('is-target');
        if (targets.has(index) && piece !== ' ') cell.classList.add('has-piece');
        cell.setAttribute('aria-label', `${squareName(index)}${piece !== ' ' ? ` ${piece}` : ''}`);
        if (piece !== ' ') {
          const span = document.createElement('span');
          span.className = `chess-piece ${colorOf(piece)}`;
          span.textContent = `${GLYPH[typeOf(piece)]}\uFE0E`;
          cell.append(span);
        }
        if (visualCol === 0) {
          const rank = document.createElement('i');
          rank.className = 'chess-coord rank';
          rank.textContent = 8 - r;
          cell.append(rank);
        }
        if (visualRow === 7) {
          const file = document.createElement('i');
          file.className = 'chess-coord file';
          file.textContent = 'abcdefgh'[c];
          cell.append(file);
        }
        board.append(cell);
      }
    }
  };

  const renderMoves = () => {
    const box = $('#chess-moves');
    box.replaceChildren();
    for (let i = 0; i < history.length; i += 2) {
      const row = document.createElement('div');
      row.className = 'row';
      row.innerHTML = '<span></span><span></span><span></span>';
      row.children[0].textContent = `${i / 2 + 1}.`;
      row.children[1].textContent = history[i].san;
      row.children[2].textContent = history[i + 1] ? history[i + 1].san : '';
      box.append(row);
    }
    box.scrollTop = box.scrollHeight;
  };

  const setStatus = (text, alert = false) => {
    const el = $('#chess-status');
    el.textContent = text;
    el.classList.toggle('is-alert', alert);
  };

  const refresh = () => {
    renderBoard();
    renderPlayers();
    renderMoves();
    $('#chess-undo').disabled = !assistsAllowed() || !history.length || thinking || (serverGame && gameOver)
      || (serverGame && history.length < (settings.side === 'b' ? 3 : 2));
    $('#chess-flip').disabled = !assistsAllowed() || thinking;
    ['#chess-new', '#chess-exit', '#chess-result-new', '#chess-result-exit', '#chess-game-practice'].forEach((selector) => {
      $(selector).disabled = thinking;
    });
    $('#chess-sync').hidden = !serverGame;
    $('#chess-sync').disabled = thinking;
  };

  const showResult = (title, text) => {
    $('#chess-result-title').textContent = title;
    $('#chess-result-text').textContent = text;
    $('#chess-result').hidden = false;
    $('#chess-promo-backdrop').hidden = false;
  };

  const closeResult = () => {
    $('#chess-result').hidden = true;
    $('#chess-promo-backdrop').hidden = true;
  };

  const evaluateEnd = () => {
    legalCache = legalMoves(state);
    const key = positionKey(state);
    const side = state.turn === 'w' ? '백' : '흑';
    const winner = state.turn === 'w' ? '흑' : '백';
    gameOver = true;
    if (!legalCache.length) {
      if (inCheck(state)) {
        setStatus(`체크메이트! ${winner} 승리`, true);
        showResult('체크메이트', `${winner}이(가) 승리했습니다.`);
      } else {
        setStatus('스테일메이트 · 무승부');
        showResult('무승부', '스테일메이트입니다. (둘 수 있는 수가 없음)');
      }
    } else if (insufficient(state.board)) {
      setStatus('기물 부족 · 무승부');
      showResult('무승부', '체크메이트가 불가능한 기물 구성입니다.');
    } else if (state.half >= 100) {
      setStatus('50수 규칙 · 무승부');
      showResult('무승부', '50수 동안 폰 이동이나 기물 잡기가 없었습니다.');
    } else if ((positionCounts[key] || 0) >= 3) {
      setStatus('3회 동형 반복 · 무승부');
      showResult('무승부', '같은 포지션이 3번 반복되었습니다.');
    } else {
      gameOver = false;
      const mine = settings.mode === 'ai' ? (humanTurn() ? '내 차례' : '컴퓨터 생각 중...') : `${side} 차례`;
      setStatus(inCheck(state) ? `체크! · ${mine}` : mine, inCheck(state));
    }
    return gameOver;
  };

  const commitMove = (move) => {
    if (serverGame) {
      void submitServerMove(move);
      return;
    }
    const moves = legalCache.length ? legalCache : legalMoves(state);
    const san = sanFor(state, move, moves);
    const before = state.board.filter((x) => x !== ' ').length;
    history.push({ state, move, san, counts: { ...positionCounts } });
    state = applyMove(state, move);
    playSound(state.board.filter((x) => x !== ' ').length < before);
    lastMove = move;
    selected = -1;
    const key = positionKey(state);
    positionCounts[key] = (positionCounts[key] || 0) + 1;
    const ended = evaluateEnd();
    refresh();
    if (!ended) maybeAiMove();
  };

  const maybeAiMove = () => {
    if (serverGame || settings.mode !== 'ai' || humanTurn() || gameOver) return;
    thinking = true;
    refresh();
    const id = gameId;
    setTimeout(() => {
      if (id !== gameId) return;
      const move = chooseAiMove(state, settings.level);
      thinking = false;
      if (move) commitMove(move);
    }, 350);
  };

  const askPromotion = (candidates) => new Promise((resolve) => {
    const choices = $('#chess-promo-choices');
    choices.replaceChildren();
    const color = state.turn;
    ['q', 'r', 'b', 'n'].forEach((type) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `chess-piece ${color}`;
      button.textContent = `${GLYPH[type]}\uFE0E`;
      button.addEventListener('click', () => {
        $('#chess-promo').hidden = true;
        $('#chess-promo-backdrop').hidden = true;
        resolve(candidates.find((m) => m.promo === type));
      });
      choices.append(button);
    });
    $('#chess-promo').hidden = false;
    $('#chess-promo-backdrop').hidden = false;
  });

  const onSquare = async (index) => {
    if (gameOver || thinking || !humanTurn()) return;
    const piece = state.board[index];
    if (selected >= 0) {
      const candidates = legalCache.filter((m) => m.from === selected && m.to === index);
      if (candidates.length) {
        const id = gameId;
        const move = candidates.length > 1 ? await askPromotion(candidates) : candidates[0];
        if (id !== gameId || thinking || gameOver) return;
        commitMove(move);
        return;
      }
    }
    selected = piece !== ' ' && colorOf(piece) === state.turn ? index : -1;
    renderBoard();
  };

  const resetGame = () => {
    gameId += 1;
    state = newState();
    history = [];
    selected = -1;
    lastMove = null;
    gameOver = false;
    thinking = false;
    flipped = settings.mode === 'ai' && settings.side === 'b';
    positionCounts = { [positionKey(state)]: 1 };
    legalCache = legalMoves(state);
    closeResult();
    $('#chess-menu').hidden = true;
    $('#chess-game').hidden = false;
    evaluateEnd();
    refresh();
    maybeAiMove();
  };

  const restoreServerGame = (game) => {
    const newGame = serverGame?.id !== game.id;
    serverGame = game;
    settings.mode = 'ai';
    settings.level = game.level;
    settings.side = game.side;
    document.querySelectorAll('.chess-seg').forEach((group) => {
      group.querySelectorAll('button').forEach((button) => {
        button.classList.toggle('is-on', String(settings[group.dataset.group]) === button.dataset.value);
      });
    });
    $('#field-side').hidden = false;
    $('#field-level').hidden = false;
    state = newState();
    history = [];
    positionCounts = { [positionKey(state)]: 1 };
    game.moves.forEach((move) => {
      const moves = legalMoves(state);
      history.push({ state, move, san: sanFor(state, move, moves), counts: { ...positionCounts } });
      state = applyMove(state, move);
      const key = positionKey(state);
      positionCounts[key] = (positionCounts[key] || 0) + 1;
    });
    selected = -1;
    lastMove = game.moves.at(-1) || null;
    if (newGame) flipped = settings.side === 'b';
    thinking = false;
    $('#chess-menu').hidden = true;
    $('#chess-game').hidden = false;
    closeResult();
    evaluateEnd();
    if (game.result) {
      gameOver = true;
      const summary = game.result === 'win'
        ? `승리! 랜덤 현금 박스 ${game.reward}개 ${game.reward_claimed ? '지급 완료' : '수령 대기 (설정에서 보유 한도를 비운 후 수령)'}`
        : game.result === 'draw' ? '무승부로 기록되었습니다.' : '패배로 기록되었습니다.';
      $('#chess-reward-status').textContent = summary;
      showResult(game.result === 'win' ? '승리' : game.result === 'draw' ? '무승부' : '패배', summary);
    } else $('#chess-reward-status').textContent = `승리 보상: 랜덤 현금 박스 ${boxRewards[game.level]}개 · 서버 AI 경기`;
    refresh();
  };

  const submitServerMove = async (move) => {
    const id = gameId;
    const previousGame = serverGame;
    const ply = history.length;
    thinking = true;
    history.push({ state, move, san: sanFor(state, move, legalCache), counts: { ...positionCounts } });
    state = applyMove(state, move);
    selected = -1;
    lastMove = move;
    legalCache = legalMoves(state);
    playSound(Boolean(move.capture));
    setStatus('컴퓨터 생각 중…');
    refresh();
    try {
      const [game] = await Promise.all([
        rpc('chess_move', {
          ...accountPayload(), p_game_id: previousGame.id, p_ply: ply,
          p_from: move.from, p_to: move.to, p_promo: move.promo || null
        }),
        new Promise((resolve) => setTimeout(resolve, 350))
      ]);
      if (id !== gameId) return;
      const opponentMove = game.moves[ply + 1];
      if (opponentMove) playSound(Boolean(opponentMove.capture));
      restoreServerGame(game);
      if (game.result) await loadProfile();
    } catch (error) {
      if (id === gameId) {
        restoreServerGame(previousGame);
        setStatus(`${error.message} 서버 경기 불러오기로 결과를 확인하세요.`, true);
      }
    } finally {
      if (id === gameId) { thinking = false; refresh(); }
    }
  };

  const startGame = async () => {
    if (thinking) return;
    const id = gameId;
    if (serverGame && !serverGame.result && !window.confirm('새 경기를 시작하면 진행 중인 경기는 패배로 기록됩니다. 계속할까요?')) return;
    if (settings.mode === 'ai' && accountSession) {
      if (!accountReady || !profile?.nickname) {
        accountMessage('계정을 새로 불러오거나 메인에서 투자 닉네임을 설정하세요.');
        return;
      }
      thinking = true;
      $('#chess-start').disabled = true;
      if (state) refresh();
      accountMessage('서버 AI 경기를 준비하는 중…');
      try {
        const game = await rpc('chess_start', {
          ...accountPayload(), p_level: settings.level, p_side: settings.side
        });
        if (id !== gameId) return;
        gameId += 1;
        restoreServerGame(game);
        await loadProfile();
      } catch (error) {
        accountMessage(error.message);
        if (state) setStatus(error.message, true);
      } finally {
        thinking = false;
        updateProfileView();
        if (state) refresh();
      }
      return;
    }
    if (serverGame && !serverGame.result) {
      try {
        await rpc('chess_leave', { ...accountPayload(), p_game_id: serverGame.id });
      } catch (error) { setStatus(error.message, true); return; }
    }
    serverGame = null;
    $('#chess-reward-status').textContent = '연습 경기 · 전적 저장 및 보상 없음';
    resetGame();
  };

  const undo = async () => {
    if (!assistsAllowed() || (serverGame && gameOver) || thinking || !history.length) return;
    if (serverGame) {
      const id = gameId;
      thinking = true;
      refresh();
      try {
        const game = await rpc('chess_undo', {
          ...accountPayload(), p_game_id: serverGame.id, p_ply: history.length
        });
        if (id === gameId) restoreServerGame(game);
      } catch (error) { if (id === gameId) setStatus(error.message, true); }
      finally { if (id === gameId) { thinking = false; refresh(); } }
      return;
    }
    const steps = settings.mode === 'ai' && history.length > 1 && !humanTurn() ? 1 : settings.mode === 'ai' && history.length > 1 ? 2 : 1;
    for (let i = 0; i < steps && history.length; i += 1) {
      const entry = history.pop();
      state = entry.state;
      positionCounts = entry.counts;
    }
    lastMove = history.length ? history[history.length - 1].move : null;
    selected = -1;
    gameOver = false;
    legalCache = legalMoves(state);
    closeResult();
    evaluateEnd();
    refresh();
    maybeAiMove();
  };

  document.querySelectorAll('.chess-seg').forEach((group) => {
    group.addEventListener('click', (event) => {
      const button = event.target.closest('button');
      if (!button) return;
      if (thinking) return;
      group.querySelectorAll('button').forEach((item) => item.classList.toggle('is-on', item === button));
      const value = button.dataset.value;
      const key = group.dataset.group;
      settings[key] = key === 'level' ? Number(value) : value;
      const ai = settings.mode === 'ai';
      $('#field-side').hidden = !ai;
      $('#field-level').hidden = !ai;
      updateProfileView();
    });
  });

  $('#chess-start').addEventListener('click', startGame);
  const startPractice = () => {
    if (thinking) return;
    if (serverGame && !serverGame.result
      && !window.confirm('서버 경기는 보존하고 새 연습 경기를 시작합니다. 연습 경기는 전적·보상이 없습니다. 계속할까요?')) return;
    serverGame = null;
    $('#chess-reward-status').textContent = '빠른 연습 경기 · 전적 저장 및 보상 없음';
    resetGame();
  };
  $('#chess-practice').addEventListener('click', startPractice);
  $('#chess-game-practice').addEventListener('click', startPractice);
  $('#chess-board').addEventListener('click', (event) => {
    const cell = event.target.closest('.chess-sq');
    if (cell) onSquare(Number(cell.dataset.index));
  });
  $('#chess-undo').addEventListener('click', undo);
  $('#chess-flip').addEventListener('click', () => {
    if (!assistsAllowed() || thinking) return;
    flipped = !flipped; refresh();
  });
  const leaveGame = async () => {
    if (thinking) return;
    const id = gameId;
    if (serverGame && !serverGame.result) {
      if (!window.confirm('진행 중인 경기를 나가면 패배로 기록됩니다. 나갈까요?')) return;
      thinking = true;
      refresh();
      try {
        await rpc('chess_leave', { ...accountPayload(), p_game_id: serverGame.id });
        if (id !== gameId) return;
      } catch (error) {
        thinking = false;
        setStatus(error.message, true);
        refresh();
        return;
      }
    }
    gameId += 1;
    thinking = false;
    closeResult();
    $('#chess-game').hidden = true;
    $('#chess-menu').hidden = false;
    serverGame = null;
    await loadProfile();
  };
  $('#chess-new').addEventListener('click', startGame);
  $('#chess-exit').addEventListener('click', leaveGame);
  $('#chess-result-close').addEventListener('click', closeResult);
  $('#chess-result-new').addEventListener('click', startGame);
  $('#chess-result-exit').addEventListener('click', leaveGame);
  $('#chess-sync').addEventListener('click', async () => {
    if (!serverGame || thinking) return;
    const id = gameId;
    thinking = true;
    refresh();
    try {
      const game = await rpc('chess_get_game', { ...accountPayload(), p_game_id: serverGame.id });
      if (id !== gameId) return;
      restoreServerGame(game);
      await loadProfile();
    } catch (error) { if (id === gameId) setStatus(error.message, true); }
    finally { if (id === gameId) { thinking = false; refresh(); } }
  });
  $('#chess-resume').addEventListener('click', async () => {
    if (!profile?.active || thinking) return;
    const id = gameId;
    thinking = true;
    $('#chess-resume').disabled = true;
    try {
      const game = await rpc('chess_get_game', { ...accountPayload(), p_game_id: profile.active.id });
      if (id !== gameId) return;
      gameId += 1;
      restoreServerGame(game);
    } catch (error) { accountMessage(error.message); }
    finally {
      thinking = false;
      $('#chess-resume').disabled = false;
      updateProfileView();
      if (state) refresh();
    }
  });
  const closeSettings = () => {
    $('#chess-settings-modal').hidden = true;
    $('#chess-settings-backdrop').hidden = true;
    statsFocus?.focus();
  };
  $('#chess-settings').addEventListener('click', () => {
    statsFocus = document.activeElement;
    $('#chess-settings-modal').hidden = false;
    $('#chess-settings-backdrop').hidden = false;
    $('#chess-settings-close').focus();
    void loadProfile();
  });
  $('#chess-settings-close').addEventListener('click', closeSettings);
  $('#chess-settings-backdrop').addEventListener('click', closeSettings);
  $('#chess-stats-refresh').addEventListener('click', loadProfile);
  $('#chess-settings-modal').addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeSettings();
    if (event.key !== 'Tab') return;
    const buttons = [...$('#chess-settings-modal').querySelectorAll('button:not(:disabled)')];
    if (event.shiftKey && document.activeElement === buttons[0]) {
      event.preventDefault(); buttons.at(-1).focus();
    } else if (!event.shiftKey && document.activeElement === buttons.at(-1)) {
      event.preventDefault(); buttons[0].focus();
    }
  });
  $('#chess-claim').addEventListener('click', async () => {
    if (profileBusy) return;
    const token = accountSession?.session_token;
    profileBusy = true;
    profileError = '';
    updateProfileView();
    let message = '';
    try {
      const result = await rpc('chess_claim_rewards', accountPayload());
      if (token !== accountSession?.session_token) return;
      profile = result.profile;
      message = result.claimed ? `랜덤 현금 박스 ${result.claimed}개를 받았습니다.`
        : '보유 상자를 사용하여 공간을 확보한 후 다시 수령하세요.';
      accountMessage(message);
    } catch (error) { message = error.message; accountMessage(message); }
    finally {
      if (token === accountSession?.session_token) {
        profileBusy = false; updateProfileView();
        $('#chess-stats-status').textContent = `${message} 수령 대기 ${profile?.pending_boxes || 0}개`;
      }
    }
  });
  window.addEventListener('storage', (event) => {
    if (event.key && !['sangki-auth-session', 'sangki-investment-client-id', 'sangki-investor-nickname'].includes(event.key)) return;
    if (!localStorage.getItem('sangki-auth-session')) sessionStorage.removeItem('sangki-auth-session-tab');
    gameId += 1;
    thinking = false;
    serverGame = null;
    $('#chess-game').hidden = true;
    $('#chess-menu').hidden = false;
    closeResult();
    void loadProfile();
  });
  void loadProfile();
})();
