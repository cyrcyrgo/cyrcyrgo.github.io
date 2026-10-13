// ===================================================================
// WebNT 写字板
// ===================================================================

const id = 'wordpad';
const name = '写字板';
const icon = '\ud83d\udcdd';

function launch() {
  window.showAppWindow('写字板', '\ud83d\udcdd', `
    <style>
      .wp-toolbar { display:flex;align-items:center;gap:4px;padding:8px;border-bottom:1px solid rgba(255,255,255,0.08);flex-wrap:wrap; }
      .wp-toolbar button { background:rgba(255,255,255,0.06);border:none;color:#ccc;padding:6px 10px;border-radius:4px;cursor:pointer;font-size:13px;min-width:32px; }
      .wp-toolbar button:hover { background:rgba(255,255,255,0.12); }
      .wp-toolbar button.active { background:rgba(100,181,246,0.3);color:#64b5f6; }
      .wp-toolbar select { background:rgba(255,255,255,0.06);border:none;color:#ccc;padding:6px 8px;border-radius:4px;font-size:13px;cursor:pointer; }
      .wp-toolbar select option { background:#1a1a2e; }
      .wp-toolbar input[type=color] { width:28px;height:28px;border:none;border-radius:4px;cursor:pointer;background:transparent;padding:0; }
      .wp-toolbar .wp-sep { width:1px;height:24px;background:rgba(255,255,255,0.1);margin:0 4px; }
      .wp-editor { flex:1;padding:16px;overflow-y:auto;color:#e0e0e0;font-size:14px;line-height:1.8;outline:none;min-height:200px; }
      .wp-editor:empty:before { content:attr(data-placeholder);color:#666; }
      .wp-status { padding:4px 12px;border-top:1px solid rgba(255,255,255,0.08);font-size:11px;color:#666;display:flex;justify-content:space-between; }
    </style>
    <div class="wp-toolbar">
      <select id="wp-font-size" onchange="document.execCommand('fontSize',false,this.value);document.getElementById('wp-editor').focus()">
        <option value="2">12px</option>
        <option value="3" selected>14px</option>
        <option value="4">18px</option>
        <option value="5">24px</option>
        <option value="6">32px</option>
      </select>
      <div class="wp-sep"></div>
      <button onclick="document.execCommand('bold');this.classList.toggle('active');document.getElementById('wp-editor').focus()" title="粗体"><b>B</b></button>
      <button onclick="document.execCommand('italic');this.classList.toggle('active');document.getElementById('wp-editor').focus()" title="斜体"><i>I</i></button>
      <button onclick="document.execCommand('underline');this.classList.toggle('active');document.getElementById('wp-editor').focus()" title="下划线"><u>U</u></button>
      <button onclick="document.execCommand('strikeThrough');this.classList.toggle('active');document.getElementById('wp-editor').focus()" title="删除线"><s>S</s></button>
      <div class="wp-sep"></div>
      <input type="color" id="wp-color" value="#e0e0e0" onchange="document.execCommand('foreColor',false,this.value);document.getElementById('wp-editor').focus()" title="文字颜色">
      <input type="color" id="wp-bgcolor" value="#000000" onchange="document.execCommand('hiliteColor',false,this.value);document.getElementById('wp-editor').focus()" title="高亮背景">
      <div class="wp-sep"></div>
      <button onclick="document.execCommand('justifyLeft');document.getElementById('wp-editor').focus()" title="左对齐">\u2261</button>
      <button onclick="document.execCommand('justifyCenter');document.getElementById('wp-editor').focus()" title="居中">\u2261</button>
      <button onclick="document.execCommand('justifyRight');document.getElementById('wp-editor').focus()" title="右对齐">\u2261</button>
      <div class="wp-sep"></div>
      <button onclick="document.execCommand('insertUnorderedList');document.getElementById('wp-editor').focus()" title="无序列表">\u2022</button>
      <button onclick="document.execCommand('insertOrderedList');document.getElementById('wp-editor').focus()" title="有序列表">1.</button>
      <div class="wp-sep"></div>
      <button onclick="document.execCommand('undo');document.getElementById('wp-editor').focus()" title="撤销">\u21a9</button>
      <button onclick="document.execCommand('redo');document.getElementById('wp-editor').focus()" title="重做">\u21aa</button>
    </div>
    <div class="wp-editor" id="wp-editor" contenteditable="true" data-placeholder="开始输入文档内容..."></div>
    <div class="wp-status">
      <span id="wp-word-count">字数: 0</span>
      <span>WebNT 写字板</span>
    </div>
  `);
  // Word count update
  requestAnimationFrame(() => {
    const editor = document.getElementById('wp-editor');
    const wordCount = document.getElementById('wp-word-count');
    if(!editor) return;
    const update = () => {
      const text = editor.innerText || '';
      const chars = text.replace(/\s/g,'').length;
      if(wordCount) wordCount.textContent = '字数: ' + chars;
    };
    editor.addEventListener('input', update);
    update();
  });
}

export { id, name, icon, launch };