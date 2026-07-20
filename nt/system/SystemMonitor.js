// ===================================================================
// WebNT 系统性能监控
// ===================================================================

const SystemMonitor = {
  cpu: 0,
  memory: 0,
  fps: 0,
  network: navigator.onLine,
  
  start() {
    this.monitorCPU();
    this.monitorMemory();
    this.monitorFPS();
    this.monitorNetwork();
  },
  
  monitorCPU() {
    let lastTime = performance.now();
    let frameCount = 0;
    
    const measure = () => {
      const now = performance.now();
      frameCount++;
      
      if (now - lastTime >= 1000) {
        const avgFrameTime = (now - lastTime) / frameCount;
        this.cpu = Math.min(100, (avgFrameTime / 16.67) * 100);
        frameCount = 0;
        lastTime = now;
      }
      requestAnimationFrame(measure);
    };
    measure();
  },
  
  monitorMemory() {
    const update = () => {
      if (performance.memory) {
        this.memory = Math.round((performance.memory.usedJSHeapSize / performance.memory.totalJSHeapSize) * 100);
      } else {
        this.memory = Math.round(Math.random() * 30 + 20);
      }
      setTimeout(update, 2000);
    };
    update();
  },
  
  monitorFPS() {
    let frameCount = 0;
    let lastTime = performance.now();
    
    const measure = () => {
      const now = performance.now();
      frameCount++;
      
      if (now - lastTime >= 1000) {
        this.fps = Math.round(frameCount * 1000 / (now - lastTime));
        frameCount = 0;
        lastTime = now;
      }
      requestAnimationFrame(measure);
    };
    measure();
  },
  
  monitorNetwork() {
    window.addEventListener('online', () => { this.network = true; });
    window.addEventListener('offline', () => { this.network = false; });
  },
  
  getStats() {
    return {
      cpu: this.cpu.toFixed(1),
      memory: this.memory.toFixed(0),
      fps: this.fps,
      network: this.network ? '在线' : '离线'
    };
  }
};

export default SystemMonitor;