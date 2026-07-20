// ===================================================================
// WebNT 日历
// ===================================================================

const id = 'calendar';
const name = '日历';
const icon = '\ud83d\udcc5';

function launch() {
  const now=new Date();
  const y=now.getFullYear(), m=now.getMonth();
  const firstDay=new Date(y,m,1).getDay();
  const daysInMonth=new Date(y,m+1,0).getDate();
  const monthNames=['一月','二月','三月','四月','五月','六月','七月','八月','九月','十月','十一月','十二月'];
  let grid='';
  for(let i=0;i<firstDay;i++) grid+='<div></div>';
  for(let d=1;d<=daysInMonth;d++) {
    const isToday=(d===now.getDate()&&m===now.getMonth()&&y===now.getFullYear());
    grid+=`<div style="padding:8px;text-align:center;border-radius:6px;${isToday?'background:rgba(102,126,234,0.5);font-weight:600;':''}">${d}</div>`;
  }
  window.showAppWindow('日历', '\ud83d\udcc5', `
    <style>
      .cal-header { display:flex;align-items:center;justify-content:space-between;margin-bottom:12px; }
      .cal-title { font-size:18px;font-weight:600; }
      .cal-nav { background:rgba(255,255,255,0.08);border:none;color:#fff;padding:6px 12px;border-radius:6px;cursor:pointer; }
      .cal-grid { display:grid;grid-template-columns:repeat(7,1fr);gap:2px; }
      .cal-day-hdr { text-align:center;font-size:11px;color:#888;padding:4px; }
    </style>
    <div class="cal-header">
      <button class="cal-nav">&lt;</button>
      <div class="cal-title">${monthNames[m]} ${y}</div>
      <button class="cal-nav">&gt;</button>
    </div>
    <div class="cal-grid">
      ${['日','一','二','三','四','五','六'].map(d=>'<div class="cal-day-hdr">'+d+'</div>').join('')}
      ${grid}
    </div>
  `);
}

export { id, name, icon, launch };