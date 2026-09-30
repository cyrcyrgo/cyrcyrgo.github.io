/** 页面逻辑：初始化模型（下载权重 + 构建计算图）并驱动对话生成 */
(function () {
  "use strict";

  // 多镜像下载链：按顺序尝试，哪个先成功用哪个（自动回退）
  //  - gh-proxy.com：国内常用 GitHub 代理，代理解包 raw.githubusercontent.com，实测 25MB ~ 4.4s
  //  - jsdelivr：纯 CDN，对 <20MB 的 JSON 小文件速度极快；对 >20MB 权重被 403 拒绝，需后续回退
  //  - raw.githubusercontent.com：GitHub 官方源，海外可用、国内慢
  //  - GitHub Pages 自身：部署后在 cyrcyrgo.github.io 直接可用（同源，通常最快）
  const REPO = "cyrcyrgo/cyrcyrgo.github.io";
  const BRANCH = "main";
  const LOCAL_ROOT = (location.protocol === "file:" ? "" : location.origin) +
    location.pathname.replace(/[^/]*$/, "") + "model/";
  const MIRRORS = [
    // gh-proxy 代理 raw 源
    (p) => "https://gh-proxy.com/https://raw.githubusercontent.com/" + REPO + "/" + BRANCH + "/llm/web/model/" + p,
    // jsdelivr CDN（仅 JSON 等小文件能过）
    (p) => "https://cdn.jsdelivr.net/gh/" + REPO + "@" + BRANCH + "/llm/web/model/" + p,
    (p) => "https://fastly.jsdelivr.net/gh/" + REPO + "@" + BRANCH + "/llm/web/model/" + p,
    // GitHub 官方 raw
    (p) => "https://raw.githubusercontent.com/" + REPO + "/" + BRANCH + "/llm/web/model/" + p,
    // GitHub Pages / 本地同源兜底
    (p) => LOCAL_ROOT + p,
  ];
  const MODEL_DIR = "model/";
  const state = {
    tok: null, model: null, cfg: null, eosId: null, ready: false, busy: false, info: null,
  };

  const $ = (id) => document.getElementById(id);

  // ---------------------------------------------------------------- 加载与初始化
  function setStep(container, idx, status) {
    const el = container.children[idx];
    if (!el) return;
    el.className = "step " + status;
    el.querySelector(".dot").textContent = status === "done" ? "✓" : idx + 1;
  }

  // ---- 多镜像下载辅助 ----
  async function mirrorFetch(path) {
    let lastErr = null;
    for (let i = 0; i < MIRRORS.length; i++) {
      const url = MIRRORS[i](path);
      try {
        const res = await fetch(url, { cache: path === "weights.bin" ? "force-cache" : "default" });
        if (res.ok) return res;
        lastErr = new Error(url + " -> " + res.status);
      } catch (e) { lastErr = e; }
    }
    throw lastErr || new Error("所有镜像均下载失败：" + path);
  }

  async function mirrorFetchJson(path) { return (await mirrorFetch(path)).json(); }
  async function mirrorFetchText(path) { return (await mirrorFetch(path)).text(); }

  async function mirrorFetchWithProgress(path, onProgress) {
    // 对二进制权重：先测最快镜像，再流式下载
    let lastErr = null, bestLen = 0, bestBuf = null;
    for (let i = 0; i < MIRRORS.length; i++) {
      const url = MIRRORS[i](path);
      try {
        const res = await fetch(url, { cache: "force-cache" });
        if (!res.ok) { lastErr = new Error(url + " -> " + res.status); continue; }
        const total = Number(res.headers.get("content-length")) || 0;
        if (!res.body || !total) {
          const arr = new Uint8Array(await res.arrayBuffer());
          if (arr.length > bestLen) { bestLen = arr.length; bestBuf = arr; }
          continue;
        }
        const reader = res.body.getReader();
        const chunks = [];
        let received = 0;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
          received += value.length;
          onProgress(received / total);
        }
        const out = new Uint8Array(received);
        let off = 0;
        for (const c of chunks) { out.set(c, off); off += c.length; }
        if (out.length === total) return out; // 完整下载即返回
        if (out.length > bestLen) { bestLen = out.length; bestBuf = out; }
      } catch (e) { lastErr = e; }
    }
    if (bestBuf && bestBuf.length > 0) return bestBuf;
    throw lastErr || new Error("所有镜像均下载失败：" + path);
  }

  async function initialize() {
    const stepsBox = $("steps");
    const bar = $("bar");
    const labels = [
      "加载分词器（vocab.json + merges.txt）",
      "下载模型权重（weights.bin）",
      "构建模型并绑定参数",
      "模型就绪",
    ];
    stepsBox.innerHTML = labels
      .map((t, i) => `<div class="step"><span class="dot">${i + 1}</span><span>${t}</span></div>`)
      .join("");

    setStep(stepsBox, 0, "active");
    bar.style.width = "4%";
    const [vocab, merges] = await Promise.all([
      mirrorFetchJson("vocab.json"),
      mirrorFetchText("merges.txt"),
    ]);
    const mergesArr = merges.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
    state.tok = new window.BPETokenizer(vocab, mergesArr, {});
    state.eosId = vocab["<|endoftext|>"];
    setStep(stepsBox, 0, "done");

    setStep(stepsBox, 1, "active");
    const manifest = await mirrorFetchJson("manifest.json");
    const buf = await mirrorFetchWithProgress("weights.bin", (p) => {
      bar.style.width = (8 + p * 82).toFixed(1) + "%";
    });
    setStep(stepsBox, 1, "done");

    setStep(stepsBox, 2, "active");
    const all = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
    const tensors = {};
    for (const t of manifest.tensors) tensors[t.name] = all.subarray(t.offset, t.offset + t.count);
    state.cfg = manifest.config;
    state.model = new window.MiniLLMJS(manifest.config, tensors);
    setStep(stepsBox, 2, "done");

    setStep(stepsBox, 3, "active");
    bar.style.width = "100%";
    // 预热一次，确保推理路径无异常
    state.model.reset();
    state.model.forward(state.tok.encode("你好")[0] || 0);
    state.model.reset();
    setStep(stepsBox, 3, "done");
    state.ready = true;
    await new Promise((r) => setTimeout(r, 260));

    $("overlay").classList.remove("show");
    $("chat").classList.add("show");
    $("startBtn").disabled = true;
    $("startBtn").textContent = "已启动";
    $("startNote").textContent = "模型已在本地浏览器中运行，可直接对话";
    addMsg("sys", `模型加载完成：${state.info.params.toLocaleString()} 参数 · ${state.cfg.num_hidden_layers} 层 · 词表 ${state.cfg.vocab_size}。输入文字即可让模型续写。`);
    $("input").focus();
    $("chat").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // ---------------------------------------------------------------- 对话渲染
  function addMsg(role, text) {
    const el = document.createElement("div");
    el.className = "msg " + role;
    el.textContent = text;
    $("msgs").appendChild(el);
    $("msgs").scrollTop = $("msgs").scrollHeight;
    return el;
  }

  function decodeSafe(ids) {
    return state.tok.decode(ids).replace(/\uFFFD+$/, "");
  }

  async function respond(prompt) {
    if (state.busy) return;
    state.busy = true;
    $("sendBtn").disabled = true;
    addMsg("user", prompt);

    const bot = addMsg("bot", "");
    bot.classList.add("cursor");

    const temperature = Number($("temp").value);
    const topK = Number($("topk").value);
    const topP = Number($("topp").value);
    const maxNew = Number($("maxn").value);
    const ctxLimit = state.cfg.max_position_embeddings;

    let ids = state.tok.encode(prompt);
    if (ids.length > ctxLimit - 8) ids = ids.slice(-(ctxLimit - 8));

    state.model.reset();
    let logits = null;
    for (const id of ids) logits = state.model.forward(id);

    const outIds = [];
    const t0 = performance.now();
    let firstAt = 0;
    for (let i = 0; i < maxNew; i++) {
      if (state.model.pos >= ctxLimit) break;
      const next = window.MiniLLMJS.sample(logits, temperature, topK, topP);
      outIds.push(next);
      if (i === 0) firstAt = performance.now();
      bot.textContent = decodeSafe(outIds);
      $("msgs").scrollTop = $("msgs").scrollHeight;
      logits = state.model.forward(next);
      if (state.eosId !== undefined && next === state.eosId) break;
      await new Promise((r) => setTimeout(r, 0));
    }
    bot.classList.remove("cursor");

    const dt = ((performance.now() - (firstAt || t0)) / 1000).toFixed(2);
    const tps = outIds.length > 1 ? (outIds.length / Math.max(dt, 1e-3)).toFixed(1) : "-";
    $("chatBadge").textContent = `已就绪 · 本次生成 ${outIds.length} token · ${tps} tok/s`;

    state.busy = false;
    $("sendBtn").disabled = false;
    $("input").focus();
  }

  // ---------------------------------------------------------------- 顶部信息卡 & 训练曲线
  function renderCards(info, cfg) {
    const items = [
      ["参数量", (info.params / 1e6).toFixed(2) + "<small>M</small>"],
      ["解码器层数", cfg.num_hidden_layers],
      ["隐藏维度", cfg.hidden_size],
      ["注意力头", `${cfg.num_attention_heads}<small>Q / ${cfg.num_key_value_heads} KV</small>`],
      ["词表大小", cfg.vocab_size],
      ["上下文长度", cfg.max_position_embeddings],
    ];
    $("cards").innerHTML = items
      .map(([k, v]) => `<div class="card"><div class="k">${k}</div><div class="v">${v}</div></div>`)
      .join("");
  }

  function drawLoss(metrics) {
    const canvas = $("lossChart");
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    const ctx = canvas.getContext("2d");
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);

    const pad = { l: 42, r: 12, t: 14, b: 26 };
    const iw = w - pad.l - pad.r, ih = h - pad.t - pad.b;
    const xs = metrics.map((m) => m.step);
    const ys = metrics.concat(metrics.filter((m) => m.val_loss)).map((m) => m.val_loss || m.loss);
    const xMax = Math.max(...xs), yMin = Math.min(...ys), yMax = Math.max(...ys);
    const X = (v) => pad.l + (v / xMax) * iw;
    const Y = (v) => pad.t + ih - ((v - yMin) / Math.max(yMax - yMin, 1e-6)) * ih;

    ctx.strokeStyle = "#222c44";
    ctx.fillStyle = "#8b9ac4";
    ctx.font = "11px sans-serif";
    for (let i = 0; i <= 4; i++) {
      const v = yMin + (yMax - yMin) * (i / 4);
      const y = Y(v);
      ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(w - pad.r, y); ctx.stroke();
      ctx.fillText(v.toFixed(2), 6, y + 4);
    }

    const drawLine = (key, color) => {
      const pts = metrics.filter((m) => m[key] != null);
      if (pts.length < 2) return;
      ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.beginPath();
      pts.forEach((m, i) => {
        const x = X(m.step), y = Y(m[key]);
        i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      });
      ctx.stroke();
    };
    drawLine("loss", "#5b8cff");
    drawLine("val_loss", "#8b5cf6");

    ctx.fillStyle = "#8b9ac4";
    ctx.fillText("0", pad.l - 4, h - 8);
    ctx.fillText(String(xMax), w - pad.r - 30, h - 8);
    ctx.fillStyle = "#5b8cff"; ctx.fillRect(pad.l, h - 16, 10, 3);
    ctx.fillStyle = "#8b9ac4"; ctx.fillText("train loss", pad.l + 16, h - 12);
    ctx.fillStyle = "#8b5cf6"; ctx.fillRect(pad.l + 92, h - 16, 10, 3);
    ctx.fillStyle = "#8b9ac4"; ctx.fillText("val loss", pad.l + 108, h - 12);
  }

  // ---------------------------------------------------------------- 启动
  async function boot() {
    let manifest = null;
    try {
      manifest = await mirrorFetchJson("manifest.json");
    } catch (e) { /* 权重未就绪 */ }
    try {
      const info = await mirrorFetchJson("train_info.json");
      state.info = info;
      renderCards({ params: info.params }, manifest ? manifest.config : info.architecture);
    } catch (e) {
      $("cards").innerHTML = '<div class="card"><div class="k">状态</div><div class="v">权重未就绪</div></div>';
    }
    try {
      const metrics = await mirrorFetchJson("metrics.json");
      if (Array.isArray(metrics) && metrics.length > 1) {
        $("lossPanel").style.display = "block";
        const last = metrics[metrics.length - 1];
        $("lossDesc").textContent =
          `已训练 ${last.step} 步 / ${(last.tokens / 1e6).toFixed(1)}M tokens · 训练损失 ${last.loss} · 验证损失 ${last.val_loss}`;
        drawLoss(metrics);
        window.addEventListener("resize", () => drawLoss(metrics));
      }
    } catch (e) { /* 无指标文件则忽略 */ }

    const seeds = ["话说天下大势", "玄德曰", "那大圣", "却说曹操", "明月几时有"];
    $("seeds").innerHTML = seeds.map((s) => `<span class="chip">${s}</span>`).join("");
    $("seeds").addEventListener("click", (e) => {
      if (e.target.classList.contains("chip")) { $("input").value = e.target.textContent; respond(e.target.textContent); }
    });

    $("startBtn").addEventListener("click", () => {
      $("overlay").classList.add("show");
      initialize().catch((err) => {
        $("bootNote").textContent = "初始化失败：" + err.message;
        $("bootNote").style.color = "#f87171";
      });
    });

    const bind = (id, out, fmt) => {
      const el = $(id);
      el.addEventListener("input", () => { $(out).textContent = fmt(el.value); });
    };
    bind("temp", "vTemp", (v) => Number(v).toFixed(2));
    bind("topk", "vTopk", (v) => v);
    bind("topp", "vTopp", (v) => Number(v).toFixed(2));
    bind("maxn", "vMax", (v) => v);

    const submit = () => {
      const v = $("input").value.trim();
      if (!v || !state.ready || state.busy) return;
      $("input").value = "";
      respond(v);
    };
    $("sendBtn").addEventListener("click", submit);
    $("input").addEventListener("keydown", (e) => { if (e.key === "Enter") submit(); });
  }

  document.addEventListener("DOMContentLoaded", boot);
})();