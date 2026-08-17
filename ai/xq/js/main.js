/* 主流程：配置、选局、回合调度、AI 对弈 */
(function () {
  const $ = (id) => document.getElementById(id);
  const S = () => window.XQSettings;
  const canvas = $('board');

  const state = {
    game: null,        // 'xiangqi' | 'gomoku'
    board: null,
    playerColor: null, // 玩家执子（象棋: 'red'/'black'; 五子棋: 1/2）
    aiColor: null,
    turn: null,        // 'player' | 'ai'
    over: false,
    thinking: false,
    // 象棋交互
    sel: null,         // 选中的起点(逻辑坐标)
    opts: [],          // 可选落点(逻辑坐标)
    moves: 0,
    log: [],
    retryFn: null,
  };

  const canvasDisp = { mirror: false };

  function colorName(color, game) {
    if (game === 'gomoku') return color === 1 ? '黑' : '白';
    return color === 'red' ? '红' : '黑';
  }

  /* ---------- 界面控制 ---------- */
  function show(id) { $(id).classList.remove('hidden'); }
  function hide(id) { $(id).classList.add('hidden'); }
  function showScreen(s) {
    hide('screen-home'); hide('screen-game');
    show(s);
  }
  function setChip(text, cls) {
    const chip = $('status-chip');
    chip.textContent = text;
    chip.className = 'chip' + (cls ? ' ' + cls : '');
  }
  function addLog(msg) {
    state.log.unshift(msg);
    const el = $('log');
    el.innerHTML = state.log.slice(0, 60).map(m => '<div class="entry">' + m + '</div>').join('');
  }
  function clearLog() { state.log = []; $('log').innerHTML = ''; }

  /* ---------- 配置弹窗 ---------- */
  let pendingGame = null;
  function openConfig() {
    const s = S().loadSettings();
    $('cfg-key').value = s.key || '';
    $('cfg-url').value = s.url || '';
    $('cfg-model').value = s.model || '';
    show('modal-config');
  }
  function closeConfig() { hide('modal-config'); }
  function saveConfig() {
    S().saveSettings({
      key: $('cfg-key').value.trim(),
      url: $('cfg-url').value.trim(),
      model: $('cfg-model').value.trim(),
    });
    closeConfig();
    if (pendingGame) { const g = pendingGame; pendingGame = null; startGame(g); }
  }
  $('cfg-save').addEventListener('click', saveConfig);
  $('cfg-cancel').addEventListener('click', closeConfig);
  $('btn-settings').addEventListener('click', openConfig);
  $('cfg-show').addEventListener('change', (e) => {
    $('cfg-key').type = e.target.checked ? 'text' : 'password';
  });

  /* ---------- 选局 ---------- */
  function requestStart(game) {
    if (!S().hasSettings()) { pendingGame = game; openConfig(); return; }
    startGame(game);
  }
  $('card-xiangqi').addEventListener('click', () => requestStart('xiangqi'));
  $('card-gomoku').addEventListener('click', () => requestStart('gomoku'));
  $('btn-back').addEventListener('click', backToLobby);
  $('btn-restart').addEventListener('click', restart);
  $('res-again').addEventListener('click', restart);
  $('res-back').addEventListener('click', backToLobby);

  function backToLobby() {
    state.over = true; // 终止可能的 AI 请求
    pendingGame = null;
    hide('modal-result');
    showScreen('screen-home');
  }
  function restart() {
    if (state.game) startGame(state.game);
  }

  /* ---------- 对局启动 ---------- */
  function startGame(game) {
    hide('modal-result');
    showScreen('screen-game');
    const first = Math.random() < 0.5 ? 'player' : 'ai'; // 随机先手
    state.game = game;
    state.over = false;
    state.thinking = false;
    state.sel = null; state.opts = [];
    state.moves = 0; state.retryFn = null;
    clearLog();

    if (game === 'xiangqi') {
      state.board = Xq.initBoard();
      state.playerColor = first === 'player' ? 'red' : 'black';
      state.aiColor = first === 'player' ? 'black' : 'red';
      $('game-title').textContent = '中国象棋';
    } else {
      state.board = Gomoku.initBoard(15);
      state.playerColor = first === 'player' ? 1 : 2; // 先手为黑
      state.aiColor = first === 'player' ? 2 : 1;
      $('game-title').textContent = '五子棋';
    }

    state.turn = first;
    canvasDisp.mirror = (game === 'xiangqi' && state.playerColor === 'black');

    $('side-info').innerHTML =
      '你执 <b>' + colorName(state.playerColor, game) + '</b>' + (game === 'gomoku' ? '（' + (state.playerColor === 1 ? '●' : '○') + '）' : '') +
      '<br>AI 执 <b>' + colorName(state.aiColor, game) + '</b>' + (game === 'gomoku' ? '（' + (state.aiColor === 1 ? '●' : '○') + '）' : '') +
      '<br>先手：' + (first === 'player' ? '你' : 'AI') +
      (game === 'xiangqi' ? '<br><span style="color:#8b95a3;font-size:12px">规则：将军不死、将死判负。点击己方棋子再点目标落子。</span>' : '');

    render();
    addLog('对局开始 · ' + (first === 'player' ? '你先手' : 'AI 先手'));
    updateTurnUI();
  }

  function updateTurnUI() {
    if (state.over) return;
    if (state.turn === 'player') {
      setChip('轮到你 · ' + colorName(state.playerColor, state.game), 'turn-you');
    } else {
      setChip('AI 思考中…', 'turn-ai');
    }
  }

  /* ---------- 渲染 ---------- */
  function render() {
    if (state.game === 'xiangqi') XqRender.drawXiangqi(canvas, state.board, state.playerColor);
    else XqRender.drawGomoku(canvas, state.board);
    // 象棋选中标记
    if (state.game === 'xiangqi' && state.sel && state.opts.length) {
      const tf = (lr, lc) => canvasDisp.mirror ? [9 - lr, 8 - lc] : [lr, lc];
      XqRender.markXiangqi(canvas, [tf(state.sel[0], state.sel[1])], 'from');
      XqRender.markXiangqi(canvas, state.opts.map(o => tf(o[0], o[1])), 'to');
    }
  }

  function toLogical(hit) {
    if (state.game === 'gomoku') return hit;
    return canvasDisp.mirror ? [9 - hit.r, 8 - hit.c] : [hit.r, hit.c];
  }

  /* ---------- 玩家点击 ---------- */
  canvas.addEventListener('click', (evt) => {
    if (state.over || state.thinking || state.turn !== 'player') return;
    if (state.game === 'xiangqi') onPlayerXiangqi(evt);
    else onPlayerGomoku(evt);
  });

  function onPlayerGomoku(evt) {
    const hit = XqRender.gomokuHit(canvas, evt);
    if (!hit) return;
    if (state.board[hit.r][hit.c] !== 0) return;
    state.board[hit.r][hit.c] = state.playerColor;
    state.moves++;
    addLog('你 落子 (' + hit.r + ',' + hit.c + ')');
    render();
    if (Gomoku.winsAt(state.board, hit.r, hit.c, state.playerColor)) return endGame('你', '五连');
    if (Gomoku.isFull(state.board)) return endGame(null, '和棋（棋盘已满）');
    state.turn = 'ai'; updateTurnUI();
    setTimeout(aiMove, 350);
  }

  function onPlayerXiangqi(evt) {
    const hit = XqRender.xiangqiHit(canvas, evt);
    if (!hit) return;
    const logical = toLogical(hit);
    const [lr, lc] = logical;
    const piece = state.board[lr][lc];
    const isPlayerPiece = piece !== '.' && Xq.colorOf(piece) === state.playerColor;

    if (state.sel) {
      // 是否为目标落点
      const targetIdx = state.opts.findIndex(o => o[0] === lr && o[1] === lc);
      if (targetIdx >= 0) {
        execXiangqiMove(state.sel, [lr, lc]);
        return;
      }
      if (isPlayerPiece) { selectPiece(lr, lc); return; }
      // 未选到合法点时取消选中
      state.sel = null; state.opts = [];
      render(); updateTurnUI(); return;
    }
    if (isPlayerPiece) selectPiece(lr, lc);
  }

  function selectPiece(lr, lc) {
    state.sel = [lr, lc];
    state.opts = Xq.legalMoves(state.board, state.playerColor)
      .filter(m => m[0] === lr && m[1] === lc)
      .map(m => [m[2], m[3]]);
    render();
    setChip('你执' + colorName(state.playerColor, state.game) + ' · 选择落点', 'turn-you');
  }

  function execXiangqiMove(from, to) {
    const [fr, fc] = from, [tr, tc] = to;
    state.board = Xq.applyMove(state.board, fr, fc, tr, tc);
    state.moves++;
    addLog('你 走子 (' + fr + ',' + fc + ')→(' + tr + ',' + tc + ')');
    state.sel = null; state.opts = [];
    render();
    const w = Xq.judgeAfterMove(state.board, state.playerColor);
    if (w === state.playerColor) return endGame('你', '将军将死');
    if (w === 'draw') return endGame(null, '和棋');
    state.turn = 'ai'; updateTurnUI();
    setTimeout(aiMove, 350);
  }

  /* ---------- AI 走棋 ---------- */
  let abort = null;
  async function aiMove() {
    if (state.over || state.thinking || state.turn !== 'ai') return;
    state.thinking = true;
    setChip('AI 思考中…', 'turn-ai');
    if (abort) abort.abort();
    abort = new AbortController();
    const timeout = setTimeout(() => abort && abort.abort(), 90 * 1000);

    try {
      const m = state.game === 'xiangqi'
        ? await xiangqiAITurn()
        : await gomokuAITurn();
      if (state.over || !m.apply) { state.thinking = false; return; }
      m.apply();
      state.thinking = false;
    } catch (err) {
      state.thinking = false;
      const msg = 'AI 出错：' + (err && err.message ? err.message : err);
      addLog('⚠ ' + msg);
      setChip('AI 出错', '');
      state.retryFn = () => aiMove();
      show('btn-retry-ai');
    } finally {
      clearTimeout(timeout);
    }
  }

  function xiangqiAITurn() {
    const aiRed = state.aiColor === 'red';
    const system =
      '你是中国象棋 AI，执' + (aiRed ? '红方（大写棋子 K帅 A仕 B相 N马 R车 C炮 P兵）' : '黑方（小写棋子 k将 a士 b象 n马 r车 c炮 p卒）') + '，与人类对弈。\n' +
      '棋盘为 10 行 × 9 列。坐标用 (row,col)：row 从 0 到 9（0 是最上方一行，9 是最下方一行），col 从 0 到 8（从左到右）。\n' +
      '系统会以字符串网格给出当前棋盘，每行一个字符串、共 10 行，从上到下对应 row 0 到 9；每个字符代表该交叉点上的棋子，"." 表示空位。\n' +
      '你只能移动自己颜色（' + (aiRed ? '大写' : '小写') + '）的棋子，并且必须符合中国象棋规则（不能把自己将暴露在将军威胁下）。每回合只走一步。\n' +
      '请根据棋盘选一步对你有利的合法棋，严格输出且仅输出一个 JSON 对象，不要输出任何其它文字、解释或标点，格式如下：\n' +
      '{"from":"R,C","to":"R,C"}\n' +
      '其中 R,C 是整数，例如：{"from":"9,4","to":"8,4"}。';

    const user = Xq.boardText(state.board) + '\n\n轮到你（执' + (aiRed ? '红' : '黑') + '方）走棋。请仅输出一个 JSON：{"from":"R,C","to":"R,C"}。';

    return askAI(system, user, (text) => {
      const m = text.match(/"from"\s*:\s*"(\d+),(\d+)"[\s\S]*?"to"\s*:\s*"(\d+),(\d+)"/);
      if (!m) return null;
      const [fr, fc, tr, tc] = [+m[1], +m[2], +m[3], +m[4]];
      const legal = Xq.legalMoves(state.board, state.aiColor)
        .find(mm => mm[0] === fr && mm[1] === fc && mm[2] === tr && mm[3] === tc);
      return legal ? [fr, fc, tr, tc] : null;
    }, () => Xq.legalMoves(state.board, state.aiColor));
  }

  function gomokuAITurn() {
    const aiBlack = state.aiColor === 1;
    const system =
      '你是五子棋 AI，执' + (aiBlack ? '黑子（X）' : '白子（O）') + '与人类对弈。\n' +
      '棋盘 15×15，坐标 (row,col)，0≤row≤14，0≤col≤14，左上角为 (0,0)。\n' +
      '系统会以网格给出棋盘：每行一个字符串共 15 行，"." 为空位，X 为黑子，O 为白子（棋子颜色固定，不随执子变化）。\n' +
      '你执' + (aiBlack ? '黑（X）' : '白（O）') + '，只能在空位落子，尽量阻止对方五连并争取己方五连。\n' +
      '严格输出且仅输出一个 JSON 对象，格式如下，不要输出任何其它文字：\n' +
      '{"row":R,"col":C}\n' +
      '例如：{"row":7,"col":7}。';

    const user = Gomoku.boardText(state.board) + '\n\n轮到你（执' + (aiBlack ? '黑 X' : '白 O') + '）落子。请仅输出一个 JSON：{"row":R,"col":C}。';

    return askAI(system, user, (text) => {
      const m = text.match(/"row"\s*:\s*(\d+)[\s\S]*?"col"\s*:\s*(\d+)/);
      if (!m) return null;
      const [r, c] = [+m[1], +m[2]];
      if (r < 0 || r > 14 || c < 0 || c > 14 || state.board[r][c] !== 0) return null;
      return [r, c];
    }, () => {
      // 兜底：任意空位
      for (let i = 0; i < 15; i++) for (let j = 0; j < 15; j++) if (state.board[i][j] === 0) return [i, j];
      return null;
    });
  }

  /* 组装并调用模型；validator 校验坐标，fallback 返回兜底走法 */
  async function askAI(system, initialUser, validator, fallback) {
    const messages = [{ role: 'system', content: system }, { role: 'user', content: initialUser }];
    let text;
    text = await S().chat(messages, { signal: abort.signal });
    let move = validator(text);
    if (!move) {
      // 二次纠正
      text = await S().chat(messages.concat({ role: 'user', content: '你刚才的输出不是合法走法，请重新仅输出一个合法 JSON。' }), { signal: abort.signal });
      move = validator(text);
    }
    if (!move) {
      addLog('⚠ AI 输出无法解析，采用兜底走法');
      move = fallback();
      if (!move) throw new Error('无可用走法');
    }
    return {
      apply: () => applyAIMove(move),
    };
  }

  function applyAIMove(move) {
    if (state.game === 'xiangqi') {
      const [fr, fc, tr, tc] = move;
      state.board = Xq.applyMove(state.board, fr, fc, tr, tc);
      state.moves++;
      addLog('AI 走子 (' + fr + ',' + fc + ')→(' + tr + ',' + tc + ')');
      render();
      const w = Xq.judgeAfterMove(state.board, state.aiColor);
      if (w === state.aiColor) return endGame('AI', '将军将死');
      if (w === 'draw') return endGame(null, '和棋');
      state.turn = 'player'; updateTurnUI();
    } else {
      const [r, c] = move;
      state.board[r][c] = state.aiColor;
      state.moves++;
      addLog('AI 落子 (' + r + ',' + c + ')');
      render();
      if (Gomoku.winsAt(state.board, r, c, state.aiColor)) return endGame('AI', '五连');
      if (Gomoku.isFull(state.board)) return endGame(null, '和棋（棋盘已满）');
      state.turn = 'player'; updateTurnUI();
    }
  }

  /* 手动重试 AI */
  $('btn-retry-ai').addEventListener('click', () => {
    hide('btn-retry-ai');
    if (state.retryFn) { const fn = state.retryFn; state.retryFn = null; fn(); }
  });

  /* ---------- 胜负 ---------- */
  function endGame(winner, reason) {
    state.over = true;
    hide('btn-retry-ai');
    const youWon = winner === '你';
    $('result-title').textContent = winner ? (youWon ? '🎉 你赢了！' : '🤖 AI 获胜') : '和棋';
    $('result-text').textContent = reason + (winner ? ' · ' + colorName(winner === '你' ? state.playerColor : state.aiColor, state.game) + '方获胜' : '');
    show('modal-result');
    setChip('对局结束', '');
  }

})();