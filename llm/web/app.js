/** 页面逻辑：初始化模型（下载权重 + 构建计算图）并驱动对话生成 */
(function () {
  "use strict";

  // 多镜像下载链：path 形如 "dialog/manifest.json"、"html/weights.bin"
  const REPO = "cyrcyrgo/cyrcyrgo.github.io";
  const BRANCH = "main";
  const PREFIX_GH_RAW = "https://raw.githubusercontent.com/" + REPO + "/" + BRANCH + "/llm/web/model/";
  const PREFIX_JSDELIVR = "https://cdn.jsdelivr.net/gh/" + REPO + "@" + BRANCH + "/llm/web/model/";
  const PREFIX_GHPAGES = (location.protocol === "file:" ? "" : location.origin) +
    location.pathname.replace(/[^/]*$/, "") + "model/";
  // 镜像按「国内可达性 + 是否支持大文件」挑选；下载时按实测速度排序，不按列表顺序
  const MIRRORS = [
    // GitHub Pages 同源 CDN：无跨域、支持 Range，速度快时最佳
    (p) => PREFIX_GHPAGES + p,
    // 公共 GitHub 代理（支持大文件 + Range，均已实测可用）
    (p) => "https://gh-proxy.com/" + PREFIX_GH_RAW + p,
    (p) => "https://ghfast.top/" + PREFIX_GH_RAW + p,
    (p) => "https://ghproxy.net/" + PREFIX_GH_RAW + p,
    // jsDelivr（小文件极快，>20MB 会被拒）
    (p) => PREFIX_JSDELIVR + p,
    (p) => "https://fastly.jsdelivr.net/gh/" + REPO + "@" + BRANCH + "/llm/web/model/" + p,
    // GitHub 官方 raw
    (p) => PREFIX_GH_RAW + p,
  ];

  const PROBE_BYTES = 256 * 1024;            // 测速读取的字节数
  const CHUNK_MIN_BYTES = 2 * 1024 * 1024;   // 超过该大小启用分块并行
  const CHUNK_CONCURRENCY = 6;               // 分块并发数

  const state = {
    modelKey: "dialog",
    tok: null, model: null, cfg: null, eosId: null, ready: false, busy: false, info: null,
    mirrorInfo: "",
  };

  const hostOf = (u) => { try { return new URL(u).host; } catch (e) { return u; } };

  // 带超时的 fetch：避免某个镜像卡死拖垮整个测速/竞速流程
  function fetchTimeout(url, opts, ms) {
    const ctrl = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; ctrl.abort(); }, ms);
    const outer = (opts && opts.signal) || null;
    if (outer) outer.addEventListener("abort", () => ctrl.abort(), { once: true });
    return fetch(url, Object.assign({}, opts, { signal: ctrl.signal }))
      .catch((e) => { if (timedOut) throw new Error("镜像超时：" + url); throw e; })
      .finally(() => clearTimeout(timer));
  }

  const $ = (id) => document.getElementById(id);

  // ---------------------------------------------------------------- 加载与初始化
  function setStep(container, idx, status) {
    const el = container.children[idx];
    if (!el) return;
    el.className = "step " + status;
    el.querySelector(".dot").textContent = status === "done" ? "✓" : idx + 1;
  }

  // ---- 模型配置：两套权重分别在 model/dialog/ 和 model/html/ 下 ----
  const MODELS = {
    dialog: {
      label: "基础对话（中文）",
      infoUrl: "model/dialog/train_info.json",
      seeds: ["你好，介绍一下你自己", "Python 是什么？", "帮我写一首春天的小诗", "1 公斤等于多少克？", "如何保持健康？"],
    },
    html: {
      label: "HTML 代码生成（可预览）",
      infoUrl: "model/html/train_info.json",
      seeds: ["写一个会让按钮悬停发光的网页", "网页版的加一减一计数器", "做一个网页版计算器", "写一个打砖块小游戏", "网页上的颜色调色盘"],
    },
  };

  // ---- 多镜像下载辅助 ----
  // path 已经是相对 model/<key>/ 的（如 dialog/manifest.json），底层 MIRRORS 会拼接好完整远端地址

  // 小文件：并发竞速，最先成功的镜像立即返回，其余请求全部中止
  function mirrorFetch(path) {
    return new Promise((resolve, reject) => {
      const ctrls = MIRRORS.map(() => new AbortController());
      let pending = MIRRORS.length;
      let lastErr = null;
      let settled = false;
      const finish = (fn, arg, keep) => {
        if (settled) return;
        settled = true;
        ctrls.forEach((c, i) => { if (i !== keep) { try { c.abort(); } catch (e) { /* ignore */ } } });
        fn(arg);
      };
      const fail = (e) => {
        if (settled) return;
        lastErr = e;
        if (--pending <= 0) finish(reject, lastErr || new Error("所有镜像均下载失败：" + path));
      };
      MIRRORS.forEach((mk, i) => {
        const url = mk(path);
        fetchTimeout(url, { cache: "default", signal: ctrls[i].signal }, 15000)
          .then((res) => { if (res.ok) finish(resolve, res, i); else fail(new Error(url + " -> " + res.status)); })
          .catch((e) => { if (!e || e.name !== "AbortError") fail(e); });
      });
    });
  }

  async function mirrorFetchJson(path) { return (await mirrorFetch(path)).json(); }
  async function mirrorFetchText(path) { return (await mirrorFetch(path)).text(); }

  // 探测单个镜像：读取少量字节估算真实吞吐（不发送 Range，避免触发跨域预检）
  async function probeMirror(path, idx) {
    const url = MIRRORS[idx](path);
    const t0 = performance.now();
    try {
      const res = await fetchTimeout(url, { cache: "no-store" }, 8000);
      if (!res.ok) return null;
      const cr = res.headers.get("content-range") || "";
      const total = Number(res.headers.get("content-length")) ||
        (cr.includes("/") ? Number(cr.split("/")[1]) : 0) || 0;
      let got = 0;
      if (res.body) {
        const reader = res.body.getReader();
        while (got < PROBE_BYTES) {
          const { done, value } = await reader.read();
          if (done) break;
          got += value.length;
        }
        try { await reader.cancel(); } catch (e) { /* ignore */ }
      } else {
        got = total;
      }
      const dt = Math.max(performance.now() - t0, 1);
      return { idx, url, total, got, bps: got > 0 ? got / (dt / 1000) : 0 };
    } catch (e) {
      return null;
    }
  }

  // 并发探测全部镜像，按实测吞吐从快到慢排序
  async function rankMirrors(path) {
    const results = await Promise.all(MIRRORS.map((_, i) => probeMirror(path, i)));
    return results.filter(Boolean).sort((a, b) => b.bps - a.bps);
  }

  // 检测镜像是否支持跨域 Range 请求（分块下载的前提）
  async function canRange(mirror) {
    try {
      const res = await fetchTimeout(mirror.url, { headers: { Range: "bytes=0-0" }, cache: "no-store" }, 8000);
      const ok = res.status === 206;
      try { if (res.body) await res.body.cancel(); } catch (e) { /* ignore */ }
      return ok;
    } catch (e) { return false; }
  }

  // 分块并行下载：把文件切成 N 段，用多个 Range 请求同时拉取
  async function downloadChunked(mirror, total, onProgress) {
    const parts = Math.max(1, Math.min(CHUNK_CONCURRENCY, Math.ceil(total / (1024 * 1024))));
    const chunk = Math.ceil(total / parts);
    const out = new Uint8Array(total);
    const loaded = new Array(parts).fill(0);
    let reported = -1;
    const tick = () => {
      let sum = 0;
      for (let i = 0; i < loaded.length; i++) sum += loaded[i];
      if (sum !== reported) { reported = sum; onProgress(sum / total); }
    };
    const fetchPart = async (slot, start, end) => {
      let lastErr = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const res = await fetch(mirror.url, {
            headers: { Range: "bytes=" + start + "-" + end },
            cache: "force-cache",
          });
          if (res.status !== 206 || !res.body) throw new Error(mirror.url + " -> " + res.status);
          const reader = res.body.getReader();
          let off = start;
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            if (off + value.length > end + 1) throw new Error("分块越界");
            out.set(value, off);
            off += value.length;
            loaded[slot] = off - start;
            tick();
          }
          if (off === end + 1) return;
          throw new Error("分块不完整");
        } catch (e) {
          lastErr = e;
          loaded[slot] = 0;
          tick();
        }
      }
      throw lastErr || new Error("分块下载失败");
    };
    const jobs = [];
    for (let i = 0; i < parts; i++) {
      const start = i * chunk;
      const end = Math.min(start + chunk, total) - 1;
      if (start > end) break;
      jobs.push(fetchPart(i, start, end));
    }
    await Promise.all(jobs);
    return out;
  }

  // 单流下载：按顺序流式读取，作为分块不可用时的兜底
  async function downloadStream(mirror, total, onProgress) {
    const res = await fetch(mirror.url, { cache: "force-cache" });
    if (!res.ok) throw new Error(mirror.url + " -> " + res.status);
    const len = Number(res.headers.get("content-length")) || total || 0;
    if (!res.body) {
      const buf = new Uint8Array(await res.arrayBuffer());
      onProgress(1);
      return buf;
    }
    const reader = res.body.getReader();
    const chunks = [];
    let received = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.length;
      if (len) onProgress(received / len);
    }
    const out = new Uint8Array(received);
    let off = 0;
    for (const c of chunks) { out.set(c, off); off += c.length; }
    onProgress(1);
    return out;
  }

  // 大文件下载主流程：并发测速 → 最快的镜像上分块并行 → 失败降级单流
  async function mirrorFetchWithProgress(path, onProgress, expectedSize) {
    const ranked = await rankMirrors(path);
    if (!ranked.length) throw new Error("所有镜像均下载失败：" + path);
    const total = expectedSize || ranked[0].total || 0;

    if (total > CHUNK_MIN_BYTES) {
      for (const m of ranked.slice(0, 3)) {            // 只在最快的几个镜像里找支持 Range 的
        if (await canRange(m)) {
          try {
            const buf = await downloadChunked(m, total, onProgress);
            state.mirrorInfo = `分块并行 ×${CHUNK_CONCURRENCY} · ${hostOf(m.url)}`;
            return buf;
          } catch (e) { /* 分块失败 → 继续找 / 降级单流 */ }
        }
      }
    }

    let lastErr = null;
    for (const m of ranked) {                           // 单流：按测速顺序依次尝试
      try {
        const buf = await downloadStream(m, total, onProgress);
        state.mirrorInfo = `单流 · ${hostOf(m.url)}`;
        return buf;
      } catch (e) { lastErr = e; }
    }
    throw lastErr || new Error("所有镜像均下载失败：" + path);
  }

  async function initialize() {
    const stepsBox = $("steps");
    const bar = $("bar");
    state.mirrorInfo = "";
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
      mirrorFetchJson(state.modelKey + "/vocab.json"),
      mirrorFetchText(state.modelKey + "/merges.txt"),
    ]);
    const mergesArr = merges.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
    state.tok = new window.BPETokenizer(vocab, mergesArr, {});
    state.eosId = vocab["<|endoftext|>"];
    setStep(stepsBox, 0, "done");

    setStep(stepsBox, 1, "active");
    const manifest = await mirrorFetchJson(state.modelKey + "/manifest.json");
    const expectedBytes = manifest.tensors.reduce((m, t) => Math.max(m, t.offset + t.count), 0) * 4;
    const t0 = performance.now();
    const totalMb = (expectedBytes / 1048576).toFixed(1);
    const buf = await mirrorFetchWithProgress(state.modelKey + "/weights.bin", (p) => {
      bar.style.width = (8 + p * 82).toFixed(1) + "%";
      const sec = (performance.now() - t0) / 1000;
      const mb = (p * expectedBytes) / 1048576;
      const speed = sec > 0.4 ? (mb / sec).toFixed(1) + " MB/s" : "测速中…";
      $("bootNote").textContent = `权重下载 ${(p * 100).toFixed(0)}% · ${mb.toFixed(1)}MB / ${totalMb}MB · ${speed}`;
    }, expectedBytes);
    const sec = (performance.now() - t0) / 1000;
    $("bootNote").textContent =
      `权重下载 100% · ${totalMb}MB / ${totalMb}MB · ${(Number(totalMb) / Math.max(sec, 1e-3)).toFixed(1)} MB/s` +
      (state.mirrorInfo ? " · " + state.mirrorInfo : "");
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
    const params = state.info && state.info.params ? state.info.params.toLocaleString() : "-";
    addMsg("sys", `模型加载完成：${params} 参数 · ${state.cfg.num_hidden_layers} 层 · 词表 ${state.cfg.vocab_size}。输入文字即可让模型续写。`);
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

    // HTML 模型：自动把输出代码放进 iframe 预览
    if (state.modelKey === "html") {
      const html = extractHtml(bot.textContent);
      if (html) runHtmlInIframe(html);
    } else {
      $("htmlPanel").style.display = "none";
    }

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

  // ---------------------------------------------------------------- HTML 预览
  let lastHtmlCode = "";
  function extractHtml(text) {
    const m = text.match(/```(?:html)?\s*([\s\S]*?)```/i);
    if (m) return m[1].trim();
    if (/<!doctype|<html|<head|<body|<script|<style|<\/html>/i.test(text)) return text.trim();
    return "";
  }
  function runHtmlInIframe(html) {
    lastHtmlCode = html;
    const frame = $("htmlFrame");
    frame.srcdoc = html;
    $("htmlPanel").style.display = "block";
    $("htmlPanel").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // ---------------------------------------------------------------- 启动
  function renderSeedsForModel() {
    const seeds = MODELS[state.modelKey].seeds;
    $("seeds").innerHTML = seeds.map((s) => `<span class="chip">${s}</span>`).join("");
  }

  async function boot() {
    state.modelKey = $("modelPick").value;
    const showCards = async () => {
      let manifest = null;
      try { manifest = await mirrorFetchJson(state.modelKey + "/manifest.json"); } catch (e) {}
      try {
        const info = await mirrorFetchJson(state.modelKey + "/train_info.json");
        state.info = info;
        renderCards({ params: info.params }, manifest ? manifest.config : info.architecture);
      } catch (e) {
        $("cards").innerHTML = '<div class="card"><div class="k">状态</div><div class="v">权重未就绪</div></div>';
      }
    };
    showCards();

    try {
      const metrics = await mirrorFetchJson(state.modelKey + "/metrics.json");
      if (Array.isArray(metrics) && metrics.length > 1) {
        $("lossPanel").style.display = "block";
        const last = metrics[metrics.length - 1];
        $("lossDesc").textContent =
          `已训练 ${last.step} 步 / ${(last.tokens / 1e6).toFixed(1)}M tokens · 训练损失 ${last.loss} · 验证损失 ${last.val_loss}`;
        drawLoss(metrics);
        window.removeEventListener("resize", drawLoss);
        window.addEventListener("resize", () => drawLoss(metrics));
      }
    } catch (e) { /* 无指标文件则忽略 */ }

    renderSeedsForModel();
    $("seeds").addEventListener("click", (e) => {
      if (e.target.classList.contains("chip")) { $("input").value = e.target.textContent; respond(e.target.textContent); }
    });

    $("modelPick").addEventListener("change", () => {
      state.modelKey = $("modelPick").value;
      state.ready = false;
      $("startBtn").disabled = false;
      $("startBtn").textContent = "开始使用";
      $("chat").classList.remove("show");
      $("chatBadge").textContent = "未加载";
      $("htmlPanel").style.display = "none";
      showCards();
      renderSeedsForModel();
    });

    $("startBtn").addEventListener("click", () => {
      state.modelKey = $("modelPick").value;
      $("overlay").classList.add("show");
      $("startNote").textContent = "下载 " + MODELS[state.modelKey].label + " 的权重并初始化...";
      initialize().catch((err) => {
        $("bootNote").textContent = "初始化失败：" + err.message;
        $("bootNote").style.color = "#f87171";
      });
    });

    $("htmlOpenNew").addEventListener("click", () => {
      if (!lastHtmlCode) return;
      const blob = new Blob([lastHtmlCode], { type: "text/html" });
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank");
    });
    $("htmlReRun").addEventListener("click", () => { if (lastHtmlCode) runHtmlInIframe(lastHtmlCode); });

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