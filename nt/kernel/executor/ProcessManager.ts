/**
 * ProcessManager - Process lifecycle manager for the WebNT-HTML5 Web OS Kernel.
 */

export enum ProcessState {
  CREATED = 'CREATED',
  RUNNING = 'RUNNING',
  BLOCKED = 'BLOCKED',
  TERMINATED = 'TERMINATED',
}

export interface ProcessInfo {
  pid: number;
  name: string;
  state: ProcessState;
  entry: string;
  parentPid: number | null;
  createdAt: number;
  cpuTime: number;
  memoryUsage: number;
  env: Record<string, string>;
  cwd: string;
}

export interface ProcessOptions {
  env?: Record<string, string>;
  cwd?: string;
  args?: string[];
  priority?: number;
  parentPid?: number;
}

interface InternalProcess extends ProcessInfo {
  worker: Worker | null;
  startTime: number;
  children: Set<number>;
}

let _instance: ProcessManager | null = null;

export class ProcessManager {
  private processes: Map<number, InternalProcess> = new Map();
  private pidCounter: number = 0;
  private eventHandlers: Map<string, Set<(data: any) => void>> = new Map();

  static get instance(): ProcessManager {
    if (!_instance) {
      _instance = new ProcessManager();
    }
    return _instance;
  }

  private constructor() {
    // Create kernel process (PID 1)
    this.createKernelProcess();
  }

  private createKernelProcess(): void {
    this.pidCounter = 1;
    const kernel: InternalProcess = {
      pid: 1,
      name: 'nt-kernel',
      state: ProcessState.RUNNING,
      entry: 'kernel',
      parentPid: null,
      createdAt: Date.now(),
      cpuTime: 0,
      memoryUsage: 0,
      env: {},
      cwd: '/',
      worker: null,
      startTime: Date.now(),
      children: new Set(),
    };
    this.processes.set(1, kernel);
  }

  createProcess(
    name: string,
    entry: string,
    options: ProcessOptions = {}
  ): number {
    this.pidCounter++;
    const pid = this.pidCounter;
    const parentPid = options.parentPid ?? 1;

    const proc: InternalProcess = {
      pid,
      name,
      state: ProcessState.CREATED,
      entry,
      parentPid,
      createdAt: Date.now(),
      cpuTime: 0,
      memoryUsage: 0,
      env: { ...options.env },
      cwd: options.cwd ?? '/',
      worker: null,
      startTime: Date.now(),
      children: new Set(),
    };

    const parent = this.processes.get(parentPid);
    if (parent) {
      parent.children.add(pid);
    }

    this.processes.set(pid, proc);

    // Transition to RUNNING
    proc.state = ProcessState.RUNNING;
    this.emit('process-created', this.getProcessInfo(pid));

    return pid;
  }

  terminateProcess(pid: number): boolean {
    const proc = this.processes.get(pid);
    if (!proc) return false;

    if (pid === 1) {
      console.warn('ProcessManager: Cannot terminate kernel process (PID 1)');
      return false;
    }

    // Terminate all children first
    for (const childPid of proc.children) {
      this.terminateProcess(childPid);
    }

    if (proc.worker) {
      proc.worker.terminate();
      proc.worker = null;
    }

    proc.state = ProcessState.TERMINATED;
    proc.cpuTime = performance.now() - proc.startTime;

    // Remove from parent's children
    if (proc.parentPid !== null) {
      const parent = this.processes.get(proc.parentPid);
      if (parent) {
        parent.children.delete(pid);
      }
    }

    this.emit('process-terminated', this.getProcessInfo(pid));

    // Keep terminated processes for a while before cleanup
    setTimeout(() => {
      this.processes.delete(pid);
    }, 5000);

    return true;
  }

  setProcessState(pid: number, state: ProcessState): void {
    const proc = this.processes.get(pid);
    if (!proc) return;
    const prevState = proc.state;
    proc.state = state;
    this.emit('process-state-changed', {
      pid,
      prevState,
      newState: state,
    });
  }

  getProcessList(): ProcessInfo[] {
    return [...this.processes.values()]
      .filter((p) => p.state !== ProcessState.TERMINATED)
      .map((p) => this.getProcessInfo(p.pid));
  }

  getProcessInfo(pid: number): ProcessInfo | null {
    const proc = this.processes.get(pid);
    if (!proc) return null;
    return {
      pid: proc.pid,
      name: proc.name,
      state: proc.state,
      entry: proc.entry,
      parentPid: proc.parentPid,
      createdAt: proc.createdAt,
      cpuTime: proc.cpuTime,
      memoryUsage: proc.memoryUsage,
      env: { ...proc.env },
      cwd: proc.cwd,
    };
  }

  getAllProcesses(): ProcessInfo[] {
    return [...this.processes.values()].map((p) => this.getProcessInfo(p.pid)!);
  }

  getChildren(pid: number): ProcessInfo[] {
    const proc = this.processes.get(pid);
    if (!proc) return [];
    return [...proc.children]
      .map((cp) => this.getProcessInfo(cp))
      .filter(Boolean) as ProcessInfo[];
  }

  on(event: string, callback: (data: any) => void): void {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, new Set());
    }
    this.eventHandlers.get(event)!.add(callback);
  }

  off(event: string, callback: (data: any) => void): void {
    const set = this.eventHandlers.get(event);
    if (set) {
      set.delete(callback);
    }
  }

  private emit(event: string, data: any): void {
    const set = this.eventHandlers.get(event);
    if (set) {
      for (const handler of set) {
        try {
          handler(data);
        } catch (err) {
          console.error(`ProcessManager: Error in handler for "${event}":`, err);
        }
      }
    }
  }
}

export default ProcessManager;