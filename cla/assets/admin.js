/* YJS 管理后台 —— 实时模型调用 / Token 计量 / 用户管理 */
(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  let API = "";
  let TOKEN = localStorage.getItem("yjs_token") || "";
  let ADMIN_TOKEN = sessionStorage.getItem("yjs_admin_token") || "";
  let ME = null;
  let timer = null;
  let auxTimer = null;
  let drawerUid = null;

  /* The dashboard is opened both as http://host/admin and as
     https://<user>.github.io/<prefix>/admin.html, so every self-link must point
     at the app folder of the *current* page instead of the site root.
     Pathname-based derivation needs no DOM lookup, so it also works when the
     page shell is an older cached copy. */
  const APP_ROOT = (function () {
    const dir = location.pathname.replace(/[^/]*$/, "");   // /admin -> "", /cla/admin.html -> /cla/
    return dir || "/";
  })();

  const hide = (id) => { const el = $(id); if (el) el.classList.add("hidden"); };
  const on = (id, evt, fn) => { const el = $(id); if (el) el.addEventListener(evt, fn); };
  const setHref = (id, href) => { const el = $(id); if (el) el.href = href; };

  /* ---------------------------------------------------------------- utils */
  const escapeHtml = (s) => (s || "").replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  function fmtNum(n) {
    n = Number(n || 0);
    if (n < 1000) return String(n);
    if (n < 1e6) return (n / 1e3).toFixed(1) + "K";
    if (n < 1e9) return (n / 1e6).toFixed(2) + "M";
    return (n / 1e9).toFixed(2) + "B";
  }
  function fmtSize(n) {
    n = Number(n || 0);
    if (n < 1024) return n + " B";
    if (n < 1048576) return (n / 1024).toFixed(1) + " KB";
    if (n < 1073741824) return (n / 1048576).toFixed(1) + " MB";
    return (n / 1073741824).toFixed(2) + " GB";
  }
  function fmtTime(ts) {
    if (!ts) return "—";
    const d = new Date(ts * 1000);
    const p = (x) => String(x).padStart(2, "0");
    return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }
  function fmtAgo(ts) {
    if (!ts) return "从未";
    const s = Math.max(0, Math.floor(Date.now() / 1000 - ts));
    if (s < 60) return s + " 秒前";
    if (s < 3600) return Math.floor(s / 60) + " 分钟前";
    if (s < 86400) return Math.floor(s / 3600) + " 小时前";
    return Math.floor(s / 86400) + " 天前";
  }
  // Local YYYY-MM-DD — the backend buckets by_day with the server's local
  // date, so toISOString() (UTC) would report "today" as yesterday before 08:00.
  function localDay() {
    const d = new Date();
    const p = (x) => String(x).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }
  function toast(msg, kind = "") {
    let el = $("toast");
    if (!el) { el = document.createElement("div"); el.id = "toast"; document.body.appendChild(el); }
    el.className = kind;
    el.textContent = msg;
    el.classList.remove("hidden");
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.add("hidden"), 2600);
  }

  /* ---------------------------------------------------------------- api */
  /* Latest tunnel URL: the one-click launcher rotates the cpolar domain on
     every boot and pushes config.json to the repo. Pages/raw can lag ~1 min,
     so query mirrors in parallel, require /api/health, retry and keep watch. */
  const CFG_RAW =
    "https://raw.githubusercontent.com/cyrcyrgo/cyrcyrgo.github.io/main/cla/config.json";

  function cfgUrls() {
    const dir = location.pathname.replace(/[^/]*$/, "");
    const bust = Date.now();
    return [
      dir + "config.json?t=" + bust,
      CFG_RAW + "?t=" + bust,
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
    return last;
  }

  async function resolveApi() {
    const override = localStorage.getItem("yjs_api_override");
    if (override) { API = override.replace(/\/$/, ""); return; }
    if (["127.0.0.1", "localhost"].includes(location.hostname)) {
      API = location.origin;
      return;
    }
    API = (await waitForTunnel()) || location.origin;
    // Survive a tunnel rotation while the dashboard stays open.
    setInterval(async () => {
      if (localStorage.getItem("yjs_api_override")) return;
      const u = await readTunnelUrl();
      if (u && u !== API && await pingTunnel(u)) API = u;
    }, 5 * 60 * 1000);
  }
  async function api(path, opts = {}) {
    const headers = Object.assign(
      { "Content-Type": "application/json", "ngrok-skip-browser-warning": "true" },
      opts.headers || {}
    );
    if (TOKEN) headers["Authorization"] = "Bearer " + TOKEN;
    if (ADMIN_TOKEN) headers["X-Admin-Token"] = ADMIN_TOKEN;
    const res = await fetch(API + path, Object.assign({}, opts, { headers }));
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.detail || data.error || ("HTTP " + res.status));
      err.status = res.status;
      throw err;
    }
    return data;
  }

  /* ------------------------------------------------- lock screen (password) */
  function showLock() {
    clearInterval(timer); timer = null;
    hide("main"); hide("deny");
    const lock = $("lock");
    if (!lock) {
      // The page shell is a stale cached copy without the lock markup.
      // Explain it instead of throwing and leaving a dead page.
      document.body.insertAdjacentHTML("beforeend",
        '<div class="deny">管理后台已加密，但当前页面是旧版缓存。' +
        '请按 Ctrl+F5 强制刷新后重试。</div>');
      return;
    }
    lock.classList.remove("hidden");
    const msg = $("lock-msg"); if (msg) msg.textContent = "";
    const pw = $("lock-pw"); if (pw) setTimeout(() => pw.focus(), 40);
  }
  function showDeny(msg) {
    clearInterval(timer); timer = null;
    hide("main"); hide("lock");
    const deny = $("deny");
    if (!deny) {
      document.body.insertAdjacentHTML("beforeend",
        '<div class="deny">' + escapeHtml(msg || "需要管理员权限") + "</div>");
      return;
    }
    deny.classList.remove("hidden");
    const el = $("deny-msg"); if (el && msg) el.textContent = msg;
  }
  async function unlock() {
    const pwEl = $("lock-pw");
    const pw = pwEl ? pwEl.value : "";
    if (!pw) return;
    const msg = $("lock-msg");
    if (msg) msg.textContent = "验证中…";
    try {
      const d = await api("/api/admin/unlock", {
        method: "POST", body: JSON.stringify({ password: pw }),
      });
      ADMIN_TOKEN = d.admin_token;
      sessionStorage.setItem("yjs_admin_token", ADMIN_TOKEN);
      if (pwEl) pwEl.value = "";
      hide("lock");
      await start();
    } catch (e) {
      if (msg) msg.textContent = e.status === 401 ? "密码错误" : (e.message || "解锁失败");
    }
  }
  // Bound defensively: a missing node must never abort the rest of the script.
  on("lock-ok", "click", unlock);
  on("lock-pw", "keydown", (e) => { if (e.key === "Enter") unlock(); });
  on("lock-back", "click", () => { location.href = APP_ROOT; });
  setHref("btn-back", APP_ROOT);
  setHref("deny-back", APP_ROOT);

  /* ---------------------------------------------------------------- modal */
  let modalCb = null;
  function openModal(title, desc, value, placeholder, cb) {
    $("modal-title").textContent = title;
    $("modal-desc").textContent = desc || "";
    $("modal-input").value = value || "";
    $("modal-input").placeholder = placeholder || "";
    modalCb = cb;
    $("modal").classList.remove("hidden");
    setTimeout(() => $("modal-input").focus(), 30);
  }
  function closeModal() { $("modal").classList.add("hidden"); modalCb = null; }
  $("modal-cancel").onclick = closeModal;
  $("modal-ok").onclick = async () => {
    const v = $("modal-input").value.trim();
    const cb = modalCb;
    if (!cb) return closeModal();
    try { await cb(v); closeModal(); } catch (e) { toast(e.message, "err"); }
  };
  $("modal-input").addEventListener("keydown", (e) => { if (e.key === "Enter") $("modal-ok").click(); });
  $("modal").addEventListener("click", (e) => { if (e.target === $("modal")) closeModal(); });

  /* ---------------------------------------------------------------- drawer */
  $("drawer-close").onclick = () => $("drawer").classList.add("hidden");
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    $("drawer").classList.add("hidden"); closeModal();
  });

  async function openUserConversations(uid, email) {
    drawerUid = uid;
    $("drawer").classList.remove("hidden");
    $("drawer-title").textContent = "对话 · " + email;
    $("drawer-body").innerHTML = `<div class="muted">加载中…</div>`;
    try {
      const d = await api(`/api/admin/users/${uid}/conversations`);
      if (!d.conversations.length) {
        $("drawer-body").innerHTML = `<div class="muted">该用户还没有对话</div>`;
        return;
      }
      $("drawer-body").innerHTML = d.conversations.map((c) =>
        `<div class="conv-item" data-cid="${escapeHtml(c.id)}">
           <div>${escapeHtml(c.title || "新对话")}</div>
           <div class="meta">${c.messages} 条消息 · 更新于 ${fmtTime(c.updated_at)}</div>
         </div>`).join("");
      $("drawer-body").querySelectorAll(".conv-item").forEach((el) => {
        el.onclick = () => openConversation(uid, el.dataset.cid);
      });
    } catch (e) {
      $("drawer-body").innerHTML = `<div style="color:var(--err)">${escapeHtml(e.message)}</div>`;
    }
  }

  async function openConversation(uid, cid) {
    $("drawer-body").innerHTML = `<div class="muted">加载中…</div>`;
    try {
      const d = await api(`/api/admin/users/${uid}/conversations/${cid}`);
      const conv = d.conversation;
      const head = `<div style="margin-bottom:14px">
          <button class="btn ghost" id="back-convs">← 返回列表</button>
          <span class="muted" style="margin-left:10px">${escapeHtml(conv.title || "")}</span>
        </div>`;
      const rows = conv.messages.map((m) => {
        const role = m.role || "?";
        const who = role === "user" ? "用户" : role === "assistant" ? "AI"
                  : role === "tool" ? "工具: " + (m.name || "") : role;
        const text = m.content || (m.files ? JSON.stringify(m.files) : "");
        return `<div class="msg-row ${escapeHtml(role)}">
            <div class="role">${escapeHtml(who)} · ${fmtTime(m.ts)}</div>
            <div class="body">${escapeHtml(text)}</div>
          </div>`;
      }).join("");
      $("drawer-body").innerHTML = head + (rows || `<div class="muted">空对话</div>`);
      $("back-convs").onclick = () => {
        const email = ME && ME.email;
        const userRow = (window.__users || []).find((u) => u.uid === uid);
        openUserConversations(uid, userRow ? userRow.email : (email || uid));
      };
    } catch (e) {
      $("drawer-body").innerHTML = `<div style="color:var(--err)">${escapeHtml(e.message)}</div>`;
    }
  }

  /* ---------------------------------------------------------------- render */
  function renderOverview(ov) {
    const t = ov.totals || {};
    $("s-users").textContent = fmtNum(ov.users_total);
    $("s-calls").textContent = fmtNum(t.calls);
    $("s-tokens").textContent = fmtNum(t.total_tokens);
    $("s-token-split").textContent =
      `输入 ${fmtNum(t.prompt_tokens)} · 输出 ${fmtNum(t.completion_tokens)}`;
    const today = (ov.by_day || {})[localDay()] || {};
    $("s-today").textContent = fmtNum(today.total_tokens);
    $("s-today-calls").textContent = `今日调用 ${fmtNum(today.calls)} 次`;
    $("s-live").textContent = fmtNum((ov.live || []).length);

    const el = $("s-ollama");
    el.textContent = ov.ollama_ok ? "在线" : "离线";
    el.style.color = ov.ollama_ok ? "var(--ok)" : "var(--err)";
    const vram = (ov.vram || []).reduce((a, m) => a + (m.vram || 0), 0);
    $("s-vram").textContent = vram ? "已加载 " + fmtSize(vram) : "无模型常驻";

    const fb = $("fb-unread");
    if (fb) {
      const n = ov.feedback_unread || 0;
      fb.style.display = n ? "inline-block" : "none";
      fb.textContent = n ? ("未读反馈 " + n) : "";
    }
  }

  let lastModelsSig = "";
  function renderModels(ov) {
    const tb = $("tbl-models").querySelector("tbody");
    const rows = ov.models || [];
    const sig = JSON.stringify(rows);
    if (sig === lastModelsSig) return;   // unchanged → keep DOM (and click handlers) intact
    lastModelsSig = sig;
    tb.innerHTML = rows.map((m) => {
      let status, cls;
      if (m.active > 0) { status = `调用中 ×${m.active}`; cls = "busy"; }
      else if (m.loaded) { status = "显存常驻"; cls = "on"; }
      else if (m.installed) { status = "已安装"; cls = "off"; }
      else { status = "未安装"; cls = "off"; }
      const enabledCls = m.enabled ? "yes" : "no";
      const enabledTxt = m.enabled ? "启用" : "暂停";
      const builtinBadge = m.is_builtin
        ? `<span class="badge tier" title="内置模型（不可删除，可暂停）">内置</span>`
        : `<span class="badge user" title="管理员添加的云端 API 模型">${escapeHtml(m.provider || "API")}</span>`;
      return `<tr data-name="${escapeHtml(m.name)}">
        <td>${builtinBadge} ${escapeHtml(m.display || m.name)}</td>
        <td><span class="badge tier">${escapeHtml(m.tier || "—")}</span></td>
        <td><span class="badge ${enabledCls}">${enabledTxt}</span></td>
        <td><span class="dot ${cls}"></span>${escapeHtml(status)}</td>
        <td class="num">${fmtNum(m.calls)}</td>
        <td class="num">${fmtNum(m.prompt_tokens)}</td>
        <td class="num">${fmtNum(m.completion_tokens)}</td>
        <td class="num"><b>${fmtNum(m.total_tokens)}</b></td>
        <td class="muted">${fmtAgo(m.last_used)}</td>
        <td style="white-space:nowrap">
          <button class="btn ghost" data-act="run" title="实际生成几个字并计时，检查模型能否正常输出">试运行</button>
          <button class="btn ghost" data-act="edit">编辑</button>
          <button class="btn ghost" data-act="tog">${m.enabled ? "暂停" : "恢复"}</button>
          ${m.is_builtin
            ? `<button class="btn ghost" disabled title="内置模型不可删除">删除</button>`
            : `<button class="btn danger" data-act="del">删除</button>`}
        </td>
      </tr>`;
    }).join("") || `<tr><td colspan="10" class="muted">无模型</td></tr>`;

    tb.querySelectorAll("button[data-act]").forEach((btn) => {
      const tr = btn.closest("tr");
      const name = tr.dataset.name;
      const act = btn.dataset.act;
      const model = (ov.models || []).find((x) => x.name === name);
      if (act === "edit") btn.onclick = () => openEditModelModal(model || { name });
      else if (act === "run") btn.onclick = async () => {
        const old = btn.textContent;
        btn.disabled = true; btn.textContent = "试运行中…";
        try {
          const d = await api("/api/admin/models/run-test", {
            method: "POST", body: JSON.stringify({ name }),
          });
          if (d.kind === "local") {
            alert(
              `试运行成功 ✅\n模型：${name}\n回复：${d.reply || "(空回复)"}\n` +
              `总耗时 ${d.wall_seconds}s（冷加载 ${d.load_seconds}s）\n` +
              `生成 ${d.gen_tokens} tokens · ${d.tokens_per_second} tok/s`);
          } else {
            alert(`试运行成功 ✅\n模型：${name}\n耗时：${d.wall_seconds}s\n回复：${d.reply}`);
          }
        } catch (e) {
          alert("试运行失败（可能长时间无响应）：" + e.message);
        } finally { btn.disabled = false; btn.textContent = old; }
      };
      else if (act === "tog") btn.onclick = async () => {
        const ov2 = await api("/api/admin/overview");
        const target = (ov2.models || []).find((x) => x.name === name);
        if (!target) return;
        await api("/api/admin/models/toggle?name=" + encodeURIComponent(name),
          { method: "POST", body: JSON.stringify({ enabled: !target.enabled }) });
        toast(target.enabled ? "已暂停" : "已恢复", "ok");
        await refresh();
      };
      else if (act === "del") btn.onclick = async () => {
        if (!confirm(`确定删除 API 模型 "${name}"？（内置模型不可删）`)) return;
        await api("/api/admin/models/delete?name=" + encodeURIComponent(name),
                  { method: "DELETE" });
        toast("已删除", "ok");
        await refresh();
      };
    });
  }

  function renderLive(ov) {
    const box = $("live-list");
    const live = ov.live || [];
    if (!live.length) { box.innerHTML = `<div class="muted">暂无进行中的调用</div>`; return; }
    box.innerHTML = live.map((c) => `
      <div class="live-item">
        <div class="top">
          <span>${escapeHtml(c.model)} <span class="badge tier">${escapeHtml(c.mode)}</span></span>
          <span class="el">${c.elapsed}s</span>
        </div>
        <div class="em">${escapeHtml(c.email || c.uid)}</div>
        <div class="ph">${escapeHtml(c.phase || "")} · 第 ${c.step || 0} 步</div>
      </div>`).join("");
  }

  function renderRecent(ov) {
    const tb = $("tbl-recent").querySelector("tbody");
    tb.innerHTML = (ov.recent || []).map((r) => `<tr>
      <td class="mono">${fmtTime(r.ts)}</td>
      <td>${escapeHtml(r.email || r.uid)}</td>
      <td>${escapeHtml(r.model)}</td>
      <td><span class="badge tier">${escapeHtml(r.mode)}</span></td>
      <td class="num">${fmtNum(r.prompt_tokens)}</td>
      <td class="num">${fmtNum(r.completion_tokens)}</td>
      <td class="num">${(r.seconds || 0).toFixed(1)}s</td>
    </tr>`).join("") || `<tr><td colspan="7" class="muted">暂无调用记录</td></tr>`;
  }

  function renderDays(ov) {
    const days = Object.entries(ov.by_day || {}).sort().slice(-7);
    const max = Math.max(1, ...days.map(([, v]) => v.total_tokens || 0));
    $("days").innerHTML = days.length
      ? days.map(([d, v]) => {
          const pct = Math.round((v.total_tokens || 0) / max * 100);
          return `<div class="day-row">
            <span class="d">${d.slice(5)}</span>
            <span class="bar" style="flex:1"><i style="width:${pct}%"></i></span>
            <span class="n">${fmtNum(v.total_tokens)}</span>
          </div>`;
        }).join("")
      : `<div class="muted">暂无数据</div>`;
  }

  let lastUsersSig = "";
  let userFilter = "";
  function filterUsers(users) {
    const q = userFilter.trim().toLowerCase();
    if (!q) return users;
    return users.filter((u) =>
      (u.email || "").toLowerCase().includes(q) ||
      (u.name || "").toLowerCase().includes(q) ||
      (u.uid || "").toLowerCase().includes(q));
  }
  function renderUsers(users) {
    window.__users = users;
    const shown = filterUsers(users);
    const sig = JSON.stringify(shown) + "|" + userFilter;
    if (sig === lastUsersSig) return;   // unchanged → keep DOM (and click handlers) intact
    lastUsersSig = sig;
    const cnt = $("user-count");
    if (cnt) cnt.textContent = userFilter
      ? `显示 ${shown.length} / 共 ${users.length} 人` : `共 ${users.length} 人`;
    const tb = $("tbl-users").querySelector("tbody");
    tb.innerHTML = shown.map((u) => {
      const pct = u.usage ? Math.min(u.usage.percent, 100) : 0;
      const ma = u.model_allowed;
      let permLabel = `<span class="badge yes">全部模型</span>`;
      if (Array.isArray(ma) && ma.length === 0) permLabel = `<span class="badge no">已暂停 AI</span>`;
      else if (Array.isArray(ma)) permLabel = `<span class="badge tier">限定 ${ma.length} 个</span>`;
      const suspended = Array.isArray(ma) && ma.length === 0;
      return `<tr>
        <td>${escapeHtml(u.email)}<div class="muted" style="font-size:11px">${escapeHtml(u.uid)}</div></td>
        <td class="muted">${fmtTime(u.created_at)}</td>
        <td class="muted">${fmtAgo(u.last_login)}</td>
        <td class="num">${u.conversation_count}</td>
        <td class="num">${fmtNum(u.tokens && u.tokens.total_tokens)}</td>
        <td style="min-width:150px">
          <div class="bar ${u.usage && u.usage.full ? "full" : ""}"><i style="width:${pct}%"></i></div>
          <div class="muted" style="font-size:11px;margin-top:3px">
            ${fmtSize(u.usage && u.usage.used)} / ${fmtSize(u.quota_bytes)}</div>
        </td>
        <td><span class="badge ${u.has_password ? "yes" : "no"}">${u.has_password ? "已设" : "未设"}</span></td>
        <td><span class="badge ${u.is_admin ? "admin" : "user"}">${u.is_admin ? "管理员" : "普通"}</span></td>
        <td style="white-space:nowrap">
          ${permLabel} <button class="btn ghost" data-act="ai">${suspended ? "恢复AI" : "暂停AI"}</button>
          <button class="btn ghost" data-act="models">配置</button>
        </td>
        <td style="white-space:nowrap">
          <button class="btn ghost" data-act="convs">对话</button>
          <button class="btn ghost" data-act="letter">✉ 发信</button>
          <button class="btn ghost" data-act="pwd">密码</button>
          <button class="btn ghost" data-act="quota">配额</button>
          <button class="btn ghost" data-act="role">${u.is_admin ? "取消管理员" : "设为管理员"}</button>
          <button class="btn danger" data-act="del">删除</button>
        </td>
      </tr>`;
    }).join("") || `<tr><td colspan="10" class="muted">${userFilter ? "没有匹配的用户" : "暂无用户"}</td></tr>`;

    tb.querySelectorAll("button[data-act]").forEach((btn) => {
      const tr = btn.closest("tr");
      const idx = Array.from(tb.children).indexOf(tr);
      const u = shown[idx];
      if (!u) return;
      const act = btn.dataset.act;
      if (act === "convs") btn.onclick = () => openUserConversations(u.uid, u.email);
      else if (act === "models") btn.onclick = () => openModelPermModal(u);
      else if (act === "ai") btn.onclick = async () => {
        const cur = Array.isArray(u.model_allowed) && u.model_allowed.length === 0;
        try {
          await api(`/api/admin/users/${u.uid}/models`, {
            method: "POST",
            body: JSON.stringify({ model_allowed: cur ? null : [] }),
          });
          toast(cur ? "已恢复该账号 AI 调用" : "已暂停该账号 AI 调用", "ok");
          await refresh();
        } catch (e) { toast(e.message, "err"); }
      };
      else if (act === "pwd") btn.onclick = () => openModal(
        "修改密码 · " + u.email, "设置后该用户可用邮箱+密码登录（至少 6 位）", "", "新密码",
        async (v) => {
          if (v.length < 6) throw new Error("密码至少 6 位");
          await api(`/api/admin/users/${u.uid}/password`,
            { method: "POST", body: JSON.stringify({ password: v }) });
          toast("密码已更新", "ok"); await refresh();
        });
      else if (act === "quota") btn.onclick = () => openModal(
        "限制云空间 · " + u.email,
        `当前配额 ${fmtSize(u.quota_bytes)}，已用 ${fmtSize(u.usage && u.usage.used)}。请输入新的配额（MB）`,
        String(Math.round((u.quota_bytes || 0) / 1048576)), "例如 50 / 500 / 2048",
        async (v) => {
          const mb = parseInt(v, 10);
          if (!isFinite(mb) || mb < 0) throw new Error("请输入合法的 MB 数值");
          await api(`/api/admin/users/${u.uid}/quota`,
            { method: "POST", body: JSON.stringify({ quota_bytes: mb * 1048576 }) });
          toast("配额已更新", "ok"); await refresh();
        });
      else if (act === "letter") btn.onclick = () => openLetterModal(u);
      else if (act === "role") btn.onclick = async () => {
        const grant = !u.is_admin;
        if (!confirm(grant ? `确定把 ${u.email} 设为管理员？对方将能打开管理后台。`
                          : `确定取消 ${u.email} 的管理员权限？`)) return;
        try {
          await api(`/api/admin/users/${u.uid}/admin`, {
            method: "POST", body: JSON.stringify({ admin: grant }),
          });
          toast(grant ? "已设为管理员" : "已取消管理员", "ok");
          await refresh();
        } catch (e) { toast(e.message, "err"); }
      };
      else if (act === "del") btn.onclick = async () => {
        if (!confirm(`确定删除用户 ${u.email}？其全部对话与文件将一并删除，不可恢复。`)) return;
        try {
          await api(`/api/admin/users/${u.uid}`, { method: "DELETE" });
          toast("用户已删除", "ok"); await refresh();
        } catch (e) { toast(e.message, "err"); }
      };
    });
  }

  /* per-user model-permission modal */
  function openModelPermModal(user) {
    api("/api/admin/overview").then((ov) => {
      const roster = ov.models || [];
      const currentAllowed = user.model_allowed;
      const isAll = currentAllowed === null;
      const isNone = Array.isArray(currentAllowed) && currentAllowed.length === 0;

      let html = `<div style="margin-bottom:10px;line-height:1.7">
        <label><input type="radio" name="mp" value="all" ${isAll ? "checked" : ""}> 允许使用全部已启用模型</label><br>
        <label><input type="radio" name="mp" value="none" ${isNone ? "checked" : ""}> 暂停 AI（禁止调用任何模型）</label><br>
        <label><input type="radio" name="mp" value="list" ${!isAll && !isNone ? "checked" : ""}> 仅允许勾选以下模型：</label>
      </div><div style="max-height:240px;overflow-y:auto;border:1px solid var(--line);border-radius:6px;padding:10px">`;
      roster.forEach((m) => {
        const checked = !isAll && !isNone
          ? currentAllowed.indexOf(m.name) >= 0
          : (isAll && m.enabled);
        html += `<label style="display:block;margin:2px 0">
          <input type="checkbox" data-m="${escapeHtml(m.name)}" ${checked ? "checked" : ""}>
          ${escapeHtml(m.display || m.name)}
          ${m.enabled ? `<span class="badge yes" style="margin-left:6px">启用</span>`
                      : `<span class="badge no" style="margin-left:6px">已暂停</span>`}
          ${m.is_builtin ? `` : `<span class="badge tier" style="margin-left:4px">API</span>`}
        </label>`;
      });
      html += `</div>
        <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px">
          <button class="btn ghost" id="mp-cancel">取消</button>
          <button class="btn" id="mp-save">保存</button>
        </div>`;

      let box = document.getElementById("mp-modal");
      if (!box) {
        box = document.createElement("div");
        box.id = "mp-modal";
        box.style.cssText = `position:fixed;inset:0;background:rgba(0,0,0,.5);
          display:flex;align-items:center;justify-content:center;z-index:9999`;
        document.body.appendChild(box);
      }
      box.innerHTML = `<div style="background:var(--panel);border-radius:10px;max-width:560px;width:92%;
          padding:22px;border:1px solid var(--line)">
        <h3 style="margin:0 0 14px">模型权限 · ${escapeHtml(user.email)}</h3>${html}</div>`;
      box.style.display = "flex";
      box.onclick = (e) => { if (e.target === box) box.style.display = "none"; };
      box.querySelector("#mp-cancel").onclick = () => box.style.display = "none";
      box.querySelector("#mp-save").onclick = async () => {
        const choice = box.querySelector(`input[name="mp"]:checked`).value;
        let payload;
        if (choice === "all") payload = { model_allowed: null };
        else if (choice === "none") payload = { model_allowed: [] };
        else {
          const checked = Array.from(box.querySelectorAll("input[data-m]:checked"))
            .map((el) => el.dataset.m);
          if (!checked.length) { toast("请至少勾选一个模型，或选『暂停 AI』", "err"); return; }
          payload = { model_allowed: checked };
        }
        try {
          await api(`/api/admin/users/${user.uid}/models`,
            { method: "POST", body: JSON.stringify(payload) });
          toast("模型权限已更新", "ok");
          box.style.display = "none";
          await refresh();
        } catch (e) { toast(e.message, "err"); }
      };
    }).catch((e) => toast("加载模型列表失败: " + e.message, "err"));
  }

  /* ---------------------------------------------------------------- loop */
  // Pause the 2s auto-refresh while a modal / drawer is open: rebuilding the
  // table under the cursor mid-click is what makes row buttons feel "dead".
  function anyOverlayOpen() {
    const ids = ["modal", "drawer", "mp-modal", "am-modal", "em-modal", "mcp-modal",
                 "letter-modal"];
    return ids.some((id) => {
      const el = document.getElementById(id);
      if (!el) return false;
      if (el.classList.contains("hidden")) return false;
      return el.style.display !== "none";
    });
  }

  async function refresh() {
    if (anyOverlayOpen()) return;
    try {
      const [ov, us] = await Promise.all([
        api("/api/admin/overview"),
        api("/api/admin/users"),
      ]);
      renderOverview(ov);
      renderModels(ov);
      renderLive(ov);
      renderRecent(ov);
      renderDays(ov);
      renderUsers(us.users);
      const c = $("conn");
      c.textContent = "已连接 · " + new Date().toLocaleTimeString();
      c.className = "pill ok";
    } catch (e) {
      if (e.status === 401) {           // admin password token expired/invalid
        ADMIN_TOKEN = "";
        sessionStorage.removeItem("yjs_admin_token");
        showLock();
        $("lock-msg").textContent = "会话已过期，请重新输入管理密码";
        return;
      }
      const c = $("conn");
      c.textContent = "连接失败";
      c.className = "pill err";
    }
  }

  $("btn-logout").onclick = () => {
    localStorage.removeItem("yjs_token");
    sessionStorage.removeItem("yjs_admin_token");
    location.href = APP_ROOT;
  };

  on("btn-add-model", "click", () => openAddApiModelModal());
  function openAddApiModelModal() {
    let box = document.getElementById("am-modal");
    if (!box) {
      box = document.createElement("div");
      box.id = "am-modal";
      box.style.cssText = `position:fixed;inset:0;background:rgba(0,0,0,.5);
        display:flex;align-items:center;justify-content:center;z-index:9999`;
      document.body.appendChild(box);
    }
    box.innerHTML = `
      <div style="background:var(--panel);border-radius:10px;max-width:520px;width:92%;
          padding:22px;border:1px solid var(--line)">
        <h3 style="margin:0 0 4px">新增云端 API 模型</h3>
        <div style="font-size:12px;color:var(--muted);margin-bottom:12px">
          填写开放平台的 OpenAI 兼容参数，保存后即可在线调用（如 DeepSeek / OpenAI / OpenRouter / 硅基流动）</div>
        <div style="display:grid;gap:10px">
          <div><label style="font-size:12px;color:var(--muted)">模型名（平台要求的模型 ID，将原样发送）</label>
            <input id="am-name" style="width:100%;padding:7px 10px;background:var(--bg);border:1px solid var(--line);
              border-radius:6px;color:var(--text)" placeholder="deepseek-chat"></div>
          <div><label style="font-size:12px;color:var(--muted)">显示名</label>
            <input id="am-display" style="width:100%;padding:7px 10px;background:var(--bg);border:1px solid var(--line);
              border-radius:6px;color:var(--text)" placeholder="GPT-4o Mini via OpenRouter"></div>
          <div><label style="font-size:12px;color:var(--muted)">Base URL</label>
            <input id="am-base" style="width:100%;padding:7px 10px;background:var(--bg);border:1px solid var(--line);
              border-radius:6px;color:var(--text)" placeholder="https://openrouter.ai/api/v1"></div>
          <div><label style="font-size:12px;color:var(--muted)">API Key (存入 config.local.json)</label>
            <input id="am-key" type="password" style="width:100%;padding:7px 10px;background:var(--bg);border:1px solid var(--line);
              border-radius:6px;color:var(--text)" placeholder="sk-..."></div>
          <div style="display:flex;gap:12px">
            <div style="flex:1"><label style="font-size:12px;color:var(--muted)">上下文长度</label>
              <input id="am-ctx" type="number" value="8192" style="width:100%;padding:7px 10px;background:var(--bg);
                border:1px solid var(--line);border-radius:6px;color:var(--text)"></div>
            <div style="flex:1"><label style="font-size:12px;color:var(--muted)">档位</label>
              <input id="am-tier" value="云端API" style="width:100%;padding:7px 10px;background:var(--bg);
                border:1px solid var(--line);border-radius:6px;color:var(--text)"></div>
          </div>
          <div><label style="font-size:12px;color:var(--muted)">备注</label>
            <input id="am-desc" style="width:100%;padding:7px 10px;background:var(--bg);border:1px solid var(--line);
              border-radius:6px;color:var(--text)" placeholder="可选"></div>
        </div>
        <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px">
          <button class="btn ghost" id="am-test">测试连通</button>
          <button class="btn ghost" id="am-cancel">取消</button>
          <button class="btn" id="am-save">添加</button>
        </div>
        <div id="am-test-msg" class="muted" style="font-size:12px;text-align:right;margin-top:8px;word-break:break-all"></div>
      </div>`;
    box.style.display = "flex";
    box.onclick = (e) => { if (e.target === box) box.style.display = "none"; };
    box.querySelector("#am-cancel").onclick = () => box.style.display = "none";
    box.querySelector("#am-test").onclick = async () => {
      const msg = box.querySelector("#am-test-msg");
      const payload = {
        name: box.querySelector("#am-name").value.trim(),
        base_url: box.querySelector("#am-base").value.trim(),
        api_key: box.querySelector("#am-key").value.trim(),
      };
      if (!payload.name || !payload.base_url || !payload.api_key) {
        msg.textContent = "请先填写 模型名 / Base URL / API Key";
        return;
      }
      msg.textContent = "测试中…";
      const btn = box.querySelector("#am-test"); btn.disabled = true;
      try {
        const d = await api("/api/admin/models/test", { method: "POST", body: JSON.stringify(payload) });
        msg.textContent = "✓ 连接成功，平台返回：" + (d.reply || "OK");
      } catch (e) { msg.textContent = "✗ " + e.message; }
      finally { btn.disabled = false; }
    };
    box.querySelector("#am-save").onclick = async () => {
      const body = {
        name: box.querySelector("#am-name").value.trim(),
        display: box.querySelector("#am-display").value.trim(),
        provider: "openai",
        base_url: box.querySelector("#am-base").value.trim(),
        api_key: box.querySelector("#am-key").value.trim(),
        context_len: parseInt(box.querySelector("#am-ctx").value, 10) || 8192,
        tier: box.querySelector("#am-tier").value.trim() || "云端API",
        desc: box.querySelector("#am-desc").value.trim(),
        size_mb: 0,
      };
      if (!body.name || !body.base_url || !body.api_key) {
        toast("模型名 / Base URL / API Key 必填", "err"); return;
      }
      try {
        await api("/api/admin/models", { method: "POST", body: JSON.stringify(body) });
        toast("API 模型已添加", "ok");
        box.style.display = "none";
        await refresh();
      } catch (e) { toast(e.message, "err"); }
    };
  }

  /* model edit modal (built-in or API) */
  function openEditModelModal(m) {
    if (!m || !m.name) return;
    let box = document.getElementById("em-modal");
    if (!box) {
      box = document.createElement("div");
      box.id = "em-modal";
      box.style.cssText = `position:fixed;inset:0;background:rgba(0,0,0,.5);
        display:flex;align-items:center;justify-content:center;z-index:9999`;
      document.body.appendChild(box);
    }
    const builtin = !!m.is_builtin;
    box.innerHTML = `
      <div class="mcard">
        <h3 style="margin:0 0 4px">编辑模型</h3>
        <div class="muted" style="font-size:12px;margin-bottom:12px">${escapeHtml(m.name)}
          ${builtin ? "（内置模型：可改显示/档位/上下文，不可删除）" : "（API 模型）"}</div>
        <div style="display:grid;gap:10px">
          <div><label class="mlabel">显示名</label>
            <input id="em-display" class="minp" value="${escapeHtml(m.display || m.name)}"></div>
          <div><label class="mlabel">档位</label>
            <input id="em-tier" class="minp" value="${escapeHtml(m.tier || "")}"></div>
          ${builtin ? "" : `
          <div><label class="mlabel">Base URL</label>
            <input id="em-base" class="minp" value="${escapeHtml(m.base_url || "")}"></div>
          <div><label class="mlabel">API Key（留空保持不变${m.has_key ? "，当前已配置" : ""}）</label>
            <input id="em-key" class="minp" type="password" placeholder="留空则不修改"></div>`}
          <div style="display:flex;gap:12px">
            <div style="flex:1"><label class="mlabel">上下文长度</label>
              <input id="em-ctx" class="minp" type="number" value="${Number(m.context_len) || 8192}"></div>
            <div style="flex:1"><label class="mlabel">状态</label>
              <select id="em-enabled" class="minp">
                <option value="1" ${m.enabled ? "selected" : ""}>启用</option>
                <option value="0" ${m.enabled ? "" : "selected"}>暂停</option>
              </select></div>
          </div>
          <div><label class="mlabel">备注</label>
            <input id="em-desc" class="minp" value="${escapeHtml(m.desc || "")}"></div>
        </div>
        <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px">
          ${builtin ? "" : `<button class="btn ghost" id="em-test">测试连通</button>`}
          <button class="btn ghost" id="em-cancel">取消</button>
          <button class="btn" id="em-save">保存</button>
        </div>
        <div id="em-test-msg" class="muted" style="font-size:12px;text-align:right;margin-top:8px;word-break:break-all"></div>
      </div>`;
    box.style.display = "flex";
    box.onclick = (e) => { if (e.target === box) box.style.display = "none"; };
    box.querySelector("#em-cancel").onclick = () => box.style.display = "none";
    const emTest = box.querySelector("#em-test");
    if (emTest) emTest.onclick = async () => {
      const msg = box.querySelector("#em-test-msg");
      const payload = {
        name: m.name, model_ref: m.name,
        base_url: box.querySelector("#em-base").value.trim(),
        api_key: box.querySelector("#em-key").value.trim(),
      };
      msg.textContent = "测试中…";
      emTest.disabled = true;
      try {
        const d = await api("/api/admin/models/test", { method: "POST", body: JSON.stringify(payload) });
        msg.textContent = "✓ 连接成功，平台返回：" + (d.reply || "OK");
      } catch (e) { msg.textContent = "✗ " + e.message; }
      finally { emTest.disabled = false; }
    };
    box.querySelector("#em-save").onclick = async () => {
      const body = {
        name: m.name,
        display: box.querySelector("#em-display").value.trim(),
        tier: box.querySelector("#em-tier").value.trim(),
        context_len: parseInt(box.querySelector("#em-ctx").value, 10) || 8192,
        enabled: box.querySelector("#em-enabled").value === "1",
        desc: box.querySelector("#em-desc").value.trim(),
      };
      if (!builtin) {
        body.base_url = box.querySelector("#em-base").value.trim();
        const k = box.querySelector("#em-key").value.trim();
        if (k) body.api_key = k;
      }
      try {
        await api("/api/admin/models/edit", { method: "POST", body: JSON.stringify(body) });
        toast("模型已更新", "ok");
        box.style.display = "none";
        await refresh();
      } catch (e) { toast(e.message, "err"); }
    };
  }

  /* system permission settings */
  async function loadSettings() {
    try {
      const st = await api("/api/admin/settings");
      $("set-ai").checked = !!st.ai_enabled;
      $("set-register").checked = !!st.allow_register;
      $("set-addmodel").checked = !!st.allow_model_add;
      $("set-toolcalls").value = st.max_tool_calls_per_step || 8;
      $("set-default").innerHTML = (st.models || []).map((m) =>
        `<option value="${escapeHtml(m.name)}" ${m.name === st.default_model ? "selected" : ""}>
           ${escapeHtml(m.display || m.name)}${m.enabled ? "" : "（已暂停）"}</option>`).join("");
    } catch (_) { /* 401 handled by refresh() */ }
  }
  on("btn-save-settings", "click", async () => {
    try {
      await api("/api/admin/settings", {
        method: "POST",
        body: JSON.stringify({
          ai_enabled: $("set-ai").checked,
          allow_register: $("set-register").checked,
          allow_model_add: $("set-addmodel").checked,
          default_model: $("set-default").value || "",
          max_tool_calls_per_step: parseInt($("set-toolcalls").value, 10) || 8,
        }),
      });
      toast("系统设置已保存", "ok");
    } catch (e) { toast(e.message, "err"); }
  });

  /* ---------------------------------------------------------------- MCP */
  async function loadMcp() {
    try {
      const d = await api("/api/admin/mcp");
      renderMcp(d.servers || []);
    } catch (_) { /* 401 handled by refresh() */ }
  }

  function renderMcp(servers) {
    const tb = $("tbl-mcp").querySelector("tbody");
    tb.innerHTML = servers.map((s) => `<tr data-name="${escapeHtml(s.name)}">
        <td><b>${escapeHtml(s.name)}</b></td>
        <td class="mono" style="font-size:12px;word-break:break-all">${escapeHtml(s.command_str || "")}</td>
        <td class="muted">${s.env && Object.keys(s.env).length ? escapeHtml(Object.keys(s.env).join(", ")) : "—"}</td>
        <td class="muted" data-tools>未检测</td>
        <td style="white-space:nowrap">
          <button class="btn ghost" data-act="test">测试</button>
          <button class="btn danger" data-act="del">删除</button>
        </td>
      </tr>`).join("") || `<tr><td colspan="5" class="muted">尚未配置 MCP 服务器</td></tr>`;

    tb.querySelectorAll("button[data-act]").forEach((btn) => {
      const tr = btn.closest("tr");
      const name = tr.dataset.name;
      const act = btn.dataset.act;
      const cell = tr.querySelector("[data-tools]");
      if (act === "test") btn.onclick = async () => {
        btn.disabled = true; cell.textContent = "检测中…";
        try {
          const d = await api("/api/admin/mcp/test?name=" + encodeURIComponent(name),
                              { method: "POST" });
          const n = (d.tools || []).length;
          cell.innerHTML = `<span class="badge yes">可用</span> ${n} 个工具`;
          toast(`MCP「${name}」可用，共 ${n} 个工具`, "ok");
        } catch (e) {
          cell.innerHTML = `<span class="badge no">失败</span>`;
          toast("连接失败：" + e.message, "err");
        } finally { btn.disabled = false; }
      };
      else if (act === "del") btn.onclick = async () => {
        if (!confirm(`确定删除 MCP 服务器「${name}」？`)) return;
        try {
          await api("/api/admin/mcp?name=" + encodeURIComponent(name), { method: "DELETE" });
          toast("已删除", "ok"); await loadMcp();
        } catch (e) { toast(e.message, "err"); }
      };
    });
  }

  on("btn-add-mcp", "click", () => openAddMcpModal());
  function openAddMcpModal() {
    let box = document.getElementById("mcp-modal");
    if (!box) {
      box = document.createElement("div");
      box.id = "mcp-modal";
      box.style.cssText = `position:fixed;inset:0;background:rgba(0,0,0,.5);
        display:flex;align-items:center;justify-content:center;z-index:9999`;
      document.body.appendChild(box);
    }
    box.innerHTML = `
      <div class="mcard">
        <h3 style="margin:0 0 4px">添加 / 更新 MCP 服务器</h3>
        <div class="muted" style="font-size:12px;margin-bottom:12px">
          填写 stdio 启动命令，保存后点「测试」验证，Agent 即可调用其工具</div>
        <div style="display:grid;gap:10px">
          <div><label class="mlabel">名称（唯一标识）</label>
            <input id="mcp-name" class="minp" placeholder="filesystem"></div>
          <div><label class="mlabel">启动命令（空格分隔；也可填 JSON 数组）</label>
            <input id="mcp-cmd" class="minp" placeholder="npx -y @modelcontextprotocol/server-filesystem D:/yjs"></div>
          <div><label class="mlabel">环境变量（可选，每行 KEY=VALUE）</label>
            <textarea id="mcp-env" class="minp" rows="3" style="resize:vertical" placeholder="FOO=bar"></textarea></div>
        </div>
        <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px">
          <button class="btn ghost" id="mcp-cancel">取消</button>
          <button class="btn" id="mcp-save">保存</button>
        </div>
        <div id="mcp-msg" class="muted" style="font-size:12px;text-align:right;margin-top:8px;word-break:break-all"></div>
      </div>`;
    box.style.display = "flex";
    box.onclick = (e) => { if (e.target === box) box.style.display = "none"; };
    box.querySelector("#mcp-cancel").onclick = () => box.style.display = "none";
    box.querySelector("#mcp-save").onclick = async () => {
      const name = box.querySelector("#mcp-name").value.trim();
      const command = box.querySelector("#mcp-cmd").value.trim();
      const msg = box.querySelector("#mcp-msg");
      if (!name || !command) { msg.textContent = "名称与启动命令必填"; return; }
      const env = {};
      box.querySelector("#mcp-env").value.split("\n").forEach((line) => {
        const i = line.indexOf("=");
        if (i > 0) env[line.slice(0, i).trim()] = line.slice(i + 1).trim();
      });
      msg.textContent = "保存中…";
      try {
        await api("/api/admin/mcp", { method: "POST", body: JSON.stringify({ name, command, env }) });
        toast("MCP 服务器已保存", "ok");
        box.style.display = "none";
        await loadMcp();
      } catch (e) { msg.textContent = "✗ " + e.message; }
    };
  }

  /* ---------------------------------------- mail (SMTP) */
  async function loadMail() {
    try {
      const d = await api("/api/admin/email");
      $("mail-host").value = d.host || "";
      $("mail-port").value = d.port || 465;
      $("mail-protocol").value = d.protocol || "ssl";
      $("mail-user").value = d.user || "";
      $("mail-fromname").value = d.from_name || "";
      $("mail-code").placeholder = d.has_auth_code ? "已配置，留空则不修改" : "请输入 SMTP 授权码";
      const st = $("mail-status");
      if (st) {
        const badge = (ok) => ok
          ? `<span class="badge yes">已保存</span>`
          : `<span class="badge no">未配置</span>`;
        st.innerHTML = d.user
          ? `发件邮箱：${escapeHtml(d.user)} · 授权码：${badge(d.has_auth_code)}` +
            ` · ${escapeHtml(d.host || "")}:${d.port || 465}（${escapeHtml(d.protocol || "ssl")}）`
          : "尚未配置发件邮箱";
      }
    } catch (_) { /* 401 handled by refresh() */ }
  }

  on("btn-save-mail", "click", async () => {
    const msg = $("mail-msg");
    const typed = $("mail-code").value.trim();
    msg.textContent = "保存中…";
    try {
      const d = await api("/api/admin/email", {
        method: "POST",
        body: JSON.stringify({
          host: $("mail-host").value.trim(),
          port: parseInt($("mail-port").value, 10) || 465,
          protocol: $("mail-protocol").value,
          user: $("mail-user").value.trim(),
          auth_code: typed,
          from_name: $("mail-fromname").value.trim(),
        }),
      });
      // Only wipe the secret field AFTER the server confirmed the save.
      $("mail-code").value = "";
      await loadMail();
      const okCode = (d && d.has_auth_code) || typed !== "";
      msg.textContent = okCode ? "✓ 已保存（授权码已加密存入本机配置）" : "✓ 已保存";
      toast("发件邮箱设置已保存", "ok");
    } catch (e) {
      if (e.status === 401) { showLock(); return; }
      msg.textContent = "✗ 保存失败：" + e.message;
      toast("保存失败：" + e.message, "err");
    }
  });

  on("btn-test-mail", "click", async (e) => {
    const btn = e.target;
    btn.disabled = true;
    const msg = $("mail-msg");
    msg.textContent = "正在发送测试邮件…";
    try {
      const d = await api("/api/admin/email/test",
        { method: "POST", body: JSON.stringify({ to: "" }) });
      msg.textContent = "✓ 已发送到 " + d.to;
      toast("测试邮件已发送", "ok");
    } catch (err) { msg.textContent = "✗ " + err.message; }
    finally { btn.disabled = false; }
  });

  async function sendBroadcast(onlyMe) {
    const msg = $("bc-msg");
    const subject = $("bc-subject").value.trim();
    const body = $("bc-body").value.trim();
    if (!subject || !body) { msg.textContent = "请先填写邮件主题与正文"; return; }
    if (!onlyMe && !confirm("确定向【全体已注册用户】发送这封邮件？")) return;
    const btns = [$("btn-broadcast"), $("btn-broadcast-me")];
    btns.forEach((b) => { b.disabled = true; });
    msg.textContent = onlyMe ? "发送中…" : "群发中，请稍候（用户较多时较慢）…";
    try {
      const d = await api("/api/admin/email/broadcast", {
        method: "POST",
        body: JSON.stringify({ subject, body, only_me: !!onlyMe }),
      });
      const fail = (d.failed || []).length;
      msg.textContent = `✓ 发送成功 ${d.sent}/${d.total}` + (fail ? `，失败 ${fail}` : "");
      toast(`邮件已发送：成功 ${d.sent}/${d.total}`, fail ? "err" : "ok");
    } catch (e) { msg.textContent = "✗ " + e.message; }
    finally { btns.forEach((b) => { b.disabled = false; }); }
  }
  on("btn-broadcast", "click", () => sendBroadcast(false));
  on("btn-broadcast-me", "click", () => sendBroadcast(true));

  /* ---------------------------------------------------------------- feedback */
  let replyTemplates = [];
  let replyFid = null;

  async function loadFeedback() {
    try {
      const d = await api("/api/admin/feedback");
      replyTemplates = d.templates || [];
      renderFeedback(d.items || []);
      renderTemplateOptions();
    } catch (_) { /* 401 handled by refresh() */ }
  }

  function renderTemplateOptions() {
    const sel = $("reply-tpl-select");
    if (!sel) return;
    sel.innerHTML = `<option value="">— 选择回信模板 —</option>` +
      replyTemplates.map((t) =>
        `<option value="${escapeHtml(t.id)}">${escapeHtml(t.title)}</option>`).join("");
  }

  function renderFeedback(items) {
    const box = $("fb-list");
    if (!items.length) { box.innerHTML = `<div class="muted">暂无后台反馈（发往邮箱的反馈不在这里显示）</div>`; return; }
    const statusText = { new: "未读", read: "已读", done: "已回复/处理" };
    box.innerHTML = items.map((f) => {
      const replies = (f.replies || []).map((r) => {
        const ways = [r.via_email ? "📮邮箱" : "", r.via_notice ? "🔔站内通知" : ""]
          .filter(Boolean).join(" ");
        return `<div class="fb-reply-log"><b>回复（${escapeHtml(ways)} · ${fmtTime(r.created_at)}）：</b>${escapeHtml(r.content)}</div>`;
      }).join("");
      return `
      <div class="fb-item ${f.status === "new" ? "new" : ""}" data-id="${escapeHtml(f.id)}">
        <div class="fb-head">
          <span class="fb-who">${escapeHtml(f.name || f.email)}</span>
          <span class="muted">${escapeHtml(f.email)}</span>
          <span class="badge tier">${escapeHtml(f.category || "其他")}</span>
          <span class="muted">${fmtTime(f.created_at)}</span>
          <span class="badge ${f.status === "new" ? "yes" : "user"}">${statusText[f.status] || "已读"}</span>
        </div>
        <div class="fb-body">${escapeHtml(f.content)}</div>
        ${replies}
        <div class="fb-acts">
          <button class="btn" data-act="reply">✏ 快速回信</button>
          <button class="btn ghost" data-act="read">标记已读</button>
          <button class="btn ghost" data-act="done">标记已处理</button>
          <button class="btn danger" data-act="del">删除</button>
        </div>
      </div>`;
    }).join("");
    box.querySelectorAll(".fb-item").forEach((el) => {
      const id = el.dataset.id;
      el.querySelectorAll("button[data-act]").forEach((btn) => {
        btn.onclick = async () => {
          const act = btn.dataset.act;
          if (act === "reply") { openReply(id, items.find((x) => x.id === id)); return; }
          try {
            if (act === "del") {
              if (!confirm("删除这条用户反馈？")) return;
              await api("/api/admin/feedback/" + encodeURIComponent(id), { method: "DELETE" });
            } else {
              await api(`/api/admin/feedback/${encodeURIComponent(id)}/status`, {
                method: "POST",
                body: JSON.stringify({ status: act === "done" ? "done" : "read" }),
              });
            }
            toast("已更新", "ok");
            await loadFeedback();
          } catch (e) { toast(e.message, "err"); }
        };
      });
    });
  }

  function openReply(fid, f) {
    replyFid = fid;
    $("reply-to").textContent = `回复给：${f ? escapeHtml(f.name || f.email || "") + " <" + escapeHtml(f.email || "") + ">" : ""}`;
    $("reply-body").value = "";
    $("reply-via-email").checked = true;
    $("reply-via-notice").checked = false;
    $("reply-msg").textContent = "";
    renderTemplateOptions();
    $("reply-modal").classList.remove("hidden");
  }
  function closeReply() { $("reply-modal").classList.add("hidden"); replyFid = null; }
  on("reply-cancel", "click", closeReply);
  on("reply-modal", "click", (e) => { if (e.target === $("reply-modal")) closeReply(); });
  on("reply-tpl-select", "change", () => {
    const t = replyTemplates.find((x) => x.id === $("reply-tpl-select").value);
    const ta = $("reply-body");
    if (!t) return;
    ta.value = t.body || "";
    ta.focus();
    $("reply-msg").textContent = t.body
      ? "已载入模板，可修改后直接发送"
      : "该模板正文为空，请先填写回信内容";
  });
  on("btn-reply-tpl-save", "click", async () => {
    const body = $("reply-body").value.trim();
    if (!body) return toast("请先在回信内容中填写要存为模板的正文", "err");
    const title = prompt("模板名称：", body.slice(0, 20));
    if (!title) return;
    try {
      const d = await api("/api/admin/reply-templates", {
        method: "POST", body: JSON.stringify({ title, body }),
      });
      replyTemplates.push(d.template);
      renderTemplateOptions();
      $("reply-tpl-select").value = d.template.id;
      toast("模板已保存", "ok");
    } catch (e) { toast(e.message, "err"); }
  });
  on("btn-reply-tpl-del", "click", async () => {
    const id = $("reply-tpl-select").value;
    if (!id) return toast("请先选择要删除的模板", "err");
    if (!confirm("删除该回信模板？")) return;
    try {
      await api("/api/admin/reply-templates/" + encodeURIComponent(id), { method: "DELETE" });
      replyTemplates = replyTemplates.filter((t) => t.id !== id);
      renderTemplateOptions();
      toast("模板已删除", "ok");
    } catch (e) { toast(e.message, "err"); }
  });
  on("reply-ok", "click", async () => {
    if (!replyFid) return;
    const content = $("reply-body").value.trim();
    const viaEmail = $("reply-via-email").checked;
    const viaNotice = $("reply-via-notice").checked;
    if (!content) return $("reply-msg").textContent = "请填写回信内容";
    if (!viaEmail && !viaNotice) return $("reply-msg").textContent = "请至少选择一种回信方式";
    const btn = $("reply-ok"); btn.disabled = true;
    $("reply-msg").textContent = "发送中…";
    try {
      const d = await api(`/api/admin/feedback/${encodeURIComponent(replyFid)}/reply`, {
        method: "POST",
        body: JSON.stringify({ content, via_email: viaEmail, via_notice: viaNotice }),
      });
      toast("回信已发送" + (d.mail_error ? "（邮件失败：" + d.mail_error + "）" : ""),
        d.mail_error ? "err" : "ok");
      closeReply();
      await loadFeedback();
    } catch (e) { $("reply-msg").textContent = "✗ " + e.message; }
    finally { btn.disabled = false; }
  });

  /* ----------------------------------------------------- unfreeze review -- */
  async function loadUnfreeze() {
    try {
      const d = await api("/api/admin/unfreeze");
      renderUnfreeze(d.items || []);
      const badge = $("uf-unread");
      badge.style.display = d.pending ? "inline-block" : "none";
      badge.textContent = d.pending + " 条待处理";
    } catch (_) {}
  }
  function renderUnfreeze(items) {
    const box = $("uf-list");
    if (!items.length) { box.innerHTML = `<div class="muted">暂无解冻申请</div>`; return; }
    const stMap = { open: ["待处理", "tier"], approved: ["已批准解冻", "yes"],
      denied: ["已取消/拒绝", "no"], pin_unlocked: ["PIN 验证解冻", "yes"],
      superseded: ["已被新申请替代", "user"] };
    box.innerHTML = items.map((u) => {
      const [stText, stCls] = stMap[u.status] || [u.status, "user"];
      const passed = (u.score || 0) >= 50;
      const answers = Object.entries(u.answers || {}).map(([k, v]) =>
        `<tr><td class="muted">${escapeHtml(k)}</td><td>${escapeHtml(v)}</td></tr>`).join("");
      const matched = (u.matched || []).map((x) => `<li>✅ ${escapeHtml(x)}</li>`).join("");
      const missed = (u.missed || []).map((x) => `<li>❌ ${escapeHtml(x)}</li>`).join("");
      return `<div class="uf-item ${u.status}" data-id="${escapeHtml(u.id)}">
        <div class="fb-head">
          <span class="fb-who">${escapeHtml(u.email)}</span>
          <span class="badge ${stCls}">${stText}</span>
          <span class="badge ${passed ? "yes" : "no"}">系统评分 ${u.score} 分${passed ? "（达标）" : "（否决）"}</span>
          <span class="muted">${fmtTime(u.created_at)}</span>
        </div>
        <div class="uf-reason"><b>解冻原因：</b>${escapeHtml(u.reason || "")}</div>
        <details class="uf-detail">
          <summary>查看使用痕迹问卷与评分明细</summary>
          <table class="tbl uf-tbl"><tbody>${answers}</tbody></table>
          <ul class="uf-score">${matched}${missed}</ul>
        </details>
        ${u.decided_at ? `<div class="muted" style="margin-top:6px">处理时间：${fmtTime(u.decided_at)} · 处理人：${escapeHtml(u.decided_by || "")}</div>` : ""}
        ${u.status === "open" ? `<div class="qreq-acts">
          ${passed ? `
            <button class="btn" data-act="approve">✓ 评分达标，同意解冻</button>
            <button class="btn danger" data-act="deny">取消申请</button>` : `
            <button class="btn" data-act="pin">📧 发送高级解冻 PIN 邮件</button>
            <button class="btn ghost" data-act="verify">输入 PIN 验证解冻</button>
            <span class="muted">评分不足 50，系统已否决，管理员无法直接解冻</span>`}
        </div>` : ""}
      </div>`;
    }).join("");
    box.querySelectorAll(".uf-item").forEach((el) => {
      const id = el.dataset.id;
      el.querySelectorAll("button[data-act]").forEach((btn) => {
        btn.onclick = async () => actUnfreeze(id, btn.dataset.act);
      });
    });
  }
  async function actUnfreeze(id, act) {
    try {
      if (act === "approve" || act === "deny") {
        if (act === "deny" && !confirm("确定拒绝该解冻申请？账号将保持冻结。")) return;
        await api(`/api/admin/unfreeze/${encodeURIComponent(id)}/decide`, {
          method: "POST", body: JSON.stringify({ approve: act === "approve" }),
        });
        toast(act === "approve" ? "已解冻账号" : "已拒绝申请", "ok");
      } else if (act === "pin") {
        if (!confirm("向该账号邮箱发送 6 位高级解冻 PIN？")) return;
        await api(`/api/admin/unfreeze/${encodeURIComponent(id)}/send-pin`, { method: "POST" });
        toast("PIN 邮件已发送，请等待用户提供 PIN", "ok");
      } else if (act === "verify") {
        const pin = prompt("请输入用户从邮箱中获取的 6 位 PIN：");
        if (!pin) return;
        await api(`/api/admin/unfreeze/${encodeURIComponent(id)}/verify-pin`, {
          method: "POST", body: JSON.stringify({ pin: pin.trim() }),
        });
        toast("PIN 验证通过，账号已解冻", "ok");
      }
      await loadUnfreeze();
    } catch (e) { toast(e.message, "err"); }
  }

  /* ---------------------------------------------------------------- notice */
  let editingNoticeId = null;

  function fmtNtTime(ts) {
    if (!ts) return "";
    const d = new Date(ts * 1000);
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  function resetNoticeEditor() {
    editingNoticeId = null;
    $("nt-title").value = ""; $("nt-body").value = "";
    $("nt-editor-title").textContent = "发布新通知";
    $("btn-nt-publish").textContent = "发布并同步到 GitHub";
    $("btn-nt-cancel-edit").style.display = "none";
  }

  async function loadNotice() {
    try {
      const d = await api("/api/admin/notifications");
      const items = d.notifications || [];
      const st = $("nt-status");
      const repo = d.repo ? `${escapeHtml(d.repo)} · ${escapeHtml(d.repo_file)}` : "未配置仓库";
      const lock = d.unlocked ? "已解锁可发布" : "未解锁（仅能保存到本机）";
      st.innerHTML = `共 ${items.length} 条历史通知 · 同步目标：${repo} · ${lock}`;
      $("nt-count").textContent = String(items.length);
      const box = $("nt-history");
      if (!items.length) {
        box.innerHTML = `<div class="muted">暂无历史通知</div>`;
      } else {
        box.innerHTML = items.map((n) => `
          <div class="nt-hist-item" data-id="${escapeHtml(n.id)}">
            <div class="nt-hist-head" title="点击展开 / 收起">
              <b><i class="collapse-mark">▾</i>${escapeHtml(n.title || "（无标题）")}</b>
              <span class="muted">${fmtNtTime(n.updated_at || n.created_at)}</span>
            </div>
            <div class="muted nt-hist-meta">发布者：${escapeHtml(n.author || "管理员")}
              ${n.updated_at && n.created_at && Math.abs(n.updated_at - n.created_at) > 60 ? "· 已编辑" : ""}
            </div>
            <div class="nt-hist-body">${escapeHtml(n.body || "")}</div>
            <div class="nt-hist-acts">
              <button class="btn ghost" data-act="edit">编辑</button>
              <button class="btn danger" data-act="del">删除</button>
            </div>
          </div>`).join("");
        box.querySelectorAll(".nt-hist-item").forEach((el) => {
          const id = el.dataset.id;
          el.querySelector(".nt-hist-head").addEventListener("click", () => {
            el.classList.toggle("open");
          });
          el.querySelector('[data-act="edit"]').onclick = () => {
            const n = items.find((x) => x.id === id);
            if (!n) return;
            editingNoticeId = id;
            $("nt-title").value = n.title || "";
            $("nt-body").value = n.body || "";
            $("nt-editor-title").textContent = "编辑通知（历史保留，同步更新）";
            $("btn-nt-publish").textContent = "保存并同步到 GitHub";
            $("btn-nt-cancel-edit").style.display = "";
            $("nt-title").scrollIntoView({ behavior: "smooth", block: "center" });
          };
          el.querySelector('[data-act="del"]').onclick = async () => {
            if (!confirm("确定删除这条通知？用户端也将无法再看到它。")) return;
            try {
              const d2 = await api(`/api/admin/notifications/${encodeURIComponent(id)}?publish=true`,
                { method: "DELETE" });
              toast(d2.pushed ? "已删除并同步 GitHub" : "已删除（GitHub 未同步）", "ok");
              await loadNotice();
              if (editingNoticeId === id) resetNoticeEditor();
            } catch (e) { toast(e.message, "err"); }
          };
        });
      }
    } catch (_) { /* 401 handled by refresh() */ }
  }

  async function saveNotice(publish) {
    const msg = $("nt-msg");
    const title = $("nt-title").value.trim();
    const body = $("nt-body").value.trim();
    if (!title && !body) { msg.textContent = "请先填写通知标题或内容"; return; }
    msg.textContent = publish ? "正在同步到 GitHub（推送完整历史）…" : "保存中…";
    try {
      const url = editingNoticeId
        ? `/api/admin/notifications/${encodeURIComponent(editingNoticeId)}`
        : "/api/admin/notifications";
      const d = await api(url, {
        method: "POST",
        body: JSON.stringify({ title, body, publish: !!publish }),
      });
      if (publish && d.pushed) {
        msg.textContent = "✓ 已同步到 GitHub 仓库（历史完整保留）";
        toast("通知已同步到 GitHub", "ok");
      } else if (publish) {
        msg.textContent = "✓ 已保存到本机，但未推送 GitHub：" + (d.error || "未知原因");
      } else {
        msg.textContent = "✓ 已保存到本机（未推送 GitHub）";
      }
      resetNoticeEditor();
      await loadNotice();
    } catch (e) { msg.textContent = "✗ " + e.message; }
  }
  on("btn-nt-save", "click", () => saveNotice(false));
  on("btn-nt-publish", "click", () => saveNotice(true));
  on("btn-nt-cancel-edit", "click", () => { resetNoticeEditor(); $("nt-msg").textContent = ""; });
  on("btn-nt-republish", "click", async () => {
    try {
      await api("/api/admin/notifications-republish", { method: "POST" });
      toast("已将完整历史重新推送到 GitHub", "ok");
      await loadNotice();
    } catch (e) { toast(e.message, "err"); }
  });

  /* ---------------------------------------------------------------- github */
  async function loadGithub() {
    try {
      const gh = await api("/api/admin/github");
      $("gh-repo").value = gh.repo || "";
      $("gh-branch").value = gh.branch || "main";
      $("gh-prefix").value = gh.path_prefix || "";
      const enc = gh.encrypted
        ? (gh.mode === "repo" ? "已用仓库密码加密" : "已加密（会话密钥）")
        : "未加密（明文回退）";
      const tok = gh.has_token
        ? `<span class="badge yes">token 可用</span>`
        : `<span class="badge no">无 token</span>`;
      const lock = gh.unlocked
        ? `<span class="badge yes">已解锁</span>`
        : `<span class="badge no">未解锁</span>`;
      $("gh-status").innerHTML =
        `存储：${escapeHtml(enc)} · ${gh.has_password ? "已设仓库密码" : "未设仓库密码"} · ${tok} · ${lock}<br>` +
        `未解锁时「发布 / 改仓库信息」不可用；设置仓库密码后 token 将以密文保存，重启后需再次解锁。`;
    } catch (_) { /* 401 handled by refresh() */ }
  }

  on("btn-gh-unlock", "click", async () => {
    const msg = $("gh-msg");
    const pw = $("gh-pw").value;
    if (!pw) { msg.textContent = "请输入仓库管理密码"; return; }
    msg.textContent = "解锁中…";
    try {
      await api("/api/admin/github/unlock",
        { method: "POST", body: JSON.stringify({ password: pw }) });
      msg.textContent = "✓ 已解锁，可发布与修改仓库信息";
      toast("仓库已解锁", "ok");
      await loadGithub();
    } catch (e) {
      if (e.status === 401) { showLock(); return; }
      msg.textContent = "✗ " + e.message;
    }
  });

  on("btn-gh-setpw", "click", async () => {
    const msg = $("gh-msg");
    const pw = $("gh-pw").value;
    if (pw.length < 6) { msg.textContent = "仓库管理密码至少 6 位"; return; }
    msg.textContent = "加密保存中…";
    try {
      await api("/api/admin/github/password", {
        method: "POST",
        body: JSON.stringify({ password: pw, token: $("gh-token").value.trim() || null }),
      });
      $("gh-token").value = "";
      $("gh-pw").value = "";
      msg.textContent = "✓ 仓库密码已设置，token 已加密存储";
      toast("仓库密码已设置", "ok");
      await loadGithub();
    } catch (e) {
      if (e.status === 401) { showLock(); return; }
      msg.textContent = "✗ " + e.message;
    }
  });

  on("btn-gh-test", "click", async (e) => {
    const btn = e.target;
    btn.disabled = true;
    const msg = $("gh-msg");
    msg.textContent = "测试中…";
    try {
      const d = await api("/api/admin/github/test", { method: "POST" });
      const r = d.repo || {};
      msg.textContent = `✓ ${r.full_name}（默认分支 ${r.default_branch}${r.can_push ? "，可写入" : "，只读"}）`;
    } catch (err) { msg.textContent = "✗ " + err.message; }
    finally { btn.disabled = false; }
  });

  on("btn-gh-save", "click", async () => {
    const msg = $("gh-msg");
    msg.textContent = "保存中…";
    try {
      await api("/api/admin/github/config", {
        method: "POST",
        body: JSON.stringify({
          repo: $("gh-repo").value.trim(),
          branch: $("gh-branch").value.trim() || "main",
          path_prefix: $("gh-prefix").value.trim(),
        }),
      });
      const tok = $("gh-token").value.trim();
      if (tok) {
        await api("/api/admin/github/token",
          { method: "POST", body: JSON.stringify({ token: tok }) });
      }
      $("gh-token").value = "";
      msg.textContent = "✓ 仓库信息已保存";
      toast("仓库信息已保存", "ok");
      await loadGithub();
    } catch (e) {
      if (e.status === 401) { showLock(); return; }
      msg.textContent = "✗ " + e.message;
    }
  });

  on("btn-gh-publish", "click", async (e) => {
    if (!confirm("确定把当前项目文件发布到仓库？（未解锁会失败）")) return;
    const btn = e.target;
    btn.disabled = true;
    const msg = $("gh-msg");
    msg.textContent = "发布中…";
    try {
      const d = await api("/api/admin/github/publish", { method: "POST" });
      msg.textContent = `✓ 已发布 ${d.count} 个文件`;
      toast(`已发布 ${d.count} 个文件`, "ok");
    } catch (err) { msg.textContent = "✗ " + err.message; }
    finally { btn.disabled = false; }
  });

  /* ---------------------------------------------------- user search */
  on("user-search", "input", (e) => {
    userFilter = e.target.value || "";
    lastUsersSig = "";
    renderUsers(window.__users || []);
  });

  /* ---------------------------------------------------- letter to one user */
  let letterUid = null;
  function openLetterModal(u) {
    letterUid = u.uid;
    $("letter-to").textContent = `收件人：${u.name ? u.name + " · " : ""}${u.email}`;
    $("letter-subject").value = "";
    $("letter-body").value = "";
    $("letter-msg").textContent = "";
    $("letter-modal").classList.remove("hidden");
    setTimeout(() => $("letter-subject").focus(), 30);
  }
  function closeLetter() { $("letter-modal").classList.add("hidden"); letterUid = null; }
  on("letter-cancel", "click", closeLetter);
  on("letter-modal", "click", (e) => { if (e.target === $("letter-modal")) closeLetter(); });
  on("letter-ok", "click", async () => {
    if (!letterUid) return;
    const subject = $("letter-subject").value.trim();
    const body = $("letter-body").value.trim();
    const msg = $("letter-msg");
    if (!subject) { msg.textContent = "请填写主题"; return; }
    if (!body) { msg.textContent = "请填写正文"; return; }
    const btn = $("letter-ok"); btn.disabled = true; msg.textContent = "发送中…";
    try {
      await api(`/api/admin/users/${letterUid}/email`, {
        method: "POST", body: JSON.stringify({ subject, body }),
      });
      toast("信件已通过 SMTP 发出", "ok");
      closeLetter();
    } catch (e) { msg.textContent = "✗ " + e.message; }
    finally { btn.disabled = false; }
  });

  /* ---------------------------------------------------- quota requests */
  async function loadQuotaRequests() {
    try {
      const d = await api("/api/admin/quota-requests");
      renderQuotaRequests(d.requests || []);
      const badge = $("qreq-unread");
      const n = d.pending || 0;
      badge.style.display = n ? "inline-block" : "none";
      badge.textContent = n + " 条待审批";
    } catch (_) { /* 401 handled elsewhere */ }
  }
  function renderQuotaRequests(items) {
    const box = $("qreq-list");
    if (!items.length) { box.innerHTML = `<div class="muted">暂无云空间调整申请</div>`; return; }
    const stMap = { pending: ["待审批", "tier"], approved: ["已通过", "yes"],
                    rejected: ["已拒绝", "no"], expired: ["已到期还原", "user"],
                    superseded: ["已被新调整替代", "user"] };
    box.innerHTML = items.map((r) => {
      const [stText, stCls] = stMap[r.status] || [r.status, "user"];
      const reqMb = Math.round(r.request_bytes / 1048576);
      const curMb = Math.round((r.current_bytes || 0) / 1048576);
      const grow = r.request_bytes > (r.current_bytes || 0);
      let term = "";
      if (r.status === "approved") {
        term = r.expire_at
          ? `<div class="muted" style="margin-top:4px">临时调整至 ${fmtTime(r.expire_at)} 到期，`
            + `自动还原为 ${Math.round((r.revert_bytes || 0) / 1048576)} MB`
            + (r.status === "expired" ? "（已还原）" : "") + `</div>`
          : `<div class="muted" style="margin-top:4px">永久调整</div>`;
      }
      return `<div class="qreq-item ${r.status}" data-id="${escapeHtml(r.id)}">
        <div class="fb-head">
          <span class="fb-who">${escapeHtml(r.name || r.email || r.uid)}</span>
          <span class="muted">${escapeHtml(r.email || "")}</span>
          <span class="badge ${stCls}">${stText}</span>
          <span class="muted">${fmtTime(r.created_at)}</span>
        </div>
        <div class="qreq-main">
          申请${grow ? "扩大" : "缩小"}至 <b>${reqMb} MB</b>（当前 ${curMb} MB）
          <div class="muted" style="margin-top:4px;white-space:pre-wrap">理由：${escapeHtml(r.reason || "")}</div>
          ${term}
          ${r.note ? `<div class="muted" style="margin-top:4px">管理员备注：${escapeHtml(r.note)}</div>` : ""}
          ${r.decided_at ? `<div class="muted" style="margin-top:4px">处理时间：${fmtTime(r.decided_at)}</div>` : ""}
        </div>
        ${r.status === "pending" ? `<div class="qreq-acts">
          <button class="btn" data-act="approve">✓ 批准（${grow ? "扩大" : "缩小"}至 ${reqMb} MB）</button>
          <button class="btn danger" data-act="reject">拒绝</button>
        </div>` : ""}
      </div>`;
    }).join("");
    box.querySelectorAll(".qreq-item").forEach((el) => {
      const id = el.dataset.id;
      el.querySelectorAll("button[data-act]").forEach((btn) => {
        btn.onclick = () => openQuotaDecide(id, btn.dataset.act === "approve");
      });
    });
  }

  /* quota approval modal with duration (30s .. 3 months / permanent) */
  let qdecideId = null;
  function openQuotaDecide(id, approve) {
    qdecideId = id;
    $("qdecide-title").textContent = approve ? "批准云空间调整" : "拒绝云空间调整";
    $("qdecide-desc").textContent = approve
      ? "选择调整期限：到期后系统自动恢复到调整前的配额。"
      : "拒绝时期限不生效，可填写拒绝原因（会邮件通知用户）。";
    $("qdecide-duration").value = approve ? "7776000" : "0";
    $("qdecide-duration").disabled = !approve;
    $("qdecide-custom-wrap").style.display = "none";
    $("qdecide-custom").value = "";
    $("qdecide-note").value = "";
    $("qdecide-msg").textContent = "";
    $("qdecide-modal").classList.remove("hidden");
  }
  function closeQuotaDecide() { $("qdecide-modal").classList.add("hidden"); qdecideId = null; }
  on("qdecide-cancel", "click", closeQuotaDecide);
  on("qdecide-modal", "click", (e) => { if (e.target === $("qdecide-modal")) closeQuotaDecide(); });
  on("qdecide-duration", "change", (e) => {
    $("qdecide-custom-wrap").style.display = e.target.value === "custom" ? "" : "none";
  });
  async function submitQuotaDecision(approve) {
    if (!qdecideId) return;
    let duration = 0;
    if (approve) {
      const sel = $("qdecide-duration").value;
      if (sel === "custom") {
        duration = parseInt($("qdecide-custom").value, 10);
        if (!duration || duration < 30 || duration > 8035200) {
          $("qdecide-msg").textContent = "自定义秒数需在 30 ~ 8035200 之间";
          return;
        }
      } else {
        duration = parseInt(sel, 10) || 0;
      }
    }
    const note = $("qdecide-note").value.trim();
    $("qdecide-msg").textContent = "提交中…";
    try {
      await api(`/api/admin/quota-requests/${encodeURIComponent(qdecideId)}/decide`, {
        method: "POST",
        body: JSON.stringify({ approve, note, duration_seconds: duration || null }),
      });
      toast(approve ? "已批准，配额已调整" : "已拒绝", "ok");
      closeQuotaDecide();
      await Promise.all([loadQuotaRequests(), refresh()]);
    } catch (e) { $("qdecide-msg").textContent = "✗ " + e.message; }
  }
  on("qdecide-approve", "click", () => submitQuotaDecision(true));
  on("qdecide-reject", "click", () => submitQuotaDecision(false));

  /* ---------------------------------------------------- host + ollama */
  async function loadSystemStatus() {
    try {
      const d = await api("/api/admin/system");
      const st = $("sys-ollama-state");
      st.textContent = d.ollama_running ? "● 运行中" : "○ 已停止";
      st.className = "badge " + (d.ollama_running ? "yes" : "no");
      $("btn-ollama-start").disabled = !!d.ollama_running;
      $("btn-ollama-stop").disabled = !d.ollama_running;
      const t = $("sys-tunnel");
      t.textContent = "内网穿透：" + (d.tunnel || "未建立") +
        (d.tunnel_pushed ? "（已推送配置）" : "（配置未推送）");
    } catch (_) {}
  }
  async function ollamaCtl(action, btn) {
    const msg = $("sys-msg");
    btn.disabled = true;
    msg.textContent = action === "stop" ? "正在停止…" : "正在启动，最多等待 20 秒…";
    try {
      const d = await api("/api/admin/system/ollama", {
        method: "POST", body: JSON.stringify({ action }),
      });
      msg.textContent = d.note || (d.ollama_running ? "✓ Ollama 正在运行" : "✓ 已停止");
      await loadSystemStatus();
    } catch (e) { msg.textContent = "✗ " + e.message; }
    finally { btn.disabled = false; }
  }
  on("btn-ollama-start", "click", (e) => ollamaCtl("start", e.target));
  on("btn-ollama-stop", "click", (e) => ollamaCtl("stop", e.target));
  on("btn-ollama-restart", "click", (e) => ollamaCtl("restart", e.target));
  on("btn-shutdown", "click", () => {
    const delay = parseInt($("shutdown-delay").value, 10) || 5;
    if (!confirm(`确定 ${delay} 秒后关闭服务器主机？\n关机后本站、内网穿透将全部下线，需要人工重新开机！`)) return;
    if (!confirm("再次确认：真的要关机吗？此操作无法远程撤销。")) return;
    api("/api/admin/system/shutdown", {
      method: "POST", body: JSON.stringify({ delay }),
    }).then((d) => toast(d.message || "关机指令已下发", "ok"))
      .catch((e) => toast(e.message, "err"));
  });

  /* ---------------------------------------------------- collapsible panels */
  // Every admin <section.panel> can be folded by clicking its <h3>. The state
  // persists locally so long inboxes (feedback / unfreeze / notice history…)
  // never blow the page up again.
  const PANEL_STORE_KEY = "yjs_admin_collapsed_v1";
  function readCollapsedStore() {
    try { return JSON.parse(localStorage.getItem(PANEL_STORE_KEY) || "{}"); }
    catch (_) { return {}; }
  }
  function saveCollapsedStore(o) {
    try { localStorage.setItem(PANEL_STORE_KEY, JSON.stringify(o)); } catch (_) {}
  }
  function initCollapsibles() {
    const store = readCollapsedStore();
    document.querySelectorAll("#main section.panel").forEach((sec, idx) => {
      const h3 = sec.querySelector(":scope > h3");
      if (!h3) return;
      // stable id: explicit attribute, else heading text, else position
      const key = sec.dataset.collapse ||
        (h3.textContent.trim().replace(/\s+/g, "").slice(0, 12)) || ("p" + idx);
      sec.dataset.collapse = key;
      sec.classList.add("collapsible");
      if (!h3.querySelector(".collapse-mark")) {
        const mark = document.createElement("i");
        mark.className = "collapse-mark";
        mark.textContent = "▾";
        h3.insertBefore(mark, h3.firstChild);
      }
      if (store[key]) sec.classList.add("collapsed");
      h3.addEventListener("click", (e) => {
        // let buttons / links / badges inside the heading do their own job
        if (e.target.closest("button, a, input, select, textarea, label")) return;
        const collapsed = sec.classList.toggle("collapsed");
        const s = readCollapsedStore();
        if (collapsed) s[key] = 1; else delete s[key];
        saveCollapsedStore(s);
      });
    });

    // notice history subsection (editor stays visible, history folds away)
    const head = document.querySelector(".nt-history-head");
    const list = $("nt-history");
    if (head && list) {
      if (!head.querySelector(".collapse-mark")) {
        const lab = head.querySelector(".sw-label");
        const mark = document.createElement("i");
        mark.className = "collapse-mark";
        mark.textContent = "▾";
        if (lab) lab.insertBefore(mark, lab.firstChild);
        else head.insertBefore(mark, head.firstChild);
      }
      // default: history folded until the admin opens it
      const histKey = "__notice_history__";
      const histClosed = store[histKey] !== 0;
      const applyHist = (closed) => {
        head.classList.toggle("collapsed", closed);
        list.classList.toggle("collapsed", closed);
      };
      applyHist(histClosed);
      head.addEventListener("click", (e) => {
        if (e.target.closest("button, a")) return;   // republish button
        const closed = !head.classList.contains("collapsed");
        applyHist(closed);
        const s = readCollapsedStore();
        if (closed) s[histKey] = 1; else s[histKey] = 0;
        saveCollapsedStore(s);
      });
    }
  }

  /* ---------------------------------------------------------------- boot */
  async function start() {
    clearInterval(timer);
    clearInterval(auxTimer);
    const who = $("who"); if (who) who.textContent = ME.email + "（管理员）";
    const main = $("main"); if (main) main.classList.remove("hidden");
    await loadSettings();
    await loadMcp();
    await loadMail();
    await loadNotice();
    await loadFeedback();
    await loadQuotaRequests();
    await loadUnfreeze();
    await loadGithub();
    await loadSystemStatus();
    await refresh();
    timer = setInterval(refresh, 2000);
    auxTimer = setInterval(() => {
      if (anyOverlayOpen()) return;
      loadQuotaRequests();
      loadUnfreeze();
      loadSystemStatus();
    }, 6000);
  }

  (async function boot() {
    initCollapsibles();
    await resolveApi();
    if (!TOKEN) {
      showDeny("尚未登录。请先回到对话页登录管理员账号，再进入后台。");
      return;
    }
    try {
      ME = (await api("/api/me")).user;
    } catch (e) {
      showDeny(e.status === 401 ? "登录已过期，请重新登录后再进入后台。"
                                : ("无法连接后端：" + (e.message || "network")));
      return;
    }
    if (!ME.is_admin) {
      showDeny("当前账号（" + ME.email + "）不是管理员，无权访问后台。");
      return;
    }
    try {
      const st = await api("/api/admin/status");
      if (st.locked) { showLock(); return; }
    } catch (e) {
      showDeny("无法读取后台状态：" + (e.message || "network"));
      return;
    }
    await start();
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) {
        clearInterval(timer); timer = null;
        clearInterval(auxTimer); auxTimer = null;
      }
      else if (!timer) {
        refresh(); timer = setInterval(refresh, 2000);
        auxTimer = setInterval(() => {
          if (anyOverlayOpen()) return;
          loadQuotaRequests(); loadUnfreeze(); loadSystemStatus();
        }, 6000);
      }
    });
  })();
})();