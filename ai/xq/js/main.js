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

  /* ---------- AI 输出日志面板（查看实时指令 / 原始输出 / 解析结果） ---------- */
  let aiTurnSeq = 0;
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function renderAIOut(block) {
    const el = $('ai-out');
    if (!el) return;
    const req = block.req
      ? '<details class="ai-in"><summary>📤 发送的指令（系统识别使用的棋盘）</summary><pre>' + esc(block.req) + '</pre></details>'
      : '';
    const rawAll = (block.reasoning || '') + (block.content || '');
    const rawTail = rawAll.length > 1600 ? '…' + rawAll.slice(-1600) : rawAll;
    const raw = '<details class="ai-in" open><summary>📥 AI 原始输出（思维链 ' + (block.reasoning || '').length +
      ' 字 / 回答 ' + (block.content || '').length + ' 字）</summary><pre class="ai-raw">' + esc(rawTail) + '</pre></details>';
    el.innerHTML = '<div class="ai-block"><div class="ai-block-title">' + esc(block.title) + '</div>' +
      req + raw + '<div class="ai-res">' + (block.result || '…') + '</div></div>';
    el.scrollTop = el.scrollHeight;
    const b = $('ai-out-badge');
    if (b) b.textContent = block.title;
  }

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

  /* ---------- 玩家走子输入（PointerEvent + 触屏/鼠标兜底，滑动忽略） ---------- */
  let tapStart = null;
  function tapAt(x, y) {
    if (state.over || state.thinking || state.turn !== 'player') return;
    if (state.game === 'xiangqi') onPlayerXiangqi({ clientX: x, clientY: y });
    else onPlayerGomoku({ clientX: x, clientY: y });
  }
  function beginTap(x, y) { tapStart = { x, y }; }
  function endTap(x, y) {
    if (!tapStart) return;
    const dx = x - tapStart.x, dy = y - tapStart.y;
    tapStart = null;
    if (Math.hypot(dx, dy) > 12) return; // 滑动/滚动手势，忽略
    tapAt(x, y);
  }

  if (window.PointerEvent) {
    canvas.addEventListener('pointerdown', (ev) => {
      if (ev.pointerType === 'mouse' && ev.button > 0) return;
      beginTap(ev.clientX, ev.clientY);
      try { if (canvas.setPointerCapture) canvas.setPointerCapture(ev.pointerId); } catch (e) {}
    });
    canvas.addEventListener('pointerup', (ev) => endTap(ev.clientX, ev.clientY));
    canvas.addEventListener('pointercancel', () => { tapStart = null; });
  } else {
    // 老浏览器兜底：触屏 + 鼠标
    canvas.addEventListener('touchstart', (ev) => { const t = ev.changedTouches[0]; if (t) beginTap(t.clientX, t.clientY); }, { passive: true });
    canvas.addEventListener('touchend', (ev) => { const t = ev.changedTouches[0]; if (t) endTap(t.clientX, t.clientY); }, { passive: true });
    canvas.addEventListener('mousedown', (ev) => { if (ev.button > 0) return; beginTap(ev.clientX, ev.clientY); });
    canvas.addEventListener('mouseup', (ev) => endTap(ev.clientX, ev.clientY));
  }
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  function onPlayerGomoku(evt) {
    const hit = XqRender.gomokuHit(canvas, evt);
    if (!hit) return;
    if (state.board[hit.r][hit.c] !== 0) return;
    state.board[hit.r][hit.c] = state.playerColor;
    state.moves++;
    addLog('你 落子 (' + hit.r + ',' + hit.c + ')');
    state.thinking = true;
    XqRender.animateGomokuStone(canvas, state.board, hit.r, hit.c, state.playerColor, () => {
      state.thinking = false;
      if (Gomoku.winsAt(state.board, hit.r, hit.c, state.playerColor)) return endGame('你', '五连');
      if (Gomoku.isFull(state.board)) return endGame(null, '和棋（棋盘已满）');
      state.turn = 'ai'; updateTurnUI();
      setTimeout(aiMove, 350);
    });
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
    const captured = state.board[tr][tc] !== '.' && Xq.colorOf(state.board[tr][tc]) !== state.playerColor;
    state.board = Xq.applyMove(state.board, fr, fc, tr, tc);
    state.moves++;
    addLog('你 走子 (' + fr + ',' + fc + ')→(' + tr + ',' + tc + ')');
    state.sel = null; state.opts = [];
    state.thinking = true;
    XqRender.animateXiangqiMove(canvas, state.board, from, to, state.playerColor, { captured }, () => {
      state.thinking = false;
      const w = Xq.judgeAfterMove(state.board, state.playerColor);
      if (w === state.playerColor) return endGame('你', '将军将死');
      if (w === 'draw') return endGame(null, '和棋');
      state.turn = 'ai'; updateTurnUI();
      setTimeout(aiMove, 350);
    });
  }

  /* ---------- AI 走棋 ---------- */
  let abort = null;
  async function aiMove() {
    if (state.over || state.thinking || state.turn !== 'ai') return;
    state.thinking = true;
    setChip('AI 思考中…', 'turn-ai');
    if (abort) abort.abort();
    abort = new AbortController();

    // 实时日志块
    const block = { title: 'AI 第 ' + (++aiTurnSeq) + ' 步', req: '', reasoning: '', content: '', result: '…' };
    renderAIOut(block);
    let lastUi = 0;
    const pump = () => {
      const now = performance.now();
      if (now - lastUi > 100) {
        lastUi = now;
        renderAIOut(block);
        setChip('AI 思考中…（已生成 ' + ((block.reasoning || '').length + (block.content || '').length) + ' 字）', 'turn-ai');
      }
    };
    const live = {
      onReasoning: (t) => { block.reasoning += t; pump(); },
      onContent: (t) => { block.content += t; pump(); },
    };

    try {
      const m = state.game === 'xiangqi'
        ? await xiangqiAITurn(live, block)
        : await gomokuAITurn(live, block);
      if (state.over || !m || !m.move) { state.thinking = false; return; }
      block.result = '✔ 解析成功：' + m.describe;
      renderAIOut(block);
      m.apply();
      state.thinking = false;
    } catch (err) {
      state.thinking = false;
      const msg = 'AI 出错：' + (err && err.message ? err.message : err);
      block.result = '✖ ' + msg;
      renderAIOut(block);
      addLog('⚠ ' + msg);
      setChip('AI 出错', '');
      state.retryFn = () => aiMove();
      show('btn-retry-ai');
    }
  }

  function xiangqiAITurn(live, block) {
    const aiRed = state.aiColor === 'red';
    const system = aiRed
      ? ('你是红方，你的所有棋子都是大写字符：K帅 A仕 B相 N马 R车 C炮 P兵；红方棋子都在棋盘下半部（row 6..9）。对方黑方棋子是小写字符（k a b n r c p），你不要去动它们。\n' +
         '"from" 必须指向一个大写红子，"to" 必须是该子的一次合法走法。')
      : ('你是黑方，你的所有棋子都是小写字符：k将 a士 b象 n马 r车 c炮 p卒；黑方棋子都在棋盘上半部（row 0..3）。对方红方棋子是大写字符（K A B N R C P），你不要去动它们。\n' +
         '"from" 必须指向一个小写黑子，"to" 必须是该子的一次合法走法。') +
      '\n棋盘固定 10 行 × 9 列，row=0..9 自上而下（0 最上、9 最下），col=0..8 自左而右；下面每行字符串恰为 9 个字符，从上到下逐行对应 row=0..9，字符为该格棋子，"." 为空位。棋盘已合法，勿质疑格式。\n' +
      '\n任选一步合法走法即可，不要再分析、不要长篇思考。严禁输出任何解释、推理、markdown 代码块标记或多余字符；只输出一行 JSON，格式精确为：{"from":"R,C","to":"R,C"}。\n' +
      '例如黑方可出马：{"from":"0,7","to":"2,6"}。';

    const user = Xq.boardText(state.board) + '\n\n轮到你（执' + (aiRed ? '红' : '黑') + '方）走棋。只输出一行合法 JSON，格式：{"from":"R,C","to":"R,C"}。';

    return askAI(system, user, (text) => {
      const clean = String(text || '').replace(/```[a-z]*/gi, '').replace(/```/g, '');
      const f = clean.match(/"from"\s*:\s*"?(\d+),(\d+)"?/);
      const t = clean.match(/"to"\s*:\s*"?(\d+),(\d+)"?/);
      if (!f || !t) return null;
      const [fr, fc, tr, tc] = [+f[1], +f[2], +t[1], +t[2]];
      const legal = Xq.legalMoves(state.board, state.aiColor)
        .find(mm => mm[0] === fr && mm[1] === fc && mm[2] === tr && mm[3] === tc);
      return legal ? [fr, fc, tr, tc] : null;
    }, () => Xq.legalMoves(state.board, state.aiColor), live, block);
  }

  function gomokuAITurn(live, block) {
    const aiBlack = state.aiColor === 1;
    const system =
      '你是五子棋 AI，执' + (aiBlack ? '黑子（X）' : '白子（O）') + '。\n' +
      '棋盘固定 15×15，坐标 (row,col)，0≤row≤14，0≤col≤14，左上角 (0,0)。\n' +
      '棋盘以 15 行字符串给出，每行恰为 15 个字符，"." 空位，X 黑子，O 白子（颜色固定，不随执子变化）。棋盘已合法，勿质疑格式。\n' +
      '你只能在空位落子，兼顾防守与进攻。任选一步即可，不必做长篇分析。\n' +
      '严禁输出任何解释、分析、推理、markdown 代码块标记；若思考后也要保证最终输出包含一个合法 JSON。\n' +
      '只输出一行 JSON，唯一格式：{"row":R,"col":C}，例如 {"row":7,"col":7}。';

    const user = Gomoku.boardText(state.board) + '\n\n轮到你（执' + (aiBlack ? '黑 X' : '白 O') + '）落子。只输出一行合法 JSON：{"row":R,"col":C}。';

    return askAI(system, user, (text) => {
      const clean = String(text || '').replace(/```[a-z]*/gi, '').replace(/```/g, '');
      const r = clean.match(/"row"\s*:\s*"?(\d+)"?/);
      const c = clean.match(/"col"\s*:\s*"?(\d+)"?/);
      if (!r || !c) return null;
      const [rr, cc] = [+r[1], +c[1]];
      if (rr < 0 || rr > 14 || cc < 0 || cc > 14 || state.board[rr][cc] !== 0) return null;
      return [rr, cc];
    }, () => {
      // 兜底：任意空位
      for (let i = 0; i < 15; i++) for (let j = 0; j < 15; j++) if (state.board[i][j] === 0) return [i, j];
      return null;
    }, live, block);
  }

  /* 组装并调用模型（流式）；validator 校验坐标，fallback 返回兜底走法 */
  async function askAI(system, initialUser, validator, fallback, live, block) {
    block.req = 'system:\n' + system + '\n\nuser:\n' + initialUser;
    const doChat = (msgs) => S().chat(msgs, {
      signal: abort.signal,
      onReasoning: live && live.onReasoning,
      onContent: live && live.onContent,
    });
    let res = await doChat([{ role: 'system', content: system }, { role: 'user', content: initialUser }]);
    let move = validator(res.content);
    if (!move && res.reasoning) move = validator(res.reasoning); // 个别情况 content 为空
    if (!move) {
      // 二次纠正
      res = await doChat([{ role: 'system', content: system }, { role: 'user', content: initialUser },
        { role: 'user', content: '你刚才的输出不是合法走法，请立刻重新仅输出一个合法 JSON，不要任何其它文字。' }]);
      move = validator(res.content);
      if (!move && res.reasoning) move = validator(res.reasoning);
    }
    if (!move) {
      addLog('⚠ AI 输出无法解析，采用兜底走法');
      block.result = '⚠ AI 输出未通过合法性校验，采用兜底走法';
      move = fallback();
      if (!move) throw new Error('无可用走法');
    }
    const describe = state.game === 'xiangqi'
      ? '(' + move[0] + ',' + move[1] + ')→(' + move[2] + ',' + move[3] + ')'
      : '落子 (' + move[0] + ',' + move[1] + ')';
    return { move, describe, apply: () => applyAIMove(move) };
  }

  function applyAIMove(move) {
    if (state.game === 'xiangqi') {
      const [fr, fc, tr, tc] = move;
      const captured = state.board[tr][tc] !== '.' && Xq.colorOf(state.board[tr][tc]) !== state.aiColor;
      state.board = Xq.applyMove(state.board, fr, fc, tr, tc);
      state.moves++;
      addLog('AI 走子 (' + fr + ',' + fc + ')→(' + tr + ',' + tc + ')');
      state.thinking = true;
      XqRender.animateXiangqiMove(canvas, state.board, [fr, fc], [tr, tc], state.aiColor, { captured }, () => {
        state.thinking = false;
        const w = Xq.judgeAfterMove(state.board, state.aiColor);
        if (w === state.aiColor) return endGame('AI', '将军将死');
        if (w === 'draw') return endGame(null, '和棋');
        state.turn = 'player'; updateTurnUI();
      });
    } else {
      const [r, c] = move;
      state.board[r][c] = state.aiColor;
      state.moves++;
      addLog('AI 落子 (' + r + ',' + c + ')');
      state.thinking = true;
      XqRender.animateGomokuStone(canvas, state.board, r, c, state.aiColor, () => {
        state.thinking = false;
        if (Gomoku.winsAt(state.board, r, c, state.aiColor)) return endGame('AI', '五连');
        if (Gomoku.isFull(state.board)) return endGame(null, '和棋（棋盘已满）');
        state.turn = 'player'; updateTurnUI();
      });
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