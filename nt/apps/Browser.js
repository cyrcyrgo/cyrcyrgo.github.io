// ===================================================================
// WebNT 浏览器
// ===================================================================

const id = 'webview';
const name = '浏览器';
const icon = '\ud83c\udf10';

function launch() {
  window.showAppWindow('浏览器', '\ud83c\udf10', `
    <style>
      .browser-wrap { display:flex;flex-direction:column;height:100%; }
      .browser-toolbar { display:flex;align-items:center;gap:6px;padding:8px;border-bottom:1px solid rgba(255,255,255,0.08); }
      .browser-toolbar button { background:rgba(255,255,255,0.06);border:none;color:#ccc;padding:6px 10px;border-radius:6px;cursor:pointer;font-size:13px; }
      .browser-toolbar button:hover { background:rgba(255,255,255,0.12); }
      .browser-toolbar button:disabled { opacity:0.4;cursor:not-allowed; }
      .browser-url { flex:1;padding:6px 12px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.1);border-radius:6px;color:#e0e0e0;font-size:13px;outline:none; }
      .browser-url:focus { border-color:#667eea; }
      .browser-content { flex:1;overflow:hidden;background:#1a1a2e; }
      .browser-content iframe { width:100%;height:100%;border:none;background:#fff; }
      .browser-placeholder { display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;color:#666;gap:12px; }
      .browser-placeholder-icon { font-size:48px;opacity:0.3; }
      .browser-placeholder-text { font-size:13px; }
    </style>
    <div class="browser-wrap">
      <div class="browser-toolbar">
        <button id="browser-back" onclick="window.__browserBack()" title="后退">\u2190</button>
        <button id="browser-forward" onclick="window.__browserForward()" title="前进">\u2192</button>
        <button onclick="window.__browserRefresh()" title="刷新">\u21bb</button>
        <input type="text" class="browser-url" id="browser-url" placeholder="输入网址..." onkeydown="if(event.key==='Enter')window.__browserGo()">
        <button onclick="window.__browserGo()" title="访问">\u2192</button>
      </div>
      <div class="browser-content" id="browser-content">
        <div class="browser-placeholder">
          <div class="browser-placeholder-icon">\ud83c\udf10</div>
          <div class="browser-placeholder-text">输入网址开始浏览</div>
        </div>
      </div>
    </div>
  `);
  requestAnimationFrame(() => {
    let browserHistory = [];
    let browserHistoryIdx = -1;
    let browserIframe = null;
    
    window.__browserGo = function() {
      const urlInput = document.getElementById('browser-url');
      const content = document.getElementById('browser-content');
      let url = urlInput.value.trim();
      if(!url) return;
      if(!url.startsWith('http://') && !url.startsWith('https://')) {
        url = 'https://' + url;
      }
      if(!browserIframe) {
        browserIframe = document.createElement('iframe');
        browserIframe.style.cssText = 'width:100%;height:100%;border:none;background:#fff;';
        content.innerHTML = '';
        content.appendChild(browserIframe);
      }
      browserIframe.src = url;
      browserHistory = browserHistory.slice(0, browserHistoryIdx + 1);
      browserHistory.push(url);
      browserHistoryIdx = browserHistory.length - 1;
      updateBrowserButtons();
    };
    
    window.__browserBack = function() {
      if(browserHistoryIdx > 0 && browserIframe) {
        browserHistoryIdx--;
        browserIframe.src = browserHistory[browserHistoryIdx];
        document.getElementById('browser-url').value = browserHistory[browserHistoryIdx];
        updateBrowserButtons();
      }
    };
    
    window.__browserForward = function() {
      if(browserHistoryIdx < browserHistory.length - 1 && browserIframe) {
        browserHistoryIdx++;
        browserIframe.src = browserHistory[browserHistoryIdx];
        document.getElementById('browser-url').value = browserHistory[browserHistoryIdx];
        updateBrowserButtons();
      }
    };
    
    window.__browserRefresh = function() {
      if(browserIframe) {
        browserIframe.src = browserIframe.src;
      }
    };
    
    function updateBrowserButtons() {
      document.getElementById('browser-back').disabled = browserHistoryIdx <= 0;
      document.getElementById('browser-forward').disabled = browserHistoryIdx >= browserHistory.length - 1;
    }
    
    updateBrowserButtons();
  });
}

export { id, name, icon, launch };