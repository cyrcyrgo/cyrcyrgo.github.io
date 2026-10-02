/* YJS LLM Agent frontend */
const $ = (id) => document.getElementById(id);
let API = "";
let TOKEN = localStorage.getItem("yjs_token") || "";
let currentConv = null;
let sending = false;

/* ------------------------------------------------------------------ */
/* api resolution                                                      */
/* ------------------------------------------------------------------ */
async function resolveApi() {
  const override = localStorage.getItem("yjs_api_override");
  if (override) {
    API = override.replace(/\/$/, "");
  } else if (location.hostname === "127.0.0.1" || location.hostname === "localhost") {
    // served by the local backend -> talk to it directly (no tunnel dependency)
    API = location.origin;
  } else {
    try {
      const r = await fetch("config.json?t=" + Date.now(), { cache: "no-store" });
      if (r.ok) {
        const c = await r.json();
        if (c.api_url) API = c.api_url.replace(/\/$/, "");
      }
    } catch (e) { /* ignore */ }
    if (!API && location.protocol.startsWith("http")) API = location.origin;
  }
  $("api-label").textContent = API || "(未配置)";
  $("api-input").value = API;
}

async function api(path, opts = {}) {
  const headers = Object.assign(
    { "Content-Type": "application/json", "ngrok-skip-browser-warning": "true" },
    opts.headers || {}
  );
  if (TOKEN) headers["Authorization"] = "Bearer " + TOKEN;
  const res = await fetch(API + path, Object.assign({}, opts, { headers }));
  if (res.status === 401) { logout(); throw new Error("登录已过期"); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail || data.error || ("HTTP " + res.status));
  return data;
}

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */
function fmtSize(n) {
  if (n < 1024) return n + " B";
  if (n < 1048576) return (n / 1024).toFixed(1) + " KB";
  if (n < 1073741824) return (n / 1048576).toFixed(1) + " MB";
  return (n / 1073741824).toFixed(2) + " GB";
}
function setMsg(text, kind = "") {
  const el = $("login-msg");
  el.textContent = text || "";
  el.className = "msg " + kind;
}
function renderUsage(u) {
  if (!u) return;
  $("quota-text").textContent =
    `空间 ${fmtSize(u.used)} / ${fmtSize(u.quota)}（${u.percent}%）`;
  const bar = $("quota-bar");
  bar.querySelector("i").style.width = Math.min(u.percent, 100) + "%";
  bar.classList.toggle("full", !!u.full);
}

/* ------------------------------------------------------------------ */
/* auth                                                                */
/* ------------------------------------------------------------------ */
$("btn-send").onclick = async () => {
  const email = $("login-email").value.trim();
  if (!email) return setMsg("请填写邮箱", "err");
  const btn = $("btn-send");
  btn.disabled = true;
  setMsg("发送中…");
  try {
    const d = await api("/api/auth/send-code", {
      method: "POST",
      body: JSON.stringify({ email }),
    });
    setMsg(d.is_new ? "验证码已发送，将为你创建新账号" : "验证码已发送，请查收邮件", "ok");
    let left = 60;
    const timer = setInterval(() => {
      btn.textContent = left + "s";
      if (--left < 0) { clearInterval(timer); btn.disabled = false; btn.textContent = "获取验证码"; }
    }, 1000);
  } catch (e) {
    setMsg(e.message, "err");
    btn.disabled = false;
  }
};

async function doVerify() {
  const email = $("login-email").value.trim();
  const code = $("login-code").value.trim();
  if (!email || !code) return setMsg("请填写邮箱和验证码", "err");
  setMsg("验证中…");
  try {
    const d = await api("/api/auth/verify", {
      method: "POST",
      body: JSON.stringify({ email, code }),
    });
    TOKEN = d.token;
    localStorage.setItem("yjs_token", TOKEN);
    enterApp(d.user);
  } catch (e) {
    setMsg(e.message, "err");
  }
}
$("btn-verify").onclick = doVerify;
$("login-code").addEventListener("keydown", (e) => { if (e.key === "Enter") doVerify(); });

function logout() {
  TOKEN = "";
  localStorage.removeItem("yjs_token");
  currentConv = null;
  $("app").classList.add("hidden");
  $("login").classList.remove("hidden");
}
$("btn-logout").onclick = logout;

$("api-input").addEventListener("change", () => {
  const v = $("api-input").value.trim();
  if (v) { localStorage.setItem("yjs_api_override", v); API = v.replace(/\/$/, ""); }
  else localStorage.removeItem("yjs_api_override");
  $("api-label").textContent = API;
});

/* ------------------------------------------------------------------ */
/* app bootstrap                                                       */
/* ------------------------------------------------------------------ */
async function enterApp(user) {
  $("login").classList.add("hidden");
  $("app").classList.remove("hidden");
  $("user-email").textContent = user.email;
  renderUsage(user.usage);
  await loadConversations();
}

/* ------------------------------------------------------------------ */
/* conversations                                                       */
/* ------------------------------------------------------------------ */
async function loadConversations() {
  try {
    const d = await api("/api/conversations");
    const list = $("conv-list");
    list.innerHTML = "";
    d.conversations.forEach((c) => {
      const div = document.createElement("div");
      div.className = "conv" + (currentConv === c.id ? " active" : "");
      div.innerHTML = `<span class="t">${escapeHtml(c.title)}</span><span class="del">✕</span>`;
      div.querySelector(".t").onclick = () => openConversation(c.id);
      div.querySelector(".del").onclick = async (e) => {
        e.stopPropagation();
        if (!confirm("删除该对话？")) return;
        await api("/api/conversations/" + c.id, { method: "DELETE" });
        if (currentConv === c.id) newChatView();
        loadConversations();
      };
      list.appendChild(div);
    });
  } catch (e) { console.warn(e); }
}

$("btn-new").onclick = async () => {
  try {
    const d = await api("/api/conversations", { method: "POST" });
    currentConv = d.conversation.id;
    newChatView();
    await loadConversations();
    $("chat-input").focus();
  } catch (e) { alert(e.message); }
};

function newChatView() {
  $("chat-title").textContent = "新对话";
  $("messages").innerHTML =
    `<div class="empty">描述你的任务，Agent 会在本机直接执行。</div>`;
}

async function openConversation(cid) {
  currentConv = cid;
  const d = await api("/api/conversations/" + cid);
  $("chat-title").textContent = d.conversation.title || "对话";
  const box = $("messages");
  box.innerHTML = "";
  d.conversation.messages.forEach((m) => {
    if (m.role === "user") addBubble("user", m.content);
    else if (m.role === "assistant") addBubble("assistant", m.content);
    else if (m.role === "tool") addStep("tool", `⚙ ${m.name} → ${shorten(m.content, 300)}`);
  });
  loadConversations();
  box.scrollTop = box.scrollHeight;
}

/* ------------------------------------------------------------------ */
/* chat / agent stream                                                 */
/* ------------------------------------------------------------------ */
function escapeHtml(s) {
  return (s || "").replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}
function shorten(s, n) { s = s || ""; return s.length > n ? s.slice(0, n) + "…" : s; }

function addBubble(role, text) {
  const box = $("messages");
  const empty = box.querySelector(".empty");
  if (empty) empty.remove();
  const div = document.createElement("div");
  div.className = "bubble " + role;
  div.innerHTML =
    `<div class="who">${role === "user" ? "你" : "Agent"}</div>` +
    `<span class="txt">${escapeHtml(text)}</span>`;
  box.appendChild(div);
  box.scrollTop = box.scrollHeight;
  return div;
}
function addStep(kind, text) {
  const box = $("messages");
  const empty = box.querySelector(".empty");
  if (empty) empty.remove();
  const div = document.createElement("div");
  div.className = "step " + kind;
  div.textContent = text;
  box.appendChild(div);
  box.scrollTop = box.scrollHeight;
  return div;
}

/* --- typewriter: tokens arrive over SSE, characters are printed one by one --- */
let streamEl = null;   // current assistant bubble receiving streamed text
let pending = "";      // characters waiting to be typed
let typing = false;    // a typing loop is running

function typeAppend(text) {
  if (!streamEl) streamEl = addBubble("assistant", "");
  pending += text;
  pump();
}
function pump() {
  if (typing) return;
  typing = true;
  const tick = () => {
    const el = streamEl;
    if (!el) { typing = false; pending = ""; return; }
    if (!pending.length) { typing = false; return; }
    const take = pending.length > 120 ? 4 : (pending.length > 40 ? 2 : 1);
    const chunk = pending.slice(0, take);
    pending = pending.slice(take);
    const t = el.querySelector(".txt");
    if (t) t.appendChild(document.createTextNode(chunk));
    const box = $("messages");
    box.scrollTop = box.scrollHeight;
    setTimeout(tick, 12);
  };
  tick();
}
/* finish a streamed answer; `fullText` (authoritative) replaces the typed text */
function endStream(fullText) {
  if (streamEl && typeof fullText === "string") {
    const t = streamEl.querySelector(".txt");
    if (t) t.textContent = fullText;
  }
  streamEl = null;
  pending = "";
}

async function sendMessage() {
  const text = $("chat-input").value.trim();
  if (!text || sending) return;
  if (!currentConv) { alert("请先新建对话"); return; }
  sending = true;
  $("btn-send-msg").disabled = true;
  $("chat-input").value = "";
  addBubble("user", text);

  let live = addStep("tool", "⏳ 正在思考…");

  const ensureLive = () => { if (!live.parentNode) live = addStep("tool", "⏳ 正在思考…"); };

  const onEvent = (ev) => {
    if (ev.type === "status") {
      ensureLive();
      live.textContent = "⏳ " + ev.text;
    } else if (ev.type === "assistant_delta") {
      if (live.parentNode) live.remove();
      typeAppend(ev.content || "");
    } else if (ev.type === "assistant") {
      if (live.parentNode) live.remove();
      if (streamEl) endStream(ev.content);
      else if (ev.content) addBubble("assistant", ev.content);
    } else if (ev.type === "tool_call") {
      endStream();
      if (live.parentNode) live.remove();
      addStep("tool", `▶ ${ev.name}(${shorten(JSON.stringify(ev.args || {}), 240)})`);
    } else if (ev.type === "tool_result") {
      endStream();
      addStep(ev.ok ? "result-ok" : "result-err",
        `${ev.ok ? "✓" : "✗"} ${ev.name}: ${ev.summary}`);
      ensureLive();
    } else if (ev.type === "done") {
      endStream();
      if (live.parentNode) live.remove();
      addStep("done", "✅ 完成：" + ev.summary);
    } else if (ev.type === "error") {
      endStream();
      if (live.parentNode) live.remove();
      addStep("result-err", "⚠ " + ev.error);
    }
  };

  try {
    const res = await fetch(`${API}/api/conversations/${currentConv}/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + TOKEN,
        "ngrok-skip-browser-warning": "true",
      },
      body: JSON.stringify({ content: text }),
    });
    if (res.status === 401) { logout(); return; }
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      throw new Error(d.detail || "请求失败");
    }
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf("\n\n")) >= 0) {
        const chunk = buf.slice(0, i);
        buf = buf.slice(i + 2);
        chunk.split("\n").forEach((line) => {
          if (line.startsWith("data: ")) {
            try { onEvent(JSON.parse(line.slice(6))); } catch (e) { /* ignore */ }
          }
        });
      }
    }
  } catch (e) {
    addStep("result-err", "⚠ " + e.message);
  } finally {
    endStream();
    if (live.parentNode) live.remove();
    sending = false;
    $("btn-send-msg").disabled = false;
    loadConversations();
    refreshMe();
  }
}

$("btn-send-msg").onclick = sendMessage;
$("chat-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
});

async function refreshMe() {
  try {
    const d = await api("/api/me");
    renderUsage(d.user.usage);
  } catch (e) { /* ignore */ }
}

/* ------------------------------------------------------------------ */
/* files                                                               */
/* ------------------------------------------------------------------ */
$("btn-files").onclick = async () => {
  $("files-panel").classList.remove("hidden");
  await loadFiles();
};
$("btn-close-files").onclick = () => $("files-panel").classList.add("hidden");

async function loadFiles() {
  try {
    const d = await api("/api/files");
    renderUsage(d.usage);
    $("files-usage").textContent =
      `${d.files.length} 个文件 · 已用 ${fmtSize(d.usage.used)} / ${fmtSize(d.usage.quota)}`;
    const box = $("files-list");
    box.innerHTML = "";
    if (!d.files.length) box.innerHTML = `<div style="color:#8b98b4">暂无文件</div>`;
    d.files.forEach((f) => {
      const div = document.createElement("div");
      div.className = "file";
      div.innerHTML =
        `<a href="javascript:void(0)" class="dl">${escapeHtml(f.path)}</a>` +
        `<span style="color:#8b98b4">${fmtSize(f.size)}</span>` +
        `<span class="del" style="color:#ef4444;cursor:pointer">✕</span>`;
      div.querySelector(".dl").onclick = () => downloadFile(f.path);
      div.querySelector(".del").onclick = async () => {
        if (!confirm("删除 " + f.path + " ?")) return;
        await api("/api/files?path=" + encodeURIComponent(f.path), { method: "DELETE" });
        loadFiles();
      };
      box.appendChild(div);
    });
  } catch (e) { alert(e.message); }
}

$("btn-clear-files").onclick = async () => {
  if (!confirm("确定清空全部工作区文件？此操作不可恢复。")) return;
  await api("/api/files/clear", { method: "POST" });
  await loadFiles();
};

async function downloadFile(path) {
  try {
    const res = await fetch(
      `${API}/api/files/download?path=${encodeURIComponent(path)}`,
      { headers: { "Authorization": "Bearer " + TOKEN, "ngrok-skip-browser-warning": "true" } }
    );
    if (!res.ok) throw new Error("下载失败 " + res.status);
    const blob = await res.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = path.split("/").pop();
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(a.href);
  } catch (e) { alert(e.message); }
}

/* ------------------------------------------------------------------ */
/* boot                                                                */
/* ------------------------------------------------------------------ */
(async function boot() {
  await resolveApi();
  if (TOKEN) {
    try {
      const d = await api("/api/me");
      enterApp(d.user);
    } catch (e) { /* token invalid */ }
  }
})();