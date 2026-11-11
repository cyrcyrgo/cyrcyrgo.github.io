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

  /* 调用模型，返回文本内容；失败则抛错 */
  async function chat(messages, { signal } = {}) {
    const s = loadSettings();
    if (!s.key || !s.url || !s.model) throw new Error('请先在“接口设置”中填写 API Key / URL / Model');
    const res = await fetch(s.url, {
      method: 'POST',
      signal,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + s.key,
      },
      body: JSON.stringify({
        model: s.model,
        messages: messages,
        temperature: 0.85,
        stream: false,
      }),
    });
    if (!res.ok) {
      let detail = '';
      try { detail = (await res.text()).slice(0, 300); } catch (e) {}
      throw new Error('接口请求失败 HTTP ' + res.status + (detail ? ': ' + detail : ''));
    }
    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content;
    if (content == null) throw new Error('接口返回为空或格式异常');
    return String(content).trim();
  }

  window.XQSettings = { loadSettings, saveSettings, hasSettings, chat };
})();