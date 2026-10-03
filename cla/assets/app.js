/* YJS Cloud LLM Agent - frontend */
(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  let API = "";
  let TOKEN = localStorage.getItem("yjs_token") || "";
  let currentConv = null;
  let sending = false;
  let MODELS = [];
  let currentMode = "work";
  let uiWired = false;
  let SITE = { ai_enabled: true, announcement: "" };

  /* ------------------------------------------------------------------ */
  /* API resolution + auth                                                */
  /* ------------------------------------------------------------------ */
  async function resolveApi() {
    const override = localStorage.getItem("yjs_api_override");
    if (override) API = override.replace(/\/$/, "");
    else if (location.hostname === "127.0.0.1" || location.hostname === "localhost")
      API = location.origin;
    else {
      try {
        const r = await fetch("config.json?t=" + Date.now(), { cache: "no-store" });
        if (r.ok) {
          const c = await r.json();
          if (c.api_url) API = c.api_url.replace(/\/$/, "");
        }
      } catch (_) {}
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

  async function loadSiteSettings() {
    try {
      const r = await fetch(API + "/api/settings?t=" + Date.now(), { cache: "no-store" });
      if (r.ok) SITE = Object.assign({ ai_enabled: true, announcement: "" }, await r.json());
    } catch (_) {}
    applyNotice();
  }

  function applyNotice() {
    const el = $("notice");
    if (!el) return;
    const parts = [];
    if (SITE.announcement) parts.push(SITE.announcement);
    if (SITE.ai_enabled === false) parts.push("⚠ 管理员已全局暂停模型调用，暂时无法执行新任务。");
    if (!parts.length) { el.textContent = ""; el.classList.add("hidden"); return; }
    el.textContent = parts.join("　　");
    el.classList.toggle("warn", SITE.ai_enabled === false);
    el.classList.remove("hidden");
  }

  /* ------------------------------------------------------------------ */
  /* helpers                                                             */
  /* ------------------------------------------------------------------ */
  const escapeHtml = (s) => (s || "").replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const shorten = (s, n) => { s = s || ""; return s.length > n ? s.slice(0, n) + "…" : s; };
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
  const downloadUrl = (path) =>
    `${API}/api/files/download?path=${encodeURIComponent(path)}&token=${encodeURIComponent(TOKEN)}`;

  /* The app is served both from the backend root (http://host/) and from a
     GitHub Pages sub-path (https://<user>.github.io/<prefix>/), so self-links
     must point at the app folder of the current page, not at the site root. */
  const APP_ROOT = (function () {
    const dir = location.pathname.replace(/[^/]*$/, "");   // / -> /, /cla/ -> /cla/
    return dir || "/";
  })();

  /* ------------------------------------------------------------------ */
  /* Sidebar collapse — CSS pins the floating button to the sidebar edge  */
  /* via the #app.sb-collapsed class, so both classes must move together. */
  /* ------------------------------------------------------------------ */
  function setSidebar(collapsed) {
    const sb = $("sidebar"), app = $("app");
    sb.classList.toggle("collapsed", collapsed);
    app.classList.toggle("sb-collapsed", collapsed);
    localStorage.setItem("yjs_sidebar_collapsed", collapsed ? "1" : "0");
  }
  function applySidebarState() {
    setSidebar(localStorage.getItem("yjs_sidebar_collapsed") === "1");
  }
  $("sidebar-toggle").onclick = () =>
    setSidebar(!$("sidebar").classList.contains("collapsed"));

  /* ------------------------------------------------------------------ */
  /* model + mode loaders                                                */
  /* ------------------------------------------------------------------ */
  async function loadModels() {
    try {
      const d = await api("/api/models");
      MODELS = d.models || [];
      const sel = $("model-select");
      if (!sel) return;
      sel.innerHTML = "";
      MODELS.forEach((m) => {
        const opt = document.createElement("option");
        opt.value = m.name;
        opt.textContent = m.display || m.name;
        if (m.desc) opt.title = m.desc;
        if (d.default && m.name === d.default) opt.dataset.isDefault = "1";
        sel.appendChild(opt);
      });
      const chosen = d.preference || d.default || (MODELS[0]?.name || "");
      sel.value = chosen;
    } catch (e) { console.warn("loadModels failed:", e); }
  }

  /* ------------------------------------------------------------------ */
  /* login: verification-code tab / password tab                         */
  /* ------------------------------------------------------------------ */
  function selectLoginTab(which) {
    const code = which === "code";
    $("tab-code").classList.toggle("on", code);
    $("tab-pwd").classList.toggle("on", !code);
    $("pane-code").classList.toggle("hidden", !code);
    $("pane-pwd").classList.toggle("hidden", code);
    localStorage.setItem("yjs_login_tab", which);
    setMsg("");
  }
  $("tab-code").onclick = () => selectLoginTab("code");
  $("tab-pwd").onclick = () => selectLoginTab("pwd");
  selectLoginTab(localStorage.getItem("yjs_login_tab") === "pwd" ? "pwd" : "code");

  $("btn-send").onclick = async () => {
    const email = $("login-email").value.trim();
    if (!email) return setMsg("请填写邮箱", "err");
    const btn = $("btn-send"); btn.disabled = true; setMsg("发送中…");
    try {
      const d = await api("/api/auth/send-code", { method: "POST", body: JSON.stringify({ email }) });
      setMsg(d.is_new ? "验证码已发送，将为你创建新账号" : "验证码已发送，请查收邮件", "ok");
      let left = 60; const timer = setInterval(() => {
        btn.textContent = left + "s";
        if (--left < 0) { clearInterval(timer); btn.disabled = false; btn.textContent = "获取验证码"; }
      }, 1000);
    } catch (e) { setMsg(e.message, "err"); btn.disabled = false; }
  };

  async function doVerify() {
    const email = $("login-email").value.trim();
    const code = $("login-code").value.trim();
    if (!email || !code) return setMsg("请填写邮箱和验证码", "err");
    setMsg("验证中…");
    try {
      const d = await api("/api/auth/verify", { method: "POST", body: JSON.stringify({ email, code }) });
      TOKEN = d.token; localStorage.setItem("yjs_token", TOKEN);
      enterApp(d.user);
    } catch (e) { setMsg(e.message, "err"); }
  }
  $("btn-verify").onclick = doVerify;
  $("login-code").addEventListener("keydown", (e) => { if (e.key === "Enter") doVerify(); });

  async function doPasswordLogin() {
    const email = $("login-email").value.trim();
    const password = $("login-password").value;
    if (!email || !password) return setMsg("请填写邮箱和密码", "err");
    setMsg("登录中…");
    try {
      const d = await api("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });
      TOKEN = d.token; localStorage.setItem("yjs_token", TOKEN);
      enterApp(d.user);
    } catch (e) { setMsg(e.message, "err"); }
  }
  $("btn-pwd-login").onclick = doPasswordLogin;
  $("login-password").addEventListener("keydown", (e) => { if (e.key === "Enter") doPasswordLogin(); });

  function logout() {
    TOKEN = ""; localStorage.removeItem("yjs_token");
    currentConv = null;
    $("app").classList.add("hidden"); $("login").classList.remove("hidden");
  }
  $("btn-logout").onclick = logout;
  $("api-input").addEventListener("change", () => {
    const v = $("api-input").value.trim();
    if (v) { localStorage.setItem("yjs_api_override", v); API = v.replace(/\/$/, ""); }
    else localStorage.removeItem("yjs_api_override");
    $("api-label").textContent = API;
  });

  /* ------------------------------------------------------------------ */
  /* set / change own password                                           */
  /* ------------------------------------------------------------------ */
  function openPwModal() { $("pw-modal").classList.remove("hidden"); $("pw-input").focus(); }
  function closePwModal() { $("pw-modal").classList.add("hidden"); $("pw-input").value = ""; }
  $("btn-setpw").onclick = openPwModal;
  $("pw-cancel").onclick = closePwModal;
  $("pw-modal").addEventListener("click", (e) => { if (e.target === $("pw-modal")) closePwModal(); });
  $("pw-ok").onclick = async () => {
    const pw = $("pw-input").value;
    if (pw.length < 6) return alert("密码至少 6 位");
    try {
      await api("/api/auth/password", { method: "POST", body: JSON.stringify({ password: pw }) });
      closePwModal();
      alert("密码已保存，下次可用「密码登录」进入");
    } catch (e) { alert(e.message); }
  };

  /* ------------------------------------------------------------------ */
  /* bootstrap                                                           */
  /* ------------------------------------------------------------------ */
  function wireUi() {
    if (uiWired) return;
    uiWired = true;

    // Model selector change → persist preference
    $("model-select").addEventListener("change", async () => {
      const v = $("model-select").value;
      try { await api("/api/models/set", { method: "POST", body: JSON.stringify({ model: v || null }) }); } catch (_) {}
    });

    // Mode selector
    $("mode-select").addEventListener("change", () => {
      currentMode = $("mode-select").value;
      localStorage.setItem("yjs_mode", currentMode);
    });
    const savedMode = localStorage.getItem("yjs_mode") || "work";
    $("mode-select").value = savedMode; currentMode = savedMode;

    // Files drawer
    $("btn-files").onclick = () => { $("files-panel").classList.remove("hidden"); loadFiles(); };
    $("btn-close-files").onclick = () => $("files-panel").classList.add("hidden");

    // Preview drawer
    $("btn-preview-close").onclick = () => $("preview-panel").classList.add("hidden");

    // Quick task templates
    const TPL = [
      { icon: "📝", label: "写文章", text: "帮我写一篇关于「主题」的文章，结构清晰、约 800 字，并保存为 Markdown 文件。" },
      { icon: "🐍", label: "写脚本", text: "用 Python 写一个脚本：读取工作区里的数据文件并统计输出结果，保存为 report.md。" },
      { icon: "📊", label: "数据分析", text: "对工作区中的数据进行统计分析，生成汇总表格，并说明关键结论。" },
      { icon: "🔍", label: "网页抓取", text: "抓取以下网页的主要内容并整理成中文摘要：https://" },
      { icon: "🧹", label: "整理文件", text: "整理工作区文件：按类型归类到子目录，并生成文件清单 index.md。" },
      { icon: "🌐", label: "做网页", text: "做一个单文件 HTML 网页，主题为「」，要求美观、响应式，保存为 index.html。" },
    ];
    const tplBox = $("templates");
    if (tplBox) {
      tplBox.innerHTML = TPL.map((t, i) =>
        `<button type="button" class="tpl" data-i="${i}">${t.icon} ${escapeHtml(t.label)}</button>`).join("");
      tplBox.querySelectorAll(".tpl").forEach((b) => {
        b.onclick = () => {
          const t = TPL[Number(b.dataset.i)];
          const inp = $("chat-input");
          inp.value = t.text; inp.focus();
          inp.dispatchEvent(new Event("input"));
        };
      });
    }

    // Conversation search
    $("conv-search").addEventListener("input", applyConvFilter);

    // Composer character counter
    $("chat-input").addEventListener("input", () => {
      $("char-count").textContent = $("chat-input").value.length + " 字";
    });

    // Export current conversation
    $("btn-export").onclick = exportConversation;
  }

  function applyConvFilter() {
    const q = ($("conv-search").value || "").trim().toLowerCase();
    document.querySelectorAll("#conv-list .conv").forEach((el) => {
      const t = (el.querySelector(".t") ? el.querySelector(".t").textContent : "").toLowerCase();
      el.style.display = (!q || t.includes(q)) ? "" : "none";
    });
  }

  async function exportConversation() {
    if (!currentConv) return;
    try {
      const d = await api("/api/conversations/" + currentConv);
      const conv = d.conversation;
      const out = [`# ${conv.title || "对话"}`, "", `> 导出时间：${new Date().toLocaleString()}`, ""];
      (conv.messages || []).forEach((m) => {
        if (m.role === "user") out.push("## 用户\n", m.content || "", "");
        else if (m.role === "assistant") out.push("## Agent\n", m.content || "", "");
        else if (m.role === "tool")
          out.push(`<!-- 工具 ${m.name || ""}: ${(m.content || "").slice(0, 200)} -->`, "");
      });
      const blob = new Blob([out.join("\n")], { type: "text/markdown;charset=utf-8" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = (conv.title || "conversation").replace(/[\\/:*?"<>|]/g, "_").slice(0, 40) + ".md";
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    } catch (e) { alert(e.message); }
  }

  async function enterApp(user) {
    $("login").classList.add("hidden"); $("app").classList.remove("hidden");
    $("user-email").textContent = user.email;
    renderUsage(user.usage);
    applySidebarState();
    $("btn-admin").classList.toggle("hidden", !user.is_admin);
    $("btn-admin").onclick = () => { location.href = APP_ROOT + "admin.html"; };
    wireUi();
    await loadModels();
    await loadConversations();
  }

  /* ------------------------------------------------------------------ */
  /* conversations  (delegated click so rebuilds never lose handlers)     */
  /* ------------------------------------------------------------------ */
  async function loadConversations() {
    try {
      const d = await api("/api/conversations");
      const list = $("conv-list");
      list.innerHTML = "";
      d.conversations.forEach((c) => {
        const div = document.createElement("div");
        div.className = "conv" + (String(currentConv) === String(c.id) ? " active" : "");
        div.dataset.cid = String(c.id);
        div.innerHTML = `<span class="t" data-act="open">${escapeHtml(c.title)}</span>` +
                        `<span class="del" data-act="del">✕</span>`;
        list.appendChild(div);
      });
      applyConvFilter();
    } catch (e) { console.warn(e); }
  }
  $("conv-list").addEventListener("click", async (ev) => {
    const target = ev.target;
    const row = target.closest(".conv");
    if (!row) return;
    const cid = row.dataset.cid;
    if (target.matches("[data-act='del']") || target.classList.contains("del")) {
      ev.stopPropagation();
      if (!confirm("删除该对话？")) return;
      await api("/api/conversations/" + cid, { method: "DELETE" });
      if (String(currentConv) === cid) newChatView();
      loadConversations();
    } else {
      openConversation(cid);
    }
  });

  $("btn-new").onclick = async () => {
    try {
      const d = await api("/api/conversations", { method: "POST" });
      currentConv = d.conversation.id;
      newChatView(); await loadConversations(); $("chat-input").focus();
    } catch (e) { alert(e.message); }
  };

  function newChatView() {
    $("chat-title").textContent = "新对话";
    $("messages").innerHTML =
      `<div class="empty">描述你的任务，Agent 会在本机直接执行。</div>`;
    $("model-tag").style.display = "none";
    $("mode-tag").style.display = "none";
    $("btn-export").classList.add("hidden");
  }

  async function openConversation(cidStr) {
    const cid = String(cidStr);
    currentConv = cid;
    try {
      const d = await api("/api/conversations/" + cid);
      $("chat-title").textContent = d.conversation.title || "对话";
      const box = $("messages"); box.innerHTML = "";
      d.conversation.messages.forEach((m) => {
        if (m.role === "user") addBubble("user", m.content);
        else if (m.role === "assistant") addBubble("assistant", m.content, m.files);
        else if (m.role === "tool") addStep("tool", `⚙ ${m.name} → ${shorten(m.content, 300)}`);
      });
      loadConversations();
      $("btn-export").classList.remove("hidden");
      box.scrollTop = box.scrollHeight;
    } catch (e) { alert(e.message); }
  }

  /* ------------------------------------------------------------------ */
  /* chat render helpers                                                 */
  /* ------------------------------------------------------------------ */
  function renderFilesChips(files, container) {
    if (!files || !files.length) return;
    container.querySelectorAll(".files-chips").forEach((e) => e.remove());
    const wrap = document.createElement("div");
    wrap.className = "files-chips";
    files.forEach((f) => {
      const rel = f.path;
      const chip = document.createElement("div");
      chip.className = "file-chip";
      const filename = f.name || rel.split("/").pop() || rel;
      const ext = (filename.split(".").pop() || "").toLowerCase();
      const canPreview = ["txt","md","markdown","json","py","js","ts","jsx","tsx",
        "css","csv","log","ini","toml","xml","html","htm","sh","bat","ps1","rs","go","java",
        "c","cpp","h","vue","svelte"].includes(ext);
      chip.innerHTML =
        `<span class="icon">📄</span>` +
        `<span class="fc-name">${escapeHtml(filename)}</span>` +
        `<span class="fc-size">${fmtSize(f.size || 0)}</span>` +
        (canPreview ? `<button class="fc-prev" title="在线预览">👁</button>` : "") +
        `<a class="fc-dl" href="${escapeHtml(downloadUrl(rel))}" download="${escapeHtml(filename)}" target="_blank" rel="noopener" title="下载">⬇</a>` +
        `<button class="fc-del" title="删除文件">✕</button>`;
      chip.querySelector(".fc-del").onclick = async () => {
        if (!confirm("删除 " + rel + " ?")) return;
        await api("/api/files?path=" + encodeURIComponent(rel), { method: "DELETE" });
        chip.remove(); refreshMe();
      };
      if (canPreview) chip.querySelector(".fc-prev").onclick = () => openPreview(rel);
      wrap.appendChild(chip);
    });
    container.appendChild(wrap);
  }

  function addBubble(role, text, files) {
    const box = $("messages");
    const empty = box.querySelector(".empty"); if (empty) empty.remove();
    const div = document.createElement("div");
    div.className = "bubble " + role;
    div.innerHTML = `<div class="who">${role === "user" ? "你" : "Agent"}</div>` +
                    `<span class="txt">${escapeHtml(text || "")}</span>`;
    box.appendChild(div);
    if (role === "assistant") {
      const copy = document.createElement("button");
      copy.className = "copy-btn";
      copy.textContent = "复制";
      copy.onclick = async () => {
        const txt = (div.querySelector(".txt") || {}).textContent || "";
        try { await navigator.clipboard.writeText(txt); copy.textContent = "已复制"; }
        catch (_) { copy.textContent = "复制失败"; }
        setTimeout(() => { copy.textContent = "复制"; }, 1500);
      };
      div.appendChild(copy);
      renderFilesChips(files, div);
    }
    box.scrollTop = box.scrollHeight;
    return div;
  }
  function addStep(kind, text) {
    const box = $("messages");
    const empty = box.querySelector(".empty"); if (empty) empty.remove();
    const div = document.createElement("div");
    div.className = "step " + kind;
    div.textContent = text;
    box.appendChild(div);
    box.scrollTop = box.scrollHeight;
    return div;
  }

  let streamEl = null, pending = "", typing = false;
  function typeAppend(text) {
    if (!streamEl) streamEl = addBubble("assistant", "");
    pending += text; pump();
  }
  function pump() {
    if (typing) return; typing = true;
    const tick = () => {
      const el = streamEl;
      if (!el) { typing = false; pending = ""; return; }
      if (!pending.length) { typing = false; return; }
      const take = pending.length > 120 ? 4 : pending.length > 40 ? 2 : 1;
      const chunk = pending.slice(0, take); pending = pending.slice(take);
      const t = el.querySelector(".txt"); if (t) t.appendChild(document.createTextNode(chunk));
      $("messages").scrollTop = $("messages").scrollHeight;
      setTimeout(tick, 10);
    };
    tick();
  }
  function endStream(fullText) {
    if (streamEl && typeof fullText === "string") {
      const t = streamEl.querySelector(".txt"); if (t) t.textContent = fullText;
    }
    streamEl = null; pending = "";
  }

  /* ------------------------------------------------------------------ */
  /* send + SSE                                                          */
  /* ------------------------------------------------------------------ */
  async function sendMessage() {
    const text = $("chat-input").value.trim();
    if (!text || sending) return;
    if (!currentConv) { alert("请先新建对话"); return; }
    sending = true; $("btn-send-msg").disabled = true; $("chat-input").value = "";
    const chosenModel = $("model-select")?.value || "";
    const chosenMode = $("mode-select")?.value || "work";
    currentMode = chosenMode;
    addBubble("user", text);

    let live = addStep("tool", "⏳ 正在思考…");
    const ensureLive = () => { if (!live.parentNode) live = addStep("tool", "⏳ 正在思考…"); };
    const showModeTag = (m) => {
      const label = { fast: "快速", think: "思考", work: "工作", expert: "专家" }[m] || m;
      const el = $("mode-tag"); el.textContent = label + "模式";
      el.dataset.mode = m; el.style.display = "inline-block";
    };

    const onEvent = (ev) => {
      if (ev.type === "status") {
        ensureLive(); live.textContent = "⏳ " + ev.text;
      } else if (ev.type === "assistant_delta") {
        if (live.parentNode) live.remove();
        typeAppend(ev.content || "");
      } else if (ev.type === "assistant") {
        if (live.parentNode) live.remove();
        if (streamEl) endStream(ev.content);
        else if (ev.content) addBubble("assistant", ev.content);
      } else if (ev.type === "model") {
        if (ev.model) {
          const sel = $("model-select"); if (sel) sel.value = ev.model;
          const el = $("model-tag"); el.textContent = ev.model; el.style.display = "inline-block";
        }
      } else if (ev.type === "mode") {
        showModeTag(ev.mode);
      } else if (ev.type === "progress") {
        ensureLive(); live.textContent = "⏳ " + (ev.text || "生成中…");
      } else if (ev.type === "heartbeat") {
        ensureLive();
        if (!streamEl && !typing)
          live.textContent = "⏳ 运行中…已 " + (ev.elapsed || 0) + " 秒";
      } else if (ev.type === "tool_call") {
        endStream();
        if (live.parentNode) live.remove();
        addStep("tool", `▶ ${ev.name}(${shorten(JSON.stringify(ev.args || {}), 240)})`);
      } else if (ev.type === "tool_result") {
        endStream();
        addStep(ev.ok ? "result-ok" : "result-err",
          `${ev.ok ? "✓" : "✗"} ${ev.name}: ${ev.summary}`);
        ensureLive();
      } else if (ev.type === "files") {
        let target = streamEl;
        if (!target) {
          const boxes = $("messages").querySelectorAll(".bubble.assistant");
          target = boxes[boxes.length - 1] || null;
        }
        if (!target) target = addBubble("assistant", "");
        renderFilesChips(ev.files || [], target);
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
        body: JSON.stringify({ content: text, model: chosenModel || null, mode: chosenMode }),
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
          const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
          chunk.split("\n").forEach((line) => {
            if (line.startsWith("data: ")) {
              try { onEvent(JSON.parse(line.slice(6))); } catch (_) {}
            }
          });
        }
      }
    } catch (e) {
      if (live.parentNode) live.remove();
      addStep("result-err",
        "⚠ 连接中断（" + (e.message || "network") + "）。稍后重开对话即可看到已完成部分。");
    } finally {
      endStream(); if (live.parentNode) live.remove();
      sending = false; $("btn-send-msg").disabled = false;
      loadConversations(); refreshMe();
    }
  }
  $("btn-send-msg").onclick = sendMessage;
  $("chat-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  });

  async function refreshMe() {
    try {
      const d = await api("/api/me"); renderUsage(d.user.usage);
    } catch (_) {}
  }

  /* ------------------------------------------------------------------ */
  /* files drawer + preview                                              */
  /* ------------------------------------------------------------------ */
  async function loadFiles() {
    try {
      const d = await api("/api/files");
      renderUsage(d.usage);
      $("files-usage").textContent =
        `${d.files.length} 个文件 · 已用 ${fmtSize(d.usage.used)} / ${fmtSize(d.usage.quota)}`;
      const box = $("files-list"); box.innerHTML = "";
      if (!d.files.length) {
        box.innerHTML = `<div style="color:#8b98b4;padding:20px;text-align:center">暂无文件 —— 让 Agent 写点什么吧</div>`;
        return;
      }
      const TEXT_EXTS = new Set(["txt","md","markdown","json","py","js","ts","jsx","tsx",
        "css","csv","log","ini","toml","xml","html","htm","sh","bat","ps1","rs","go","java",
        "c","cpp","h","vue","svelte"]);
      d.files.forEach((f) => {
        const row = document.createElement("div");
        row.className = "file-row";
        const filename = f.path.split("/").pop();
        const ext = (filename.split(".").pop() || "").toLowerCase();
        const canPreview = TEXT_EXTS.has(ext);
        row.innerHTML =
          `<div class="fr-main">` +
          `<div class="fr-name" title="${escapeHtml(f.path)}">📄 ${escapeHtml(f.path)}</div>` +
          `<div class="fr-meta">${fmtSize(f.size)} · ${new Date(f.modified * 1000).toLocaleString()}</div>` +
          `</div><div class="fr-actions">` +
          (canPreview ? `<button class="btn btn-prev">预览</button>` : "") +
          `<a class="btn btn-dl" href="${escapeHtml(downloadUrl(f.path))}" download="${escapeHtml(filename)}" target="_blank" rel="noopener">下载</a>` +
          `<button class="btn btn-del">删除</button></div>`;
        if (canPreview) row.querySelector(".btn-prev").onclick = () => openPreview(f.path);
        row.querySelector(".btn-del").onclick = async () => {
          if (!confirm("删除 " + f.path + " ?")) return;
          await api("/api/files?path=" + encodeURIComponent(f.path), { method: "DELETE" });
          await refreshMe(); loadFiles();
        };
        box.appendChild(row);
      });
    } catch (e) { alert(e.message); }
  }
  $("btn-clear-files").onclick = async () => {
    if (!confirm("确定清空全部工作区文件？此操作不可恢复。")) return;
    await api("/api/files/clear", { method: "POST" });
    await refreshMe(); loadFiles();
  };

  /* --- upload --- */
  async function uploadOne(file, rel) {
    const headers = { "Content-Type": "application/octet-stream",
                      "ngrok-skip-browser-warning": "true" };
    if (TOKEN) headers["Authorization"] = "Bearer " + TOKEN;
    const res = await fetch(API + "/api/files/upload?path=" + encodeURIComponent(rel),
      { method: "POST", headers, body: file });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.detail || data.error || ("HTTP " + res.status));
    return data;
  }
  $("btn-upload-file").onclick = () => $("upload-input").click();
  $("upload-input").onchange = async (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = "";
    if (!files.length) return;
    const box = $("files-usage");
    const btn = $("btn-upload-file");
    btn.disabled = true;
    let done = 0, failed = 0, lastErr = "";
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      box.textContent = `上传中… ${i + 1}/${files.length}：${f.name}`;
      try { await uploadOne(f, f.name); done++; }
      catch (err) { failed++; lastErr = f.name + "：" + err.message; }
    }
    btn.disabled = false;
    await refreshMe();
    await loadFiles();
    if (failed) alert(`上传完成：成功 ${done} 个，失败 ${failed} 个\n${lastErr}`);
  };

  /* --- preview --- */
  async function openPreview(path) {
    $("preview-panel").classList.remove("hidden");
    $("preview-title").textContent = "预览 · " + path;
    $("preview-body").innerHTML = `<div style="color:#8b98b4">加载中…</div>`;
    try {
      const d = await api("/api/files/preview?path=" + encodeURIComponent(path));
      if (d.kind === "html") {
        $("preview-body").innerHTML =
          `<iframe class="preview-iframe" src="${d.data_uri}"></iframe>`;
      } else {
        $("preview-body").innerHTML =
          `<pre class="preview-pre" data-lang="${escapeHtml(d.language || "")}">${escapeHtml(d.content)}</pre>`;
      }
    } catch (e) {
      $("preview-body").innerHTML = `<div style="color:#ef4444;padding:20px">${escapeHtml(e.message)}</div>` +
        `<div style="padding:0 20px">` +
        `<a href="${escapeHtml(downloadUrl(path))}" download="${escapeHtml(path.split('/').pop())}" target="_blank">下载文件</a></div>`;
    }
  }

  /* ------------------------------------------------------------------ */
  /* boot                                                                */
  /* ------------------------------------------------------------------ */
  (async function boot() {
    await resolveApi();
    loadSiteSettings();
    if (TOKEN) {
      try {
        const d = await api("/api/me");
        enterApp(d.user);
      } catch (_) {}
    }
  })();
})();