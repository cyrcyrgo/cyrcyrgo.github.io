// ===================================================================
// WebNT 终端 - TerminalCommandRegistry, TerminalExecutor
// ===================================================================

class TerminalCommandRegistry {
  constructor() { this.cmds=new Map(); this._init(); }
  static get instance() { if(!this._i) this._i=new TerminalCommandRegistry(); return this._i; }
  _init() {
    const add=(name,desc,cat,fn)=>this.cmds.set(name,{name,desc,cat,fn});
    add('help','显示可用命令','系统',(a,o)=>{let t='可用命令:\n\n';this.cmds.forEach((c,n)=>{t+=`  ${n.padEnd(12)}${c.desc}\n`;});return t;});
    add('ver','内核版本','系统',()=>'WebNT 内核 v1.0.0');
    add('sysinfo','系统信息','系统',()=>`WebNT 内核 v1.0.0\nCPU: ${navigator.hardwareConcurrency||'?'} 核\n内存: ${navigator.deviceMemory||'?'} GB\n平台: ${navigator.platform}\nGPU: ${navigator.gpu?'WebGPU':'Canvas2D'}\n运行时间: ${Math.floor(performance.now()/1000)}秒`);
    add('ps','进程列表','进程',()=>'  PID:1  系统  [运行中]');
    add('ls','目录列表','文件',(a)=>(a.length?`目录: ${a[0]}`:'/')+'\n  下载/  文档/  桌面/');
    add('pwd','当前目录','文件',()=>'/home/webnt');
    add('cd','切换目录','文件',(a)=>`已切换到: ${a[0]||'/'}`);
    add('clear','清屏','工具',()=>'__CLEAR__');
    add('echo','输出文本','工具',(a)=>a.join(' '));
    add('date','显示日期','工具',()=>new Date().toLocaleString('zh-CN'));
    add('uptime','运行时间','系统',()=>`${Math.floor(performance.now()/1000)} 秒`);
    add('whoami','当前用户','系统',()=>'管理员');
    add('shutdown','关机','系统',()=>{setTimeout(()=>location.reload(),500);return'正在关机...';});
    add('reboot','重启','系统',()=>{location.reload();return'正在重启...';});
    add('netstat','网络状态','网络',()=>'活动连接: 0');
    add('driver','驱动管理','设备',()=>'display.webgpu [正常]\nfile.fs [正常]\nnet.stream [正常]\nterminal.cmd [正常]');
    add('display','显示信息','设备',()=>`${window.innerWidth}x${window.innerHeight} @ ${window.devicePixelRatio}x`);
    add('tree','目录树','文件',()=>'/\n├── home/\n│   └── webnt/\n├── 系统/\n└── 临时/');
    add('grep','文本搜索','工具',(a)=>`grep: 未找到 "${a.join(' ')}"`);
    add('history','命令历史','工具',()=>'');
    add('dns','DNS查询','网络',(a)=>`${a[0]}: 127.0.0.1`);
    add('ping','网络测试','网络',(a)=>`PING ${a[0]} (127.0.0.1): 56 字节\n64 字节: seq=0 ttl=64 时间=0.5ms`);
    add('calc','计算器','工具',(a)=>{ const expr=a.join(' '); try{ return `${expr} = ${Function('"use strict"; return ('+expr+')')()}`; }catch(e){ return `错误: ${e.message}`; } });
    add('base64','Base64 编解码','工具',(a)=>{ const mode=a[0], text=a.slice(1).join(' '); if(!text) return '用法: base64 encode|decode <text>'; try{ if(mode==='encode') return btoa(unescape(encodeURIComponent(text))); if(mode==='decode') return decodeURIComponent(escape(atob(text))); return '用法: base64 encode|decode <text>'; }catch(e){ return `错误: ${e.message}`; } });
    add('urlencode','URL 编码','工具',(a)=>{ const t=a.join(' '); return t?encodeURIComponent(t):'用法: urlencode <text>'; });
    add('urldecode','URL 解码','工具',(a)=>{ const t=a.join(' '); try{return t?decodeURIComponent(t):'用法: urldecode <text>';}catch(e){return `错误: ${e.message}`;} });
    add('uuid','生成 UUID','工具',()=>'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,c=>{ const r=Math.random()*16|0; return (c==='x'?r:(r&0x3|0x8)).toString(16); }));
    add('rand','随机数','工具',(a)=>{ const min=parseFloat(a[0])||0, max=parseFloat(a[1])||(min+1); return String(Math.floor(Math.random()*(max-min+1))+min); });
    add('hash','简单哈希','工具',(a)=>{ let h=5381; const s=a.join(' '); for(let i=0;i<s.length;i++) h=((h<<5)+h)+s.charCodeAt(i); return (h>>>0).toString(16); });
    add('time','当前时间','工具',()=>new Date().toLocaleString('zh-CN',{hour12:false}));
    add('neofetch','系统信息','工具',()=>{
      const logo='    ___       ___       ___\n   /\\__\\     /\\__\\     /\\__\\\n  /:/  /__   /:/ _/_   /:/ _/_\n /:/_/\\__\\ /:/_/\\__\\ /:/_/\\__\\\n \\:\\\\/__/ \\:\\/__/ \\:\\\\/__/\n  \\:\\\\__\\  \\:\\\\__\\  \\:\\\\__\\\n   \\/__/    \\/__/    \\/__/';
      return `${logo}\n  系统: WebNT 内核 v1.0.0\n  平台: ${navigator.platform}\n  内核: ${navigator.hardwareConcurrency||'?'} 核\n  内存: ${navigator.deviceMemory||'?'} GB\n  分辨率: ${window.innerWidth}x${window.innerHeight}\n  运行时间: ${Math.floor(performance.now()/1000)} 秒`;
    });
    add('cowsay','奶牛说话','娱乐',(a)=>{ const text=a.join(' ')||'哞~'; const pad=Math.max(2,text.length+2); const line='-'.repeat(pad); return `${line}\n< ${text} >\n${line}\n        \\   ^__^\n         \\  (oo)\\_______\n            (__)\\       )\\/\\\n                ||----w |\n                ||     ||`; });
    add('fortune','随机格言','娱乐',()=>{ const q=['千里之行，始于足下。','Talk is cheap. Show me the code.','Stay hungry, stay foolish.','知之为知之，不知为不知。','The journey of a thousand miles begins with one step.','代码是写给人看的，只是顺便让机器执行。']; return q[Math.floor(Math.random()*q.length)]; });
    add('matrix','矩阵雨','娱乐',()=>Array.from({length:8},()=>Array.from({length:16},()=>'01'[Math.floor(Math.random()*2)]).join(' ')).join('\n'));
    add('open','打开应用','系统',(a)=>{ const id=a[0]; if(!id) return '用法: open <appId>'; window.launchApp(id); return `正在打开 ${id}...`; });
    add('wallpaper','当前壁纸','系统',()=>{ const s=localStorage.getItem('webnt_wallpaper'); return s?'当前壁纸: '+s.substring(0,80)+(s.length>80?'...':''):'当前使用默认壁纸'; });
  }
  getCommand(n) { return this.cmds.get(n)||null; }
  getAllCommands() { return [...this.cmds.keys()]; }
}

class TerminalExecutor {
  constructor() { this.history=[]; }
  static get instance() { if(!this._i) this._i=new TerminalExecutor(); return this._i; }
  async execute(line) {
    const t=line.trim(); if(!t) return {output:'',exitCode:0};
    this.history.push(t);
    const parts=t.split(/\s+/), name=parts[0].toLowerCase(), args=parts.slice(1);
    const cmd=TerminalCommandRegistry.instance.getCommand(name);
    if(!cmd) return {output:`命令未找到: ${name}\n输入 'help' 查看可用命令。`,exitCode:127};
    try {
      const r=cmd.fn(args,{});
      if(r==='__CLEAR__') return {output:'',exitCode:0,clear:true};
      return {output:String(r||''),exitCode:0};
    } catch(e) { return {output:`Error: ${e.message}`,exitCode:1}; }
  }
  getHistory() { return [...this.history]; }
}

export { TerminalCommandRegistry, TerminalExecutor };