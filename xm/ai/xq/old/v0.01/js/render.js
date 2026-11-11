/* Canvas 棋盘渲染 */
(function () {
  // 象棋参数
  const XC = { cell: 56, margin: 48, cols: 9, rows: 10 };
  const XQ_W = XC.margin * 2 + (XC.cols - 1) * XC.cell;
  const XQ_H = XC.margin * 2 + (XC.rows - 1) * XC.cell;
  const XQ_CHAR = { K: '帅', A: '仕', B: '相', N: '马', R: '车', C: '炮', P: '兵',
                    k: '将', a: '士', b: '象', n: '马', r: '车', c: '炮', p: '卒' };
  const XQ_COLOR = { red: '#c33a2f', black: '#2a2e33' };

  // 五子棋参数
  const GK = { cell: 40, margin: 34, size: 15 };
  const GK_PX = GK.margin * 2 + (GK.size - 1) * GK.cell;

  function setup(canvas, w, h, dpr) {
    const d = dpr || Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = w * d;
    canvas.height = h * d;
    canvas.getContext('2d').setTransform(d, 0, 0, d, 0, 0);
    return canvas.getContext('2d');
  }

  function r2d(r, c) { return [XC.margin + c * XC.cell, XC.margin + r * XC.cell]; }

  function drawXiangqi(canvas, board, playerColor) {
    const ctx = setup(canvas, XQ_W, XQ_H);
    ctx.fillStyle = '#bda272';
    ctx.fillRect(0, 0, XQ_W, XQ_H);
    // 木纹底色渐变
    const grad = ctx.createLinearGradient(0, 0, XQ_W, XQ_H);
    grad.addColorStop(0, '#c9ab6f'); grad.addColorStop(1, '#b2905a');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, XQ_W, XQ_H);

    ctx.strokeStyle = '#5a4425';
    ctx.lineWidth = 1.5;
    // 横线
    for (let r = 0; r < 10; r++) {
      const y = XC.margin + r * XC.cell;
      ctx.beginPath(); ctx.moveTo(XC.margin, y); ctx.lineTo(XQ_W - XC.margin, y); ctx.stroke();
    }
    // 纵线（中间留河界）
    for (let c = 0; c < 9; c++) {
      const x = XC.margin + c * XC.cell;
      ctx.beginPath(); ctx.moveTo(x, XC.margin); ctx.lineTo(x, XC.margin + 4 * XC.cell); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x, XC.margin + 5 * XC.cell); ctx.lineTo(x, XQ_H - XC.margin); ctx.stroke();
    }
    // 九宫斜线（己方看：红下黑上，这里固定黑上红下 = 逻辑方向）
    for (const [r0, r1] of [[0, 2], [7, 9]]) {
      const x0 = XC.margin + 3 * XC.cell, x1 = XC.margin + 5 * XC.cell;
      ctx.beginPath(); ctx.moveTo(x0, XC.margin + r0 * XC.cell); ctx.lineTo(x1, XC.margin + r1 * XC.cell); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x1, XC.margin + r0 * XC.cell); ctx.lineTo(x0, XC.margin + r1 * XC.cell); ctx.stroke();
    }
    // 河界文字
    ctx.fillStyle = '#6b5228'; ctx.font = '22px serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('楚 河', XC.margin + 2 * XC.cell, XC.margin + 4.5 * XC.cell);
    ctx.fillText('汉 界', XC.margin + 6 * XC.cell, XC.margin + 4.5 * XC.cell);

    // 棋子（玩家在下 → 根据 playerColor 做旋转映射）
    const mirror = playerColor === 'black';
    const disp = (lr, lc) => mirror ? [9 - lr, 8 - lc] : [lr, lc];
    for (let r = 0; r < 10; r++) {
      for (let c = 0; c < 9; c++) {
        const p = board[r][c];
        if (p === '.') continue;
        const [dr, dc] = disp(r, c);
        const [x, y] = r2d(dr, dc);
        const colr = XQ_COLOR[board[r][c] === board[r][c].toUpperCase() ? 'red' : 'black'] || '#000';
        // 木纹上的棋子
        drawPiece(ctx, x, y, XC.cell * 0.44, colr, XQ_CHAR[p] || p);
      }
    }
    // 选中标记由调用方叠加
    return { mirror, cell: XC.cell, margin: XC.margin };
  }

  function drawPiece(ctx, x, y, r, fill, ch) {
    ctx.shadowColor = 'rgba(0,0,0,.35)'; ctx.shadowBlur = 4; ctx.shadowOffsetY = 2;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = '#f5ecd8'; ctx.fill();
    ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
    ctx.lineWidth = 2; ctx.strokeStyle = '#5a4425'; ctx.stroke();
    ctx.beginPath(); ctx.arc(x, y, r * 0.82, 0, Math.PI * 2);
    ctx.strokeStyle = fill; ctx.stroke();
    ctx.fillStyle = fill; ctx.font = Math.floor(r * 1.15) + 'px serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(ch, x, y + 1);
  }

  function drawGomoku(canvas, board) {
    const ctx = setup(canvas, GK_PX, GK_PX);
    ctx.fillStyle = '#dfc78f';
    ctx.fillRect(0, 0, GK_PX, GK_PX);
    const grad = ctx.createLinearGradient(0, 0, GK_PX, GK_PX);
    grad.addColorStop(0, '#e6d19a'); grad.addColorStop(1, '#d0b471');
    ctx.fillStyle = grad; ctx.fillRect(0, 0, GK_PX, GK_PX);

    ctx.strokeStyle = '#6b5228'; ctx.lineWidth = 1.4;
    for (let i = 0; i < GK.size; i++) {
      const a = GK.margin + i * GK.cell;
      ctx.beginPath(); ctx.moveTo(a, GK.margin); ctx.lineTo(a, GK_PX - GK.margin); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(GK.margin, a); ctx.lineTo(GK_PX - GK.margin, a); ctx.stroke();
    }
    // 星位
    for (const [x, y] of [[3, 3], [11, 3], [7, 7], [3, 11], [11, 11]]) {
      ctx.beginPath(); ctx.arc(GK.margin + x * GK.cell, GK.margin + y * GK.cell, 4, 0, Math.PI * 2); ctx.fillStyle = '#6b5228'; ctx.fill();
    }
    const n = board.length;
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        const v = board[r][c];
        if (v === 0) continue;
        const x = GK.margin + c * GK.cell, y = GK.margin + r * GK.cell;
        ctx.beginPath(); ctx.arc(x, y, GK.cell * 0.42, 0, Math.PI * 2);
        if (v === 1) { ctx.fillStyle = '#1b1d20'; } else { ctx.fillStyle = '#f5f2ea'; }
        ctx.fill();
        ctx.lineWidth = 1.6; ctx.strokeStyle = 'rgba(0,0,0,.3)'; ctx.stroke();
      }
    }
  }

  /* 把画布上的像素点转为网格索引（显示空间） */
  function toIndex(evt, canvas, margin, cell) {
    const rect = canvas.getBoundingClientRect();
    const scaleW = canvas.width / rect.width;
    const scaleH = canvas.height / rect.height;
    const x = (evt.clientX - rect.left) * scaleW;
    const y = (evt.clientY - rect.top) * scaleH;
    const c = Math.round((x - margin) / cell);
    const r = Math.round((y - margin) / cell);
    return { r, c };
  }

  function xiangqiHit(canvas, evt) {
    const idx = toIndex(evt, canvas, XC.margin, XC.cell);
    if (idx.r < 0 || idx.r > 9 || idx.c < 0 || idx.c > 8) return null;
    return idx;
  }
  function gomokuHit(canvas, evt) {
    const idx = toIndex(evt, canvas, GK.margin, GK.cell);
    if (idx.r < 0 || idx.r >= GK.size || idx.c < 0 || idx.c >= GK.size) return null;
    return idx;
  }
  /* 在象棋棋盘上叠加标记。cells 为显示空间 [dr,dc]；kind: 'from' | 'to' */
  function markXiangqi(canvas, cells, kind) {
    const ctx = canvas.getContext('2d');
    ctx.save();
    for (const [r, c] of cells) {
      const x = XC.margin + c * XC.cell, y = XC.margin + r * XC.cell;
      if (kind === 'from') {
        ctx.strokeStyle = '#1a7a3c'; ctx.lineWidth = 4;
      } else {
        ctx.strokeStyle = 'rgba(20,120,40,.85)'; ctx.lineWidth = 3;
      }
      ctx.beginPath(); ctx.arc(x, y, XC.cell * 0.44 + 2, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.restore();
  }

  /* 在五子棋盘上标记一个落点 */
  function markGomoku(canvas, r, c) {
    const ctx = canvas.getContext('2d');
    const x = GK.margin + c * GK.cell, y = GK.margin + r * GK.cell;
    ctx.save();
    ctx.strokeStyle = 'rgba(220,60,60,.9)'; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.arc(x, y, GK.cell * 0.5, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  }

  window.XqRender = { drawXiangqi, drawGomoku, xiangqiHit, gomokuHit, markXiangqi, markGomoku };
})();