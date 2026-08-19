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
      cfgShow: $('#cfg-show'),
      cfgSave: $('#cfg-save'),
      cfgCancel: $('#cfg-cancel'),
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

  /* ---------- 对局历史 ---------- */
  function renderHistory(records) {
    els.history.innerHTML = '';
    records.forEach((rec, idx) => {
      const row = document.createElement('div');
      row.className = 'hrow' + (rec.type === 'ai' ? ' ai' : '');
      row.innerHTML =
        '<span class="hnum">' + (idx + 1) + '</span>' +
        '<span class="htext">' + esc(rec.text) + '</span>';
      els.history.appendChild(row);
    });
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
    openModal('#modal-config');
  }

  /* 打开设置时避免后台操作 */
  function openConfigOff() { if (els.resModal) els.resModal.classList.add('hidden'); }

  window.UI = {
    init, els, $, showTaunt, hideTaunt, setStatus, setTurn, setEval, AIThinking,
    renderHistory, showResult, showConfig, openModal, closeModal, esc,
  };
})();