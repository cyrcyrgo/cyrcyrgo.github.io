// ===================================================================
// WebNT 天气
// ===================================================================

const id = 'weather';
const name = '天气';
const icon = '\u2600\ufe0f';

function launch() {
  window.showAppWindow('天气', '\u2600\ufe0f', `
    <style>
      .wx-current { display:flex;align-items:center;gap:20px;margin-bottom:20px;padding:16px;background:rgba(255,255,255,0.04);border-radius:12px; }
      .wx-current .wx-icon { font-size:56px; }
      .wx-current .wx-temp { font-size:42px;font-weight:200; }
      .wx-current .wx-detail { font-size:12px;color:#888;line-height:1.8; }
      .wx-forecast { display:grid;grid-template-columns:repeat(4,1fr);gap:8px; }
      .wx-fc { text-align:center;padding:10px;background:rgba(255,255,255,0.04);border-radius:10px; }
      .wx-fc .wx-fc-day { font-size:11px;color:#888;margin-bottom:6px; }
      .wx-fc .wx-fc-icon { font-size:28px;margin-bottom:4px; }
      .wx-fc .wx-fc-temp { font-size:13px; }
      .wx-fc .wx-fc-hi { color:#f28b82; }
      .wx-fc .wx-fc-lo { color:#8ab4f8;margin-left:4px; }
    </style>
    <div class="wx-current">
      <div class="wx-icon">\u2600\ufe0f</div>
      <div>
        <div class="wx-temp">28\u00b0</div>
        <div style="font-size:14px;color:#e0e0e0">晴</div>
      </div>
      <div class="wx-detail">
        湿度: 45%<br>风速: 12 km/h<br>紫外线: 中等
      </div>
    </div>
    <div style="font-size:13px;font-weight:600;margin-bottom:10px;color:#888">5 日预报</div>
    <div class="wx-forecast">
      ${[
        {day:'周一',icon:'\u2600\ufe0f',hi:30,lo:20},
        {day:'周二',icon:'\u26c5',hi:27,lo:18},
        {day:'周三',icon:'\ud83c\udf27\ufe0f',hi:24,lo:16},
        {day:'周四',icon:'\u2600\ufe0f',hi:29,lo:19},
      ].map(f=>'<div class="wx-fc"><div class="wx-fc-day">'+f.day+'</div><div class="wx-fc-icon">'+f.icon+'</div><div class="wx-fc-temp"><span class="wx-fc-hi">'+f.hi+'\u00b0</span><span class="wx-fc-lo">'+f.lo+'\u00b0</span></div></div>').join('')}
    </div>
  `);
}

export { id, name, icon, launch };