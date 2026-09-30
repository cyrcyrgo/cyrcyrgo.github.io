/** 页面逻辑：初始化模型（下载权重 + 构建计算图）并驱动对话生成 */
(function () {
  "use strict";

  // 多镜像下载链：path 形如 "dialog/manifest.json"、"html/weights.bin"
  const REPO = "cyrcyrgo/cyrcyrgo.github.io";
  const BRANCH = "main";
  const PREFIX_GH_RAW = "https://raw.githubusercontent.com/" + REPO + "/" + BRANCH + "/llm/web/model/";
  const PREFIX_GHPAGES = (location.protocol === "file:" ? "" : location.origin) +
    location.pathname.replace(/[^/]*$/, "") + "model/";
  const MIRRORS = [
    // gh-proxy 代理 raw 源（实测 25MB 权重 ~ 4.4s）
    (p) => "https://gh-proxy.com/https://" + PREFIX_GH_RAW + p,
    // jsDelivr（对小文件快，大文件 403）
    (p) => "https://cdn.jsdelivr.net/gh/" + REPO + "@" + BRANCH + "/llm/web/model/" + p,
    (p) => "https://fastly.jsdelivr.net/gh/" + REPO + "@" + BRANCH + "/llm/web/model/" + p,
    // GitHub 官方 raw
    (p) => PREFIX_GH_RAW + p,
    // GitHub Pages / 本地同源兜底
    (p) => PREFIX_GHPAGES + p,
  ];
  const state = {
    modelKey: "dialog",
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

  // ---- 模型配置：每套权重在 model/<key>/ 下 ----
  // build：把用户输入包装成训练时使用的 prompt 模板（务必与训练语料一致）
  // stop ：生成时遇到即截断的字符串
  // kind ： "text" 纯文本对话 / "code" 代码（渲染代码框，可一键运行）
  const T = "<|endoftext|>";
  const MODELS = {
    dialog: {
      label: "基础对话（中文）",
      kind: "text",
      seeds: ["你好，介绍一下你自己", "Python 是什么？", "帮我写一首春天的小诗", "1 公斤等于多少克？", "如何保持健康？"],
      build: (p) => "<|user|>" + p + "\n<|assistant|>",
      stop: ["<|user|>", T],
    },
    html: {
      label: "HTML 组件 / 小游戏",
      kind: "code",
      seeds: ["写一个会让按钮悬停发光的网页", "网页版的加一减一计数器", "做一个网页版计算器", "写一个打砖块小游戏", "网页上的颜色调色盘"],
      build: (p) => "<|user|>" + p + "\n<|assistant|>\n```html\n",
      stop: ["<|user|>", T],
    },
    greet: {
      label: "基础问候闲聊",
      kind: "text",
      seeds: ["你好", "你是谁", "讲个笑话", "我心情不好", "晚安"],
      build: (p) => "<|user|>" + p + "\n<|assistant|>",
      stop: ["<|user|>", T],
    },
    qa: {
      label: "中文知识问答",
      kind: "text",
      seeds: ["中国的首都是哪里？", "为什么天空是蓝色的？", "如何保持健康？", "什么是人工智能？", "1 公斤等于多少克？"],
      build: (p) => "<|user|>" + p + "\n<|assistant|>",
      stop: ["<|user|>", T],
    },
    enqa: {
      label: "English Q&A",
      kind: "text",
      seeds: ["Hello", "What is Python?", "How do you stay healthy?", "Why is the sky blue?", "Thank you"],
      build: (p) => "<|user|>" + p + "\n<|assistant|>",
      stop: ["<|user|>", T],
    },
    math: {
      label: "数学计算 / 应用题",
      kind: "text",
      seeds: ["计算：25 + 37 = ?", "计算：96 - 48 = ?", "小明有 12 个苹果，又买了 8 个，一共有多少个苹果？",
        "每盒有 12 支铅笔，一共 8 盒，共有多少支铅笔？", "把 48 个糖果平均分给 6 个小朋友，每人分到几个？"],
      build: (p) => "<|user|>" + p + "\n<|assistant|>",
      stop: ["<|user|>", T],
    },
    web: {
      label: "网页创作（HTML+CSS+JS）",
      kind: "code",
      seeds: ["写一个会让按钮悬停发光的网页", "做一个网页版四则运算计算器", "写一个能倒计时的网页",
        "写一个贪吃蛇小游戏", "网页画板，鼠标拖动画画，能换颜色和清空"],
      build: (p) => "<|user|>" + p + "\n<|assistant|>\n```html\n",
      stop: ["<|user|>", T],
    },
  };

  // ---- 多镜像下载辅助 ----
  // path 已经是相对 model/<key>/ 的（如 dialog/manifest.json），底层 MIRRORS 会拼接好完整远端地址
  async function mirrorFetch(path) {
    let lastErr = null;
    for (let i = 0; i < MIRRORS.length; i++) {
      const url = MIRRORS[i](path);
      try {
        const res = await fetch(url, { cache: path.includes("weights.bin") ? "force-cache" : "default" });
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

  // ---- 权重解码：manifest.dtype 为 "float16" 时把半精度还原为 Float32Array ----
  // 半精度 -> 单精度查表（65536 项），比逐元素位运算快得多
  let HALF_LUT = null;
  function halfToFloatTable() {
    if (HALF_LUT) return HALF_LUT;
    const lut = new Float32Array(65536);
    const f32 = new Float32Array(1);
    const u32 = new Uint32Array(f32.buffer);
    const TWO_POW_M24 = 5.960464477539063e-8; // 2^-24，用于次正规数
    for (let i = 0; i < 65536; i++) {
      const sign = (i & 0x8000) << 16;
      const exp = (i >> 10) & 0x1f;
      const mant = i & 0x3ff;
      if (exp === 0) {
        const v = mant * TWO_POW_M24; // 零 / 次正规数
        lut[i] = (i & 0x8000) ? -v : v;
        continue;
      }
      let bits;
      if (exp === 0x1f) bits = sign | 0x7f800000 | (mant << 13);       // inf / nan
      else bits = sign | ((exp - 15 + 127) << 23) | (mant << 13);      // 正规数
      u32[0] = bits >>> 0;
      lut[i] = f32[0];
    }
    HALF_LUT = lut;
    return lut;
  }

  function decodeWeights(buf, dtype) {
    if (dtype === "float16") {
      const u16 = new Uint16Array(buf.buffer, buf.byteOffset, buf.byteLength / 2);
      const out = new Float32Array(u16.length);
      const lut = halfToFloatTable();
      for (let i = 0; i < u16.length; i++) out[i] = lut[u16[i]];
      return out;
    }
    return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
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
      mirrorFetchJson(state.modelKey + "/vocab.json"),
      mirrorFetchText(state.modelKey + "/merges.txt"),
    ]);
    const mergesArr = merges.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
    state.tok = new window.BPETokenizer(vocab, mergesArr, {});
    state.eosId = vocab["<|endoftext|>"];
    setStep(stepsBox, 0, "done");

    setStep(stepsBox, 1, "active");
    const manifest = await mirrorFetchJson(state.modelKey + "/manifest.json");
    const buf = await mirrorFetchWithProgress(state.modelKey + "/weights.bin", (p) => {
      bar.style.width = (8 + p * 82).toFixed(1) + "%";
    });
    setStep(stepsBox, 1, "done");

    setStep(stepsBox, 2, "active");
    const all = decodeWeights(buf, manifest.dtype);
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
    const pstr = state.info ? state.info.params.toLocaleString() : state.cfg.hidden_size + "d";
    addMsg("sys", `模型加载完成：${pstr} 参数 · ${state.cfg.num_hidden_layers} 层 · 词表 ${state.cfg.vocab_size}。${MODELS[state.modelKey].kind === "code" ? "输入需求即可生成可运行的网页代码。" : "输入内容即可对话。"}`);
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

    const spec = MODELS[state.modelKey];
    const temperature = Number($("temp").value);
    const topK = Number($("topk").value);
    const topP = Number($("topp").value);
    const maxNew = Number($("maxn").value);
    const ctxLimit = state.cfg.max_position_embeddings;

    // 按训练时的模板包装输入（<|user|>…<|assistant|>），否则模型无法正确响应
    let ids = state.tok.encode(spec.build(prompt));
    if (ids.length > ctxLimit - 8) ids = ids.slice(-(ctxLimit - 8));

    state.model.reset();
    let logits = null;
    for (const id of ids) logits = state.model.forward(id);

    const outIds = [];
    const t0 = performance.now();
    let firstAt = 0;
    let text = "";
    for (let i = 0; i < maxNew; i++) {
      if (state.model.pos >= ctxLimit) break;
      const next = window.MiniLLMJS.sample(logits, temperature, topK, topP);
      outIds.push(next);
      if (i === 0) firstAt = performance.now();
      text = decodeSafe(outIds);
      bot.textContent = cutAtStop(text, spec.stop);
      $("msgs").scrollTop = $("msgs").scrollHeight;
      logits = state.model.forward(next);
      if (state.eosId !== undefined && next === state.eosId) break;
      if (cutAtStop(text, spec.stop) !== text) break;   // 命中停止串
      await new Promise((r) => setTimeout(r, 0));
    }
    bot.classList.remove("cursor");
    text = cutAtStop(text, spec.stop);

    const dt = ((performance.now() - (firstAt || t0)) / 1000).toFixed(2);
    const tps = outIds.length > 1 ? (outIds.length / Math.max(dt, 1e-3)).toFixed(1) : "-";
    $("chatBadge").textContent = `已就绪 · 本次生成 ${outIds.length} token · ${tps} tok/s`;

    // 渲染：代码类模型输出代码框（可一键运行），文本类模型直接显示
    const hasCode = renderAssistant(bot, text, spec);

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

  // ---------------------------------------------------------------- 输出渲染（文本 / 代码框一键运行）
  let lastHtmlCode = "";

  const FENCE = /```([a-zA-Z0-9+#._-]*)[ \t]*\r?\n([\s\S]*?)```/g;

  /** 按停止串截断生成结果 */
  function cutAtStop(text, stops) {
    let cut = text.length;
    for (const s of stops || []) {
      const i = text.indexOf(s);
      if (i >= 0 && i < cut) cut = i;
    }
    return text.slice(0, cut);
  }

  /** 拆出文本段与代码段；兼容未闭合的代码块（生成被截断） */
  function parseSegments(text) {
    const segs = [];
    let last = 0, m;
    FENCE.lastIndex = 0;
    while ((m = FENCE.exec(text)) !== null) {
      if (m.index > last) segs.push({ type: "text", text: text.slice(last, m.index) });
      segs.push({ type: "code", lang: (m[1] || "").toLowerCase(), code: m[2] });
      last = m.index + m[0].length;
    }
    const rest = text.slice(last).replace(/^[ \t]*```[a-zA-Z0-9+#._-]*[ \t]*\r?\n?/, "");
    if (/```/.test(text.slice(last))) {
      if (rest.trim()) segs.push({ type: "code", lang: guessLang(rest), code: rest });
      return segs;
    }
    if (segs.length === 0) {
      // 没有围栏：若是 HTML 片段则整体当代码
      if (/<!doctype|<html|<head|<body|<script|<style/i.test(text)) {
        return [{ type: "code", lang: "html", code: text }];
      }
      return [{ type: "text", text }];
    }
    if (rest) segs.push({ type: "text", text: rest });
    return segs;
  }

  function guessLang(code) {
    if (/<html|<body|<div|<style|<script/i.test(code)) return "html";
    if (/^\s*[.#@a-zA-Z].*\{[\s\S]*\}/m.test(code)) return "css";
    return "js";
  }

  /** 把代码段组装成可在 iframe 里直接运行的单文件 HTML */
  function buildDoc(lang, code) {
    const looksHtml = /<!doctype|<html|<head|<body|<style|<script|<div|<button|<canvas/i.test(code);
    if (lang === "html" || looksHtml) {
      return /<html|<!doctype/i.test(code)
        ? code
        : "<!doctype html><html lang=\"zh\"><head><meta charset=\"utf-8\">" +
          "<style>body{font-family:system-ui,sans-serif;margin:24px}</style></head><body>\n" + code + "\n</body></html>";
    }
    if (lang === "css" || /^\s*[.#@a-zA-Z][^{]*\{/m.test(code)) {
      return "<!doctype html><html lang=\"zh\"><head><meta charset=\"utf-8\"><style>\n" + code +
        "\n</style></head><body><div class=\"demo\">CSS 预览：请把样式写进页面使用</div><h1>Hello</h1><p>示例段落</p><button>示例按钮</button></body></html>";
    }
    return "<!doctype html><html lang=\"zh\"><head><meta charset=\"utf-8\"></head><body>\n<script>\n" + code + "\n</script>\n</body></html>";
  }

  function runHtmlInIframe(html) {
    lastHtmlCode = html;
    const frame = $("htmlFrame");
    frame.srcdoc = html;
    $("htmlPanel").style.display = "block";
    $("htmlPanel").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function openInNewTab(code) {
    const blob = new Blob([code], { type: "text/html" });
    window.open(URL.createObjectURL(blob), "_blank");
  }

  /** 渲染一条机器人消息；返回是否包含可运行代码 */
  function renderAssistant(el, text, spec) {
    const segs = parseSegments(text);
    const hasCode = segs.some((s) => s.type === "code");
    if (!hasCode) {
      el.textContent = text;
      $("htmlPanel").style.display = "none";
      return false;
    }
    el.textContent = "";
    let firstDoc = null;
    for (const s of segs) {
      if (s.type === "text") {
        if (s.text.trim()) {
          const d = document.createElement("div");
          d.className = "seg-text";
          d.textContent = s.text.replace(/^\s+|\s+$/g, "");
          el.appendChild(d);
        }
        continue;
      }
      const doc = buildDoc(s.lang, s.code);
      if (!firstDoc) firstDoc = doc;
      const box = document.createElement("div");
      box.className = "codebox";
      const head = document.createElement("div");
      head.className = "codehead";
      head.innerHTML = `<span class="lang">${s.lang || "code"}</span>`;
      const runBtn = document.createElement("button");
      runBtn.className = "btn ghost mini";
      runBtn.textContent = "▶ 运行";
      const newBtn = document.createElement("button");
      newBtn.className = "btn ghost mini";
      newBtn.textContent = "新标签页";
      runBtn.addEventListener("click", () => runHtmlInIframe(doc));
      newBtn.addEventListener("click", () => openInNewTab(doc));
      head.appendChild(runBtn);
      head.appendChild(newBtn);
      const pre = document.createElement("pre");
      const codeEl = document.createElement("code");
      codeEl.textContent = s.code.replace(/^\n+|\n+$/g, "");
      pre.appendChild(codeEl);
      box.appendChild(head);
      box.appendChild(pre);
      el.appendChild(box);
    }
    // 代码类模型自动预览第一段代码
    if (spec.kind === "code" && firstDoc) runHtmlInIframe(firstDoc);
    return true;
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
          `已训练 ${last.step} 步 / ${(last.tokens / 1e6).toFixed(1)}M tokens · 训练损失 ${last.loss}` +
          (last.val_loss != null ? ` · 验证损失 ${last.val_loss}` : "");
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