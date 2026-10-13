/* 中国象棋引擎（规则、走法生成、胜负判定）
 * 坐标：row 0~9（0 为黑方底，9 为红方底），col 0~8（从左到右）
 * 棋子编码：红 = 大写（K帅 A仕 B相 N马 R车 C炮 P兵）
 *          黑 = 小写（k将 a士 b象 n马 r车 c炮 p卒）
 */
(function () {
  const R = 10, C = 9;

  function initBoard() {
    const b = Array.from({ length: R }, () => Array(C).fill('.'));
    const top = ['r', 'n', 'b', 'a', 'k', 'a', 'b', 'n', 'r'];
    const bot = ['R', 'N', 'B', 'A', 'K', 'A', 'B', 'N', 'R'];
    for (let c = 0; c < C; c++) {
      b[0][c] = top[c];
      b[9][c] = bot[c];
      b[3][c] = c % 2 === 0 ? 'p' : '.';
      b[6][c] = c % 2 === 0 ? 'P' : '.';
    }
    b[2][1] = 'c'; b[2][7] = 'c';
    b[7][1] = 'C'; b[7][7] = 'C';
    return b;
  }

  function colorOf(p) {
    if (p === '.' || p === '') return null;
    return p === p.toUpperCase() ? 'red' : 'black';
  }

  function inPalace(r, c, color) {
    if (c < 3 || c > 5) return false;
    return color === 'red' ? r >= 7 && r <= 9 : r >= 0 && r <= 2;
  }

  function inBoard(r, c) { return r >= 0 && r < R && c >= 0 && c < C; }

  /* 兵卒是否已过河 */
  function crossedRiver(piece, r) {
    return colorOf(piece) === 'red' ? r <= 4 : r >= 5;
  }

  /* 生成某方所有伪合法走法（不检测自将） */
  function pseudoMoves(b, color) {
    const moves = [];
    const add = (fr, fc, tr, tc) => { if (inBoard(tr, tc)) { const t = b[tr][tc]; if (t === '.' || colorOf(t) !== color) moves.push([fr, fc, tr, tc]); } };
    for (let r = 0; r < R; r++) {
      for (let c = 0; c < C; c++) {
        const p = b[r][c];
        if (p === '.' || colorOf(p) !== color) continue;
        switch (p.toUpperCase()) {
          case 'K': { // 将/帅
            const ds = [[1, 0], [-1, 0], [0, 1], [0, -1]];
            for (const [dr, dc] of ds) {
              const tr = r + dr, tc = c + dc;
              if (inPalace(tr, tc, color)) add(r, c, tr, tc);
            }
            break;
          }
          case 'A': { // 士/仕
            for (const [dr, dc] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
              const tr = r + dr, tc = c + dc;
              if (inPalace(tr, tc, color)) add(r, c, tr, tc);
            }
            break;
          }
          case 'B': { // 象/相（田字，不可过河，象眼塞腿）
            for (const [dr, dc] of [[2, 2], [2, -2], [-2, 2], [-2, -2]]) {
              const tr = r + dr, tc = c + dc;
              if (!inBoard(tr, tc)) continue;
              if (color === 'red' && tr < 5) continue;
              if (color === 'black' && tr > 4) continue;
              const eyeR = r + dr / 2, eyeC = c + dc / 2;
              if (b[eyeR][eyeC] !== '.') continue;
              add(r, c, tr, tc);
            }
            break;
          }
          case 'N': { // 马（日字，马腿）
            const legs = [
              [2, 1, 1, 0], [2, -1, 1, 0], [-2, 1, -1, 0], [-2, -1, -1, 0],
              [1, 2, 0, 1], [1, -2, 0, -1], [-1, 2, 0, 1], [-1, -2, 0, -1],
            ];
            for (const [dr, dc, lr, lc] of legs) {
              if (inBoard(r + lr, c + lc) && b[r + lr][c + lc] === '.') add(r, c, r + dr, c + dc);
            }
            break;
          }
          case 'R': { // 车（直线，遇子而止）
            for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
              let tr = r + dr, tc = c + dc;
              while (inBoard(tr, tc)) {
                const t = b[tr][tc];
                if (t === '.') { add(r, c, tr, tc); }
                else { if (colorOf(t) !== color) add(r, c, tr, tc); break; }
                tr += dr; tc += dc;
              }
            }
            break;
          }
          case 'C': { // 炮（吃子须隔一子）
            for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
              let tr = r + dr, tc = c + dc, jumped = false;
              while (inBoard(tr, tc)) {
                const t = b[tr][tc];
                if (!jumped) {
                  if (t === '.') add(r, c, tr, tc);
                  else jumped = true;
                } else {
                  if (t !== '.') { if (colorOf(t) !== color) add(r, c, tr, tc); break; }
                }
                tr += dr; tc += dc;
              }
            }
            break;
          }
          case 'P': { // 兵/卒（前进一格；过河后可横走）
            const dir = color === 'red' ? -1 : 1; // 红向上（row-1），黑向下（row+1）
            add(r, c, r + dir, c);
            if (crossedRiver(p, r)) { add(r, c, r, c + 1); add(r, c, r, c - 1); }
            break;
          }
        }
      }
    }
    return moves;
  }

  function findGeneral(b, color) {
    const k = color === 'red' ? 'K' : 'k';
    for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) if (b[r][c] === k) return [r, c];
    return null;
  }

  function clone(b) { return b.map(row => row.slice()); }

  /* 某方是否被将军 */
  function inCheck(b, color) {
    const g = findGeneral(b, color);
    if (!g) return false;
    const opp = color === 'red' ? 'black' : 'red';
    const oppMoves = pseudoMoves(b, opp);
    for (const [, , tr, tc] of oppMoves) if (tr === g[0] && tc === g[1]) return true;
    // 飞将：同列无遮挡，两将互相照面
    const oppG = findGeneral(b, opp);
    if (oppG && oppG[1] === g[1]) {
      const col = g[1];
      let blockers = 0;
      for (let r = Math.min(g[0], oppG[0]) + 1; r < Math.max(g[0], oppG[0]); r++) if (b[r][col] !== '.') blockers++;
      if (blockers === 0) return true;
    }
    return false;
  }

  /* 走一步（返回新棋盘）；不校验合法性 */
  function applyMove(b, fr, fc, tr, tc) {
    const nb = clone(b);
    nb[tr][tc] = nb[fr][fc];
    nb[fr][fc] = '.';
    return nb;
  }

  /* 合法走法（走完不能让自己被将） */
  function legalMoves(b, color) {
    const res = [];
    for (const m of pseudoMoves(b, color)) {
      const [fr, fc, tr, tc] = m;
      const nb = applyMove(b, fr, fc, tr, tc);
      if (!inCheck(nb, color)) res.push(m);
    }
    return res;
  }

  /* 判断走完后是否分出胜负。return 'red' | 'black' | 'draw' | null */
  function judgeAfterMove(b, moverColor) {
    const opp = moverColor === 'red' ? 'black' : 'red';
    const oppG = findGeneral(b, opp);
    // 对方将已被吃 → 直接胜
    if (!oppG) return moverColor;
    const checkOpp = inCheck(b, opp);
    const oppMoves = legalMoves(b, opp);
    if (oppMoves.length === 0) {
      return checkOpp ? moverColor : 'draw'; // 将死则胜，否则困毙按和棋
    }
    return null;
  }

  /* 将棋盘转为给 AI 的纯文本（逻辑方向：黑上红下） */
  function boardText(b) {
    return b.map(row => row.join('')).join('\n');
  }

  window.Xq = { initBoard, colorOf, legalMoves, applyMove, judgeAfterMove, boardText, R, C };
})();