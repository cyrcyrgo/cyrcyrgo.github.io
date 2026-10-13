// ===================================================================
// WebNT 时钟
// ===================================================================

const id = 'clock';
const name = '时钟';
const icon = '\u23f0';

function launch() {
  window.showAppWindow('时钟', '\u23f0', `
    <style>
      .clk-display { text-align:center;padding:20px 0; }
      .clk-time { font-size:56px;font-weight:200;color:#fff;letter-spacing:2px; }
      .clk-date { font-size:14px;color:#888;margin-top:4px; }
      .clk-tabs { display:flex;gap:4px;margin-bottom:16px; }
      .clk-tab { flex:1;padding:8px;text-align:center;background:rgba(255,255,255,0.04);border:none;color:#888;border-radius:8px;cursor:pointer;font-size:13px; }
      .clk-tab.active { background:rgba(102,126,234,0.3);color:#fff; }
      .clk-panel { display:none; }
      .clk-panel.active { display:block; }
      .clk-sw-time { font-size:32px;text-align:center;font-weight:200;padding:16px 0; }
      .clk-sw-btns { display:flex;gap:8px;justify-content:center; }
      .clk-sw-btns button { padding:10px 24px;background:rgba(255,255,255,0.08);border:none;color:#e0e0e0;border-radius:8px;cursor:pointer;font-size:14px; }
      .clk-sw-btns button:hover { background:rgba(255,255,255,0.15); }
      .clk-sw-btns button.primary { background:rgba(102,126,234,0.5); }
      .clk-laps { max-height:120px;overflow-y:auto;margin-top:12px;font-size:13px;color:#888; }
      .clk-laps div { padding:4px 8px;border-bottom:1px solid rgba(255,255,255,0.04); }
    </style>
    <div class="clk-display">
      <div class="clk-time" id="clk-time">--:--:--</div>
      <div class="clk-date" id="clk-date"></div>
    </div>
    <div class="clk-tabs">
      <button class="clk-tab active" data-panel="stopwatch">秒表</button>
      <button class="clk-tab" data-panel="timer">计时器</button>
    </div>
    <div class="clk-panel active" id="panel-stopwatch">
      <div class="clk-sw-time" id="sw-time">00:00.00</div>
      <div class="clk-sw-btns">
        <button class="primary" id="sw-start">开始</button>
        <button id="sw-lap">计次</button>
        <button id="sw-reset">重置</button>
      </div>
      <div class="clk-laps" id="sw-laps"></div>
    </div>
    <div class="clk-panel" id="panel-timer">
      <div class="clk-sw-time" id="tm-time">05:00</div>
      <div class="clk-sw-btns" style="margin-bottom:12px">
        <button class="primary" id="tm-start">Start</button>
        <button id="tm-reset">Reset</button>
      </div>
      <div style="display:flex;gap:4px;justify-content:center;flex-wrap:wrap">
        ${[1,3,5,10,15,30].map(m=>'<button style="padding:6px 12px;background:rgba(255,255,255,0.06);border:none;color:#ccc;border-radius:6px;cursor:pointer;font-size:12px" onclick="document.getElementById(\'tm-time\').textContent=\''+String(m).padStart(2,'0')+':00\';window.__tmTotal='+(m*60)+';window.__tmRemaining='+(m*60)+'">'+m+' min</button>').join('')}
      </div>
    </div>
  `);
  // Clock live update
  (function updateClock() {
    const now = new Date();
    const timeEl = document.getElementById('clk-time');
    const dateEl = document.getElementById('clk-date');
    if(!timeEl) return;
    timeEl.textContent = now.toLocaleTimeString('zh-CN',{hour12:false});
    dateEl.textContent = now.toLocaleDateString('zh-CN',{weekday:'long',year:'numeric',month:'long',day:'numeric'});
    setTimeout(updateClock, 1000);
  })();
  // Stopwatch
  (function() {
    const swTime = document.getElementById('sw-time');
    const swStart = document.getElementById('sw-start');
    const swLap = document.getElementById('sw-lap');
    const swReset = document.getElementById('sw-reset');
    const swLaps = document.getElementById('sw-laps');
    if(!swTime) return;
    let swRunning = false, swStartTime = 0, swElapsed = 0, swInterval;
    function updateSwDisplay() {
      const total = swElapsed + (swRunning ? Date.now() - swStartTime : 0);
      const ms = Math.floor(total/10)%100;
      const s = Math.floor(total/1000)%60;
      const m = Math.floor(total/60000);
      swTime.textContent = `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}.${String(ms).padStart(2,'0')}`;
    }
    swStart.addEventListener('click', () => {
      if(swRunning) { swElapsed += Date.now() - swStartTime; clearInterval(swInterval); swStart.textContent = '开始'; swStart.classList.add('primary'); }
      else { swStartTime = Date.now(); swInterval = setInterval(updateSwDisplay, 10); swStart.textContent = '停止'; swStart.classList.remove('primary'); }
      swRunning = !swRunning;
    });
    swLap.addEventListener('click', () => {
      if(!swRunning && swElapsed===0) return;
      const lap = document.createElement('div');
      lap.textContent = `#${swLaps.children.length+1}  ${swTime.textContent}`;
      swLaps.appendChild(lap);
    });
    swReset.addEventListener('click', () => {
      swRunning = false; swElapsed = 0; clearInterval(swInterval);
      swStart.textContent = '开始'; swStart.classList.add('primary');
      swTime.textContent = '00:00.00'; swLaps.innerHTML = '';
    });
  })();
  // Timer
  (function() {
    const tmTime = document.getElementById('tm-time');
    const tmStart = document.getElementById('tm-start');
    const tmReset = document.getElementById('tm-reset');
    if(!tmTime) return;
    let tmRunning = false, tmRemaining = 300, tmInterval;
    window.__tmTotal = 300;
    window.__tmRemaining = 300;
    function updateTmDisplay() {
      const m = Math.floor(tmRemaining/60);
      const s = tmRemaining%60;
      tmTime.textContent = `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
    }
    tmStart.addEventListener('click', () => {
      if(tmRunning) { clearInterval(tmInterval); tmStart.textContent = '开始'; tmStart.classList.add('primary'); }
      else {
        tmInterval = setInterval(() => {
          tmRemaining--;
          if(tmRemaining <= 0) { tmRemaining = 0; clearInterval(tmInterval); tmRunning = false; tmStart.textContent = '开始'; tmStart.classList.add('primary'); }
          updateTmDisplay();
        }, 1000);
        tmStart.textContent = '停止'; tmStart.classList.remove('primary');
      }
      tmRunning = !tmRunning;
    });
    tmReset.addEventListener('click', () => {
      tmRunning = false; clearInterval(tmInterval);
      tmRemaining = window.__tmTotal || 300;
      tmStart.textContent = '开始'; tmStart.classList.add('primary');
      updateTmDisplay();
    });
  })();
  // Tab switching
  (function() {
    document.querySelectorAll('.clk-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.clk-tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.clk-panel').forEach(p => p.classList.remove('active'));
        tab.classList.add('active');
        document.getElementById('panel-' + tab.dataset.panel).classList.add('active');
      });
    });
  })();
}

export { id, name, icon, launch };