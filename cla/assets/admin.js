/* YJS 管理后台 —— 实时模型调用 / Token 计量 / 用户管理 */
(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  let API = "";
  let TOKEN = localStorage.getItem("yjs_token") || "";
  let ME = null;
  let timer = null;
  let drawerUid = null;

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
    const res = await fetch(API + path, Object.assign({}, opts, { headers }));
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.detail || ("HTTP " + res.status));
    return data;
  }

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

  function renderModels(ov) {
    const tb = $("tbl-models").querySelector("tbody");
    tb.innerHTML = (ov.models || []).map((m) => {
      let status, cls;
      if (m.active > 0) { status = `调用中 ×${m.active}`; cls = "busy"; }
      else if (m.loaded) { status = "显存常驻"; cls = "on"; }
      else if (m.installed) { status = "已安装"; cls = "off"; }
      else { status = "未安装"; cls = "off"; }
      return `<tr>
        <td><span class="dot ${cls}"></span>${escapeHtml(m.display || m.name)}</td>
        <td><span class="badge tier">${escapeHtml(m.tier || "—")}</span></td>
        <td>${escapeHtml(status)}</td>
        <td class="num">${fmtNum(m.calls)}</td>
        <td class="num">${fmtNum(m.prompt_tokens)}</td>
        <td class="num">${fmtNum(m.completion_tokens)}</td>
        <td class="num"><b>${fmtNum(m.total_tokens)}</b></td>
        <td class="muted">${fmtAgo(m.last_used)}</td>
      </tr>`;
    }).join("") || `<tr><td colspan="8" class="muted">无模型</td></tr>`;
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

  function renderUsers(users) {
    window.__users = users;
    const tb = $("tbl-users").querySelector("tbody");
    tb.innerHTML = users.map((u) => {
      const pct = u.usage ? Math.min(u.usage.percent, 100) : 0;
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
          <button class="btn ghost" data-act="convs">对话</button>
          <button class="btn ghost" data-act="pwd">改密码</button>
          <button class="btn ghost" data-act="quota">配额</button>
          <button class="btn danger" data-act="del">删除</button>
        </td>
      </tr>`;
    }).join("") || `<tr><td colspan="9" class="muted">暂无用户</td></tr>`;

    tb.querySelectorAll("button[data-act]").forEach((btn) => {
      const tr = btn.closest("tr");
      const idx = Array.from(tb.children).indexOf(tr);
      const u = users[idx];
      if (!u) return;
      const act = btn.dataset.act;
      if (act === "convs") btn.onclick = () => openUserConversations(u.uid, u.email);
      else if (act === "pwd") btn.onclick = () => openModal(
        "修改密码 · " + u.email, "设置后该用户可用「邮箱 + 密码」登录（至少 6 位）", "", "新密码",
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

  /* ---------------------------------------------------------------- loop */
  async function refresh() {
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
      const c = $("conn");
      c.textContent = "连接失败";
      c.className = "pill err";
    }
  }

  $("btn-logout").onclick = () => {
    localStorage.removeItem("yjs_token");
    location.href = "/";
  };

  /* ---------------------------------------------------------------- boot */
  (async function boot() {
    await resolveApi();
    if (!TOKEN) { location.href = "/"; return; }
    try {
      const d = await api("/api/me");
      ME = d.user;
    } catch (_) { location.href = "/"; return; }
    if (!ME.is_admin) {
      $("deny").classList.remove("hidden");
      return;
    }
    $("who").textContent = ME.email + "（管理员）";
    $("main").classList.remove("hidden");
    await refresh();
    timer = setInterval(refresh, 2000);
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) { clearInterval(timer); timer = null; }
      else if (!timer) { refresh(); timer = setInterval(refresh, 2000); }
    });
  })();
})();