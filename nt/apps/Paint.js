// ===================================================================
// WebNT 画图
// ===================================================================

const id = 'paint';
const name = '画图';
const icon = '\ud83c\udfa8';

function launch() {
  window.showAppWindow('画图', '\ud83c\udfa8', `
    <style>
      .paint-toolbar { display:flex;align-items:center;gap:8px;margin-bottom:10px;flex-wrap:wrap; }
      .paint-toolbar button { background:rgba(255,255,255,0.08);border:none;color:#e0e0e0;padding:6px 12px;border-radius:6px;cursor:pointer;font-size:12px; }
      .paint-toolbar button:hover { background:rgba(255,255,255,0.15); }
      .paint-toolbar button.active { background:rgba(102,126,234,0.5); }
      .paint-toolbar input[type=color] { width:32px;height:28px;border:none;border-radius:4px;cursor:pointer;background:transparent; }
      .paint-toolbar input[type=range] { width:80px; }
      .paint-canvas-wrap { flex:1;overflow:hidden;border-radius:8px;background:#fff; }
      .paint-canvas { display:block;cursor:crosshair;width:100%;height:100%; }
    </style>
    <div class="paint-toolbar">
      <input type="color" id="paint-color" value="#667eea" title="Color">
      <input type="range" id="paint-size" min="1" max="20" value="3" title="Brush Size">
      <button id="paint-clear">清空</button>
      <button id="paint-fill" title="填充背景">填充</button>
      <span style="font-size:11px;color:#888;margin-left:auto">在画布上绘制</span>
    </div>
    <div class="paint-canvas-wrap"><canvas class="paint-canvas" id="paint-canvas"></canvas></div>
  `);
  // Initialize paint canvas after DOM is attached
  requestAnimationFrame(() => {
    const canvas = document.getElementById('paint-canvas');
    const colorPicker = document.getElementById('paint-color');
    const sizeSlider = document.getElementById('paint-size');
    const clearBtn = document.getElementById('paint-clear');
    const fillBtn = document.getElementById('paint-fill');
    if(!canvas) return;
    const wrap = canvas.parentElement;
    const ctx = canvas.getContext('2d');
    let drawing = false;
    function resize() {
      const rect = wrap.getBoundingClientRect();
      canvas.width = rect.width;
      canvas.height = rect.height;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    resize();
    new ResizeObserver(resize).observe(wrap);
    function getCanvasPos(e) {
      const rect = canvas.getBoundingClientRect();
      return {
        x: (e.clientX - rect.left) * (canvas.width / rect.width),
        y: (e.clientY - rect.top) * (canvas.height / rect.height)
      };
    }
    canvas.addEventListener('pointerdown', e => {
      drawing = true;
      const pos = getCanvasPos(e);
      ctx.beginPath();
      ctx.moveTo(pos.x, pos.y);
      ctx.strokeStyle = colorPicker.value;
      ctx.lineWidth = parseInt(sizeSlider.value);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
    });
    canvas.addEventListener('pointermove', e => {
      if(!drawing) return;
      const pos = getCanvasPos(e);
      ctx.lineTo(pos.x, pos.y);
      ctx.stroke();
    });
    canvas.addEventListener('pointerup', () => { drawing = false; });
    canvas.addEventListener('pointerleave', () => { drawing = false; });
    clearBtn.addEventListener('click', () => {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    });
    fillBtn.addEventListener('click', () => {
      ctx.fillStyle = colorPicker.value;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    });
  });
}

export { id, name, icon, launch };