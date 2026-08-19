/* 主逻辑：状态管理、对局流程、人类走棋、AI 调用、终局处理 */
(function () {
  'use strict';
  const X = window.XqRules;
  const Not = window.Notation;

  let state = {
    board: X.initBoard(),
    humanColor: 'red',
    turn: 'red',
    phase: 'idle', // idle | human | ai | over
    history: [],   // { type: 'human'|'ai', color, text, from, to }
    aiComment: '',
    busy: false,
    rounds: 0,
  };

  const STORAGE_KEY = 'xq_ai_config';

  /* ---------- 配置（localStorage） ---------- */
  function loadConfig() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
    } catch (_) { return {}; }
  }
  function saveConfig(cfg) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg)); } catch (_) { /* ignore */ }
  }

  /* ---------- 历史构造：供 AI 提示使用 ---------- */
  function simpleHistory() {
    return state.history.map((h, i) => (i + 1) + '. ' + h.text).join('\n');
  }

  /* ---------- 人类走棋 ---------- */
  function onBoardClick(r, c) {
    if (state.phase !== 'human' || state.busy) return;
    const b = state.board;
    const selected = window.__sel;

    // 未选中：尝试选中己方棋子
    if (!selected) {
      const p = b[r][c];
      if (p !== '.' && X.colorOf(p) === state.humanColor) {
        select(r, c);
      }
      return;
    }
    // 已选中：若点击的是己方另一棋子则切换选中
    const p2 = b[r][c];
    if (p2 !== '.' && X.colorOf(p2) === state.humanColor) {
      select(r, c);
      return;
    }
    // 尝试走棋
    const [fr, fc] = selected;
    const isHint = window.__hints.some(([hr, hc]) => hr === r && hc === c);
    if (!isHint) { clearSelect(); return; }
    if (b[r][c] !== '.' && X.colorOf(b[r][c]) === state.humanColor) { select(r, c); return; }

    doHumanMove(fr, fc, r, c);
  }

  function select(r, c) {
    const hints = X.legalMoves(state.board, state.humanColor)
      .filter(m => m[0] === r && m[1] === c)
      .map(m => [m[2], m[3]]);
    window.__sel = [r, c];
    window.__hints = hints;
    Board.setSelected(r, c);
    Board.setHints(hints);
  }

  function clearSelect() {
    window.__sel = null;
    window.__hints = [];
    Board.setSelected(null, null);
    Board.setHints([]);
  }

  function doHumanMove(fr, fc, tr, tc) {
    clearSelect();
    const b = state.board;
    const capture = b[tr][tc] !== '.';
    const moveText = Not.toNotation(b, fr, fc, tr, tc);
    const nb = X.applyMove(b, fr, fc, tr, tc);
    commitMove(nb, moveText, [fr, fc], [tr, tc], 'human');
    void capture;
  }

  /* ---------- AI 走棋 ---------- */
  async function aiToMove() {
    state.phase = 'ai';
    state.busy = true;
    UI.AIThinking(true);
    UI.setStatus('AI 思考中…', { tone: 'busy' });
    UI.hideTaunt();

    const cfg = loadConfig();
    const opp = state.humanColor === 'red' ? 'black' : 'red';
    const isCheck = X.inCheck(state.board, opp);

    const opt = {
      board: state.board,
      color: opp,
      history: simpleHistory(),
      lastMove: state.history.length ? state.history[state.history.length - 1].text : null,
      checkHint: isCheck ? (opp === 'red' ? '红方' : '黑方') + '正被将军。' : '',
      cfg,
    };
    const result = await window.Ai.getAIMove(opt);

    if (state.phase === 'invalid') { clearBusy(); return; } // 对局已被重置

    // 校验落点
    const mv = result.moveArr;
    if (!mv) {
      UI.AIThinking(false);
      UI.setStatus('AI 出错', { tone: 'err' });
      UI.showTaunt('系统故障也想赢我？做梦。', {});
      // 线性退回：由人类继续或认输
      endGame('resign');
      return;
    }

    const b = state.board;
    const capture = b[mv[2]][mv[3]] !== '.';
    const isCheckNow = X.inCheck(X.applyMove(b, mv[0], mv[1], mv[2], mv[3]), state.humanColor);
    const nb = X.applyMove(b, mv[0], mv[1], mv[2], mv[3]);
    const moveText = Not.toNotation(b, mv[0], mv[1], mv[2], mv[3]);
    commitMove(nb, moveText, [mv[0], mv[1]], [mv[2], mv[3]], 'ai');

    state.aiComment = result.comment || '';
    UI.AIThinking(false);
    UI.setStatus(result.fallback ? 'AI（兜底引擎）走棋' : 'AI 走棋');
    UI.showTaunt(state.aiComment, { check: isCheckNow, capture });
    UI.setEval(result.evaluation ? result.evaluation : '');

    afterMove(nb, result.fallback);
    void isCheck;
  }

  function commitMove(nb, text, from, to, mover) {
    state.board = nb;
    state.turn = state.turn === 'red' ? 'black' : 'red';
    state.rounds++;
    state.history.push({ type: mover, color: mover === 'human' ? state.humanColor : (state.humanColor === 'red' ? 'black' : 'red'), text, from, to });
    Board.setBoard(nb);
    Board.setLastMove(from, to);
    UI.renderHistory(state.history);
    refreshTurn();
  }

  function afterMove(board, aiFallback) {
    const moverColor = state.turn === 'red' ? 'black' : 'red'; // 刚走方已在 commitMove 翻转
    const judge = X.judgeAfterMove(board, moverColor);
    if (judge.winner || judge.reason === 'stalemate') {
      finishGame(judge, aiFallback);
      return;
    }
    if (state.turn === state.humanColor) {
      state.phase = 'human';
      state.busy = false;
      UI.setStatus('轮到你走棋', { tone: '' });
    } else {
      aiToMove();
    }
  }

  function refreshTurn() {
    const t = state.turn;
    const human = state.humanColor;
    UI.setTurn((t === human ? '你（' : 'AI（') + (t === 'red' ? '红方' : '黑方') + '）');
  }

  function finishGame(judge, aiFallback) {
    state.phase = 'over';
    state.busy = false;
    clearSelect();
    UI.AIThinking(false);

    // 计算胜负
    let winnerText, reasonText;
    if (judge.winner === state.humanColor) {
      winnerText = '人类胜';
      reasonText = judge.reason === 'stalemate' ? '困毙' : '将死';
    } else if (judge.winner && judge.winner !== state.humanColor) {
      winnerText = 'AI 胜';
      reasonText = judge.reason === 'stalemate' ? '困毙' : '将死';
    } else {
      winnerText = '和棋';
      reasonText = judge.reason === 'stalemate' ? '困毙（无子可动）' : '和局';
    }

    UI.setStatus('对局结束', { tone: 'over' });

    // 终局评价（异步、不阻塞）
    const phrase = winnerText === 'AI 胜' ? '胜利宣言' : (winnerText === '人类胜' ? '失败感言' : '和棋评论');
    window.Ai.getFinalComment({
      resultText: winnerText, reasonText, rounds: Math.ceil(state.rounds / 2), phrase,
    }, loadConfig()).then(comment => {
      if (comment) {
        UI.showTaunt(comment, { check: true });
      } else if (winnerText === 'AI 胜') {
        UI.showTaunt('我赢，意料之中。你回去再多练练吧。', { check: true });
      }
    });

    const title = winnerText + '！';
    let text = reasonText + '，共 ' + Math.ceil(state.rounds / 2) + ' 回合。';
    if (aiFallback) text += '\n（本次 AI 由本地引擎兜底，接口不可用时依然能虐你）';
    UI.showResult(title, text);
  }

  function endGame(reason) {
    state.phase = 'over';
    state.busy = false;
    clearSelect();
    UI.AIThinking(false);
    const winnerText = 'AI 胜';
    const reasonText = reason === 'resign' ? '人类认输' : '对局中止';
    UI.setStatus('对局结束', { tone: 'over' });
    window.Ai.getFinalComment({
      resultText: winnerText, reasonText, rounds: Math.ceil(state.rounds / 2), phrase: '胜利宣言',
    }, loadConfig()).then(c => UI.showTaunt(c || '认输？识相。', { check: true }));
    UI.showResult('AI 胜！', reasonText + '，共 ' + Math.ceil(state.rounds / 2) + ' 回合。');
  }

  /* ---------- 开始 / 重置 ---------- */
  function startGame(humanColor) {
    state.humanColor = humanColor;
    state.board = X.initBoard();
    state.turn = 'red';
    state.phase = 'human';
    state.busy = false;
    state.history = [];
    state.rounds = 0;
    state.aiComment = '';
    clearSelect();
    Board.setBoard(state.board);
    Board.setLastMove(null, null);
    Board.setHints([]);
    UI.renderHistory([]);
    UI.setEval('');
    UI.hideTaunt();
    UI.setStatus('游戏开始', { tone: '' });

    if (humanColor === 'black') {
      aiToMove();
    } else {
      state.phase = 'human';
      refreshTurn();
    }
  }

  function clearBusy() {
    state.busy = false;
    UI.AIThinking(false);
    UI.setStatus('已重置', {});
  }

  /* ---------- 挂载 ---------- */
  function init() {
    UI.init();
    Board.attach(UI.els.boardCanvas);
    Board.setBoard(state.board);
    Board.bind(onBoardClick);
    Board.size();
    Board.start();

    UI.els.boardCanvas.addEventListener('click', Board.handleClick);

    // 首页选择
    UI.els.chooseRed.addEventListener('click', () => { UI.closeModal('#modal-config'); showHome(false); startGame('red'); });
    UI.els.chooseBlack.addEventListener('click', () => { UI.closeModal('#modal-config'); showHome(false); startGame('black'); });

    // 设置
    UI.els.btnConfig.addEventListener('click', () => UI.showConfig(loadConfig()));
    UI.els.btnConfigg.addEventListener('click', () => UI.showConfig(loadConfig()));
    UI.els.presetDeepSeek.addEventListener('click', () => {
      UI.els.cfgUrl.value = 'https://api.deepseek.com/v1/chat/completions';
      UI.els.cfgModel.value = 'deepseek-v4-flash';
      UI.els.cfgThinking.checked = true;
      UI.els.cfgJsonMode.checked = false;
    });
    UI.els.presetOpenAI.addEventListener('click', () => {
      UI.els.cfgUrl.value = 'https://api.openai.com/v1/chat/completions';
      UI.els.cfgModel.value = 'gpt-4-turbo';
      UI.els.cfgThinking.checked = false;
      UI.els.cfgJsonMode.checked = true;
    });
    UI.els.cfgCancel.addEventListener('click', () => UI.closeModal('#modal-config'));
    UI.els.cfgSave.addEventListener('click', () => {
      const cfg = {
        apiKey: UI.els.cfgKey.value.trim(),
        apiUrl: UI.els.cfgUrl.value.trim(),
        model: UI.els.cfgModel.value.trim(),
        provider: /deepseek/i.test(UI.els.cfgUrl.value) ? 'deepseek' : 'openai',
        disableThinking: UI.els.cfgThinking.checked,
        responseFormat: UI.els.cfgJsonMode.checked,
      };
      if (!cfg.apiKey) { alert('请填写 API Key，否则将使用本地兜底引擎。'); }
      saveConfig(cfg);
      UI.closeModal('#modal-config');
    });

    // 控制
    UI.els.btnRestart.addEventListener('click', () => showHome(true));
    UI.els.btnBack.addEventListener('click', () => showHome(true));
    UI.els.btnResign.addEventListener('click', () => { if (state.phase !== 'over' && state.phase !== 'idle') endGame('resign'); });
    UI.els.resAgain.addEventListener('click', () => { UI.closeModal('#modal-result'); startGame(state.humanColor); });
    UI.els.resBack.addEventListener('click', () => { UI.closeModal('#modal-result'); showHome(true); });

    refreshTurn();
  }

  function showHome(toHome) {
    UI.els.screenHome.classList.toggle('hidden', !toHome);
    UI.els.screenGame.classList.toggle('hidden', toHome);
    if (toHome) {
      state.phase = 'idle';
      Board.setBoard(state.board);
    } else {
      Board.size();
    }
  }

  window.addEventListener('DOMContentLoaded', init);
})();