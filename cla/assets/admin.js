/* YJS 管理后台 —— 实时模型调用 / Token 计量 / 用户管理 */
(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  let API = "";
  let TOKEN = localStorage.getItem("yjs_token") || "";
  let ADMIN_TOKEN = sessionStorage.getItem("yjs_admin_token") || "";
  let ME = null;
  let timer = null;
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
  async function resolveApi() {
    const override = localStorage.getItem("yjs_api_override");
    if (override) API = override.replace(/\/$/, "");
    else if (["127.0.0.1", "localhost"].includes(location.hostname)) API = location.origin;
    else {
      try {
        const r = await fetch("config.json?t=" + Date.now(), { cache: "no-store" });
        if (r.ok) { const c = await r.json(); if (c.api_url) API = c.api_url.replace(/\/$/, ""); }
      } catch (_) {}
      if (!API) API = location.origin;
    }
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
  function renderUsers(users) {
    window.__users = users;
    const sig = JSON.stringify(users);
    if (sig === lastUsersSig) return;   // unchanged → keep DOM (and click handlers) intact
    lastUsersSig = sig;
    const tb = $("tbl-users").querySelector("tbody");
    tb.innerHTML = users.map((u) => {
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
          <button class="btn ghost" data-act="pwd">密码</button>
          <button class="btn ghost" data-act="quota">配额</button>
          <button class="btn danger" data-act="del">删除</button>
        </td>
      </tr>`;
    }).join("") || `<tr><td colspan="10" class="muted">暂无用户</td></tr>`;

    tb.querySelectorAll("button[data-act]").forEach((btn) => {
      const tr = btn.closest("tr");
      const idx = Array.from(tb.children).indexOf(tr);
      const u = users[idx];
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
        `当前配额 ${fmtSize(u.quota_bytes)}，已用 ${fmtSize(u.usage && u.usage.used)}。请输入新的配额（GB）`,
        (u.quota_bytes / 1073741824).toFixed(2), "例如 1 或 0.5",
        async (v) => {
          const gb = parseFloat(v);
          if (!isFinite(gb) || gb < 0) throw new Error("请输入合法的 GB 数值");
          await api(`/api/admin/users/${u.uid}/quota`,
            { method: "POST", body: JSON.stringify({ quota_bytes: Math.round(gb * 1073741824) }) });
          toast("配额已更新", "ok"); await refresh();
        });
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
    const ids = ["modal", "drawer", "mp-modal", "am-modal", "em-modal", "mcp-modal"];
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
      $("set-announce").value = st.announcement || "";
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
          announcement: $("set-announce").value,
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

  /* ---------------------------------------------------------------- boot */
  async function start() {
    clearInterval(timer);
    const who = $("who"); if (who) who.textContent = ME.email + "（管理员）";
    const main = $("main"); if (main) main.classList.remove("hidden");
    await loadSettings();
    await loadMcp();
    await refresh();
    timer = setInterval(refresh, 2000);
  }

  (async function boot() {
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
      if (document.hidden) { clearInterval(timer); timer = null; }
      else if (!timer) { refresh(); timer = setInterval(refresh, 2000); }
    });
  })();
})();