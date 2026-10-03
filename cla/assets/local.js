/* YJS — fully offline, in-browser chat (WebGPU / WASM via Transformers.js).
 *
 * The model runs inside this browser tab; the server never sees messages.
 *
 * Reliability design (国内网络环境):
 *  - the Transformers.js ENGINE is vendored under assets/vendor/ and loaded
 *    SAME-ORIGIN (GitHub Pages / local server), so no cdn.jsdelivr.net
 *    dependency can break startup;
 *  - the onnxruntime WASM binary is also vendored same-origin (wasmPaths);
 *  - the page shell + engine + wasm are cached by a Service Worker, so the
 *    local-mode UI opens with NO internet at all after the first visit;
 *  - model WEIGHTS are downloaded by the BROWSER directly from the fastest
 *    reachable mirror (ModelScope -> hf-mirror -> huggingface.co) and stored
 *    in the browser Cache Storage (transformers.js is cache-first: once a
 *    file is cached it is never refetched). The user's own API server relay
 *    is only an optional last resort and is NEVER required.
 * Result: after the first successful download, the model loads and chats
 * fully offline — zero requests to any server.
 */
(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const on = (id, ev, fn) => { const el = $(id); if (el) el.addEventListener(ev, fn); };
  const esc = (s) => (s || "").replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const mb = (n) => (n / 1048576).toFixed(1) + " MB";

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
  // Direct browser->mirror download sources (fastest first). After the first
  // successful download the files live in the browser Cache Storage keyed by
  // URL, so the same source later loads with zero network. ModelScope hosts
  // an HF-compatible /models/{repo}/resolve/main/ layout with permissive CORS.
  const WEIGHTS_PATH = "/api/local-weights/";
  const DIRECT_SOURCES = [
    { name: "ModelScope 魔搭（国内直连，最快）", host: "https://modelscope.cn/models" },
    { name: "hf-mirror 国内镜像", host: "https://hf-mirror.com" },
    { name: "Hugging Face 官方", host: "https://huggingface.co" },
  ];

  // Model weights published as GitHub Release assets (flat names). The
  // browser pulls them through GitHub accelerator mirrors and stores them
  // in transformers' cache under the canonical ModelScope URLs, so model
  // loads are fully offline afterwards and the API server is never touched.
  const GH_REPO = "cyrcyrgo/cyrcyrgo.github.io";
  const GH_MIRRORS = [
    "https://gh-proxy.com/",
    "https://ghfast.top/",
    "https://ghproxy.net/",
    "https://mirror.ghproxy.com/",
    "https://gh.llkk.cc/",
  ];
  // modelId -> release tag. Only models listed here get the GitHub route.
  const GH_RELEASES = {
    "onnx-community/Qwen2.5-0.5B-Instruct": { tag: "weights-qwen2.5-0.5b-v1" },
  };
  const HUB_SMALL_FILES = [
    "config.json", "generation_config.json", "tokenizer.json",
    "tokenizer_config.json", "special_tokens_map.json", "vocab.json", "merges.txt",
  ];
  const HUB_CACHE = "transformers-cache";

  const MODELS = [
    { id: "onnx-community/Qwen2.5-0.5B-Instruct", name: "Qwen2.5 · 0.5B",
      note: "轻量快速，低配机首选", size: "约 470 MB" },
    { id: "onnx-community/Qwen2.5-1.5B-Instruct", name: "Qwen2.5 · 1.5B",
      note: "效果更好，需更多内存与耐心", size: "约 1.1 GB" },
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

  function configureEngine(t) {
    t.env.allowLocalModels = false;
    // Persist every fetched model file in the browser Cache Storage; the
    // hub loader matches the cache BEFORE touching the network, which is
    // what makes later loads work with the machine fully offline.
    t.env.useBrowserCache = true;
    t.env.useFSCache = false;
    // Same-origin vendored WASM binary — never fetched from a CDN.
    t.env.backends = t.env.backends || {};
    t.env.backends.onnx = t.env.backends.onnx || {};
    t.env.backends.onnx.wasm = t.env.backends.onnx.wasm || {};
    t.env.backends.onnx.wasm.wasmPaths = VENDOR_BASE;
    return t;
  }

  // Point the hub loader at one download source. All three direct mirrors
  // speak the HF layout {model}/resolve/{revision}/file (ModelScope included).
  function useSource(t, host) {
    t.env.remoteHost = host;
    t.env.remotePathTemplate = "{model}/resolve/{revision}/";
  }

  async function ensureEngine() {
    if (engine) return engine;
    const errors = [];

    // 1) same-origin vendored engine (the normal path)
    setProgress("正在加载本地推理引擎…");
    try {
      engine = configureEngine(await importWithTimeout(ENGINE_LOCAL, 30000));
      return engine;
    } catch (e) { errors.push("本地引擎：" + (e?.message || e)); }

    // 2) CDN fallbacks (only if the vendored file is somehow missing)
    for (const url of ENGINE_CDNS) {
      setProgress("本地引擎缺失，尝试备用源 " + url.replace(/^https?:\/\//, "").split("/")[0] + " …");
      try {
        engine = configureEngine(await importWithTimeout(url, 30000));
        return engine;
      } catch (e) { errors.push(url.split("/")[2] + "：" + (e?.message || e)); }
    }
    throw new Error("推理引擎加载失败。\n" + errors.join("\n"));
  }

  // Pull release assets through GitHub accelerator mirrors and inject them
  // into transformers' Cache Storage under the canonical hub URLs. Once all
  // needed files are cached (possibly from a previous run), model loading
  // makes ZERO network requests — fully offline, no server involved.
  // Returns true when every required file is available in the cache.
  async function preSeedFromGithub(modelId, dtype) {
    const spec = GH_RELEASES[modelId];
    if (!spec || typeof caches === "undefined") return false;
    const cache = await caches.open(HUB_CACHE);
    const hubBase = DIRECT_SOURCES[0].host + "/" + modelId + "/resolve/main/";
    const weightAsset = "model_" + dtype + ".onnx";
    const want = HUB_SMALL_FILES.map((f) => ({ key: hubBase + f, asset: f }));
    want.push({ key: hubBase + "onnx/" + weightAsset, asset: weightAsset });

    const missing = [];
    for (const f of want) {
      if (cancelled) throw new Error("__CANCELLED__");
      let hit = null;
      try { hit = await cache.match(f.key); } catch (_) { hit = null; }
      if (!hit) missing.push(f);
    }
    if (!missing.length) return true;                    // fully cached -> offline
    if (navigator.onLine === false) return false;

    const ghBase = "https://github.com/" + GH_REPO +
      "/releases/download/" + spec.tag + "/";
    let doneBytes = 0;
    for (const f of missing) {
      if (cancelled) throw new Error("__CANCELLED__");
      let saved = false;
      for (const prefix of GH_MIRRORS) {
        let ctrl = null;
        try {
          ctrl = new AbortController();
          setProgress("通过 GitHub 加速站连接 " + prefix.replace(/^https?:\/\//, "").replace(/\/$/, "") +
            " …");
          const resp = await fetch(prefix + ghBase + f.asset, {
            signal: ctrl.signal, cache: "no-store",
          });
          if (!resp.ok) throw new Error("HTTP " + resp.status);

          // Count progress while collecting chunks; a Blob is disk-backed in
          // Chromium so the 460 MB weight doesn't blow up JS heap.
          const chunks = [];
          let got = 0, lastUi = 0;
          const total = Number(resp.headers.get("content-length")) || 0;
          if (resp.body && resp.body.getReader) {
            const reader = resp.body.getReader();
            for (;;) {
              if (cancelled) { ctrl.abort(); throw new Error("__CANCELLED__"); }
              const { done, value } = await reader.read();
              if (done) break;
              chunks.push(value);
              got += value.length;
              const now = Date.now();
              if (now - lastUi > 250) {
                lastUi = now;
                const loaded = doneBytes + got;
                setProgress(
                  `GitHub 加速下载 ${mb(loaded)}${total ? " / " + mb(total + doneBytes) : ""}` +
                  `（${f.asset}）`,
                  total ? (loaded / (total + doneBytes)) * 100 : null,
                );
              }
            }
          } else {
            chunks.push(new Uint8Array(await resp.arrayBuffer()));
            got = chunks[0].byteLength;
          }
          const stored = new Response(new Blob(chunks, {
            type: resp.headers.get("content-type") || "application/octet-stream",
          }), {
            headers: {
              "Content-Type": resp.headers.get("content-type") || "application/octet-stream",
              ...(total ? { "Content-Length": String(total) } : {}),
            },
          });
          await cache.put(f.key, stored);
          doneBytes += total || got;
          saved = true;
          break;
        } catch (e) {
          if (String(e?.message) === "__CANCELLED__") throw e;
          if (ctrl) { try { ctrl.abort(); } catch (_) {} }
          // try the next accelerator mirror
        }
      }
      if (!saved) return false;
    }
    return true;
  }

  // The API-server relay is OPTIONAL: probe it quickly (3 s) and only offer
  // it as a last resort when the browser itself cannot reach any mirror.
  // Being offline / no tunnel / no server must never block local mode.
  async function probeRelaySource() {
    try {
      let apiBase = localStorage.getItem("yjs_api_override");
      if (!apiBase) {
        const r = await fetch(APP_DIR + "config.json?t=" + Date.now(), { cache: "no-store" });
        if (r.ok) {
          const c = await r.json();
          if (c.api_url) apiBase = String(c.api_url);
        }
      }
      if (!apiBase) return null;
      apiBase = apiBase.replace(/\/+$/, "");
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 3000);
      try {
        const h = await fetch(apiBase + "/api/health?t=" + Date.now(), {
          cache: "no-store", signal: ctrl.signal,
          headers: { "ngrok-skip-browser-warning": "true" },
        });
        if (!h.ok) return null;
      } finally { clearTimeout(timer); }
      installFetchPatch(new URL(apiBase, location.href).origin);
      return { name: "本机服务器中转（直连镜像均失败时兜底）",
               host: apiBase + WEIGHTS_PATH.replace(/\/$/, "") };
    } catch (_) {
      return null;
    }
  }

  // Trivial factual probe: a healthy model must continue "中国的首都是"
  // with "北京". Catches backends that produce silently corrupted tokens.
  async function sanityCheck(p) {
    try {
      const r = await p("中国的首都是", {
        max_new_tokens: 3, do_sample: false, return_full_text: false,
      });
      const s = String(r?.[0]?.generated_text ?? "");
      if (!s.includes("北京")) console.warn("[yjs-sanity] unexpected output:", JSON.stringify(s));
      return s.includes("北京");
    } catch (e) {
      console.warn("[yjs-sanity] probe threw:", e);
      return false;
    }
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
      const t = await ensureEngine();
      const tracker = makeProgressTracker();
      const hasGpu = !!navigator.gpu;
      // (device, dtype) combos to attempt, best-first. q4f16 is the ONLY
      // correct WebGPU storage format; plain q4 is the WASM-only fallback
      // (running q4 on WebGPU produces garbage output, so never combine).
      const forceWasm = /[?&]wasm=1\b/.test(location.search);
      const attempts = (!forceWasm && hasGpu)
        ? [{ device: "webgpu", dtype: "q4f16" }, { device: "wasm", dtype: "q4" }]
        : [{ device: "wasm", dtype: "q4" }];

      let lastErr = null;
      outer:
      for (const a of attempts) {
        if (cancelled) throw new Error("__CANCELLED__");

        // Build a pipeline then verify it actually reasons: ask a trivial
        // question and require the expected token. WebGPU devices can
        // occasionally return corrupted outputs (garbage) without throwing,
        // so an exception-only check is insufficient. A failed check is
        // treated like a broken backend -> retry once, then next combo.
        const tryPipe = async (label) => {
          setProgress(label);
          const p = await t.pipeline("text-generation", modelId, {
            device: a.device, dtype: a.dtype, progress_callback: tracker,
          });
          setProgress("正在自检模型输出…");
          if (await sanityCheck(p)) return p;
          try { await p.destroy?.(); } catch (_) {}
          throw new Error("webgpu backend sanity check failed (corrupt output)");
        };

        // Route 1 — GitHub Release assets via accelerator mirrors. Files are
        // injected into the browser cache, so the pipeline loads them with
        // zero network (works fully offline after the first download).
        if (GH_RELEASES[modelId]) {
          const seeded = await preSeedFromGithub(modelId, a.dtype);
          if (seeded) {
            // Cached keys are the canonical ModelScope URLs.
            useSource(t, DIRECT_SOURCES[0].host);
            // Files are cached, so retries cost no traffic.
            for (const attemptNo of [1, 2]) {
              if (cancelled) throw new Error("__CANCELLED__");
              try {
                pipe = await tryPipe(
                  `从本机缓存加载模型，以 ${a.device.toUpperCase()} 模式初始化…`);
                break outer;
              } catch (e) {
                if (cancelled || String(e?.message) === "__CANCELLED__") throw new Error("__CANCELLED__");
                console.error("[yjs-load] cached route failed:", a.device, a.dtype, "attempt", attemptNo, e);
                lastErr = e;
                if (attemptNo === 2) break;
                setProgress("模型自检未通过，正在重新初始化…");
                await new Promise((r) => setTimeout(r, 800));
              }
            }
            continue;   // this device/dtype is unusable -> next combo
          }
        }

        // Route 2 — direct HF-compatible mirrors (ModelScope first; fast).
        for (const src of DIRECT_SOURCES) {
          if (cancelled) throw new Error("__CANCELLED__");
          useSource(t, src.host);
          try {
            pipe = await tryPipe(
              `从 ${src.name} 获取模型，以 ${a.device.toUpperCase()} 模式初始化…`);
            break outer;
          } catch (e) {
            if (cancelled || String(e?.message) === "__CANCELLED__") throw new Error("__CANCELLED__");
            lastErr = e;
            const msg = String(e?.message || e);
            if (is_networkish(msg)) break;                  // next source
            if (/gpu|dtype|quantiz|webgpu|unsupported|execution provider|backend|sanity/i.test(msg)) continue outer;
            break;
          }
        }
      }

      // All direct mirrors failed/blocked: only now probe the OPTIONAL
      // local-server relay (this is why no server is needed in normal use).
      // Also attempted offline, since a localhost server still works without
      // internet when weights were cached server-side on an earlier run.
      if (!pipe && !cancelled) {
        setProgress("直连镜像均不可达，尝试本机服务器中转…");
        const relay = await probeRelaySource();
        if (relay) {
          useSource(t, relay.host);
          for (const a of attempts) {
            if (cancelled) throw new Error("__CANCELLED__");
            try {
              const p = await t.pipeline("text-generation", modelId, {
                device: a.device, dtype: a.dtype, progress_callback: tracker,
              });
              if (!(await sanityCheck(p))) {
                try { await p.destroy?.(); } catch (_) {}
                throw new Error("backend sanity check failed");
              }
              pipe = p;
              break;
            } catch (e) {
              if (cancelled || String(e?.message) === "__CANCELLED__") throw new Error("__CANCELLED__");
              lastErr = e;
              if (is_networkish(String(e?.message || e))) break;
            }
          }
        }
      }

      if (!pipe) {
        if (navigator.onLine === false) {
          throw new Error("当前处于离线状态，且本机尚未缓存该模型。" +
            "请先联网完成一次下载，之后即可永久离线使用。");
        }
        throw lastErr || new Error("所有下载线路均失败");
      }

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
          "\n可切换网络（如手机热点）后重试；下载成功一次后即可永久离线使用。");
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
        repetition_penalty: 1.15,
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
    // Enable the offline app shell (page + engine + wasm cached by the SW).
    if ("serviceWorker" in navigator) {
      const reg = () => navigator.serviceWorker.register(APP_DIR + "sw.js").catch(() => {});
      if (document.readyState === "complete") reg();
      else window.addEventListener("load", reg);
    }
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
