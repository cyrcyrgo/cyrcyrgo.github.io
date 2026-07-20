// ===================================================================
// WebNT 内核 - EventBus, GlobalDisplayAPI, WindowManager, SysCallBridge
// ===================================================================

// EventBus - 全局事件总线
class EventBus {
  constructor() { this._handlers = {}; }
  on(event, callback) { if(!this._handlers[event]) this._handlers[event]=[]; this._handlers[event].push(callback); }
  off(event, callback) { if(this._handlers[event]) this._handlers[event]=this._handlers[event].filter(cb=>cb!==callback); }
  emit(event, data) { (this._handlers[event]||[]).forEach(cb=>{try{cb(data)}catch(e){console.error('EventBus error:',e);}}); }
}

// GlobalDisplayAPI
class GlobalDisplayAPI {
  constructor() { this.initialized = false; }
  static get instance() { if(!this._i) this._i=new GlobalDisplayAPI(); return this._i; }
  initialize(c,o={}) {
    if(this.initialized) return;
    this.initialized = true;
    c.width = (o.width||window.innerWidth) * (o.dpr||1);
    c.height = (o.height||window.innerHeight) * (o.dpr||1);
    c.style.width = (o.width||window.innerWidth)+'px';
    c.style.height = (o.height||window.innerHeight)+'px';
  }
}

// WindowManager
class WindowManager {
  constructor() { this.wins=new Map(); this.order=[]; this.focus=null; this.nid=1; this.ls={}; }
  static get instance() { if(!this._i) this._i=new WindowManager(); return this._i; }
  createWindow(o={}) {
    const id='win_'+this.nid++;
    const w={id,title:o.title||'Window',w:o.width||600,h:o.height||400,x:o.x??100,y:o.y??100,state:'NORMAL',appId:o.appId||null,minimized:false,icon:o.icon||'\ud83d\udcc4'};
    this.wins.set(id,w); this.order.push(id); this.focus=id;
    this._emit('window-created',w); return id;
  }
  destroyWindow(id) { this.wins.delete(id); this.order=this.order.filter(w=>w!==id); if(this.focus===id) this.focus=this.order[this.order.length-1]||null; this._emit('window-destroyed',{windowId:id}); }
  setFocus(id) { if(this.wins.has(id)) { this.focus=id; this._emit('window-focused',{windowId:id}); } }
  bringToFront(id) { if(!this.wins.has(id)) return; this.order=this.order.filter(w=>w!==id); this.order.push(id); this.setFocus(id); }
  getWindowList() { return [...this.wins.values()]; }
  on(e,cb) { if(!this.ls[e]) this.ls[e]=[]; this.ls[e].push(cb); }
  _emit(e,d) { (this.ls[e]||[]).forEach(cb=>{try{cb(d)}catch(e){}}); }
}

// SysCallBridge
class SysCallBridge {
  constructor() { this.h={}; this._reg(); }
  static get instance() { if(!this._i) this._i=new SysCallBridge(); return this._i; }
  _reg() {
    this.h.NtGetSystemInfo=()=>({hostname:'WebNT-Kernel',version:'2.01',build:'20260718',platform:navigator.platform,cpuCores:navigator.hardwareConcurrency||1,memory:navigator.deviceMemory||4,uptime:Math.floor(performance.now()/1000)});
    this.h.NtShutdown=()=>({success:true});
    this.h.NtReboot=()=>({success:true});
  }
  async call(name,...args) { const h=this.h[name]; if(!h) throw new Error(`SysCall '${name}' not found`); return h(args[0]); }
}

export { EventBus, GlobalDisplayAPI, WindowManager, SysCallBridge };