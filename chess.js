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

  const capturedFor = (color) => {
    const initial = { p: 8, n: 2, b: 2, r: 2, q: 1 };
    const count = {};
    state.board.forEach((piece) => {
      if (piece !== ' ' && colorOf(piece) !== color) count[typeOf(piece)] = (count[typeOf(piece)] || 0) + 1;
    });
    let text = '';
    ['q', 'r', 'b', 'n', 'p'].forEach((type) => {
      text += GLYPH[type].repeat(Math.max(0, initial[type] - (count[type] || 0)));
    });
    return text;
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
      target.innerHTML = `<strong>${name(color)}${turnMark}</strong><span class="chess-captured">${capturedFor(color === 'w' ? 'b' : 'w').replace(/./gu, (glyph) => `${glyph}\uFE0E`)}</span>`;
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
    $('#chess-undo').disabled = !history.length || thinking;
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
    const moves = legalCache.length ? legalCache : legalMoves(state);
    const san = sanFor(state, move, moves);
    history.push({ state, move, san, counts: { ...positionCounts } });
    state = applyMove(state, move);
    lastMove = move;
    selected = -1;
    const key = positionKey(state);
    positionCounts[key] = (positionCounts[key] || 0) + 1;
    const ended = evaluateEnd();
    refresh();
    if (!ended) maybeAiMove();
  };

  const maybeAiMove = () => {
    if (settings.mode !== 'ai' || humanTurn() || gameOver) return;
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
        const move = candidates.length > 1 ? await askPromotion(candidates) : candidates[0];
        commitMove(move);
        return;
      }
    }
    selected = piece !== ' ' && colorOf(piece) === state.turn ? index : -1;
    renderBoard();
  };

  const startGame = () => {
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

  const undo = () => {
    if (thinking || !history.length) return;
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
      group.querySelectorAll('button').forEach((item) => item.classList.toggle('is-on', item === button));
      const value = button.dataset.value;
      const key = group.dataset.group;
      settings[key] = key === 'level' ? Number(value) : value;
      const ai = settings.mode === 'ai';
      $('#field-side').hidden = !ai;
      $('#field-level').hidden = !ai;
    });
  });

  $('#chess-start').addEventListener('click', startGame);
  $('#chess-board').addEventListener('click', (event) => {
    const cell = event.target.closest('.chess-sq');
    if (cell) onSquare(Number(cell.dataset.index));
  });
  $('#chess-undo').addEventListener('click', undo);
  $('#chess-flip').addEventListener('click', () => { flipped = !flipped; refresh(); });
  $('#chess-new').addEventListener('click', () => {
    gameId += 1;
    thinking = false;
    $('#chess-game').hidden = true;
    $('#chess-menu').hidden = false;
    closeResult();
  });
  $('#chess-result-close').addEventListener('click', closeResult);
  $('#chess-result-new').addEventListener('click', () => {
    gameId += 1;
    closeResult();
    $('#chess-game').hidden = true;
    $('#chess-menu').hidden = false;
  });
})();
