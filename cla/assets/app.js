/* YJS Cloud LLM Agent - frontend */
(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  let API = "";
  let TOKEN = localStorage.getItem("yjs_token") || "";
  let currentConv = null;
  let sending = false;
  let MODELS = [];
  let AGENTS = [];
  let ME = null;
  let currentMode = "work";
  let currentAgent = localStorage.getItem("yjs_agent") || "";
  let uiWired = false;
  let SITE = { ai_enabled: true, announcement: "" };

  /* Bind a handler only when the element actually exists — a stale HTML id
     must never abort the whole bundle (that caused the "clicks do nothing"). */
  function on(id, ev, fn) { const el = $(id); if (el) el.addEventListener(ev, fn); }
  function setHtml(id, html) { const el = $(id); if (el) el.innerHTML = html; }
  function setText(id, txt) { const el = $(id); if (el) el.textContent = txt; }

  /* ------------------------------------------------------------------ */
  /* API resolution + auth                                                */
  /* ------------------------------------------------------------------ */
  /* The one-click launcher restarts cpolar on every boot (the free tier
     rotates the domain) and pushes the fresh URL to config.json in the repo.
     GitHub Pages / raw can lag by a minute, so we query several mirrors,
     require a healthy backend, retry for ~2 minutes, and keep watching. */
  const CFG_RAW =
    "https://raw.githubusercontent.com/cyrcyrgo/cyrcyrgo.github.io/main/cla/config.json";

  function cfgUrls() {
    const dir = location.pathname.replace(/[^/]*$/, "");   // /cla/ on Pages
    const bust = Date.now();
    return [
      dir + "config.json?t=" + bust,                      // Pages same-origin
      CFG_RAW + "?t=" + bust,                             // raw (fastest refresh)
      "https://gh-proxy.com/" + CFG_RAW + "?t=" + bust,
      "https://ghfast.top/" + CFG_RAW + "?t=" + bust,
    ];
  }

  async function readTunnelUrl(timeoutMs = 7000) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const settled = await Promise.allSettled(cfgUrls().map((u) =>
        fetch(u, { cache: "no-store", signal: ctrl.signal }).then(async (r) => {
          if (!r.ok) throw new Error("http " + r.status);
          const c = await r.json();
          return c.api_url ? String(c.api_url).replace(/\/+$/, "") : "";
        })));
      for (const s of settled) {
        if (s.status === "fulfilled" && s.value) return s.value;
      }
      return "";
    } finally { clearTimeout(timer); }
  }

  async function pingTunnel(base, timeoutMs = 5000) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const r = await fetch(base + "/api/health?t=" + Date.now(), {
        cache: "no-store", signal: ctrl.signal,
        headers: { "ngrok-skip-browser-warning": "true" },
      });
      return r.ok;
    } catch (_) { return false; }
    finally { clearTimeout(timer); }
  }

  async function waitForTunnel(maxMs = 120000) {
    const deadline = Date.now() + maxMs;
    let last = "";
    while (Date.now() < deadline) {
      const u = await readTunnelUrl();
      if (u) {
        last = u;
        if (await pingTunnel(u)) return u;
      }
      await new Promise((r) => setTimeout(r, 5000));
    }
    return last;   // best effort even if not healthy yet
  }

  let _tunnelWatch = false;
  function watchTunnel() {
    if (_tunnelWatch) return;
    _tunnelWatch = true;
    setInterval(async () => {
      if (localStorage.getItem("yjs_api_override")) return;
      const u = await readTunnelUrl();
      if (u && u !== API && await pingTunnel(u)) {
        API = u;
        setText("api-label", API);
        const inp = $("api-input"); if (inp) inp.value = API;
      }
    }, 5 * 60 * 1000);
  }

  async function resolveApi() {
    const override = localStorage.getItem("yjs_api_override");
    if (override) { API = override.replace(/\/$/, ""); }
    else if (location.hostname === "127.0.0.1" || location.hostname === "localhost") {
      API = location.origin;
    } else {
      setText("api-label", "正在获取最新隧道地址…");
      const u = await waitForTunnel();
      API = u || location.origin;
      watchTunnel();
    }
    setText("api-label", API || "(未配置)");
    const inp = $("api-input"); if (inp) inp.value = API;
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

  /* The site-wide notice lives in the GitHub repo (the same file the admin
     publishes); read it from there first so the message is delivered even when
     the tunnel/back-end is down, then fall back to the local API. */
  const NOTICE_RAW =
    "https://raw.githubusercontent.com/cyrcyrgo/cyrcyrgo.github.io/main/cla/notification.json";

  async function loadGithubNotice() {
    const dir = location.pathname.replace(/[^/]*$/, "");     // /cla/ on Pages
    const targets = [
      dir + "notification.json?t=" + Date.now(),              // same-origin copy
      "https://gh-proxy.com/" + NOTICE_RAW + "?t=" + Date.now(),
      "https://ghfast.top/" + NOTICE_RAW + "?t=" + Date.now(),
    ];
    for (const url of targets) {
      try {
        const r = await fetch(url, { cache: "no-store" });
        if (!r.ok) continue;
        const d = await r.json();
        const title = (d.title || "").trim();
        const body = (d.body || "").trim();
        if (!title && !body) continue;
        return title && body ? title + "：" + body : (title || body);
      } catch (_) { /* try the next mirror */ }
    }
    return "";
  }

  async function loadSiteSettings() {
    try {
      const r = await fetch(API + "/api/settings?t=" + Date.now(), { cache: "no-store" });
      if (r.ok) SITE = Object.assign({ ai_enabled: true, announcement: "" }, await r.json());
    } catch (_) {}
    try {
      const remote = await loadGithubNotice();
      if (remote) SITE.announcement = remote;
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
    if (n == null) return "--";
    if (n < 1024) return n + " B";
    if (n < 1048576) return (n / 1024).toFixed(1) + " KB";
    if (n < 1073741824) return (n / 1048576).toFixed(1) + " MB";
    return (n / 1073741824).toFixed(2) + " GB";
  }
  function setMsg(text, kind = "") {
    const el = $("login-msg");
    if (!el) return;
    el.textContent = text || "";
    el.className = "msg " + kind;
  }
  function inlineMsg(id, text, kind) {
    const el = $(id); if (!el) return;
    el.textContent = text || "";
    el.className = "me-msg" + (kind ? " " + kind : "");
  }
  function renderUsage(u) {
    if (!u) return;
    setText("quota-text", `空间 ${fmtSize(u.used)} / ${fmtSize(u.quota)}（${u.percent}%）`);
    const bar = $("quota-bar");
    if (bar) {
      bar.querySelector("i").style.width = Math.min(u.percent, 100) + "%";
      bar.classList.toggle("full", !!u.full);
    }
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
  /* ------------------------------------------------------------------ */
  function setSidebar(collapsed) {
    const sb = $("sidebar"), app = $("app");
    if (!sb || !app) return;
    sb.classList.toggle("collapsed", collapsed);
    app.classList.toggle("sb-collapsed", collapsed);
    localStorage.setItem("yjs_sidebar_collapsed", collapsed ? "1" : "0");
  }
  function applySidebarState() {
    setSidebar(localStorage.getItem("yjs_sidebar_collapsed") === "1");
  }
  on("sidebar-toggle", "click", () =>
    setSidebar(!$("sidebar").classList.contains("collapsed")));

  /* ------------------------------------------------------------------ */
  /* model + mode + agent loaders                                         */
  /* ------------------------------------------------------------------ */
  async function loadModels(prefValue) {
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
      const chosen = prefValue || d.preference || d.default || (MODELS[0]?.name || "");
      if ([...sel.options].some((o) => o.value === chosen)) sel.value = chosen;
    } catch (e) { console.warn("loadModels failed:", e); }
  }

  async function loadAgents() {
    const sel = $("agent-select");
    if (!sel) return;
    try {
      const d = await api("/api/agents");
      AGENTS = d.agents || [];
    } catch (e) { AGENTS = []; }
    sel.innerHTML = "";
    const auto = document.createElement("option");
    auto.value = ""; auto.textContent = "🤖 默认智能体";
    sel.appendChild(auto);
    AGENTS.forEach((a) => {
      const opt = document.createElement("option");
      opt.value = a.id;
      opt.textContent = `${a.icon || "🤖"} ${a.name}`;
      opt.title = a.desc || "";
      sel.appendChild(opt);
    });
    if ([...sel.options].some((o) => o.value === currentAgent)) sel.value = currentAgent;
    renderAgentTag();
  }

  function renderAgentTag() {
    const el = $("agent-tag");
    if (!el) return;
    const a = AGENTS.find((x) => x.id === currentAgent);
    if (a) { el.textContent = `${a.icon || "🤖"} ${a.name}`; el.style.display = "inline-block"; }
    else el.style.display = "none";
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
  on("tab-code", "click", () => selectLoginTab("code"));
  on("tab-pwd", "click", () => selectLoginTab("pwd"));
  if ($("tab-code")) selectLoginTab(localStorage.getItem("yjs_login_tab") === "pwd" ? "pwd" : "code");

  on("btn-send", "click", async () => {
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
  });

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
  on("btn-verify", "click", doVerify);
  on("login-code", "keydown", (e) => { if (e.key === "Enter") doVerify(); });

  async function doPasswordLogin() {
    const email = $("login-email").value.trim();
    const password = $("login-password").value;
    if (!email || !password) return setMsg("请填写邮箱和验证码", "err");
    setMsg("登录中…");
    try {
      const d = await api("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });
      TOKEN = d.token; localStorage.setItem("yjs_token", TOKEN);
      enterApp(d.user);
    } catch (e) { setMsg(e.message, "err"); }
  }
  on("btn-pwd-login", "click", doPasswordLogin);
  on("login-password", "keydown", (e) => { if (e.key === "Enter") doPasswordLogin(); });

  function logout() {
    TOKEN = ""; localStorage.removeItem("yjs_token");
    currentConv = null; ME = null;
    $("app")?.classList.add("hidden");
    $("local")?.classList.add("hidden");
    $("login")?.classList.remove("hidden");
  }
  on("btn-logout", "click", logout);
  on("api-input", "change", () => {
    const v = $("api-input").value.trim();
    if (v) { localStorage.setItem("yjs_api_override", v); API = v.replace(/\/$/, ""); }
    else localStorage.removeItem("yjs_api_override");
    setText("api-label", API);
  });

  /* ------------------------------------------------------------------ */
  /* my account panel: profile / avatar / email / password / feedback     */
  /* ------------------------------------------------------------------ */
  function renderMeCard(user) {
    ME = user;
    setText("user-email", user.email);
    setText("me-mini-name", user.name || "我");
    const mini = $("me-mini-avatar"), big = $("me-avatar");
    const avatarHtml = user.avatar
      ? `<img src="${user.avatar}" alt="头像" />` : "👤";
    if (mini) mini.innerHTML = avatarHtml;
    if (big) big.innerHTML = avatarHtml;
    if ($("me-name")) $("me-name").value = user.name || "";
    setText("me-email", user.email);
    setText("me-quota",
      `${fmtSize(user.usage?.used)} / ${fmtSize(user.quota_bytes)}（${user.usage?.percent ?? 0}%）`);
    renderQreq(user.quota_request);
  }

  /* cloud-space expansion request */
  function renderQreq(req) {
    const st = $("qreq-status");
    const btn = $("btn-qreq-submit");
    if (!st) return;
    if (!req) { st.innerHTML = ""; st.classList.remove("show"); if (btn) btn.disabled = false; return; }
    const map = {
      pending: ["⏳ 申请审核中", "tag tier"],
      approved: ["✅ 申请已通过", "tag ok"],
      rejected: ["❌ 申请未通过", "tag danger"],
    };
    const [txt, cls] = map[req.status] || [req.status, "tag"];
    const mb = Math.round(req.request_bytes / 1024 / 1024);
    st.innerHTML = `<span class="${cls}">${txt} · ${mb} MB</span>` +
      (req.note ? `<div class="me-hint" style="margin-top:6px">管理员备注：${escapeHtml(req.note)}</div>` : "");
    st.classList.add("show");
    if (btn) btn.disabled = req.status === "pending";
  }
  async function loadQreq() {
    try {
      const d = await api("/api/quota/request");
      renderQreq(d.request || null);
      if (d.base_quota && !$("qreq-size").value) {
        $("qreq-size").placeholder =
          `期望空间（MB），当前基础 ${Math.round(d.base_quota / 1024 / 1024)}MB`;
      }
    } catch (_) {}
  }
  on("btn-qreq-submit", "click", async () => {
    const sizeMb = parseInt($("qreq-size").value, 10);
    const reason = $("qreq-reason").value.trim();
    const msg = $("qreq-msg");
    msg.style.color = "#ef4444";
    if (!sizeMb || sizeMb <= 0) { msg.textContent = "请填写期望空间大小"; return; }
    if (sizeMb > 51200) { msg.textContent = "最大可申请 51200 MB"; return; }
    if (reason.length < 5) { msg.textContent = "申请理由至少 5 个字"; return; }
    const btn = $("btn-qreq-submit"); btn.disabled = true;
    try {
      const d = await api("/api/quota/request", {
        method: "POST", body: JSON.stringify({ size_mb: sizeMb, reason }),
      });
      renderQreq(d.request);
      $("qreq-size").value = ""; $("qreq-reason").value = "";
      msg.style.color = "#16a34a"; msg.textContent = "✓ 申请已提交，等待管理员审批";
    } catch (e) {
      msg.textContent = e.message; btn.disabled = false;
    }
  });

  function openMePanel() {
    if (!ME) return;
    $("me-panel").classList.remove("hidden");
    renderMeCard(ME);
    loadQreq();
  }
  on("btn-me", "click", openMePanel);
  on("btn-settings", "click", openMePanel);
  on("btn-close-me", "click", () => $("me-panel").classList.add("hidden"));

  /* Client-side downscale so a phone photo never exceeds the 300 KB limit. */
  function fileToAvatarDataUri(file, maxBytes = 290 * 1024) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error("读取图片失败"));
      reader.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error("图片解码失败"));
        img.onload = () => {
          let size = 160;
          const attempt = () => {
            const cv = document.createElement("canvas");
            cv.width = cv.height = size;
            const ctx = cv.getContext("2d");
            ctx.clearRect(0, 0, size, size);
            const s = Math.min(img.width, img.height);
            ctx.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, size, size);
            const uri = cv.toDataURL("image/jpeg", 0.85);
            if (uri.length <= maxBytes || size <= 64) return resolve(uri);
            size = Math.round(size * 0.8);
            attempt();
          };
          attempt();
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  on("btn-avatar-pick", "click", () => $("avatar-input")?.click());
  on("avatar-input", "change", async (e) => {
    const file = (e.target.files || [])[0];
    e.target.value = "";
    if (!file) return;
    inlineMsg("me-profile-msg", "处理图片中…");
    try {
      const uri = await fileToAvatarDataUri(file);
      const d = await api("/api/me/profile", { method: "POST", body: JSON.stringify({ avatar: uri }) });
      renderMeCard(d.user);
      inlineMsg("me-profile-msg", "✓ 头像已更新", "ok");
    } catch (err) { inlineMsg("me-profile-msg", err.message, "err"); }
  });
  on("btn-avatar-clear", "click", async () => {
    try {
      const d = await api("/api/me/profile", { method: "POST", body: JSON.stringify({ avatar: "" }) });
      renderMeCard(d.user);
      inlineMsg("me-profile-msg", "✓ 头像已清除", "ok");
    } catch (err) { inlineMsg("me-profile-msg", err.message, "err"); }
  });
  on("btn-save-profile", "click", async () => {
    const name = $("me-name").value.trim();
    if (!name) return inlineMsg("me-profile-msg", "昵称不能为空", "err");
    try {
      const d = await api("/api/me/profile", { method: "POST", body: JSON.stringify({ name }) });
      renderMeCard(d.user);
      inlineMsg("me-profile-msg", "✓ 资料已保存", "ok");
    } catch (err) { inlineMsg("me-profile-msg", err.message, "err"); }
  });

  on("btn-me-send-code", "click", async () => {
    const email = $("me-new-email").value.trim();
    if (!email) return inlineMsg("me-email-msg", "请填写新邮箱", "err");
    const btn = $("btn-me-send-code"); btn.disabled = true;
    try {
      await api("/api/me/email/send-code", { method: "POST", body: JSON.stringify({ email }) });
      inlineMsg("me-email-msg", "✓ 验证码已发送", "ok");
      let left = 60; const timer = setInterval(() => {
        btn.textContent = left + "s";
        if (--left < 0) { clearInterval(timer); btn.disabled = false; btn.textContent = "获取验证码"; }
      }, 1000);
    } catch (err) {
      inlineMsg("me-email-msg", err.message, "err"); btn.disabled = false;
    }
  });
  on("btn-me-change-email", "click", async () => {
    const email = $("me-new-email").value.trim();
    const code = $("me-email-code").value.trim();
    if (!email || !code) return inlineMsg("me-email-msg", "请填写新邮箱和验证码", "err");
    try {
      const d = await api("/api/me/email", { method: "POST", body: JSON.stringify({ email, code }) });
      TOKEN = d.token; localStorage.setItem("yjs_token", TOKEN);
      renderMeCard(d.user);
      $("me-new-email").value = ""; $("me-email-code").value = "";
      inlineMsg("me-email-msg", "✓ 邮箱已更改", "ok");
    } catch (err) { inlineMsg("me-email-msg", err.message, "err"); }
  });

  on("btn-me-save-pw", "click", async () => {
    const pw1 = $("me-pw1").value, pw2 = $("me-pw2").value;
    if (pw1.length < 6) return inlineMsg("me-pw-msg", "密码至少 6 位", "err");
    if (pw1 !== pw2) return inlineMsg("me-pw-msg", "两次输入不一致", "err");
    try {
      await api("/api/auth/password", { method: "POST", body: JSON.stringify({ password: pw1 }) });
      $("me-pw1").value = ""; $("me-pw2").value = "";
      inlineMsg("me-pw-msg", "✓ 密码已保存，下次可用密码登录", "ok");
    } catch (err) { inlineMsg("me-pw-msg", err.message, "err"); }
  });

  on("btn-me-feedback", "click", async () => {
    const category = $("me-fb-cat").value;
    const content = $("me-fb-text").value.trim();
    if (content.length < 2) return inlineMsg("me-fb-msg", "请填写反馈内容", "err");
    try {
      await api("/api/feedback", { method: "POST",
        body: JSON.stringify({ category, content }) });
      $("me-fb-text").value = "";
      inlineMsg("me-fb-msg", "✓ 反馈已提交，感谢你的反馈", "ok");
    } catch (err) { inlineMsg("me-fb-msg", err.message, "err"); }
  });

  /* ------------------------------------------------------------------ */
  /* offline (in-browser WebGPU) mode entry — implemented in local.js     */
  /* ------------------------------------------------------------------ */
  on("btn-local", "click", () => {
    $("login").classList.add("hidden");
    $("local").classList.remove("hidden");
    if (window.YJSLocal && window.YJSLocal.enter) window.YJSLocal.enter();
  });
  on("btn-local-back", "click", () => {
    $("local").classList.add("hidden");
    $("login").classList.remove("hidden");
  });

  /* ------------------------------------------------------------------ */
  /* bootstrap                                                           */
  /* ------------------------------------------------------------------ */
  function wireUi() {
    if (uiWired) return;
    uiWired = true;

    // Model selector change → persist preference
    $("model-select").addEventListener("change", () => {
      const v = $("model-select").value;
      api("/api/models/set", { method: "POST", body: JSON.stringify({ model: v || null }) }).catch(() => {});
    });

    // Domain agents are chosen automatically by mode; the manual selector
    // was removed from the UI to keep the composer to model + mode.
    const agentSel = $("agent-select");
    if (agentSel) agentSel.addEventListener("change", () => {
      currentAgent = agentSel.value;
      localStorage.setItem("yjs_agent", currentAgent);
      renderAgentTag();
    });

    // Mode selector
    $("mode-select").addEventListener("change", () => {
      currentMode = $("mode-select").value;
      localStorage.setItem("yjs_mode", currentMode);
    });
    const savedMode = localStorage.getItem("yjs_mode") || "work";
    $("mode-select").value = savedMode; currentMode = savedMode;

    // Files drawer
    on("btn-files", "click", () => { $("files-panel").classList.remove("hidden"); loadFiles(); });
    on("btn-close-files", "click", () => $("files-panel").classList.add("hidden"));

    // Preview drawer
    on("btn-preview-close", "click", () => $("preview-panel").classList.add("hidden"));

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
    on("btn-export", "click", exportConversation);
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
    $("login").classList.add("hidden"); $("local")?.classList.add("hidden");
    $("app").classList.remove("hidden");
    renderMeCard(user);
    renderUsage(user.usage);
    applySidebarState();
    wireUi();
    await Promise.all([loadModels(user.model_preference), loadAgents()]);
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
    setHtml("messages", `<div class="empty">描述你的任务，选择模型与模式，Agent 就会在本机直接执行。</div>`);
    $("model-tag").style.display = "none";
    $("mode-tag").style.display = "none";
    const at = $("agent-tag"); if (at) at.style.display = "none";
    const rs = $("run-status"); if (rs) rs.style.display = "none";
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
      refreshRunStatus();
    } catch (e) { alert(e.message); }
  }

  /* A run survives network drops: poll status and auto-reload the finished
     result when the page was offline while the agent kept working. */
  let runPollTimer = null;
  function setRunBanner(running, elapsed) {
    const el = $("run-status");
    if (!el) return;
    if (running) {
      el.style.display = "inline-block";
      el.textContent = `⏳ 任务运行中（${elapsed}s）· 断线也不影响，完成后会自动保存`;
    } else {
      el.style.display = "none";
    }
  }
  async function pollRunning() {
    if (!currentConv) return;
    try {
      const d = await api(`/api/conversations/${currentConv}/status`);
      if (d.running) { setRunBanner(true, d.elapsed); return; }
      setRunBanner(false, 0);
      if (runPollTimer) { clearInterval(runPollTimer); runPollTimer = null; }
      // Finished while this tab was away -> pull the persisted messages.
      if (!sending) { await openConversation(currentConv); }
    } catch (_) { /* keep polling */ }
  }
  async function refreshRunStatus() {
    if (!currentConv) return;
    try {
      const d = await api(`/api/conversations/${currentConv}/status`);
      setRunBanner(d.running, d.elapsed);
      if (d.running && !runPollTimer) runPollTimer = setInterval(pollRunning, 4000);
      if (!d.running && runPollTimer) { clearInterval(runPollTimer); runPollTimer = null; }
    } catch (_) {}
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
    setRunBanner(true, 0);
    if (!runPollTimer) runPollTimer = setInterval(pollRunning, 4000);
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
      } else if (ev.type === "agent") {
        const el = $("agent-tag");
        if (el && ev.icon && ev.name) {
          el.textContent = `${ev.icon} ${ev.name}`;
          el.style.display = "inline-block";
        }
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
        body: JSON.stringify({
          content: text, model: chosenModel || null,
          mode: chosenMode, agent: null,
        }),
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
        "⚠ 连接中断（" + (e.message || "network") + "）。任务仍在服务器执行，完成后会自动保存；可稍后重开对话查看。");
      // Keep polling: the agent run is tied to the server task, not this SSE.
      refreshRunStatus();
    } finally {
      endStream(); if (live.parentNode) live.remove();
      sending = false; $("btn-send-msg").disabled = false;
      loadConversations(); refreshMe();
      setTimeout(refreshRunStatus, 800);
    }
  }
  on("btn-send-msg", "click", sendMessage);
  on("chat-input", "keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  });

  async function refreshMe() {
    try {
      const d = await api("/api/me");
      ME = d.user;
      renderUsage(d.user.usage);
    } catch (_) {}
  }

  /* ------------------------------------------------------------------ */
  /* files drawer + preview                                              */
  /* ------------------------------------------------------------------ */
  let lastFiles = [];   // current file listing, for batch selection

  function toast(text) {
    let el = document.getElementById("mini-toast");
    if (!el) {
      el = document.createElement("div");
      el.id = "mini-toast"; el.className = "mini-toast";
      document.body.appendChild(el);
    }
    el.textContent = text;
    el.classList.add("show");
    clearTimeout(el._timer);
    el._timer = setTimeout(() => el.classList.remove("show"), 2400);
  }

  function selectedPaths() {
    return Array.from(document.querySelectorAll(".fr-check:checked"))
      .map((cb) => cb.value);
  }
  function updateBatchBar() {
    const paths = selectedPaths();
    const bar = $("files-batchbar");
    if (bar) bar.classList.toggle("hidden", lastFiles.length === 0);
    const cnt = $("files-sel-count");
    if (cnt) cnt.textContent = `已选 ${paths.length} 项`;
    const ck = $("files-checkall");
    if (ck) {
      ck.checked = lastFiles.length > 0 && paths.length === lastFiles.length;
      ck.indeterminate = paths.length > 0 && paths.length < lastFiles.length;
    }
    ["btn-batch-download", "btn-batch-email", "btn-batch-delete"].forEach((id) => {
      const b = $(id); if (b) b.disabled = paths.length === 0;
    });
  }

  async function loadFiles() {
    try {
      const d = await api("/api/files");
      renderUsage(d.usage);
      lastFiles = d.files || [];
      $("files-usage").textContent =
        `${lastFiles.length} 个文件 · 已用 ${fmtSize(d.usage.used)} / ${fmtSize(d.usage.quota)}`;
      const box = $("files-list"); box.innerHTML = "";
      if (!lastFiles.length) {
        box.innerHTML = `<div style="color:#8b98b4;padding:20px;text-align:center">暂无文件 —— 让 Agent 写点什么吧</div>`;
        updateBatchBar();
        return;
      }
      const TEXT_EXTS = new Set(["txt","md","markdown","json","py","js","ts","jsx","tsx",
        "css","csv","log","ini","toml","xml","html","htm","sh","bat","ps1","rs","go","java",
        "c","cpp","h","vue","svelte"]);
      lastFiles.forEach((f) => {
        const row = document.createElement("div");
        row.className = "file-row";
        const filename = f.path.split("/").pop();
        const ext = (filename.split(".").pop() || "").toLowerCase();
        const canPreview = TEXT_EXTS.has(ext);
        row.innerHTML =
          `<label class="fr-pick"><input type="checkbox" class="fr-check" value="${escapeHtml(f.path)}" /></label>` +
          `<div class="fr-main">` +
          `<div class="fr-name" title="${escapeHtml(f.path)}">📄 ${escapeHtml(f.path)}</div>` +
          `<div class="fr-meta">${fmtSize(f.size)} · ${new Date(f.modified * 1000).toLocaleString()}</div>` +
          `</div><div class="fr-actions">` +
          (canPreview ? `<button class="btn btn-prev">预览</button>` : "") +
          `<a class="btn btn-dl" href="${escapeHtml(downloadUrl(f.path))}" download="${escapeHtml(filename)}" target="_blank" rel="noopener">下载</a>` +
          `<button class="btn btn-del">删除</button></div>`;
        row.querySelector(".fr-check").addEventListener("change", updateBatchBar);
        if (canPreview) row.querySelector(".btn-prev").onclick = () => openPreview(f.path);
        row.querySelector(".btn-del").onclick = async () => {
          if (!confirm("删除 " + f.path + " ?")) return;
          await api("/api/files?path=" + encodeURIComponent(f.path), { method: "DELETE" });
          await refreshMe(); loadFiles();
        };
        box.appendChild(row);
      });
      updateBatchBar();
    } catch (e) { alert(e.message); }
  }
  on("btn-clear-files", "click", async () => {
    if (!confirm("确定清空全部工作区文件？此操作不可恢复。")) return;
    await api("/api/files/clear", { method: "POST" });
    await refreshMe(); loadFiles();
  });

  /* --- batch select / download / delete / email --- */
  on("files-checkall", "change", (e) => {
    document.querySelectorAll(".fr-check").forEach((cb) => { cb.checked = e.target.checked; });
    updateBatchBar();
  });
  on("btn-batch-download", "click", () => {
    const paths = selectedPaths();
    if (!paths.length) return;
    let url;
    if (paths.length === 1) {
      url = downloadUrl(paths[0]);
    } else {
      const q = paths.map((p) => "paths=" + encodeURIComponent(p)).join("&");
      url = `${API}/api/files/batch-download?${q}&token=${encodeURIComponent(TOKEN || "")}`;
    }
    const a = document.createElement("a");
    a.href = url; a.target = "_blank"; a.rel = "noopener";
    document.body.appendChild(a); a.click(); a.remove();
  });
  on("btn-batch-delete", "click", async () => {
    const paths = selectedPaths();
    if (!paths.length) return;
    if (!confirm(`确定删除选中的 ${paths.length} 个文件？此操作不可恢复。`)) return;
    try {
      const r = await api("/api/files/batch-delete", {
        method: "POST", body: JSON.stringify({ paths }),
      });
      await refreshMe(); await loadFiles();
      toast(`已删除 ${r.deleted ?? paths.length} 个文件`);
    } catch (e) { alert(e.message); }
  });

  let mailPaths = [];
  function closeFileMail() {
    $("file-mail-modal").classList.add("hidden");
    $("file-mail-msg").textContent = "";
  }
  on("btn-batch-email", "click", () => {
    mailPaths = selectedPaths();
    if (!mailPaths.length) return;
    const total = mailPaths.reduce((s, p) => {
      const f = lastFiles.find((x) => x.path === p);
      return s + (f ? f.size : 0);
    }, 0);
    $("file-mail-info").textContent =
      `将发送 ${mailPaths.length} 个文件（共 ${fmtSize(total)}）到你注册的邮箱 ${ME?.email || ""}。附件总量不超过 25MB。`;
    const radios = document.querySelectorAll('input[name="mail-as"]');
    if (mailPaths.length === 1) radios.forEach((r) => { r.disabled = false; });
    else { document.querySelector('input[name="mail-as"][value="zip"]').checked = true; }
    $("file-mail-msg").textContent = "";
    $("file-mail-modal").classList.remove("hidden");
  });
  on("file-mail-cancel", "click", closeFileMail);
  on("file-mail-ok", "click", async () => {
    if (!mailPaths.length) return;
    const asZip = document.querySelector('input[name="mail-as"]:checked')?.value === "zip";
    const msg = $("file-mail-msg");
    const btn = $("file-mail-ok");
    btn.disabled = true; msg.style.color = "#8b98b4"; msg.textContent = "发送中，请稍候…";
    try {
      await api("/api/files/email", {
        method: "POST", body: JSON.stringify({ paths: mailPaths, as_zip: asZip }),
      });
      msg.style.color = "#16a34a"; msg.textContent = "✓ 已发送到你的邮箱（SMTP 投递可能需要一点时间）";
      setTimeout(closeFileMail, 1500);
    } catch (e) {
      msg.style.color = "#ef4444"; msg.textContent = e.message;
    } finally { btn.disabled = false; }
  });

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
  on("btn-upload-file", "click", () => $("upload-input")?.click());
  on("upload-input", "change", async (e) => {
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
  });

  /* --- preview --- */
  async function openPreview(path) {
    $("preview-panel").classList.remove("hidden");
    $("preview-title").textContent = "预览 · " + path;
    setHtml("preview-body", `<div style="color:#8b98b4">加载中…</div>`);
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
