/* YJS — fully offline, in-browser chat (WebGPU / WASM via Transformers.js).
 *
 * The model runs inside this browser tab; the server never sees messages.
 *
 * Reliability design (国内网络环境):
 *  - the Transformers.js ENGINE is vendored under assets/vendor/ and loaded
 *    SAME-ORIGIN (GitHub Pages / local server), so no cdn.jsdelivr.net
 *    dependency can break startup;
 *  - the onnxruntime WASM binary is also vendored same-origin (wasmPaths);
 *  - model WEIGHTS do NOT go directly from the browser to huggingface /
 *    hf-mirror (that path is often blocked): they are relayed through the
 *    user's own API server (the ngrok tunnel on the deployed setup), which
 *    fetches hf-mirror.com -> huggingface.co server-side and caches the
 *    files once on local disk. The browser also keeps a Cache Storage copy,
 *    so later runs are fully offline.
 */
(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const on = (id, ev, fn) => { const el = $(id); if (el) el.addEventListener(ev, fn); };
  const esc = (s) => (s || "").replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  // The page may be served from a GitHub Pages sub-path (/cla/), so every
  // self-link is resolved against the folder containing this page.
  const APP_DIR = location.pathname.replace(/[^/]*$/, "");
  const VENDOR_BASE = APP_DIR + "assets/vendor/";
  const ENGINE_LOCAL = VENDOR_BASE + "transformers.min.js?v=3.0.2";
  const ENGINE_CDNS = [
    "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.0.2/dist/transformers.min.js",
    "https://unpkg.com/@huggingface/transformers@3.0.2/dist/transformers.min.js",
    "https://esm.sh/@huggingface/transformers@3.0.2",
  ];
  // Weight downloads are relayed by the API server (same resolution rules
  // as app.js: manual override -> config.json -> current origin).
  const WEIGHTS_PATH = "/api/local-weights/";

  const MODELS = [
    { id: "onnx-community/Qwen2.5-0.5B-Instruct", name: "Qwen2.5 · 0.5B",
      note: "轻量快速，低配机首选", size: "约 470 MB" },
    { id: "onnx-community/Qwen2.5-1.5B-Instruct", name: "Qwen2.5 · 1.5B",
      note: "效果更好，需更多内存与耐心", size: "约 1.0 GB" },
  ];

  let engine = null;           // imported transformers module
  let pipe = null;             // ready generation pipeline
  let loadedId = null;
  let history = [];            // in-memory only
  let busy = false;
  let cancelled = false;
  let entered = false;

  /* --------------------------------------------------------------- UI -- */
  function localMsg(role, text) {
    const box = $("local-messages");
    if (!box) return;
    const empty = box.querySelector(".empty"); if (empty) empty.remove();
    const div = document.createElement("div");
    div.className = "bubble " + role + (role === "sys" ? " step" : "");
    if (role === "sys") div.textContent = text;
    else div.innerHTML = `<div class="who">${role === "user" ? "你" : "本地模型"}</div><span class="txt"></span>`;
    const t = div.querySelector(".txt"); if (t) t.textContent = text || "";
    box.appendChild(div);
    box.scrollTop = box.scrollHeight;
    return div;
  }

  function setLabel(text) { const el = $("local-model-label"); if (el) el.textContent = text; }
  function setProgress(text, pct) {
    const el = $("local-progress"); if (!el) return;
    if (text == null) { el.innerHTML = ""; return; }
    const p = typeof pct === "number" ? Math.max(0, Math.min(100, pct)) : null;
    el.innerHTML = `<div class="lp-text">${esc(text)}</div>` +
      (p != null ? `<div class="lp-bar"><i style="width:${p}%"></i></div>` : "");
  }

  function detectGpu() {
    const tag = $("local-gpu"), note = $("local-gpu-note");
    let html = "";
    if (navigator.gpu) {
      if (tag) { tag.textContent = "WebGPU 可用"; tag.style.display = "inline-block"; }
      html = "✓ 检测到 WebGPU，模型将以 GPU 加速运行（失败会自动切换 CPU）。";
    } else {
      if (tag) { tag.textContent = "仅 CPU 模式"; tag.style.display = "inline-block"; }
      html = "⚠ 当前浏览器不支持 WebGPU（建议最新版 Chrome / Edge），将使用 CPU 运行，速度较慢。";
    }
    if (note) note.textContent = html;
  }

  function renderModelList(selectId) {
    const box = $("local-models");
    if (!box) return;
    box.innerHTML = "";
    MODELS.forEach((m) => {
      const row = document.createElement("label");
      row.className = "local-model" + (loadedId === m.id ? " loaded" : "");
      row.innerHTML =
        `<input type="radio" name="local-model" value="${esc(m.id)}" ${loadedId === m.id ? "checked" : ""}/>` +
        `<div class="lm-info"><div class="lm-name">${esc(m.name)} ${loadedId === m.id ? "<span class=\"lm-ok\">✓ 已加载</span>" : ""}</div>` +
        `<div class="lm-note">${esc(m.note)} · ${esc(m.size)}</div></div>`;
      box.appendChild(row);
    });
    if (selectId) {
      const r = box.querySelector(`input[value="${CSS.escape(selectId)}"]`);
      if (r) r.checked = true;
    }
  }

  function selectedModelId() {
    const r = document.querySelector('input[name="local-model"]:checked');
    return r ? r.value : MODELS[0].id;
  }

  /* ------------------------------------------------------------- engine */
  async function resolveApi() {
    const override = localStorage.getItem("yjs_api_override");
    if (override) return override.replace(/\/+$/, "");
    try {
      const r = await fetch(APP_DIR + "config.json?t=" + Date.now(), { cache: "no-store" });
      if (r.ok) {
        const c = await r.json();
        if (c.api_url) return String(c.api_url).replace(/\/+$/, "");
      }
    } catch (_) { /* fall through */ }
    return location.origin;
  }

  // Requests to the tunnel must carry the ngrok free-tier bypass header,
  // otherwise users get the ngrok warning page instead of the binary.
  // transformers.js has no per-request header hook, so patch global fetch
  // narrowly for the weights proxy only.
  function installFetchPatch(apiOrigin) {
    const prefix = apiOrigin + WEIGHTS_PATH;
    const prev = window.fetch;
    if (prev.__yjsPatched) return;
    const wrapped = function (input, init) {
      try {
        const url = typeof input === "string" ? input : (input && input.url) || "";
        if (url.indexOf(prefix) === 0) {
          init = Object.assign({}, init || {});
          const h = new Headers(init.headers ||
            (typeof input !== "string" && input ? input.headers : undefined));
          h.set("ngrok-skip-browser-warning", "true");
          init.headers = h;
        }
      } catch (_) { /* never break fetch because of the patch */ }
      return prev.call(window, input, init);
    };
    wrapped.__yjsPatched = true;
    window.fetch = wrapped;
  }

  async function importWithTimeout(url, ms) {
    return Promise.race([
      import(/* @vite-ignore */ url),
      new Promise((_, rej) => setTimeout(() => rej(new Error("加载超时")), ms)),
    ]);
  }

  function configureEngine(t, apiBase) {
    t.env.allowLocalModels = false;
    // Same-origin vendored WASM binary — never fetched from a CDN.
    t.env.backends = t.env.backends || {};
    t.env.backends.onnx = t.env.backends.onnx || {};
    t.env.backends.onnx.wasm = t.env.backends.onnx.wasm || {};
    t.env.backends.onnx.wasm.wasmPaths = VENDOR_BASE;
    // Route every model file (tokenizer/config/weights) via our own server.
    t.env.remoteHost = apiBase + WEIGHTS_PATH.replace(/\/$/, "");
    t.env.remotePathTemplate = "{model}/resolve/{revision}/";
    return t;
  }

  async function ensureEngine(apiBase) {
    if (engine) return engine;
    const errors = [];

    // 1) same-origin vendored engine (the normal path)
    setProgress("正在加载本地推理引擎…");
    try {
      engine = configureEngine(await importWithTimeout(ENGINE_LOCAL, 30000), apiBase);
      return engine;
    } catch (e) { errors.push("本地引擎：" + (e?.message || e)); }

    // 2) CDN fallbacks (only if the vendored file is somehow missing)
    for (const url of ENGINE_CDNS) {
      setProgress("本地引擎缺失，尝试备用源 " + url.replace(/^https?:\/\//, "").split("/")[0] + " …");
      try {
        engine = configureEngine(await importWithTimeout(url, 30000), apiBase);
        return engine;
      } catch (e) { errors.push(url.split("/")[2] + "：" + (e?.message || e)); }
    }
    throw new Error("推理引擎加载失败。\n" + errors.join("\n"));
  }

  /* Aggregate progress across the (tokenizer + multiple weight) files. */
  function makeProgressTracker() {
    const seen = new Map();   // file -> {loaded, total}
    return function (p) {
      if (cancelled) throw new Error("__CANCELLED__");
      if (p.status === "progress" && p.file) {
        seen.set(p.file, { loaded: p.loaded || 0, total: p.total || 0 });
        let loaded = 0, total = 0, knownFiles = 0, active = "";
        for (const [f, v] of seen) {
          loaded += v.loaded; total += v.total;
          if (v.total && v.loaded < v.total) { active = f; knownFiles++; }
        }
        const mb = (n) => (n / 1048576).toFixed(1) + " MB";
        const pct = total ? (loaded / total) * 100 : null;
        const tail = active ? `（正在下载 ${active.replace(/^.*[\\/]/, "")}）` : "";
        setProgress(`下载权重 ${mb(loaded)}${total ? " / " + mb(total) : ""} ${tail}`, pct);
      } else if (p.status === "ready" || p.status === "done") {
        setProgress(p.status === "done" ? "权重就绪，正在编译模型（首次较慢）…" : "准备中…");
      }
    };
  }

  async function loadModel() {
    const btn = $("btn-local-load");
    const cancelBtn = $("btn-local-cancel");
    const modelId = selectedModelId();
    if (loadedId === modelId && pipe) {
      $("local-setup").classList.add("hidden");
      return;
    }
    btn.disabled = true;
    if (cancelBtn) cancelBtn.classList.remove("hidden");
    cancelled = false;

    try {
      setProgress("正在连接本机服务器…");
      const apiBase = await resolveApi();
      let apiOrigin = apiBase;
      try { apiOrigin = new URL(apiBase, location.href).origin; } catch (_) {}
      installFetchPatch(apiOrigin);
      // quick health probe so users get a clear error instead of a stalled
      // download when the tunnel/server is offline
      try {
        const h = await fetch(apiBase + "/api/health?t=" + Date.now(), {
          cache: "no-store", headers: { "ngrok-skip-browser-warning": "true" },
        });
        if (!h.ok) throw new Error("HTTP " + h.status);
      } catch (e) {
        throw new Error("无法连接本机服务器（" + apiBase.replace(/^https?:\/\//, "") +
          "），首次下载权重需要服务器在线。请先启动服务并重试。");
      }

      const t = await ensureEngine(apiBase);
      const tracker = makeProgressTracker();
      const hasGpu = !!navigator.gpu;
      // (device, dtype) combos to attempt, best-first. q4f16 is the GPU
      // storage format; plain q4 is the portable WASM quantization.
      const attempts = hasGpu
        ? [{ device: "webgpu", dtype: "q4f16" }, { device: "webgpu", dtype: "q4" },
           { device: "wasm", dtype: "q4" }]
        : [{ device: "wasm", dtype: "q4" }];

      let lastErr = null;
      for (const a of attempts) {
        if (cancelled) throw new Error("__CANCELLED__");
        setProgress(`经本机服务器中转下载，以 ${a.device.toUpperCase()} 模式初始化…`);
        try {
          const p = await t.pipeline("text-generation", modelId, {
            device: a.device, dtype: a.dtype, progress_callback: tracker,
          });
          pipe = p;
          break;
        } catch (e) {
          if (cancelled || String(e?.message) === "__CANCELLED__") throw new Error("__CANCELLED__");
          lastErr = e;
          const msg = String(e?.message || e);
          // Device/dtype mismatch -> try the next combo; relay/server errors
          // are fatal (no other download path exists).
          if (is_networkish(msg)) throw e;
          if (/gpu|dtype|quantiz|webgpu|unsupported/i.test(msg)) continue;
          continue;
        }
      }
      if (!pipe) throw lastErr || new Error("模型加载失败");

      loadedId = modelId;
      setProgress(null);
      const meta = MODELS.find((m) => m.id === modelId);
      setLabel(`${meta ? meta.name : modelId} · 本地运行`);
      $("local-setup").classList.add("hidden");
      localMsg("sys", `✓ 本地模型「${meta ? meta.name : modelId}」已就绪，可离线对话。`);
      renderModelList(modelId);
      $("local-input")?.focus();
    } catch (e) {
      if (cancelled || String(e?.message) === "__CANCELLED__") {
        setProgress("已取消下载（已下载部分会保留在浏览器缓存中，下次继续）。");
      } else {
        const msg = String(e?.message || e);
        setProgress("✗ 模型加载失败：" + msg +
          "\n请确认本机服务器与内网穿透已启动（页面左下角显示的服务器地址可连），然后重试。");
      }
    } finally {
      btn.disabled = false;
      if (cancelBtn) cancelBtn.classList.add("hidden");
      cancelled = false;
    }
  }
  // small helper kept outside to avoid redefining per attempt
  function is_networkish(m) {
    return /fetch|network|load failed|timeout|404|cors|failed to fetch|abort|getaddrinfo|enotfound/i.test(m);
  }

  /* -------------------------------------------------------------- chat -- */
  async function sendLocal() {
    const inp = $("local-input");
    const text = (inp?.value || "").trim();
    if (!text || busy) return;
    if (!pipe) {
      localMsg("sys", "请先点击右上角「模型」下载并启动一个本地模型。");
      openSetup();
      return;
    }
    busy = true;
    const sendBtn = $("btn-local-send");
    sendBtn.disabled = true;
    inp.value = "";
    localMsg("user", text);
    history.push({ role: "user", content: text });
    const bubble = localMsg("assistant", "");
    const txt = bubble.querySelector(".txt");

    let output = "";
    try {
      const prompt = pipe.tokenizer.apply_chat_template(history, {
        tokenize: false, add_generation_prompt: true,
      });
      const throttled = { last: 0 };
      const r = await pipe(prompt, {
        max_new_tokens: 512,
        temperature: 0.6,
        top_p: 0.9,
        do_sample: true,
        return_full_text: false,
        callback_function: (beams) => {
          const ids = beams[0]?.output_token_ids;
          if (!ids) return;
          output = pipe.tokenizer.decode(ids, { skip_special_tokens: true });
          const now = Date.now();
          if (now - throttled.last > 80) { throttled.last = now; txt.textContent = output; }
        },
      });
      output = (r?.[0]?.generated_text ?? output).trim();
      txt.textContent = output;
      history.push({ role: "assistant", content: output });
    } catch (e) {
      txt.textContent = "⚠ 生成失败：" + (e?.message || e);
      history.pop();
    } finally {
      $("local-messages").scrollTop = $("local-messages").scrollHeight;
      busy = false; sendBtn.disabled = false; inp?.focus();
    }
  }

  function openSetup() {
    renderModelList(loadedId);
    $("local-setup").classList.remove("hidden");
  }

  function enter() {
    if (entered) return;
    entered = true;
    detectGpu();
    renderModelList(loadedId);
    if (!pipe) setTimeout(openSetup, 250);
  }

  on("btn-local-model", "click", openSetup);
  on("btn-local-close-setup", "click", () => $("local-setup").classList.add("hidden"));
  on("btn-local-load", "click", loadModel);
  on("btn-local-cancel", "click", () => { cancelled = true; });
  on("btn-local-send", "click", sendLocal);
  on("local-input", "keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendLocal(); }
  });
  on("btn-local-clear", "click", () => {
    if (busy) return;
    history = [];
    const box = $("local-messages");
    if (box) box.innerHTML = `<div class="empty">对话已清空，所有记录仅保存在本页内存中。</div>`;
  });
  window.YJSLocal = { enter };
})();
