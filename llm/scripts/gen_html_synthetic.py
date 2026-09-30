import os, random, sys
"""合成 HTML 演示 Prompt-代码对，训练 HTML 专用 demo 模型。

每个样本 = "<|user|>写一个能 X 的网页\n<|assistant|>```html\n<!doctype html>...\n```\n"

代码片段全部单文件、无外部依赖，保证浏览器可直接运行（iframe/新标签预览都 OK）。
"""
import os, random

random.seed(42)

# ---- 各类组件/示例 HTML 代码（都单文件自包含）----
BUTTON_ANIM = """<!doctype html><html lang="zh"><head><meta charset="utf-8"><title>按钮动画</title>
<style>
  body{display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#0b0f17;font-family:system-ui}
  button{position:relative;padding:14px 34px;font-size:16px;color:#fff;background:linear-gradient(90deg,#5b8cff,#8b5cf6);border:none;border-radius:12px;cursor:pointer;transition:.2s;overflow:hidden}
  button:hover{transform:translateY(-2px);box-shadow:0 12px 30px -8px #5b8cffcc}
  button:active{transform:translateY(0)}
  button::after{content:"";position:absolute;inset:0;background:radial-gradient(circle,rgba(255,255,255,.4),transparent 60%);opacity:0;transition:.3s}
  button:hover::after{opacity:1}
</style></head><body><button onclick="this.style.transform='scale(.95)';setTimeout(()=>this.style.transform='',150)">悬停我</button></body></html>
"""

COLOR_PICKER = """<!doctype html><html lang="zh"><head><meta charset="utf-8"><title>调色盘</title>
<style>
  body{margin:0;font-family:system-ui;display:flex;gap:30px;padding:40px;background:#f4f6fb}
  .swatches{display:grid;grid-template-columns:repeat(6,50px);gap:8px}
  .sw{width:50px;height:50px;border-radius:10px;cursor:pointer;border:2px solid transparent;transition:.15s}
  .sw:hover{border-color:#333;transform:scale(1.08)}
  .panel{flex:1;background:#fff;border-radius:16px;padding:26px;box-shadow:0 10px 30px -18px #000;min-width:260px}
  .hex{font-family:ui-monospace,monospace;font-size:18px;color:#333;margin:12px 0}
  input[type=color]{width:100%;height:60px;border:none;background:none;cursor:pointer}
</style></head><body>
  <div class="swatches" id="sw"></div>
  <div class="panel"><h3 style="margin-top:0">选个颜色</h3><input type="color" id="cp"><div>HEX</div><div class="hex" id="hex">#ffffff</div><div style="width:100%;height:120px;border-radius:10px;border:1px dashed #bbb;background:var(--c,#fff)"></div></div>
<script>
  const cols = ["#ff6b6b","#ffa94d","#ffd43b","#69db7c","#4dabf7","#845ef7","#f06595","#20c997","#e8590c","#1971c2","#5f3dc4","#c92a2a"];
  const sw=document.getElementById("sw"); cols.forEach(c=>{const d=document.createElement("div");d.className="sw";d.style.background=c;d.onclick=()=>document.getElementById("cp").value=c;sw.appendChild(d)});
  document.getElementById("cp").addEventListener("input",e=>{document.getElementById("hex").textContent=e.target.value;document.documentElement.style.setProperty("--c",e.target.value)});
</script></body></html>
"""

TODO = """<!doctype html><html lang="zh"><head><meta charset="utf-8"><title>待办清单</title>
<style>
  *{box-sizing:border-box}body{margin:0;font-family:system-ui;background:#eef2ff;min-height:100vh;display:flex;justify-content:center;padding:40px 16px}
  .card{background:#fff;border-radius:18px;padding:24px;width:100%;max-width:420px;box-shadow:0 20px 40px -24px #4a5ab8}
  h2{margin:0 0 16px;color:#222}form{display:flex;gap:8px;margin-bottom:14px}input{flex:1;padding:10px 12px;border:1px solid #dbe0ee;border-radius:10px;font-size:14px;outline:none}input:focus{border-color:#5b8cff}button[type=submit]{background:#5b8cff;color:#fff;border:none;border-radius:10px;padding:0 16px;cursor:pointer}
  ul{list-style:none;padding:0;margin:0}li{padding:10px;border-bottom:1px solid #eef0f8;display:flex;align-items:center;gap:10px}li:last-child{border:none}
  .done{text-decoration:line-through;color:#9aa3b5}.del{margin-left:auto;background:none;border:none;color:#c00;cursor:pointer}
</style></head><body>
<div class="card"><h2>今日待办</h2><form onsubmit="add(this);return false"><input name=t placeholder="输入事项" required><button type=submit>添加</button></form><ul id=list></ul></div>
<script>
  const ST="todo-demo"; const items=JSON.parse(localStorage.getItem(ST)||"[]");
  function render(){const u=document.getElementById("list");u.innerHTML="";items.forEach((t,i)=>{const li=document.createElement("li");
    li.innerHTML=`<input type=checkbox ${t.done?"checked":""} onchange="toggle(${i})"> <span class="${t.done?'done':''}">${t.t}</span> <button class=del onclick="del(${i})">删</button>`;u.appendChild(li)})}
  function add(f){items.unshift({t:f.t.value.trim(),done:false});f.reset();save()}function toggle(i){items[i].done=!items[i].done;save()}function del(i){items.splice(i,1);save()}
  function save(){localStorage.setItem(ST,JSON.stringify(items));render()}
  render();
</script></body></html>
"""

CALCULATOR = """<!doctype html><html lang="zh"><head><meta charset="utf-8"><title>简易计算器</title>
<style>
  body{margin:0;font-family:system-ui;background:#0f1420;min-height:100vh;display:flex;align-items:center;justify-content:center}
  .c{background:#1a2136;border-radius:20px;padding:20px;width:280px}#d{background:#0b0f17;color:#fff;text-align:right;padding:14px 16px;font-size:28px;border-radius:12px;margin-bottom:14px;min-height:58px;word-break:break-all}
  .g{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}.b{aspect-ratio:1;background:#242d46;border:none;color:#fff;font-size:18px;border-radius:10px;cursor:pointer}.b:hover{background:#2f3957}.op{background:#5b8cff}.eq{grid-column:span 2;background:#8b5cf6}
</style></head><body>
<div class="c"><div id="d">0</div><div class="g" id="k">
  <button class="b" onclick="inp('(')">(</button><button class="b" onclick="inp(')')">)</button><button class="b" onclick="clr()">C</button><button class="b op" onclick="inp('/')">÷</button>
  <button class="b" onclick="inp('7')">7</button><button class="b" onclick="inp('8')">8</button><button class="b" onclick="inp('9')">9</button><button class="b op" onclick="inp('*')">×</button>
  <button class="b" onclick="inp('4')">4</button><button class="b" onclick="inp('5')">5</button><button class="b" onclick="inp('6')">6</button><button class="b op" onclick="inp('-')">−</button>
  <button class="b" onclick="inp('1')">1</button><button class="b" onclick="inp('2')">2</button><button class="b" onclick="inp('3')">3</button><button class="b op" onclick="inp('+')">+</button>
  <button class="b eq" onclick="go()">=</button><button class="b" onclick="inp('0')">0</button><button class="b" onclick="inp('.')">.</button>
</div></div>
<script>
  let s="";const d=document.getElementById("d");
  function inp(v){s+=v;d.textContent=s}function clr(){s="";d.textContent="0"}
  function go(){try{let r=Function("return "+s.replace(/×/g,"*").replace(/÷/g,"/").replace(/−/g,"-"))();d.textContent=r;s=""+r}catch(e){d.textContent="错误";s=""}}
</script></body></html>
"""

COUNTDOWN = """<!doctype html><html lang="zh"><head><meta charset="utf-8"><title>倒计时</title>
<style>body{margin:0;font-family:system-ui;min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;background:linear-gradient(160deg,#1a2340,#0b0f17);color:#fff}
  .d{font-size:11vw;font-weight:300;font-variant-numeric:tabular-nums;margin:20px 0 8px}
  .b{padding:10px 22px;border-radius:10px;border:none;margin:6px;cursor:pointer;font-size:14px;background:#5b8cff;color:#fff}.b.s{background:#22c55e}.b.r{background:#f59e0b}
  input{padding:8px 12px;border-radius:10px;border:1px solid #2a324a;background:#121828;color:#fff;margin:4px;width:90px;text-align:center}
</style></head><body>
  <h2 style="font-weight:400">倒计时器</h2><div class="d" id="d">00:00:00</div>
  <div><input id=h placeholder=时 type=number min=0><input id=m placeholder=分 type=number min=0><input id=s placeholder=秒 type=number min=0></div>
  <div><button class=b onclick="start()" id=sb>开始</button><button class=b s onclick="pause()">暂停</button><button class=b r onclick="reset()">重置</button></div>
<script>
  let t=0,timer=null;const d=document.getElementById("d");
  function fmt(x){x=Math.max(0,x);const h=String(Math.floor(x/3600)).padStart(2,"0");const mm=String(Math.floor(x%3600/60)).padStart(2,"0");const ss=String(x%60).padStart(2,"0");d.textContent=h+":"+mm+":"+ss}
  function start(){if(!t)t=(+h.value||0)*3600+(+m.value||0)*60+(+s.value||0);if(timer)return;timer=setInterval(()=>{t--;fmt(t);if(t<=0)pause()},1000)}
  function pause(){clearInterval(timer);timer=null}function reset(){pause();t=0;fmt(t)}
</script></body></html>
"""

PAINT = """<!doctype html><html lang="zh"><head><meta charset="utf-8"><title>简易画板</title>
<style>body{margin:0;font-family:system-ui;background:#f0f2f8;display:flex;flex-direction:column;height:100vh}
  .t{display:flex;gap:10px;padding:12px;background:#fff;border-bottom:1px solid #e0e3ee;align-items:center}
  canvas{flex:1;background:#fff;cursor:crosshair}button{padding:7px 14px;border:none;background:#5b8cff;color:#fff;border-radius:8px;cursor:pointer}
</style></head><body>
<div class="t"><input type="color" id=c><input type="range" id=w min=2 max=30 value=4><button onclick="clear()">清空</button><button onclick="save()">保存</button></div>
<canvas id=cv></canvas>
<script>
  const cv=document.getElementById("cv"),ctx=cv.getContext("2d");let drawing=false;
  function resize(){cv.width=innerWidth;cv.height=innerHeight-48}resize();addEventListener("resize",resize);
  cv.onmousedown=e=>{drawing=true;ctx.beginPath();ctx.moveTo(e.clientX,e.clientY-48)};
  cv.onmousemove=e=>{if(!drawing)return;ctx.strokeStyle=c.value;ctx.lineWidth=+w.value;ctx.lineCap="round";ctx.lineTo(e.clientX,e.clientY-48);ctx.stroke()};
  addEventListener("mouseup",()=>drawing=false);
  function clear(){ctx.clearRect(0,0,cv.width,cv.height)}
  function save(){const a=document.createElement("a");a.href=cv.toDataURL("image/png");a.download="paint.png";a.click()}
</script></body></html>
"""

COUNTER = """<!doctype html><html lang="zh"><head><meta charset="utf-8"><title>计数器</title>
<style>body{margin:0;min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;font-family:system-ui;background:#f8fafc}
  .n{font-size:96px;font-weight:200;color:#333;margin:0 0 30px}button{padding:12px 26px;border-radius:10px;border:none;color:#fff;margin:4px;cursor:pointer;font-size:14px}
  .p{background:#22c55e}.m{background:#ef4444}.r{background:#64748b}
</style></head><body>
  <div class="n" id="n">0</div>
  <div><button class=m onclick="c(-1)">−</button><button class=p onclick="c(1)">+</button><button class=r onclick="c(0)">重置</button></div>
<script>let v=0;function c(d){v=d===0?0:v+d;document.getElementById("n").textContent=v}</script>
</body></html>
"""

QUOTE = """<!doctype html><html lang="zh"><head><meta charset="utf-8"><title>每日一言</title>
<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:radial-gradient(800px 400px at 30% 0%,#1a2340,#0b0f17);font-family:system-ui;color:#fff}
  .q{max-width:520px;padding:32px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);border-radius:20px;backdrop-filter:blur(6px)}
  .t{font-size:22px;line-height:1.7;margin:0}.s{text-align:right;margin-top:20px;color:#9fb0d4}button{margin-top:22px;background:#5b8cff;color:#fff;border:none;padding:10px 22px;border-radius:10px;cursor:pointer}
</style></head><body>
<div class="q"><p class="t" id="t"></p><p class="s" id="s"></p><button onclick="next()">换一条</button></div>
<script>
  const data=[
    ["千里之行，始于足下。","老子"],
    ["学而不思则罔，思而不学则殆。","论语"],
    ["天行健，君子以自强不息。","周易"],
    ["业精于勤荒于嬉，行成于思毁于随。","韩愈"],
    ["不积跬步，无以至千里。","荀子"],
    ["天下大事，必作于细。","老子"],
  ];
  function next(){const x=data[Math.floor(Math.random()*data.length)];document.getElementById("t").textContent="「"+x[0]+"」";document.getElementById("s").textContent="——"+x[1]}next();
</script></body></html>
"""

WEATHER = """<!doctype html><html lang="zh"><head><meta charset="utf-8"><title>天气模拟</title>
<style>body{margin:0;font-family:system-ui;display:flex;gap:16px;padding:24px;background:#eef2ff}
  .c{background:#fff;padding:20px;border-radius:14px;width:180px;text-align:center;box-shadow:0 8px 24px -16px #000}
  .e{font-size:48px} .t{font-size:24px;margin:6px 0} .d{color:#888;font-size:13px}
</style></head><body>
<script>
  const cities=[["北京","☀️",22],["上海","⛅",26],["深圳","🌧️",31],["成都","☁️",24],["哈尔滨","❄️",-4]];
  document.body.innerHTML+=cities.map(([n,e,t])=>`<div class=c><div class=e>${e}</div><div>${n}</div><div class=t>${t}°C</div><div class=d>${["晴","多云","雨","阴","雪"][Math.floor(Math.random()*5)]} · 微风</div></div>`).join("");
</script></body></html>
"""

SLIDESHOW = """<!doctype html><html lang="zh"><head><meta charset="utf-8"><title>图片轮播</title>
<style>body{margin:0;font-family:system-ui;background:#111;color:#fff;display:flex;flex-direction:column;align-items:center;min-height:100vh;justify-content:center}
  .s{width:min(90vw,640px);height:360px;background:#222;border-radius:14px;overflow:hidden;position:relative}
  .sl{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:32px;opacity:0;transition:opacity .7s}
  .sl.on{opacity:1} .c{margin-top:16px;display:flex;gap:6px} .d{width:8px;height:8px;border-radius:50%;background:#555;cursor:pointer} .d.on{background:#fff}
</style></head><body>
  <div class="s" id="s"></div><div class="c" id="c"></div>
<script>
  const colors=[["#5b8cff","蓝色"],["#8b5cf6","紫色"],["#22c55e","绿色"],["#f59e0b","金色"],["#ef4444","红色"]];
  const s=document.getElementById("s"),c=document.getElementById("c");let i=0;
  colors.forEach(([bg,t],k)=>{const d=document.createElement("div");d.className="sl"+(k===0?" on":"");d.style.background=bg;d.textContent=t;s.appendChild(d);
    const p=document.createElement("div");p.className="d"+(k===0?" on":"");p.onclick=()=>go(k);c.appendChild(p)});
  function go(k){s.children[i].classList.remove("on");c.children[i].classList.remove("on");i=k;s.children[i].classList.add("on");c.children[i].classList.add("on")}
  setInterval(()=>go((i+1)%colors.length),1600);
</script></body></html>
"""

BREAKOUT = """<!doctype html><html lang="zh"><head><meta charset="utf-8"><title>打砖块</title>
<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0f1420;font-family:system-ui;color:#fff}canvas{background:#0b0f17;border-radius:10px}
  .g{position:fixed;top:10px;left:50%;transform:translateX(-50%);display:flex;gap:20px}
</style></head><body>
  <div class="g"><div>分数: <b id="s">0</b></div><div>生命: <b id="l">3</b></div><div id="msg">← → 移动，空格 发射</div></div>
  <canvas id=c width=480 height=360></canvas>
<script>
  const cv=document.getElementById("c"),ctx=cv.getContext("2d");let px=180,pw=120,by=320,bx=240,bvx=2.8,bvy=-2.8,score=0,life=3,running=false,over=false;
  const rows=5,cols=8,bw=50,bh=16,bricks=Array.from({length:rows},()=>Array(cols).fill(1));
  document.addEventListener("keydown",e=>{if(e.key===" ")running=true;if(e.key==="ArrowLeft")px-=18;if(e.key==="ArrowRight")px+=18});
  function rectsOverlap(bx,by){return bx+10>px&&bx-10<px+pw&&by+10>330&&by-10<344}
  function step(){
    ctx.fillStyle="#0b0f17";ctx.fillRect(0,0,cv.width,cv.height);
    for(let r=0;r<rows;r++)for(let c=0;c<cols;c++)if(bricks[r][c]){ctx.fillStyle=["#5b8cff","#8b5cf6","#22c55e","#f59e0b","#ef4444"][r];ctx.fillRect(10+c*(bw+8),20+r*(bh+6),bw,bh)}
    ctx.fillStyle="#5b8cff";ctx.fillRect(px,330,pw,14);
    if(running){bx+=bvx;by+=bvy;if(bx<10||bx>cv.width-10)bvx*=-1;if(by<10)bvy*=-1;
      if(rectsOverlap(bx,by)){bvy*=-1;if(by<340)by=320}
      for(let r=0;r<rows;r++)for(let c=0;c<cols;c++)if(bricks[r][c]){const x=10+c*(bw+8),y=20+r*(bh+6);
        if(bx+10>x&&bx-10<x+bw&&by+10>y&&by-10<y+bh){bricks[r][c]=0;bvy*=-1;score+=10;document.getElementById("s").textContent=score}}
      if(by>cv.height){life--;document.getElementById("l").textContent=life;running=false;by=320;bx=px+pw/2}
      if(life<=0)over=true}
    ctx.beginPath();ctx.fillStyle="#fff";ctx.arc(bx,by,8,0,Math.PI*2);ctx.fill();
    if(!over)requestAnimationFrame(step)}
  step();
</script></body></html>
"""

SNAKE = """<!doctype html><html lang="zh"><head><meta charset="utf-8"><title>贪吃蛇</title>
<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0f1420;font-family:system-ui;color:#fff}canvas{background:#0b0f17;border-radius:10px}</style></head><body>
  <canvas id=c width=400 height=400></canvas>
<script>
  const cv=document.getElementById("c"),ctx=cv.getContext("2d"),G=20,sz=20;
  let sn=[[10,10],[9,10]],dir=[1,0],fd=[2+Math.floor(Math.random()*(G-4)),2+Math.floor(Math.random()*(G-4))],sc=0,over=false;
  document.addEventListener("keydown",e=>{if(e.key==="ArrowUp"&&dir[1]!==1)dir=[0,-1];if(e.key==="ArrowDown"&&dir[1]!==-1)dir=[0,1];if(e.key==="ArrowLeft"&&dir[0]!==1)dir=[-1,0];if(e.key==="ArrowRight"&&dir[0]!==-1)dir=[1,0]});
  function tick(){
    ctx.fillStyle="#0b0f17";ctx.fillRect(0,0,cv.width,cv.height);
    ctx.fillStyle="#ef4444";ctx.fillRect(fd[0]*sz,fd[1]*sz,sz,sz);
    for(let i=0;i<sn.length;i++){ctx.fillStyle=i===0?"#22c55e":"#16a34a";ctx.fillRect(sn[i][0]*sz,sn[i][1]*sz,sz-2,sz-2)}
    const h=[sn[0][0]+dir[0],sn[0][1]+dir[1]];
    if(h[0]<0||h[0]>=G||h[1]<0||h[1]>=G||sn.some(s=>s[0]===h[0]&&s[1]===h[1]))over=true;
    sn.unshift(h);if(h[0]===fd[0]&&h[1]===fd[1]){sc++;fd=[Math.floor(Math.random()*G),Math.floor(Math.random()*G)]}else sn.pop();
    ctx.fillStyle="#fff";ctx.font="16px system-ui";ctx.fillText("分数 "+sc,10,20);
    if(!over)setTimeout(tick,110);else ctx.fillText("游戏结束",150,200)
  }tick();
</script></body></html>
"""

# ---- Prompt 模板 ----
PROMPTS = [
    ("写一个会让按钮在悬停时发光缩放的网页", BUTTON_ANIM),
    ("帮我写一个网页上的调色盘", COLOR_PICKER),
    ("我想要一个可以添加和删除事项的待办清单", TODO),
    ("做一个网页版的四则运算计算器", CALCULATOR),
    ("写一个能倒计时的网页，从输入的时分秒开始", COUNTDOWN),
    ("网页画板，鼠标拖动画画，能换颜色和清空", PAINT),
    ("一个简单的加一减一计数器网页", COUNTER),
    ("写一个每天自动推荐一句名言的网页", QUOTE),
    ("一个模拟几个城市天气的网页卡片", WEATHER),
    ("做一个颜色自动轮播的幻灯片网页", SLIDESHOW),
    ("网页小游戏：打砖块（弹球消砖块）", BREAKOUT),
    ("网页小游戏：贪吃蛇", SNAKE),
]

def main(out_dir):
    os.makedirs(out_dir, exist_ok=True)
    out = os.path.join(out_dir, "html_samples.txt")
    random.seed(7)
    with open(out, "w", encoding="utf-8") as f:
        variants = ["写一个 {task}", "帮我做一个 {task}", "我想要一个网页上的 {task}",
                    "帮我写个网页版 {task}", "{task} 用 HTML + CSS + JS 实现"]
        for _ in range(5):
            for _round in range(2):
                random.shuffle(PROMPTS)
                for q, code in PROMPTS:
                    tmpl = random.choice(variants)
                    task = q.replace("写一个", "").replace("网页小游戏：", "").replace("网页版", "").replace("网页上的", "")
                    new_q = tmpl.format(task=task)
                    f.write(f"<|user|>{new_q}\n<|assistant|>\n```html\n{code}\n```\n<|endoftext|>\n\n")
    print(f"合成 HTML 数据 -> {out}  {os.path.getsize(out):,} bytes")

if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "data/html_raw")

