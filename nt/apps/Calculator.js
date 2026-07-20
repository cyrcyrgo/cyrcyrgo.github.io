// ===================================================================
// WebNT 计算器
// ===================================================================

const id = 'calculator';
const name = '计算器';
const icon = '\ud83d\uddd2\ufe0f';

function launch() {
  const suffix = window.appWinCounter + 1;
  window.showAppWindow('计算器', '\ud83d\uddd2\ufe0f', `
    <style>
      .calc-display { background:rgba(0,0,0,0.3); border-radius:8px; padding:12px 16px; margin-bottom:12px; text-align:right; min-height:60px; display:flex;flex-direction:column;justify-content:flex-end; }
      .calc-expr { font-size:13px; color:#888; min-height:20px; word-break:break-all; }
      .calc-result { font-size:28px; font-weight:300; color:#fff; }
      .calc-grid { display:grid; grid-template-columns:repeat(4,1fr); gap:6px; }
      .calc-btn { padding:14px; font-size:18px; border:none; border-radius:8px; cursor:pointer; background:rgba(255,255,255,0.08); color:#e0e0e0; transition:background 0.1s; }
      .calc-btn:hover { background:rgba(255,255,255,0.15); }
      .calc-btn:active { background:rgba(255,255,255,0.05); }
      .calc-btn.op { background:rgba(102,126,234,0.3); color:#a0b4f0; }
      .calc-btn.op:hover { background:rgba(102,126,234,0.45); }
      .calc-btn.eq { background:rgba(102,126,234,0.5); color:#fff; }
      .calc-btn.eq:hover { background:rgba(102,126,234,0.65); }
      .calc-btn.fn { background:rgba(255,255,255,0.04); color:#999; }
    </style>
    <div class="calc-display"><div class="calc-expr" id="calc-expr-${suffix}"></div><div class="calc-result" id="calc-result-${suffix}">0</div></div>
    <div class="calc-grid">
      <button class="calc-btn fn" onclick="window.__calcClear('${suffix}')">C</button>
      <button class="calc-btn fn" onclick="window.__calcInput('${suffix}','(')">(</button>
      <button class="calc-btn fn" onclick="window.__calcInput('${suffix}',')')">)</button>
      <button class="calc-btn op" onclick="window.__calcInput('${suffix}','/')">/</button>
      <button class="calc-btn" onclick="window.__calcInput('${suffix}','7')">7</button>
      <button class="calc-btn" onclick="window.__calcInput('${suffix}','8')">8</button>
      <button class="calc-btn" onclick="window.__calcInput('${suffix}','9')">9</button>
      <button class="calc-btn op" onclick="window.__calcInput('${suffix}','*')">*</button>
      <button class="calc-btn" onclick="window.__calcInput('${suffix}','4')">4</button>
      <button class="calc-btn" onclick="window.__calcInput('${suffix}','5')">5</button>
      <button class="calc-btn" onclick="window.__calcInput('${suffix}','6')">6</button>
      <button class="calc-btn op" onclick="window.__calcInput('${suffix}','-')">-</button>
      <button class="calc-btn" onclick="window.__calcInput('${suffix}','1')">1</button>
      <button class="calc-btn" onclick="window.__calcInput('${suffix}','2')">2</button>
      <button class="calc-btn" onclick="window.__calcInput('${suffix}','3')">3</button>
      <button class="calc-btn op" onclick="window.__calcInput('${suffix}','+')">+</button>
      <button class="calc-btn" onclick="window.__calcInput('${suffix}','0')" style="grid-column:span 2">0</button>
      <button class="calc-btn" onclick="window.__calcInput('${suffix}','.')">.</button>
      <button class="calc-btn eq" onclick="window.__calcEval('${suffix}')">=</button>
    </div>
  `);
}

export { id, name, icon, launch };