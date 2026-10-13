/* AI 对接：OpenAI API 调用 + 重试机制 + 兜底引擎
 * 依赖 window.XqRules、window.Notation、window.PromptTemplates
 */
(function () {
  'use strict';

  /* 调用 OpenAI / DeepSeek 兼容的 Chat Completions 接口 */
  async function callAI(messages, cfg) {
    const url = cfg.apiUrl || 'https://api.openai.com/v1/chat/completions';
    const headers = { 'Content-Type': 'application/json' };
    if (cfg.apiKey) headers['Authorization'] = 'Bearer ' + cfg.apiKey;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), (cfg.timeout || 60000));
    try {
      const body = {
        model: cfg.model || 'gpt-4-turbo',
        messages,
        temperature: cfg.temperature != null ? cfg.temperature : 0.3,
        max_tokens: cfg.maxTokens || 80,
      };
      // 强制 JSON 输出（DeepSeek 不支持时请关闭 responseFormat）
      if (cfg.responseFormat && cfg.provider !== 'deepseek') {
        body.response_format = { type: 'json_object' };
      }
      // 关闭思考模式（DeepSeek 的 thinking.type=disabled）
      if (cfg.disableThinking) {
        body.thinking = { type: 'disabled' };
      }
      const resp = await fetch(url, {
        method: 'POST',
        headers,
        signal: controller.signal,
        body: JSON.stringify(body),
      });
      if (!resp.ok) {
        const t = await resp.text();
        throw new Error('HTTP ' + resp.status + ': ' + t.slice(0, 200));
      }
      const data = await resp.json();
      return data.choices && data.choices[0] && data.choices[0].message
        ? data.choices[0].message.content
        : null;
    } finally {
      clearTimeout(timer);
    }
  }

  /* 从接口原始文本中稳健地提取 JSON 对象 */
  function extractJSON(text) {
    if (typeof text !== 'string') return null;
    const cleaned = text.replace(/```json|```/g, '').trim();
    try { return JSON.parse(cleaned); } catch (_) { /* ignore */ }
    const m = cleaned.match(/\{[\s\S]*\}/);
    if (m) {
      try { return JSON.parse(m[0]); } catch (_) { /* ignore */ }
    }
    return null;
  }

  /* 将走法字符串解析为内部坐标；非法返回 null */
  function resolveNotation(moveStr, board, color) {
    if (!moveStr || typeof moveStr !== 'string') return null;
    let s = moveStr.trim();
    // 去除常见多余字符（如 "、"、"可"、"走"，或数字围措）
    s = s.replace(/[，、。\s“”"'（）()]+/g, '');
    const m = window.Notation.parseMove(s, board, color);
    return m || null;
  }

  /* 获取 AI 走法（含最多3次重试）
   * opts: { board, color, history, lastMove, checkHint, cfg }
   * 返回：{ moveText, moveArr, comment, evaluation, strategy, attempts, fallback }
   */
  async function getAIMove(opts) {
    const cfg = opts.cfg;
    const { board, color } = opts;
    const sys = window.PromptTemplates.SYSTEM_PROMPT;
    const userMessage = () =>
      window.PromptTemplates.buildUserMessage({
        rows: boardToPromptRows(board),
        turn: color === 'red' ? '红方' : '黑方',
        history: opts.history,
        lastMove: opts.lastMove,
        checkHint: opts.checkHint,
      });

    let user = userMessage();
    let lastErr = '';

    for (let attempt = 0; attempt < 3; attempt++) {
      const messages = [
        { role: 'system', content: sys },
        { role: 'user', content: user },
      ];
      let text;
      try {
        text = await callAI(messages, cfg);
      } catch (e) {
        lastErr = e.message || String(e);
        break; // 网络 / 鉴权类错误：不重试内容，直接进入 fallback
      }
      const obj = extractJSON(text);
      const moveStr = obj && obj.move;
      const moveArr = moveStr ? resolveNotation(moveStr, board, color) : null;
      if (moveArr) {
        return {
          moveText: moveStr,
          moveArr,
          comment: obj.comment || '',
          evaluation: obj.evaluation || '',
          strategy: obj.strategy || '',
          attempts: attempt + 1,
          fallback: false,
        };
      }
      lastErr = '非法或无法解析的走法: ' + (moveStr || '(空)');
      user = userMessage() + window.PromptTemplates.INVALID_MOVE_HINT;
      await delay(cfg.delayMs ?? 300);
    }
    // 兜底引擎
    const fb = fallbackMove(board, color);
    return {
      moveText: fb.text,
      moveArr: fb.move,
      comment: fb.comment,
      evaluation: '',
      strategy: '',
      attempts: 3,
      fallback: true,
      error: lastErr,
    };
  }

  /* 获取终局评价 */
  async function getFinalComment(result, cfg) {
    const sys = window.PromptTemplates.SYSTEM_PROMPT;
    const user = window.PromptTemplates.buildFinalMessage({
      result: result.resultText,
      reason: result.reasonText,
      rounds: result.rounds,
      phrase: result.phrase,
    });
    try {
      const text = await callAI([{ role: 'system', content: sys }, { role: 'user', content: user }], cfg);
      const obj = extractJSON(text);
      if (obj && obj.final_comment) return obj.final_comment;
      return null;
    } catch (_e) {
      return null;
    }
  }

  /* ---------- 兜底引擎：简单评估 + 贪心走法，保证 AI 不出非法步 ---------- */
  /* 简单子力价值：车9 马4 炮4.5 士相马2 兵卒过河后高 */
  const PIECE_VAL = {
    R: 9, C: 4.5, N: 4, B: 2, A: 2, P: 2,
    r: 9, c: 4.5, n: 4, b: 2, a: 2, p: 2,
  };

  function fallbackMove(board, color) {
    const legals = window.XqRules.legalMoves(board, color);
    if (!legals.length) return { move: null, text: '', comment: '（无子可动）' };
    const enemyKing = color === 'red' ? 'k' : 'K';
    let best = null, bestScore = -Infinity;
    for (const mv of legals) {
      const nb = window.XqRules.applyMove(board, mv[0], mv[1], mv[2], mv[3]);
      const target = nb[mv[2]][mv[3]];
      let score = Math.random() * 1;
      // 吃子奖励
      if (target !== '.') score += (PIECE_VAL[target.toUpperCase()] || 1) * 10;
      // 直接吃敌将 → 胜势
      if (target === enemyKing) score += 1000;
      // 走完是否能把对手带向将军
      const opp = color === 'red' ? 'black' : 'red';
      if (window.XqRules.inCheck(nb, opp)) score += 30;
      // 中心控制
      const cr = Math.abs(mv[2] - 4.5), cc = Math.abs(mv[3] - 4);
      score += (8 - cr) * 0.3 + (5 - cc) * 0.2;
      if (score > bestScore) { bestScore = score; best = mv; }
    }
    if (!best) return { move: null, text: '', comment: '' };
    const text = window.Notation.toNotation(board, best[0], best[1], best[2], best[3]);
    return { move: best, text, comment: '（引擎兜底）哼，我让你一车一马。' };
  }

  /* 将内部棋盘转成提示用的行字符串（"." 分隔，行为第0行…第9行） */
  function boardToPromptRows(board) {
    return board.map(row => row.join(' '));
  }

  function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

  window.Ai = { callAI, getAIMove, getFinalComment, extractJSON, resolveNotation, boardToPromptRows };
})();