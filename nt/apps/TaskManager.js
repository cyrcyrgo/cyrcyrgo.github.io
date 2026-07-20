// ===================================================================
// WebNT 任务管理
// ===================================================================

const id = 'taskmgr';
const name = '任务管理';
const icon = '\ud83d\udcca';

function launch() {
  window.showAppWindow('任务管理', '\ud83d\udcca', `
    <style>
      .tm-table { width:100%;border-collapse:collapse;font-size:13px; }
      .tm-table th { text-align:left;padding:8px 12px;border-bottom:1px solid rgba(255,255,255,0.1);color:#888;font-weight:500; }
      .tm-table td { padding:8px 12px;border-bottom:1px solid rgba(255,255,255,0.04); }
      .tm-kill { background:#e8112322;color:#f28b82;border:1px solid #e8112344;padding:4px 10px;border-radius:4px;cursor:pointer;font-size:11px; }
      .tm-kill:hover { background:#e8112344; }
    </style>
    <div style="margin-bottom:12px;font-size:13px;color:#888;">
      进程: <strong style="color:#fff">${window.WindowManager.instance.getWindowList().length+1}</strong> | 
      内核: <strong style="color:#81c995">运行中</strong>
    </div>
    <table class="tm-table">
      <tr><th>PID</th><th>名称</th><th>状态</th><th>CPU</th><th>内存</th><th></th></tr>
      <tr><td>1</td><td>系统</td><td style="color:#81c995">运行中</td><td>0.2%</td><td>4.2 MB</td><td></td></tr>
      <tr><td>2</td><td>内核</td><td style="color:#81c995">运行中</td><td>0.5%</td><td>8.1 MB</td><td></td></tr>
      <tr><td>3</td><td>桌面</td><td style="color:#81c995">运行中</td><td>1.2%</td><td>12.4 MB</td><td></td></tr>
      ${window.WindowManager.instance.getWindowList().map((w,i)=>'<tr><td>'+(i+4)+'</td><td>'+w.title+'</td><td style="color:#81c995">运行中</td><td>'+(Math.random()*2).toFixed(1)+'%</td><td>'+(Math.random()*20+5).toFixed(1)+' MB</td><td><button class="tm-kill" onclick="const el=document.getElementById(\''+w.appId+'\');if(el)el.remove();window.WindowManager.instance.destroyWindow(\''+w.id+'\');window.updateTaskbarWindowButtons();this.closest(\'tr\').remove()">结束</button></td></tr>').join('')}
    </table>
  `);
}

export { id, name, icon, launch };