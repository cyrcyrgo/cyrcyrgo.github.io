/* 界面交互：元素引用、嘲讽气泡、对局历史、设置弹窗、结果弹窗 */
(function () {
  'use strict';

  const $ = (sel) => document.querySelector(sel);
  let els = {};

  function init() {
    Object.assign(els, {
      boardCanvas: $('#board'),
      turnChip: $('#turn-chip'),
      evalBox: $('#eval-box'),
      aiBubble: $('#ai-bubble'),
      aiName: $('#ai-name'),
      history: $('#history'),
      statusChip: $('#status'),
      // 设置
      cfgModal: $('#modal-config'),
      cfgKey: $('#cfg-key'),
      cfgUrl: $('#cfg-url'),
      cfgModel: $('#cfg-model'),
      cfgThinking: $('#cfg-thinking'),
      cfgJsonMode: $('#cfg-jsonmode'),
      cfgShow: $('#cfg-show'),
      cfgSave: $('#cfg-save'),
      cfgCancel: $('#cfg-cancel'),
      presetDeepSeek: $('#preset-deepseek'),
      presetOpenAI: $('#preset-openai'),
      // 结果
      resModal: $('#modal-result'),
      resTitle: $('#result-title'),
      resText: $('#result-text'),
      resAgain: $('#res-again'),
      resBack: $('#res-back'),
      // 控制
      btnRestart: $('#btn-restart'),
      btnResign: $('#btn-resign'),
      btnConfig: $('#btn-config'),
      btnConfigg: $('#btn-configg'),
      btnBack: $('#btn-back'),
      screenHome: $('#screen-home'),
      screenGame: $('#screen-game'),
      chooseRed: $('#choose-red'),
      chooseBlack: $('#choose-black'),
    });
    bindEvents();
  }

  function bindEvents() {
    els.cfgShow && els.cfgShow.addEventListener('change', () => {
      els.cfgKey.type = els.cfgShow.checked ? 'text' : 'password';
    });
  }

  /* ---------- 嘲讽气泡（打字机效果） ---------- */
  function showTaunt(text, opts) {
    const bubble = els.aiBubble;
    if (!bubble) return;
    const emphasis = opts && (opts.check || opts.capture);
    bubble.classList.toggle('emphasis', !!emphasis);
    bubble.classList.remove('hidden');
    bubble.innerHTML = '';
    if (!text) { bubble.innerHTML = '哼。'; return; }
    typewriter(bubble, text, 30);
  }

  function typewriter(el, text, speed) {
    let i = 0;
    el.textContent = '';
    const step = () => {
      if (i <= text.length) {
        el.textContent = text.slice(0, i);
        i++;
        setTimeout(step, speed);
      }
    };
    step();
  }

  function hideTaunt() {
    els.aiBubble && els.aiBubble.classList.add('hidden');
  }

  function setStatus(text, { tone } = {}) {
    els.statusChip.textContent = text;
    els.statusChip.className = 'status ' + (tone || '');
  }

  function setTurn(text) {
    els.turnChip.textContent = text;
  }

  function setEval(text) {
    els.evalBox.textContent = text || '';
  }

  function AIThinking(show) {
    els.aiName && (els.aiName.textContent = show ? 'AI 思考中…' : 'AI 大师');
  }

  /* ---------- 对局历史（按回合成对展示：红在前，黑在后） ---------- */
  function renderHistory(records) {
    els.history.innerHTML = '';
    if (!records.length) {
      els.history.innerHTML = '<div class="h-empty">尚无走法，请走出你的第一步。</div>';
      return;
    }
    const rows = document.createElement('div');
    rows.className = 'hrows';
    for (let i = 0; i < records.length; i += 2) {
      const r = records[i], b = records[i + 1];
      const row = document.createElement('div');
      row.className = 'hrow';
      const redText = r && r.color === 'red' ? esc(r.text) : (b && b.color === 'red' ? esc(b.text) : '—');
      const blackText = b && b.color === 'black' ? esc(b.text) : (r && r.color === 'black' ? esc(r.text) : '—');
      row.innerHTML =
        '<span class="hnum">' + (i / 2 + 1) + '</span>' +
        '<span class="hmove red">' + redText + '</span>' +
        '<span class="hmove black">' + blackText + '</span>';
      rows.appendChild(row);
    }
    els.history.appendChild(rows);
    els.history.scrollTop = els.history.scrollHeight;
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  /* ---------- 弹窗 ---------- */
  function openModal(sel) { $(sel).classList.remove('hidden'); }
  function closeModal(sel) { $(sel).classList.add('hidden'); }

  function showResult(title, text) {
    els.resTitle.textContent = title;
    els.resText.textContent = text;
    openConfigOff();
    openModal('#modal-result');
  }

  function showConfig(values) {
    els.cfgKey.value = values.apiKey || '';
    els.cfgUrl.value = values.apiUrl || '';
    els.cfgModel.value = values.model || '';
    if (els.cfgThinking) els.cfgThinking.checked = values.disableThinking !== false;
    if (els.cfgJsonMode) els.cfgJsonMode.checked = !!values.responseFormat;
    openModal('#modal-config');
  }

  /* 打开设置时避免后台操作 */
  function openConfigOff() { if (els.resModal) els.resModal.classList.add('hidden'); }

  window.UI = {
    init, els, $, showTaunt, hideTaunt, setStatus, setTurn, setEval, AIThinking,
    renderHistory, showResult, showConfig, openModal, closeModal, esc,
  };
})();