/* YJS — fully offline, in-browser chat (WebGPU / WASM via Transformers.js).
 *
 * The model runs inside this browser tab; the server never sees messages.
 * The engine (@huggingface/transformers) and model weights are fetched on
 * first use (engine from a CDN, weights from a configurable mirror, default
 * hf-mirror.com), then cached by the browser for true offline reuse. */
(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const on = (id, ev, fn) => { const el = $(id); if (el) el.addEventListener(ev, fn); };
  const esc = (s) => (s || "").replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  const ENGINE_URL = "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.0.2/+esm";
  const MODELS = [
    { id: "onnx-community/Qwen2.5-0.5B-Instruct", name: "Qwen2.5 · 0.5B", note: "轻量快速，低配机推荐", size: "约 400 MB" },
    { id: "onnx-community/Qwen2.5-1.5B-Instruct", name: "Qwen2.5 · 1.5B", note: "效果更好，需较多显存/内存", size: "约 1 GB" },
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
      html = "✓ 检测到 WebGPU，模型将以 GPU 加速运行。";
    } else {
      if (tag) { tag.textContent = "仅 CPU 模式"; tag.style.display = "inline-block"; }
      html = "⚠ 当前浏览器不支持 WebGPU（建议使用最新版 Chrome / Edge），将使用 CPU 运行，速度较慢。";
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
  async function ensureEngine() {
    if (engine) return engine;
    setProgress("正在加载本地推理引擎（首次需访问 CDN）…");
    try {
      engine = await import(ENGINE_URL);
    } catch (e) {
      throw new Error("推理引擎加载失败：" + (e?.message || e) +
        "。请确认网络可访问 cdn.jsdelivr.net（仅首次需要）。");
    }
    return engine;
  }

  function applyMirror(t) {
    const mirror = (($("local-mirror")?.value || "").trim() || "https://hf-mirror.com")
      .replace(/\/+$/, "");
    t.env.allowLocalModels = false;
    try { t.env.remoteHost = mirror; } catch (_) {}
    return mirror;
  }

  async function loadModel() {
    const btn = $("btn-local-load");
    const cancelBtn = $("btn-local-cancel");
    const modelId = selectedModelId();
    if (loadedId === modelId && pipe) {
      $("local-setup").classList.add("hidden");
      localMsg("sys", `模型 ${modelId} 已在运行中。`);
      return;
    }
    btn.disabled = true;
    if (cancelBtn) cancelBtn.classList.remove("hidden");
    cancelled = false;
    try {
      const t = await ensureEngine();
      const mirror = applyMirror(t);
      setProgress(`将从 ${mirror} 下载权重，开始初始化「${modelId}」…`);

      const progressCb = (p) => {
        if (cancelled) throw new Error("已取消");
        if (p.status === "progress" && p.file) {
          const pct = p.progress != null ? p.progress : null;
          const loaded = p.loaded ? (p.loaded / 1048576).toFixed(1) + " MB" : "";
          const total = p.total ? (p.total / 1048576).toFixed(1) + " MB" : "";
          setProgress(`下载 ${p.file.replace(/^.*[\\/]/, "")} ${loaded}${total ? " / " + total : ""}`, pct);
        } else if (p.status === "ready" || p.status === "done") {
          setProgress(p.status === "done" ? "权重就绪，正在编译模型（首次较慢）…" : "准备中…");
        }
      };

      let attempt;
      try {
        attempt = await t.pipeline("text-generation", modelId, {
          device: navigator.gpu ? "webgpu" : "wasm",
          dtype: "q4",
          progress_callback: progressCb,
        });
      } catch (gpuErr) {
        if (cancelled) throw gpuErr;
        setProgress("WebGPU 初始化失败，自动切换 CPU 模式重试…");
        attempt = await t.pipeline("text-generation", modelId, {
          device: "wasm", dtype: "q4", progress_callback: progressCb,
        });
      }

      pipe = attempt;
      loadedId = modelId;
      setProgress(null);
      const meta = MODELS.find((m) => m.id === modelId);
      setLabel(`${meta ? meta.name : modelId} · 本地运行`);
      $("local-setup").classList.add("hidden");
      localMsg("sys", `✓ 本地模型「${meta ? meta.name : modelId}」已就绪，可以开始离线对话。`);
      renderModelList(modelId);
      $("local-input")?.focus();
    } catch (e) {
      if (cancelled) setProgress("已取消下载。");
      else setProgress("✗ " + (e?.message || e));
    } finally {
      btn.disabled = false;
      if (cancelBtn) cancelBtn.classList.add("hidden");
      cancelled = false;
    }
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
    if (!$("local-mirror")?.value) $("local-mirror").value = "https://hf-mirror.com";
    $("local-setup").classList.remove("hidden");
  }

  function enter() {
    if (entered) return;
    entered = true;
    detectGpu();
    renderModelList(loadedId);
    if (!$("local-mirror")) return;
    $("local-mirror").value = localStorage.getItem("yjs_local_mirror") || "https://hf-mirror.com";
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
  on("local-mirror", "change", () => {
    const v = ($("local-mirror").value || "").trim();
    if (v) localStorage.setItem("yjs_local_mirror", v);
  });

  window.YJSLocal = { enter };
})();
