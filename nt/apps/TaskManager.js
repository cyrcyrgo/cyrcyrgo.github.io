// ===================================================================
// WebNT 任务管理
// ===================================================================

const id = 'taskmgr';
const name = '任务管理';
const icon = '\ud83d\udcca';

function launch() {
  const procs = window.WindowManager.instance.getProcessList();
  const coreCount = procs.filter(p => p.protected).length;
  const userCount = procs.filter(p => !p.protected).length;
  window.showAppWindow('任务管理', '\ud83d\udcca', `
    <style>
      .tm-table { width:100%;border-collapse:collapse;font-size:13px; }
      .tm-table th { text-align:left;padding:8px 12px;border-bottom:1px solid rgba(255,255,255,0.1);color:#888;font-weight:500; }
      .tm-table td { padding:8px 12px;border-bottom:1px solid rgba(255,255,255,0.04); }
      .tm-kill { background:#e8112322;color:#f28b82;border:1px solid #e8112344;padding:4px 10px;border-radius:4px;cursor:pointer;font-size:11px; }
      .tm-kill:hover { background:#e8112344; }
    </style>
    <div style="margin-bottom:12px;font-size:13px;color:#888;">
      进程: <strong style="color:#fff">${procs.length}</strong> | 
      核心进程: <strong style="color:#81c995">${coreCount}</strong> | 
      用户进程: <strong style="color:#8ab4f8">${userCount}</strong>
    </div>
    <table class="tm-table">
      <tr><th>PID</th><th>名称</th><th>状态</th><th>CPU</th><th>内存</th><th></th></tr>
      ${procs.map(p => {
        if (p.protected) {
          return `<tr><td>${p.pid}</td><td>${p.name}</td><td style="color:#81c995">运行中</td><td>${p.cpu}</td><td>${p.mem}</td><td style="color:#666;font-size:11px">受保护</td></tr>`;
        }
        return `<tr><td>${p.pid}</td><td>${p.name}</td><td style="color:#81c995">运行中</td><td>${p.cpu}</td><td>${p.mem}</td><td><button class="tm-kill" onclick="const el=document.getElementById('${p.appId||''}');if(el)el.remove();window.WindowManager.instance.destroyWindow('${p.windowId||''}');window.updateTaskbarWindowButtons();this.closest('tr').remove()">结束</button></td></tr>`;
      }).join('')}
    </table>
  `);
}

export { id, name, icon, launch };