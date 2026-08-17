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
   *   maxThinkingMs   硬超时：超过该毫秒数仍未返回最终 content，强制切断思考并重试（默认 30s）
   *   maxReasoningChars 软上限：思维链字数超过后立即切断（为了让 AI 及时收尾）。
   *                         设 0 表示不限制；默认 ~4500 字（≈3000 token）。
   *   maxIdleMs       空闲超时：连续多久无新 chunk 视为卡死（默认 60s）。
   *
   * 策略：
   *   - 先用 thinking:enabled + reasoning_effort=high 发起；
   *   - 如果触发【硬超时 maxThinkingMs】或【软上限 maxReasoningChars】，直接 abort；
   *   - 若被 abort 且尚无 content，立即降级为 thinking:disabled（关闭思考模式）重发请求，
   *     保证能拿到最终决定 JSON，避免 AI 无法下棋。 */
  async function chat(messages, opts = {}) {
    const { signal, onReasoning, onContent, onProgress } = opts;
    const MAX_THINKING_MS = Math.max(8000, typeof opts.maxThinkingMs === 'number' ? opts.maxThinkingMs : 30000);
    const MAX_REASONING_CHARS = typeof opts.maxReasoningChars === 'number'
      ? opts.maxReasoningChars : 4500; // ≈ 3000 tokens（汉字/token 约 0.65~0.75）
    const MAX_IDLE_MS = Math.max(5000, typeof opts.maxIdleMs === 'number' ? opts.maxIdleMs : 60000);
    const s = loadSettings();
    if (!s.key || !s.url || !s.model) throw new Error('请先在“接口设置”中填写 API Key / URL / Model');

    let abortedByTimeout = false;
    let abortedByChars = false;

    function runOnce(withThinking, extraReasoningFlags) {
      return new Promise(async (resolve, reject) => {
        const ctrl = new AbortController();
        const localAbort = (reason) => {
          try { ctrl.abort(reason); } catch (e) {}
        };
        const unbind = [];
        if (signal) {
          if (signal.aborted) localAbort('external');
          else { signal.addEventListener('abort', () => localAbort('external'), { once: true }); unbind.push(() => signal.removeEventListener('abort', localAbort)); }
        }

        let idleTimer = null, thinkingTimer = null;
        const resetIdle = () => { if (idleTimer) clearTimeout(idleTimer); idleTimer = setTimeout(() => localAbort('idle'), MAX_IDLE_MS); };
        resetIdle();
        if (withThinking) {
          thinkingTimer = setTimeout(() => { abortedByTimeout = true; localAbort('thinking_timeout'); }, MAX_THINKING_MS);
        } else {
          // 关闭思考时仍给更充裕 60s，确保网络波动下的响应
          thinkingTimer = setTimeout(() => { localAbort('fast_timeout'); }, 60000);
        }

        const startedAt = performance.now();
        let reasoning = '', content = '';
        let reasoningBytes = 0;
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
          const doFetch = (wt) => {
            const body = { model: s.model, messages, temperature: 0.2, stream: true };
            // reasoning_effort=high 让模型聚焦、尽快给出高质量决定
            if (extraReasoningFlags && extraReasoningFlags.effort) body.reasoning_effort = extraReasoningFlags.effort;
            if (wt) body.thinking = { type: 'enabled' };
            else body.thinking = { type: 'disabled' }; // 快速模式：必须显式关闭思考，否则模型仍输出思维链超时
            return fetch(s.url, {
              method: 'POST',
              signal: ctrl.signal,
              headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + s.key },
              body: JSON.stringify(body),
            });
          };
          try {
            res = await doFetch(withThinking);
          } catch (e) {
            if (ctrl.signal.aborted) {
              reject(new Error(
                ctrl.signal.reason === 'thinking_timeout'
                  ? ('思考超过 ' + (MAX_THINKING_MS / 1000) + 's，强制终止思考模式（稍后自动重试快速模式）')
                  : (ctrl.signal.reason === 'idle'
                    ? 'AI 长时间未返回新内容（接口空闲超时），已取消'
                    : 'AI 响应已取消'))
              );
              return;
            }
            reject(e);
            return;
          }
          if (!res.ok && (res.status === 400 || res.status === 422) && withThinking) {
            // 不识别 thinking 或 reasoning_effort 字段时关闭思考模式再试
            try { res = await doFetch(false); } catch (e2) { reject(e2); return; }
          }
          if (!res.ok) {
            let detail = '';
            try { detail = (await res.text()).slice(0, 300); } catch (e2) {}
            reject(new Error('接口请求失败 HTTP ' + res.status + (detail ? ': ' + detail : '')));
            return;
          }
          // 不支持流式的服务兜底
          if (!res.body || !res.body.getReader) {
            const data = await res.json();
            const msg = data?.choices?.[0]?.message || {};
            reasoning = (msg.reasoning_content || '');
            content = (msg.content || '');
            reasoningBytes = [...reasoning].length;
            emit();
            resolve({ content: String(content).trim(), reasoning: String(reasoning).trim(), abortedByTimeout, abortedByChars });
            return;
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
                  if (withThinking && MAX_REASONING_CHARS > 0 && reasoning.length > MAX_REASONING_CHARS) {
                    abortedByChars = true;
                    localAbort('reasoning_chars');
                  }
                }
                if (delta.content) {
                  content += delta.content;
                  if (onContent) onContent(delta.content);
                  emit();
                }
              } catch (e3) {}
              if (ctrl.signal.aborted) { break; }
            }
            if (ctrl.signal.aborted) break;
          }
          // 尾行兜底
          if (!finished && buf.trim()) {
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
                  emit();
                } catch (e4) {}
              }
            }
          }
          emit();
          if (ctrl.signal.aborted && !content.trim()) {
            reject(new Error('AI 思考被提前终止且未返回最终坐标，稍后将自动使用快速模式重试'));
            return;
          }
          resolve({ content: String(content).trim(), reasoning: String(reasoning).trim(), abortedByTimeout, abortedByChars });
        } catch (err) {
          reject(err);
        } finally {
          if (idleTimer) clearTimeout(idleTimer);
          if (thinkingTimer) clearTimeout(thinkingTimer);
          unbind.forEach(u => { try { u(); } catch (e) {} });
        }
      });
    }

    // 第一发：思考模式 + reasoning_effort=high（让模型聚焦，尽量 30s 内完成）
    let result;
    try {
      result = await runOnce(true, { effort: 'high' });
    } catch (e1) {
      // 触发超时/软上限，或 content 为空：降级到"关闭思考"快速模式
      const firstErr = (e1 && e1.message) ? e1.message : String(e1);
      try {
        result = await runOnce(false, {});
        result._degraded = true;
        result._degradeReason = firstErr;
      } catch (e2) {
        // 第二次再失败才抛
        const secondErr = (e2 && e2.message) ? e2.message : String(e2);
        throw new Error(firstErr + '；快速模式重试仍失败：' + secondErr);
      }
    }
    if (!result.content && !result.reasoning) throw new Error('接口返回为空或格式异常');
    return result;
  }

  window.XQSettings = { loadSettings, saveSettings, hasSettings, chat };
})();