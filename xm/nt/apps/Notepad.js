// ===================================================================
// WebNT 记事本
// ===================================================================

const id = 'notepad';
const name = '记事本';
const icon = '\ud83d\udcc4';

function launch() {
  window.showAppWindow('记事本', '\ud83d\udcc4', `
    <textarea style="width:100%;height:calc(100% - 8px);background:transparent;border:none;color:#e0e0e0;font-family:'Courier New',monospace;font-size:14px;resize:none;outline:none" placeholder="开始输入..."></textarea>
  `);
}

export { id, name, icon, launch };