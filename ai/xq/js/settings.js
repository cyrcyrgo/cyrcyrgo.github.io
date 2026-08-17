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
   * 注意：默认显式关闭思考（thinking.type = disabled），以最快速度产出最终 JSON。
   *   - opts.enableThinking = true 时才启用思考模式，并附加 reasoning_effort。
   * opts:
   *   signal          外部取消信号（重试/返回大厅）
   *   onReasoning     流式回调：每段思维链文本（仅思考模式下有）
   *   onContent       流式回调：每段回答文本
   *   onProgress({ elapsedMs, reasoningChars, reasoningBytes, contentChars })
   *                   持续回调（每收到一个 chunk 至少一次）
   *   maxThinkingMs   思考模式硬超时（默认 30s）
   *   maxReasoningChars 思考模式思维链软上限字数（默认 4500≈3000 token）
   *   maxIdleMs       空闲超时（默认 30s） */
  async function chat(messages, opts = {}) {
    const { signal, onReasoning, onContent, onProgress, enableThinking = false } = opts;
    const MAX_THINKING_MS = Math.max(8000, typeof opts.maxThinkingMs === 'number' ? opts.maxThinkingMs : 30000);
    const MAX_REASONING_CHARS = typeof opts.maxReasoningChars === 'number'
      ? opts.maxReasoningChars : 4500;
    const MAX_IDLE_MS = Math.max(5000, typeof opts.maxIdleMs === 'number' ? opts.maxIdleMs : 30000);
    const s = loadSettings();
    if (!s.key || !s.url || !s.model) throw new Error('请先在“接口设置”中填写 API Key / URL / Model');

    let abortedByTimeout = false;
    let abortedByChars = false;

    function runOnce(withThinking) {
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
            const body = { model: s.model, messages, temperature: 0.3, stream: true };
            // 显式传 thinking.type 避免不同模型默认行为不一致
            if (wt) {
              body.thinking = { type: 'enabled' };
              body.reasoning_effort = 'medium'; // 需要思考时也别太发散，medium 兼顾质量与速度
            } else {
              body.thinking = { type: 'disabled' };
            }
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
                  ? ('思考超过 ' + (MAX_THINKING_MS / 1000) + 's，强制终止（稍后自动重试快速模式）')
                  : (ctrl.signal.reason === 'idle'
                    ? 'AI 长时间未返回新内容（接口空闲超时），已取消'
                    : 'AI 响应已取消'))
              );
              return;
            }
            reject(e);
            return;
          }
          if (!res.ok && (res.status === 400 || res.status === 422)) {
            try { res = await doFetch(false); } catch (e2) { reject(e2); return; }
          }
          if (!res.ok) {
            let detail = '';
            try { detail = (await res.text()).slice(0, 300); } catch (e2) {}
            reject(new Error('接口请求失败 HTTP ' + res.status + (detail ? ': ' + detail : '')));
            return;
          }
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
              if (ctrl.signal.aborted) break;
            }
            if (ctrl.signal.aborted) break;
          }
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
            reject(new Error('AI 响应被提前终止且未返回最终坐标，稍后将自动使用快速模式重试'));
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

    // 默认：不进入思考模式，直接快速出 JSON（用户明确要求"关闭思考"）
    // 若调用方显式 enableThinking，则先走思考模式；超时或被截断且无 content 时降级到禁用思考模式重试
    let result;
    if (enableThinking) {
      try {
        result = await runOnce(true);
      } catch (e1) {
        const firstErr = (e1 && e1.message) ? e1.message : String(e1);
        try {
          result = await runOnce(false);
          result._degraded = true;
          result._degradeReason = firstErr;
        } catch (e2) {
          const secondErr = (e2 && e2.message) ? e2.message : String(e2);
          throw new Error(firstErr + '；快速模式重试仍失败：' + secondErr);
        }
      }
    } else {
      try {
        result = await runOnce(false);
      } catch (e1) {
        // 再尝试一次（防止偶发网络抖动）
        const firstErr = (e1 && e1.message) ? e1.message : String(e1);
        try { result = await runOnce(false); }
        catch (e2) {
          const secondErr = (e2 && e2.message) ? e2.message : String(e2);
          throw new Error(firstErr + '；重试仍失败：' + secondErr);
        }
      }
    }
    if (!result.content && !result.reasoning) throw new Error('接口返回为空或格式异常');
    return result;
  }

  window.XQSettings = { loadSettings, saveSettings, hasSettings, chat };
})();