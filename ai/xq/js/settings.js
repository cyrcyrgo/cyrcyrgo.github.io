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
   *   signal          外部取消信号（重试/返回大厅）
   *   onReasoning     流式回调：每段思维链文本
   *   onContent       流式回调：每段回答文本
   *   onProgress({ elapsedMs, reasoningChars, reasoningBytes, contentChars })
   *                   持续回调（每收到一个 chunk 至少一次），供 UI 显示思考中计时/字数
   * 超时策略：空闲超时 + 长总时长兜底（思考模式下默认更宽松）。 */
  async function chat(messages, opts = {}) {
    const { signal, onReasoning, onContent, onProgress } = opts;
    const s = loadSettings();
    if (!s.key || !s.url || !s.model) throw new Error('请先在“接口设置”中填写 API Key / URL / Model');

    const ctrl = new AbortController();
    const localAbort = () => { try { ctrl.abort(); } catch (e) {} };
    if (signal) {
      if (signal.aborted) localAbort();
      else signal.addEventListener('abort', localAbort, { once: true });
    }

    const IDLE_MS = 300000;       // 空闲超时：连续 5 分钟无新 token
    const TOTAL_MS = 30 * 60 * 1000; // 总时长兜底：30 分钟（长思考模式）
    let idleTimer = null, totalTimer = null;
    const resetIdle = () => { if (idleTimer) clearTimeout(idleTimer); idleTimer = setTimeout(localAbort, IDLE_MS); };
    resetIdle();
    totalTimer = setTimeout(localAbort, TOTAL_MS);

    const startedAt = performance.now();
    let reasoning = '', content = '';
    let reasoningBytes = 0; // UTF-16 字符数近似
    const emit = () => {
      if (!onProgress) return;
      try { onProgress({
        elapsedMs: performance.now() - startedAt,
        reasoningChars: reasoning.length,
        reasoningBytes,
        contentChars: content.length,
      }); } catch (e) {}
    };
    emit();

    try {
      let res;
      // 显式不写 thinking.type:disabled -> DeepSeek 启用思考模式
      const body = { model: s.model, messages, temperature: 0.2, stream: true };
      try {
        res = await fetch(s.url, {
          method: 'POST',
          signal: ctrl.signal,
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + s.key },
          body: JSON.stringify(body),
        });
      } catch (e) {
        if (ctrl.signal.aborted) throw new Error('AI 响应超时（长时间未返回新内容），已取消');
        throw e;
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
        reasoningBytes = [...reasoning].length;
        emit();
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
            if (delta.reasoning_content) {
              reasoning += delta.reasoning_content;
              reasoningBytes += [...delta.reasoning_content].length;
              if (onReasoning) onReasoning(delta.reasoning_content);
              emit();
            }
            if (delta.content) {
              content += delta.content;
              if (onContent) onContent(delta.content);
              emit();
            }
          } catch (e3) {}
        }
      }
      // 兜底：末尾无换行分隔的 [DONE] / 尾行
      if (buf.trim()) {
        const line = buf.trim();
        if (line.startsWith('data:')) {
          const payload = line.slice(5).trim();
          if (payload !== '[DONE]') {
            try {
              const j = JSON.parse(payload);
              const delta = (j.choices && j.choices[0] && j.choices[0].delta) || {};
              if (delta.reasoning_content) {
                reasoning += delta.reasoning_content;
                reasoningBytes += [...delta.reasoning_content].length;
                if (onReasoning) onReasoning(delta.reasoning_content);
              }
              if (delta.content) { content += delta.content; if (onContent) onContent(delta.content); }
            } catch (e4) {}
          }
        }
      }
      emit();
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