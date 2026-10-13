// ===================================================================
// WebNT 扫雷
// ===================================================================

const id = 'minesweeper';
const name = '扫雷';
const icon = '\ud83d\udca3';

const ROWS=9, COLS=9, MINES=10;

function launch() {
  let board, revealed, flagged, gameOver, gameStarted;
  function initBoard() {
    board = Array(ROWS).fill(null).map(() => Array(COLS).fill(0));
    revealed = Array(ROWS).fill(null).map(() => Array(COLS).fill(false));
    flagged = Array(ROWS).fill(null).map(() => Array(COLS).fill(false));
    gameOver = false; gameStarted = false;
    // Place mines
    let placed = 0;
    while(placed < MINES) {
      const r = Math.floor(Math.random()*ROWS), c = Math.floor(Math.random()*COLS);
      if(board[r][c] === -1) continue;
      board[r][c] = -1;
      placed++;
    }
    // Calculate numbers
    for(let r=0; r<ROWS; r++)
      for(let c=0; c<COLS; c++) {
        if(board[r][c] === -1) continue;
        let count = 0;
        for(let dr=-1; dr<=1; dr++)
          for(let dc=-1; dc<=1; dc++) {
            if(dr===0 && dc===0) continue;
            const nr=r+dr, nc=c+dc;
            if(nr>=0 && nr<ROWS && nc>=0 && nc<COLS && board[nr][nc]===-1) count++;
          }
        board[r][c] = count;
      }
  }
  function reveal(r, c) {
    if(r<0||r>=ROWS||c<0||c>=COLS||revealed[r][c]||flagged[r][c]||gameOver) return;
    revealed[r][c] = true;
    if(board[r][c] === -1) { gameOver = true; return; }
    if(board[r][c] === 0) {
      for(let dr=-1; dr<=1; dr++)
        for(let dc=-1; dc<=1; dc++)
          reveal(r+dr, c+dc);
    }
  }
  function checkWin() {
    for(let r=0; r<ROWS; r++)
      for(let c=0; c<COLS; c++)
        if(!revealed[r][c] && board[r][c] !== -1) return false;
    return true;
  }
  function renderBoard() {
    const container = document.getElementById('ms-board');
    if(!container) return;
    let html = '';
    for(let r=0; r<ROWS; r++) {
      html += '<div style="display:flex">';
      for(let c=0; c<COLS; c++) {
        let content = '', bg = 'rgba(255,255,255,0.06)', color = '#ccc';
        if(revealed[r][c]) {
          bg = 'rgba(255,255,255,0.02)';
          if(board[r][c] === -1) { content = '\ud83d\udca3'; }
          else if(board[r][c] > 0) {
            content = board[r][c];
            const colors = ['','#4fc3f7','#81c995','#f28b82','#ce93d8','#ff9800','#fdd663','#aaa','#888'];
            color = colors[board[r][c]] || '#fff';
          }
        } else if(flagged[r][c]) {
          content = '\ud83d\udea9'; bg = 'rgba(255,200,50,0.1)';
        }
        if(gameOver && board[r][c] === -1 && !flagged[r][c]) { content = '\ud83d\udca3'; bg = 'rgba(255,0,0,0.2)'; }
        html += `<div data-r="${r}" data-c="${c}" style="width:34px;height:34px;display:flex;align-items:center;justify-content:center;font-size:16px;background:${bg};color:${color};border:1px solid rgba(255,255,255,0.04);cursor:pointer;user-select:none;border-radius:2px">${content}</div>`;
      }
      html += '</div>';
    }
    container.innerHTML = html;
    // Attach click handlers
    container.querySelectorAll('div[data-r]').forEach(cell => {
      cell.addEventListener('click', () => {
        if(gameOver) return;
        const r = parseInt(cell.dataset.r), c = parseInt(cell.dataset.c);
        reveal(r, c);
        if(checkWin()) { gameOver = true; }
        renderBoard();
        const status = document.getElementById('ms-status');
        if(status) {
          if(gameOver && checkWin()) status.textContent = '你赢了! \ud83c\udf89';
          else if(gameOver) status.textContent = '游戏结束 \ud83d\udca5';
          else status.textContent = `雷数: ${MINES}`;
        }
      });
      cell.addEventListener('contextmenu', e => {
        e.preventDefault();
        if(gameOver || revealed[parseInt(cell.dataset.r)][parseInt(cell.dataset.c)]) return;
        const r = parseInt(cell.dataset.r), c = parseInt(cell.dataset.c);
        flagged[r][c] = !flagged[r][c];
        renderBoard();
      });
    });
  }
  initBoard();
  window.showAppWindow('扫雷', '\ud83d\udca3', `
    <style>
      #ms-board { display:inline-block;margin:0 auto; }
    </style>
    <div style="text-align:center">
      <div id="ms-status" style="font-size:14px;margin-bottom:12px;color:#888">雷数: ${MINES}</div>
      <div id="ms-board"></div>
      <button id="ms-restart" style="margin-top:12px;padding:8px 20px;background:rgba(255,255,255,0.08);border:none;color:#e0e0e0;border-radius:8px;cursor:pointer;font-size:13px">新游戏</button>
    </div>
  `);
  // Render after DOM attached
  requestAnimationFrame(() => {
    renderBoard();
    const restartBtn = document.getElementById('ms-restart');
    if(restartBtn) {
      restartBtn.addEventListener('click', () => {
        initBoard();
        renderBoard();
        const status = document.getElementById('ms-status');
        if(status) status.textContent = `雷数: ${MINES}`;
      });
    }
  });
}

export { id, name, icon, launch };