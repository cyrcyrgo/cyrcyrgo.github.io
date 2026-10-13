/* 五子棋引擎（15×15，五连即胜） */
(function () {
  const N = 15;

  function initBoard(size) {
    const n = size || N;
    return Array.from({ length: n }, () => Array(n).fill(0)); // 0空 1黑 2白
  }

  /* 判定落子后是否获胜；返回 true */
  function winsAt(b, r, c, player) {
    const n = b.length;
    const dirs = [[0, 1], [1, 0], [1, 1], [1, -1]];
    for (const [dr, dc] of dirs) {
      let count = 1;
      for (const s of [1, -1]) {
        let rr = r + dr * s, cc = c + dc * s;
        while (rr >= 0 && rr < n && cc >= 0 && cc < n && b[rr][cc] === player) { count++; rr += dr * s; cc += dc * s; }
      }
      if (count >= 5) return true;
    }
    return false;
  }

  function isFull(b) {
    for (const row of b) for (const v of row) if (v === 0) return false;
    return true;
  }

  function boardText(b) {
    return b.map(row => row.map(v => v === 0 ? '.' : (v === 1 ? 'X' : 'O')).join('')).join('\n');
  }

  window.Gomoku = { initBoard, winsAt, isFull, boardText, N };
})();