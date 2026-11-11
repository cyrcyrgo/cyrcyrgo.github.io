/* 中国象棋规则引擎（走法验证、将军检测、终局判定）
 * 坐标系统（依据需求文档 4.1）：
 *   - 10 行 × 9 列二维数组 board[row][col]
 *   - board[0][0] = 红方底线最左边（row 0 为红方底线，位于棋盘下侧/屏幕下端）
 *   - board[9][8] = 黑方底线最右边（row 9 为黑方底线，位于棋盘上侧/屏幕上端）
 *   - 红方向前 = row 递增；黑方向前 = row 递减
 * 棋子编码：红 = 大写（K帅 A仕 B相 N马 R车 C炮 P兵）
 *          黑 = 小写（k将 a士 b象 n马 r车 c炮 p卒）
 */
(function () {
  'use strict';
  const R = 10, C = 9;

  /* ---------- 基础工具 ---------- */
  function initBoard() {
    const top = ['r', 'n', 'b', 'a', 'k', 'a', 'b', 'n', 'r'];
    const bot = ['R', 'N', 'B', 'A', 'K', 'A', 'B', 'N', 'R'];
    const b = [];
    for (let r = 0; r < R; r++) b.push(Array(C).fill('.'));
    for (let c = 0; c < C; c++) {
      b[0][c] = bot[c];     // 第0行 红方底线
      b[9][c] = top[c];     // 第9行 黑方底线
      b[3][c] = c % 2 === 0 ? 'P' : '.';  // 第3行 红方兵行
      b[6][c] = c % 2 === 0 ? 'p' : '.';  // 第6行 黑方卒行
    }
    b[2][1] = 'C'; b[2][7] = 'C';  // 第2行 红炮
    b[7][1] = 'c'; b[7][7] = 'c';  // 第7行 黑炮
    return b;
  }

  function clone(b) { return b.map(row => row.slice()); }

  function inBoard(r, c) { return r >= 0 && r < R && c >= 0 && c < C; }

  /* 棋子所属方：'red' | 'black' | null */
  function colorOf(p) {
    if (p === '.' || p === '' || p == null) return null;
    return p === p.toUpperCase() ? 'red' : 'black';
  }

  /* 是否在九宫格内 */
  function inPalace(r, c, color) {
    if (c < 3 || c > 5) return false;
    return color === 'red' ? r >= 0 && r <= 2 : r >= 7 && r <= 9;
  }

  /* 行号是否在己方一侧（不能过河判断用）
   * 红方 home 区 = row 0~4；黑方 home 区 = row 5~9 */
  function ownSide(r, color) {
    return color === 'red' ? r <= 4 : r >= 5;
  }

  /* 兵/卒是否已过河 */
  function crossedRiver(piece, r) {
    return colorOf(piece) === 'red' ? r >= 5 : r <= 4;
  }

  function forwardDir(color) { return color === 'red' ? 1 : -1; }

  /* 找到某方帅/将 */
  function findGeneral(b, color) {
    const k = color === 'red' ? 'K' : 'k';
    for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) if (b[r][c] === k) return [r, c];
    return null;
  }

  /* ---------- 伪合法走法（未检测自将） ---------- */
  function pseudoMoves(b, color) {
    const moves = [];
    const add = (fr, fc, tr, tc) => {
      if (!inBoard(tr, tc)) return;
      const t = b[tr][tc];
      if (t === '.' || colorOf(t) !== color) moves.push([fr, fc, tr, tc]);
    };
    for (let r = 0; r < R; r++) {
      for (let c = 0; c < C; c++) {
        const p = b[r][c];
        if (p === '.' || colorOf(p) !== color) continue;
        switch (p.toUpperCase()) {
          case 'K': { // 将/帅：九宫格内直线一格
            for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
              if (inPalace(r + dr, c + dc, color)) add(r, c, r + dr, c + dc);
            }
            break;
          }
          case 'A': { // 士/仕：九宫格内斜一格
            for (const [dr, dc] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
              if (inPalace(r + dr, c + dc, color)) add(r, c, r + dr, c + dc);
            }
            break;
          }
          case 'B': { // 象/相：田字，不可过河，塞象眼
            for (const [dr, dc] of [[2, 2], [2, -2], [-2, 2], [-2, -2]]) {
              const tr = r + dr, tc = c + dc;
              if (!inBoard(tr, tc) || !ownSide(tr, color)) continue;
              const eyeR = r + dr / 2, eyeC = c + dc / 2;
              if (b[eyeR][eyeC] !== '.') continue;
              add(r, c, tr, tc);
            }
            break;
          }
          case 'N': { // 马：日字，蹩马腿
            const legs = [
              [2, 1, 1, 0], [2, -1, 1, 0], [-2, 1, -1, 0], [-2, -1, -1, 0],
              [1, 2, 0, 1], [1, -2, 0, -1], [-1, 2, 0, 1], [-1, -2, 0, -1],
            ];
            for (const [dr, dc, lr, lc] of legs) {
              const tr = r + dr, tc = c + dc;
              if (inBoard(tr, tc) && b[r + lr][c + lc] === '.') add(r, c, tr, tc);
            }
            break;
          }
          case 'R': { // 车：直线，遇子而止
            for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
              let tr = r + dr, tc = c + dc;
              while (inBoard(tr, tc)) {
                const t = b[tr][tc];
                if (t === '.') add(r, c, tr, tc);
                else { if (colorOf(t) !== color) add(r, c, tr, tc); break; }
                tr += dr; tc += dc;
              }
            }
            break;
          }
          case 'C': { // 炮：直线，吃子须隔一子（炮架）
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
          case 'P': { // 兵/卒：过河前只前进，过河后可横走，不可后退
            const dir = forwardDir(color);
            add(r, c, r + dir, c);
            if (crossedRiver(p, r)) { add(r, c, r, c + 1); add(r, c, r, c - 1); }
            break;
          }
        }
      }
    }
    return moves;
  }

  /* ---------- 将军检测 ---------- */
  function applyMove(b, fr, fc, tr, tc) {
    const nb = clone(b);
    nb[tr][tc] = nb[fr][fc];
    nb[fr][fc] = '.';
    return nb;
  }

  function inCheck(b, color) {
    const g = findGeneral(b, color);
    if (!g) return false;
    const opp = color === 'red' ? 'black' : 'red';
    const oppMoves = pseudoMoves(b, opp);
    for (const m of oppMoves) if (m[2] === g[0] && m[3] === g[1]) return true;
    // 飞将：两将同列且中间无子
    const oppG = findGeneral(b, opp);
    if (oppG && oppG[1] === g[1]) {
      const col = g[1];
      for (let r = Math.min(g[0], oppG[0]) + 1; r < Math.max(g[0], oppG[0]); r++) {
        if (b[r][col] !== '.') return false;
      }
      return true;
    }
    return false;
  }

  /* ---------- 合法走法（走完不能自将） ---------- */
  function legalMoves(b, color) {
    const res = [];
    for (const m of pseudoMoves(b, color)) {
      const nb = applyMove(b, m[0], m[1], m[2], m[3]);
      if (!inCheck(nb, color)) res.push(m);
    }
    return res;
  }

  /* ---------- 终局判定 ----------
   * 参数：走完之后的新棋盘、走棋方
   * 返回：{ winner: 'red'|'black'|null, reason: 'checkmate'|'stalemate'|'resign'|null }
   * 将死=胜；困毙（无子可动且未被将）= 按和棋处理；将/帅被吃=对方胜 */
  function judgeAfterMove(b, moverColor) {
    const opp = moverColor === 'red' ? 'black' : 'red';
    // 对方帅/将已被吃
    const oppG = findGeneral(b, opp);
    if (!oppG) return { winner: moverColor, reason: 'checkmate' };
    if (!findGeneral(b, moverColor)) return { winner: opp, reason: 'checkmate' };
    const checkOpp = inCheck(b, opp);
    const oppMoves = legalMoves(b, opp);
    if (oppMoves.length === 0) {
      return checkOpp
        ? { winner: moverColor, reason: 'checkmate' }
        : { winner: null, reason: 'stalemate' };
    }
    return { winner: null, reason: null };
  }

  window.XqRules = {
    R, C, initBoard, clone, colorOf, inBoard, inPalace, ownSide,
    crossedRiver, forwardDir, findGeneral, pseudoMoves, applyMove,
    inCheck, legalMoves, judgeAfterMove,
  };
})();