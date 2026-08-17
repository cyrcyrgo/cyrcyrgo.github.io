/* 接口配置与 AI 调用（OpenAI 兼容 chat/completions） */
(function () {
  const KEY = 'xq_ai_settings';

  function loadSettings() {
    try {
      return JSON.parse(localStorage.getItem(KEY) || 'null') || {};
    } catch (e) {
      return {};
    }
  }
  function saveSettings(s) { localStorage.setItem(KEY, JSON.stringify(s)); }
  function hasSettings() {
    const s = loadSettings();
    return !!(s.key && s.url && s.model);
  }

  /* 调用模型（流式），返回最后回答 content 与思维链 reasoning。
   * opts:
   *   signal         外部取消信号（重试/返回大厅）
   *   onReasoning    流式回调：每段思维链文本
   *   onContent      流式回调：每段回答文本
   * 超时策略：用“空闲 X 秒无新数据”判定（适配推理模型长思维链），配一个总时长兜底。 */
  async function chat(messages, opts = {}) {
    const { signal, onReasoning, onContent } = opts;
    const s = loadSettings();
    if (!s.key || !s.url || !s.model) throw new Error('请先在“接口设置”中填写 API Key / URL / Model');

    const ctrl = new AbortController();
    const localAbort = () => { try { ctrl.abort(); } catch (e) {} };
    if (signal) {
      if (signal.aborted) localAbort();
      else signal.addEventListener('abort', localAbort, { once: true });
    }

    const IDLE_MS = 150000;   // 空闲超时：连续 150s 无新 token 判定超时
    const TOTAL_MS = 600000;  // 总时长兜底：10 分钟
    let idleTimer = null, totalTimer = null;
    const resetIdle = () => { if (idleTimer) clearTimeout(idleTimer); idleTimer = setTimeout(localAbort, IDLE_MS); };
    resetIdle();
    totalTimer = setTimeout(localAbort, TOTAL_MS);

    let reasoning = '', content = '';
    try {
      let res;
      const doFetch = (withThinking) => {
        const body = { model: s.model, messages, temperature: 0.2, stream: true };
        if (withThinking) body.thinking = { type: 'disabled' }; // DeepSeek 关闭思考模式，返回快、无需长思维链
        return fetch(s.url, {
          method: 'POST',
          signal: ctrl.signal,
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + s.key },
          body: JSON.stringify(body),
        });
      };
      try {
        res = await doFetch(true);
      } catch (e) {
        if (ctrl.signal.aborted) throw new Error('AI 响应超时（长时间未返回新内容），已取消');
        throw e;
      }
      // 部分 OpenAI 兼容服务不识别 thinking 字段，返回 4xx 时降级重试
      if (!res.ok && res.status === 400) {
        res = await doFetch(false);
      }
      if (!res.ok) {
        let detail = '';
        try { detail = (await res.text()).slice(0, 300); } catch (e2) {}
        throw new Error('接口请求失败 HTTP ' + res.status + (detail ? ': ' + detail : ''));
      }
      // 不支持流式的服务兜底
      if (!res.body || !res.body.getReader) {
        const data = await res.json();
        const msg = data?.choices?.[0]?.message || {};
        reasoning = (msg.reasoning_content || '');
        content = (msg.content || '');
        return { content: String(content).trim(), reasoning: String(reasoning).trim() };
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '', finished = false;
      while (!finished) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        resetIdle();
        let idx;
        while ((idx = buf.indexOf('\n\n')) >= 0) {
          const chunk = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          const line = chunk.trim();
          if (!line.startsWith('data:')) continue;
          const payload = line.slice(5).trim();
          if (payload === '[DONE]') { finished = true; break; }
          try {
            const j = JSON.parse(payload);
            const delta = (j.choices && j.choices[0] && j.choices[0].delta) || {};
            if (delta.reasoning_content) { reasoning += delta.reasoning_content; if (onReasoning) onReasoning(delta.reasoning_content); }
            if (delta.content) { content += delta.content; if (onContent) onContent(delta.content); }
          } catch (e3) {}
        }
      }
      // 兜底：无换行分隔的 [DONE]
      if (buf.trim() === '[DONE]') { buf = ''; }
      if (buf.trim()) {
        const line = buf.trim();
        if (line.startsWith('data:')) {
          const payload = line.slice(5).trim();
          if (payload !== '[DONE]') {
            try {
              const j = JSON.parse(payload);
              const delta = (j.choices && j.choices[0] && j.choices[0].delta) || {};
              if (delta.reasoning_content) { reasoning += delta.reasoning_content; if (onReasoning) onReasoning(delta.reasoning_content); }
              if (delta.content) { content += delta.content; if (onContent) onContent(delta.content); }
            } catch (e4) {}
          }
        }
      }
    } finally {
      if (idleTimer) clearTimeout(idleTimer);
      if (totalTimer) clearTimeout(totalTimer);
      if (signal) signal.removeEventListener('abort', localAbort);
    }
    if (!content.trim() && !reasoning.trim()) throw new Error('接口返回为空或格式异常');
    return { content: String(content).trim(), reasoning: String(reasoning).trim() };
  }

  window.XQSettings = { loadSettings, saveSettings, hasSettings, chat };
})();