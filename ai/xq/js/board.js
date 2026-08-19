/* 棋盘渲染：使用 Canvas 绘制中国象棋棋盘与棋子
 * 坐标：row 0 = 红方底线（屏幕下方），row 9 = 黑方底线（屏幕上方）
 * 依赖 window.XqRules
 */
(function () {
  'use strict';

  const PIECE_CN = {
    K: '帅', A: '仕', B: '相', N: '马', R: '车', C: '炮', P: '兵',
    k: '将', a: '士', b: '象', n: '马', r: '车', c: '炮', p: '卒',
  };

  let state = {
    board: null,
    selected: null,        // [r, c]
    hints: [],             // [[r, c], ...]
    lastMove: null,        // { from:[r,c], to:[r,c] }
    interactive: true,
  };

  let canvas = null;
  let ctx = null;
  let cell = 0;            // 每格像素
  let margin = 0;
  let onClick = null;

  function attach(canvasEl) {
    canvas = canvasEl;
    ctx = canvas.getContext('2d');
  }

  function setBoard(board) {
    state.board = board;
  }
  function getBoard() { return state.board; }
  function setSelected(r, c) { state.selected = [r, c]; }
  function setHints(hints) { state.hints = hints; }
  function setLastMove(from, to) { state.lastMove = from && to ? { from, to } : null; }
  function setInteractive(v) { state.interactive = !!v; state.hints = v ? state.hints : []; }

  function bind(cb) { onClick = cb; }

  function size() {
    if (!canvas) return;
    const rect = canvas.parentElement ? canvas.parentElement.getBoundingClientRect() : null;
    const pw = rect ? rect.width : (window.innerWidth - 40);
    const avail = Math.min(pw, 720);
    cell = Math.max(28, Math.floor(avail / 9.4));
    margin = cell * 0.9;
    const W = cell * 8 + margin * 2;
    const H = cell * 9 + margin * 2;
    canvas.width = W;
    canvas.height = H;
  }

  // row,col → 像素（row 0 在底部）
  function pos(r, c) {
    const x = margin + c * cell;
    const y = margin + (9 - r) * cell;
    return { x, y };
  }

  // 像素 → row,col（在格子内返回坐标，否则 null）
  function pick(px, py) {
    const c = Math.round((px - margin) / cell);
    const r = 9 - Math.round((py - margin) / cell);
    if (r < 0 || r > 9 || c < 0 || c > 8) return null;
    return [r, c];
  }

  function draw() {
    if (!ctx || !state.board) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawBoardLines();
    drawStars();
    drawPieces();
  }

  function drawBoardLines() {
    const W = cell * 8;
    const H = cell * 9;
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = '#5a3b22';
    ctx.fillStyle = '#e8c688';
    ctx.fillRect(8, 8, canvas.width - 16, canvas.height - 16);
    ctx.beginPath();
    // 横向线
    for (let r = 0; r <= 9; r++) {
      const y = margin + (9 - r) * cell;
      ctx.moveTo(margin, y);
      ctx.lineTo(margin + W, y);
    }
    // 纵向线（楚河汉界不画中间横穿，分两段）
    for (let c = 0; c <= 8; c++) {
      const x = margin + c * cell;
      // 上半（row 4~9）
      ctx.moveTo(x, margin);
      ctx.lineTo(x, margin + H / 2 - cell / 2);
      // 下半（row 0~4）
      ctx.moveTo(x, margin + H / 2 + cell / 2);
      ctx.lineTo(x, margin + H);
      // 边界垂直整行
      if (c === 0 || c === 8) {
        ctx.moveTo(x, margin);
        ctx.lineTo(x, margin + H);
      }
    }
    // 九宫斜线
    // 红方九宫（row 0~2, col 3~5）
    const p0 = pos(0, 3), p1 = pos(2, 5);
    ctx.moveTo(p0.x, p0.y); ctx.lineTo(p1.x, p1.y);
    const p2 = pos(0, 5), p3 = pos(2, 3);
    ctx.moveTo(p2.x, p2.y); ctx.lineTo(p3.x, p3.y);
    // 黑方九宫（row 7~9）
    const q0 = pos(9, 3), q1 = pos(7, 5);
    ctx.moveTo(q0.x, q0.y); ctx.lineTo(q1.x, q1.y);
    const q2 = pos(9, 5), q3 = pos(7, 3);
    ctx.moveTo(q2.x, q2.y); ctx.lineTo(q3.x, q3.y);
    ctx.stroke();

    // 楚河汉界 文字
    ctx.font = 'bold ' + Math.round(cell * 0.7) + 'px serif';
    ctx.fillStyle = '#7a5a3a';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('楚 河', margin + cell * 2.1, margin + cell * 4);
    ctx.fillText('汉 界', margin + cell * 6.4, margin + cell * 5);
  }

  function drawStars() {
    // 画点：兵/卒位与炮位、九宫角
    ctx.fillStyle = '#5a3b22';
    const dot = (r, c) => { const { x, y } = pos(r, c); ctx.beginPath(); ctx.arc(x, y, cell * 0.08, 0, Math.PI * 2); ctx.fill(); };
    for (let c = 0; c < 9; c += 2) { dot(3, c); dot(6, c); }
    dot(2, 1); dot(2, 7); dot(7, 1); dot(7, 7);
  }

  function drawPieces() {
    const b = state.board;
    for (let r = 0; r < 10; r++) {
      for (let c = 0; c < 9; c++) {
        const p = b[r][c];
        if (p === '.') continue;
        drawPiece(r, c, p);
      }
    }
    // 选中高亮
    if (state.selected) {
      const [r, c] = state.selected;
      const { x, y } = pos(r, c);
      ctx.beginPath();
      ctx.arc(x, y, cell * 0.62, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,180,50,0.45)';
      ctx.fill();
    }
    // 可走提示
    for (const [r, c] of state.hints) {
      const { x, y } = pos(r, c);
      ctx.beginPath();
      ctx.arc(x, y, b[r][c] === '.' ? cell * 0.14 : cell * 0.5, 0, Math.PI * 2);
      ctx.fillStyle = b[r][c] === '.' ? 'rgba(60,140,60,0.8)' : 'rgba(220,80,60,0.5)';
      ctx.fill();
    }
    // 上一步高亮
    if (state.lastMove) {
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(70,130,220,0.85)';
      for (const [r, c] of [state.lastMove.from, state.lastMove.to]) {
        const { x, y } = pos(r, c);
        ctx.beginPath();
        ctx.arc(x, y, cell * 0.58, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  }

  function drawPiece(r, c, p) {
    const { x, y } = pos(r, c);
    const isRed = p === p.toUpperCase();
    const R = cell * 0.56;
    // 外圈
    ctx.beginPath();
    ctx.arc(x, y, R, 0, Math.PI * 2);
    ctx.fillStyle = isRed ? '#f3d9b0' : '#e0c8a0';
    ctx.fill();
    ctx.strokeStyle = isRed ? '#c0392b' : '#2c3e50';
    ctx.lineWidth = Math.max(2, cell * 0.05);
    ctx.stroke();
    // 内圈
    ctx.beginPath();
    ctx.arc(x, y, R * 0.72, 0, Math.PI * 2);
    ctx.strokeStyle = isRed ? '#c0392b' : '#2c3e50';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    // 汉字
    ctx.fillStyle = isRed ? '#c0392b' : '#2c3e50';
    ctx.font = 'bold ' + Math.round(cell * 0.62) + 'px "KaiTi","STKaiti",serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(PIECE_CN[p], x, y + cell * 0.02);
  }

  function handleClick(ev) {
    if (!state.interactive || !onClick) return;
    const rect = canvas.getBoundingClientRect();
    const px = ev.clientX - rect.left;
    const py = ev.clientY - rect.top;
    const xy = pick(px, py);
    if (xy) onClick(xy[0], xy[1]);
  }

  function drawLoop() {
    draw();
    requestAnimationFrame(drawLoop);
  }

  window.Board = {
    attach, setBoard, getBoard, setSelected, setHints, setLastMove,
    setInteractive, bind, size, draw, handleClick, start: drawLoop,
  };

  window.addEventListener('resize', () => {
    if (canvas) { size(); draw(); }
  });
})();