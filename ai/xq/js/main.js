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
    lastMove: null,    // 最近一步走法 { who, desc } —— 每次走子后更新，打包给 AI
  };

  const canvasDisp = { mirror: false };

  /* ---------- 棋局打包：生成结构化棋子坐标清单（供 AI 交叉核对） ---------- */
  const XQ_NAMES_RED = { K:'帅', A:'仕', B:'相', N:'马', R:'车', C:'炮', P:'兵' };
  const XQ_NAMES_BLK = { k:'将', a:'士', b:'象', n:'马', r:'车', c:'炮', p:'卒' };
  function xiangqiPieceList(board) {
    const red = [], black = [];
    for (let r = 0; r < board.length; r++) {
      for (let c = 0; c < board[r].length; c++) {
        const p = board[r][c];
        if (p === '.') continue;
        const isRed = p === p.toUpperCase();
        const name = isRed ? (XQ_NAMES_RED[p] || p) : (XQ_NAMES_BLK[p] || p);
        const item = name + '(' + p + ')@(row=' + r + ',col=' + c + ')';
        (isRed ? red : black).push(item);
      }
    }
    return { red, black };
  }
  function gomokuStonesList(board) {
    const black = [], white = [];
    for (let r = 0; r < board.length; r++) {
      for (let c = 0; c < board[r].length; c++) {
        const v = board[r][c];
        if (v === 0) continue;
        const item = '(row=' + r + ',col=' + c + ')';
        (v === 1 ? black : white).push(item);
      }
    }
    return { black, white };
  }

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

  /* ---------- AI 输出日志面板（查看实时指令 / 原始输出 / 解析结果 + 思考计时） ---------- */
  let aiTurnSeq = 0;
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function fmtMs(ms) {
    const t = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
    const mm = (m < 10 ? '0' : '') + m, ss = (s < 10 ? '0' : '') + s;
    return (h > 0 ? h + ':' : '') + mm + ':' + ss;
  }
  function renderAIOut(block) {
    const el = $('ai-out');
    if (!el) return;
    const stat = block.stats || {};
    const thinkingPhase =
      (block.content && block.content.length > 0)
        ? '已输出结论（' + block.content.length + ' 字）'
        : (stat.reasoningChars > 0 ? '思考中…已写 ' + stat.reasoningChars + ' 字' : '等待 AI 首包…');
    const statLine =
      '<div class="ai-stat">' +
      '⏱ <b>' + fmtMs(stat.elapsedMs || 0) + '</b>' +
      (stat.reasoningChars > 0 ? ' · 🧠 思考量 <b>' + stat.reasoningChars.toLocaleString() + '</b> 字' : '') +
      (stat.contentChars > 0 ? ' · ✍ 结论字数 <b>' + stat.contentChars.toLocaleString() + '</b>' : '') +
      ' · 阶段：<b>' + esc(thinkingPhase) + '</b>' +
      '</div>';
    const req = block.req
      ? '<details class="ai-in"><summary>📤 发送的指令（系统识别使用的棋盘）</summary><pre>' + esc(block.req) + '</pre></details>'
      : '';
    const reasoningOnly =
      (block.reasoning && block.reasoning.length)
        ? '<details class="ai-in"><summary>🧠 思维链（' + block.reasoning.length.toLocaleString() + ' 字，可展开查看）</summary><pre class="ai-raw">' +
          esc(block.reasoning.length > 2400 ? (block.reasoning.slice(0, 1200) + '\n…(中间已省略)…\n' + block.reasoning.slice(-1200)) : block.reasoning) +
          '</pre></details>'
        : '';
    const rawContent =
      (block.content && block.content.length)
        ? '<details class="ai-in" open><summary>🎯 系统抽取的【正式输出】content（用于坐标解析）</summary><pre class="ai-raw">' + esc(block.content) + '</pre></details>'
        : '';
    el.innerHTML = '<div class="ai-block"><div class="ai-block-title">' + esc(block.title) + '</div>' +
      statLine + req + reasoningOnly + rawContent +
      '<div class="ai-res">' + (block.result || '…') + '</div></div>';
    el.scrollTop = el.scrollHeight;
    const b = $('ai-out-badge');
    if (b) b.textContent = '⏱ ' + fmtMs(stat.elapsedMs || 0) + (stat.reasoningChars ? ' · 🧠 ' + stat.reasoningChars : '');
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
    state.moves = 0; state.retryFn = null; state.lastMove = null;
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
    if (first === 'ai') { setTimeout(aiMove, 180); } // AI 先手：直接发起走棋
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
      if (ev.cancelable) try { ev.preventDefault(); } catch (e) {} // 抑制移动端滚动/缩放/悬停菜单
      beginTap(ev.clientX, ev.clientY);
      try { if (canvas.setPointerCapture) canvas.setPointerCapture(ev.pointerId); } catch (e) {}
    });
    canvas.addEventListener('pointerup', (ev) => endTap(ev.clientX, ev.clientY));
    canvas.addEventListener('pointercancel', () => { tapStart = null; });
  } else {
    // 老浏览器兜底：触屏 + 鼠标（wzq 风格：把 touchstart 映射为 click）
    canvas.addEventListener('touchstart', (ev) => {
      const t = ev.changedTouches[0];
      if (!t) return;
      if (ev.cancelable) try { ev.preventDefault(); } catch (e) {}
      beginTap(t.clientX, t.clientY);
    }, { passive: false });
    canvas.addEventListener('touchend', (ev) => {
      const t = ev.changedTouches[0];
      if (!t) return;
      if (ev.cancelable) try { ev.preventDefault(); } catch (e) {}
      endTap(t.clientX, t.clientY);
    }, { passive: false });
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
    state.lastMove = { who: 'player', desc: '玩家(' + colorName(state.playerColor, 'gomoku') + ') 落子(' + hit.r + ',' + hit.c + ')' };
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
    state.lastMove = { who: 'player', desc: '玩家(' + colorName(state.playerColor, 'xiangqi') + ') (' + fr + ',' + fc + ')→(' + tr + ',' + tc + ') 棋子' + state.board[tr][tc] };
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
    setChip('AI 思考中…（等待响应）', 'turn-ai');
    if (abort) abort.abort();
    abort = new AbortController();

    // 实时日志块
    const block = {
      title: 'AI 第 ' + (++aiTurnSeq) + ' 步', req: '', reasoning: '', content: '', result: '…',
      stats: { elapsedMs: 0, reasoningChars: 0, reasoningBytes: 0, contentChars: 0 },
    };
    renderAIOut(block);
    const startedAt = performance.now();
    let rafId = 0;
    const stopRaf = () => { if (rafId) cancelAnimationFrame(rafId); rafId = 0; };
    const loopTick = () => {
      // 即便 onProgress 长时间没到，也按 rAF 刷新已流逝时间
      block.stats.elapsedMs = performance.now() - startedAt;
      renderAIOut(block);
      const phase = block.content && block.content.length
        ? '输出结论中（' + fmtMs(block.stats.elapsedMs) + '）'
        : (block.stats.reasoningChars > 0 ? '思考中（' + fmtMs(block.stats.elapsedMs) + ' · ' + block.stats.reasoningChars.toLocaleString() + '字）' : '连接中…（' + fmtMs(block.stats.elapsedMs) + '）');
      setChip('AI ' + phase, 'turn-ai');
      rafId = requestAnimationFrame(loopTick);
    };
    rafId = requestAnimationFrame(loopTick);
    const live = {
      onReasoning: (t) => { block.reasoning += t; },
      onContent: (t) => { block.content += t; },
      onProgress: (p) => { Object.assign(block.stats, p); },
    };

    try {
      const m = state.game === 'xiangqi'
        ? await xiangqiAITurn(live, block)
        : await gomokuAITurn(live, block);
      stopRaf();
      block.stats.elapsedMs = performance.now() - startedAt;
      if (state.over || !m || !m.move) { state.thinking = false; return; }
      block.result = '✔ 解析成功（耗时 ' + fmtMs(block.stats.elapsedMs) + ' · 思考量 ' + block.stats.reasoningChars.toLocaleString() + ' 字）：' + m.describe;
      renderAIOut(block);
      m.apply();
      state.thinking = false;
    } catch (err) {
      stopRaf();
      block.stats.elapsedMs = performance.now() - startedAt;
      state.thinking = false;
      const msg = 'AI 出错：' + (err && err.message ? err.message : err);
      block.result = '✖ ' + msg;
      renderAIOut(block);
      addLog('⚠ ' + msg);
      setChip('AI 出错（' + fmtMs(block.stats.elapsedMs) + '）', '');
      state.retryFn = () => aiMove();
      show('btn-retry-ai');
    }
  }

  function xiangqiAITurn(live, block) {
    const aiRed = state.aiColor === 'red';
    const aiPieceLetter = aiRed ? '大写' : '小写';
    const legalMs = Xq.legalMoves(state.board, state.aiColor);
    const legalMsPreview = legalMs.slice(0, 180).map(m =>
      '  (' + m[0] + ',' + m[1] + ' ' + (state.board[m[0]][m[1]] || '.') + ')→(' + m[2] + ',' + m[3] + ')'
    ).join('\n');
    const boardWHeaders = (function () {
      const colHeader = '   ' + '012345678';
      const rows = Xq.boardText(state.board).split('\n');
      return [colHeader].concat(rows.map((r, i) => (' ' + i).slice(-2) + ' ' + r + ' ' + (' ' + i).slice(-2))).concat([colHeader]).join('\n');
    })();
    // 结构化棋子坐标清单（与网格等价，便于 AI 交叉核对，避免读取网格时列错位）
    const pieces = xiangqiPieceList(state.board);
    const pieceListText =
      '【你方（' + (aiRed ? '红方' : '黑方') + '，' + aiPieceLetter + '）共 ' + (aiRed ? pieces.red.length : pieces.black.length) + ' 子】\n' +
      (aiRed ? pieces.red : pieces.black).map(x => '  ' + x).join('\n') + '\n' +
      '【对方（' + (aiRed ? '黑方' : '红方') + '，' + (aiRed ? '小写' : '大写') + '）共 ' + (aiRed ? pieces.black.length : pieces.red.length) + ' 子】\n' +
      (aiRed ? pieces.black : pieces.red).map(x => '  ' + x).join('\n');
    const lastMoveLine = state.lastMove
      ? '\n📋 最近一步：' + state.lastMove.desc + '\n（现在轮到你走棋，以上是最新局面）\n'
      : '\n（开局第一步，现在轮到你走棋）\n';

    const system =
      '你是中国象棋 AI。\n' +
      '棋盘坐标系：row 行 0..9（0 最上、9 最下），col 列 0..8（0 最左、8 最右），严格从零开始。\n' +
      '红方棋子 = 大写：K帅 A仕 B相 N马 R车 C炮 P兵；黑方棋子 = 小写：k将 a士 b象 n马 r车 c炮 p卒。\n' +
      '你执' + (aiRed ? '红方' : '黑方') + '，你的棋子都是' + aiPieceLetter + '。你只能移动你自己颜色（' + aiPieceLetter + '）的棋子。\n' +
      '\n工作流（必须严格遵守）：\n' +
      '  ① 先进行分析和思考（这些可以放在你自己的思维链里，系统会忽略、不算作你的最终输出）；\n' +
      '  ② 思考完毕后，把【最终决定】作为正式回答输出，并且必须且只能输出一个裸 JSON；\n' +
      '  ③ 最终决定 JSON 格式精确为：{"from":"R,C","to":"R,C"}，R、C 为整数，不要再写解释、代码块、标签、多余字符。\n' +
      '  ⚠ 系统只会提取正式回答里的最后一个 JSON 作为你的最终坐标，草稿和思维链里的任何 JSON 都不会被采信。';

    const user =
      '===== 当前棋局现状（每次都重新打包发送，以下为最新局面）=====\n' +
      '\n【A. 棋盘网格（带行列号，行号=row，列号=col）】\n' +
      boardWHeaders + '\n' +
      '\n【B. 棋子坐标清单（与网格等价，按方分组，每子标注 row/col，便于交叉核对）】\n' +
      pieceListText + '\n' +
      lastMoveLine +
      '\n你执' + (aiRed ? '红方（大写）' : '黑方（小写）') + '。下面列出【当前合法走法全集】(from_row,from_col 棋子)→(to_row,to_col)，你必须从下列候选中挑一条（任选其一即可），不要自己编造：\n' +
      legalMsPreview +
      (legalMs.length > legalMsPreview.length ? '\n（只展示前 ' + legalMsPreview.length + '/' + legalMs.length + ' 条，其他同理。）' : '') +
      '\n\n步骤：① 先按你自己的方式深入思考；② 思考结束后，把最终决定以且仅以一个 JSON 输出，格式：{"from":"R,C","to":"R,C"}。';

    return askAI(system, user, (text) => {
      const clean = String(text || '').replace(/```[a-z]*/gi, '').replace(/```/g, '');
      // 取最后一个 JSON 块（防止正式回答里先写一段话再写 JSON，或者在 JSON 后还有文字）
      const matches = clean.match(/\{[\s\S]*?\}/g);
      const blockJson = matches && matches.length ? matches[matches.length - 1] : clean;
      const f = blockJson.match(/"from"\s*:\s*"?(\d+),(\d+)"?/);
      const t = blockJson.match(/"to"\s*:\s*"?(\d+),(\d+)"?/);
      if (!f || !t) return null;
      const [fr, fc, tr, tc] = [+f[1], +f[2], +t[1], +t[2]];
      const legal = legalMs.find(mm => mm[0] === fr && mm[1] === fc && mm[2] === tr && mm[3] === tc);
      return legal ? [fr, fc, tr, tc] : null;
    }, () => legalMs, live, block);
  }

  function gomokuAITurn(live, block) {
    const aiBlack = state.aiColor === 1;
    const aiMark = aiBlack ? 'X（黑，棋子编码 1）' : 'O（白，棋子编码 2）';
    const oppMark = aiBlack ? 'O（白）' : 'X（黑）';
    const N = state.board.length;
    const boardWHeaders = (function () {
      const hdr = '   ' + Array.from({ length: N }, (_, i) => (' ' + (i % 10)).slice(-1)).join('');
      const rows = Gomoku.boardText(state.board).split('\n');
      return [hdr].concat(rows.map((r, i) => ('  ' + i).slice(-3) + r + ('  ' + i).slice(-3))).concat([hdr]).join('\n');
    })();
    // 结构化已落子坐标清单（按颜色分组）
    const stones = gomokuStonesList(state.board);
    const stonesListText =
      '【黑方 X（棋子编码 1）共 ' + stones.black.length + ' 子】\n' +
      (stones.black.length ? stones.black.map(x => '  ' + x).join('\n') : '  （无）') + '\n' +
      '【白方 O（棋子编码 2）共 ' + stones.white.length + ' 子】\n' +
      (stones.white.length ? stones.white.map(x => '  ' + x).join('\n') : '  （无）');
    const lastMoveLine = state.lastMove
      ? '\n📋 最近一步：' + state.lastMove.desc + '\n（现在轮到你落子，以上是最新局面）\n'
      : '\n（开局第一步，现在轮到你落子）\n';
    const empties = [];
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
      if (state.board[i][j] !== 0) continue;
      let near = 0;
      for (let di = -2; di <= 2; di++) for (let dj = -2; dj <= 2; dj++) {
        const ii = i + di, jj = j + dj;
        if (ii >= 0 && ii < N && jj >= 0 && jj < N && state.board[ii][jj] !== 0) near++;
      }
      empties.push([i, j, near]);
    }
    const hasStone = empties.filter(x => x[2] > 0).sort((a, b) => b[2] - a[2]).slice(0, 200);
    const cand = hasStone.length ? hasStone : empties.slice(0, 200);
    const candList = cand.map(x => '  (' + x[0] + ',' + x[1] + ')').join('\n');

    const system =
      '你是五子棋 AI。棋盘固定 15×15，row/col 均为 0..14，左上角 (0,0)，row 从上到下递增，col 从左到右递增，严格从零开始。\n' +
      '棋盘每行 15 个字符："." 空位，X 黑方，O 白方（颜色固定，与执子无关）。\n' +
      '你执' + aiMark + '，只能在空位落子，尽量阻止对方五连并争取己方五连。\n' +
      '\n工作流（必须严格遵守）：\n' +
      '  ① 先进行分析和思考（这些可以放在你自己的思维链里，系统会忽略、不算作你的最终输出）；\n' +
      '  ② 思考完毕后，把【最终决定】作为正式回答输出，并且必须且只能输出一个裸 JSON；\n' +
      '  ③ 最终决定 JSON 格式精确为：{"row":R,"col":C}，R、C 为整数，不要再写解释、代码块、标签、多余字符。\n' +
      '  ⚠ 系统只会提取正式回答里的最后一个 JSON 作为你的最终坐标，草稿和思维链里的任何 JSON 都不会被采信。';

    const user =
      '===== 当前棋局现状（每次都重新打包发送，以下为最新局面）=====\n' +
      '\n【A. 棋盘网格（带行列号，行号=row，列号=col）】\n' +
      boardWHeaders + '\n' +
      '\n【B. 已落子坐标清单（与网格等价，按颜色分组，每子标注 row/col，便于交叉核对）】\n' +
      stonesListText + '\n' +
      lastMoveLine +
      '\n你执' + aiMark + '，对方执' + oppMark + '。下面列出【当前推荐候选空位】（已按接近已有棋子密度排序，任选其一即可）：\n' +
      candList +
      '\n\n步骤：① 先按你自己的方式深入思考；② 思考结束后，把最终决定以且仅以一个 JSON 输出，格式：{"row":R,"col":C}。';

    return askAI(system, user, (text) => {
      const clean = String(text || '').replace(/```[a-z]*/gi, '').replace(/```/g, '');
      const matches = clean.match(/\{[\s\S]*?\}/g);
      const blockJson = matches && matches.length ? matches[matches.length - 1] : clean;
      const r = blockJson.match(/"row"\s*:\s*"?(\d+)"?/);
      const c = blockJson.match(/"col"\s*:\s*"?(\d+)"?/);
      if (!r || !c) return null;
      const [rr, cc] = [+r[1], +c[1]];
      if (rr < 0 || rr >= N || cc < 0 || cc >= N) return null;
      if (state.board[rr][cc] !== 0) return null;
      return [rr, cc];
    }, () => {
      if (cand.length) return [cand[0][0], cand[0][1]];
      const m7 = (N >> 1);
      return [m7, m7];
    }, live, block);
  }

  /* 组装并调用模型（流式）；validator 校验坐标，fallback 返回兜底走法。
   * ⚠ 系统只解析【正式回答 content】里的最后一个 JSON，绝不采信 reasoning 思维链中的草稿 JSON。 */
  async function askAI(system, initialUser, validator, fallback, live, block) {
    block.req = 'system:\n' + system + '\n\nuser:\n' + initialUser;
    const doChat = (msgs) => S().chat(msgs, {
      signal: abort.signal,
      onReasoning: live && live.onReasoning,
      onContent: live && live.onContent,
      onProgress: live && live.onProgress,
    });
    let res = await doChat([{ role: 'system', content: system }, { role: 'user', content: initialUser }]);
    // 只使用 content（正式回答）解析，不采信思维链草稿
    let move = validator(res.content);
    if (!move && !res.content.trim() && res.reasoning) {
      // 极少数情况下模型把回答也放在了 reasoning_content（非标准），仅 content 为空时退回尝试
      move = validator(res.reasoning);
    }
    if (!move) {
      res = await doChat([
        { role: 'system', content: system }, { role: 'user', content: initialUser },
        { role: 'user', content: '⚠ 你刚才的正式回答里没有包含一个合法可解析的最终 JSON。请重新完整输出最终决定，正式回答必须包含且只包含一个裸 JSON：' + (state.game === 'xiangqi' ? '{"from":"R,C","to":"R,C"}' : '{"row":R,"col":C}') + '。思维链仍然可以写，但最终坐标必须出现在正式回答中。' },
      ]);
      move = validator(res.content);
      if (!move && !res.content.trim() && res.reasoning) move = validator(res.reasoning);
    }
    if (!move) {
      addLog('⚠ AI 正式回答中未找到合法坐标，采用兜底走法');
      block.result = '⚠ AI 正式回答未通过合法性校验，采用兜底走法（思考 ' + block.stats.reasoningChars.toLocaleString() + ' 字）';
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
      state.lastMove = { who: 'ai', desc: 'AI(' + colorName(state.aiColor, 'xiangqi') + ') (' + fr + ',' + fc + ')→(' + tr + ',' + tc + ')' };
      state.thinking = true;
      const displayMirror = (state.game === 'xiangqi' && state.playerColor === 'black');
      XqRender.animateXiangqiMove(canvas, state.board, [fr, fc], [tr, tc], displayMirror ? 'black' : 'red', { captured }, () => {
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
      state.lastMove = { who: 'ai', desc: 'AI(' + colorName(state.aiColor, 'gomoku') + ') 落子(' + r + ',' + c + ')' };
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