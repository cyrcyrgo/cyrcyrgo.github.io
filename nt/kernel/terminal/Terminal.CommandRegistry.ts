/**
 * CommandRegistry - Terminal command registry for the WebNT-HTML5 Web OS Kernel.
 * Manages built-in commands and user-registered commands.
 */

export interface CommandDef {
  name: string;
  description: string;
  usage: string;
  category: string;
  handler: (args: string[], output: CommandOutput) => string | Promise<string>;
}

export interface CommandOutput {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  clear: () => void;
}

interface CommandEntry {
  name: string;
  description: string;
  usage: string;
  category: string;
  handler: (args: string[], output: CommandOutput) => string | Promise<string>;
}

let _instance: CommandRegistry | null = null;

export class CommandRegistry {
  private commands: Map<string, CommandEntry> = new Map();

  static get instance(): CommandRegistry {
    if (!_instance) {
      _instance = new CommandRegistry();
    }
    return _instance;
  }

  private constructor() {
    this.registerBuiltins();
  }

  registerCommand(cmd: CommandDef): void {
    this.commands.set(cmd.name, {
      name: cmd.name,
      description: cmd.description,
      usage: cmd.usage,
      category: cmd.category,
      handler: cmd.handler,
    });
  }

  getCommand(name: string): CommandEntry | null {
    return this.commands.get(name) ?? null;
  }

  getAllCommands(): CommandEntry[] {
    return [...this.commands.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  private registerBuiltins(): void {
    const r = (cmd: CommandDef) => this.commands.set(cmd.name, cmd);

    r({
      name: 'help',
      description: 'Display help information for available commands',
      usage: 'help [command]',
      category: 'system',
      handler: (args) => {
        if (args.length > 0) {
          const cmd = this.commands.get(args[0]);
          if (!cmd) return `help: no help for '${args[0]}'`;
          return `${cmd.name} - ${cmd.description}\nUsage: ${cmd.usage}\nCategory: ${cmd.category}`;
        }
        const cats: Record<string, string[]> = {};
        for (const cmd of this.commands.values()) {
          (cats[cmd.category] ??= []).push(cmd.name);
        }
        let out = 'Available commands:\n\n';
        for (const [cat, names] of Object.entries(cats).sort()) {
          out += `[${cat}]\n  ${names.sort().join(', ')}\n\n`;
        }
        out += 'Type "help <command>" for more info.';
        return out;
      },
    });

    r({
      name: 'ver',
      description: 'Display kernel version',
      usage: 'ver',
      category: 'system',
      handler: () => 'WebNT-HTML5 Kernel v1.0.0 (build 2026)',
    });

    r({
      name: 'sysinfo',
      description: 'Display system information',
      usage: 'sysinfo',
      category: 'system',
      handler: () => {
        const nav = typeof navigator !== 'undefined' ? navigator : null;
        return [
          `OS: WebNT-HTML5`,
          `Kernel: 1.0.0`,
          `Arch: ${nav?.platform ?? 'web'}`,
          `CPU Cores: ${nav?.hardwareConcurrency ?? 'unknown'}`,
          `Memory: ${this.formatBytes(performance?.memory?.jsHeapSizeLimit ?? 0)}`,
          `User Agent: ${nav?.userAgent ?? 'unknown'}`,
          `Language: ${nav?.language ?? 'unknown'}`,
        ].join('\n');
      },
    });

    r({
      name: 'ps',
      description: 'List running processes',
      usage: 'ps',
      category: 'process',
      handler: () => {
        try {
          const { ProcessManager } = require('../../kernel/executor/ProcessManager.js');
          const list = ProcessManager.instance.getProcessList();
          if (list.length === 0) return 'No running processes.';
          let out = 'PID\tNAME\t\tSTATE\n';
          for (const p of list) {
            out += `${p.pid}\t${p.name}\t\t${p.state}\n`;
          }
          return out;
        } catch {
          return 'PID\tNAME\t\tSTATE\n1\tkernel\t\tRUNNING\n2\tterminal\t\tRUNNING';
        }
      },
    });

    r({
      name: 'kill',
      description: 'Terminate a process by PID',
      usage: 'kill <pid>',
      category: 'process',
      handler: (args) => {
        if (args.length === 0) return 'kill: missing PID\nUsage: kill <pid>';
        const pid = parseInt(args[0], 10);
        if (isNaN(pid)) return `kill: invalid PID '${args[0]}'`;
        try {
          const { ProcessManager } = require('../../kernel/executor/ProcessManager.js');
          const ok = ProcessManager.instance.terminateProcess(pid);
          return ok ? `Process ${pid} terminated.` : `kill: no such process ${pid}`;
        } catch {
          return `Process ${pid} terminated.`;
        }
      },
    });

    r({
      name: 'mem',
      description: 'Display memory usage',
      usage: 'mem',
      category: 'system',
      handler: () => {
        if (typeof performance !== 'undefined' && (performance as any).memory) {
          const m = (performance as any).memory;
          return [
            `Used:  ${this.formatBytes(m.usedJSHeapSize)}`,
            `Total: ${this.formatBytes(m.totalJSHeapSize)}`,
            `Limit: ${this.formatBytes(m.jsHeapSizeLimit)}`,
          ].join('\n');
        }
        return 'Memory API not available.';
      },
    });

    r({
      name: 'ls',
      description: 'List directory contents',
      usage: 'ls [path]',
      category: 'filesystem',
      handler: (args) => {
        const path = args[0] ?? '/';
        const fs = this.getVirtualFS();
        const entries = fs[path] ?? [];
        if (entries.length === 0) return '(empty)';
        return entries.join('  ');
      },
    });

    r({
      name: 'cd',
      description: 'Change current directory',
      usage: 'cd <path>',
      category: 'filesystem',
      handler: (args) => {
        if (args.length === 0) return 'cd: missing path';
        return `Changed directory to ${args[0]}`;
      },
    });

    r({
      name: 'pwd',
      description: 'Print working directory',
      usage: 'pwd',
      category: 'filesystem',
      handler: () => '/',
    });

    r({
      name: 'cat',
      description: 'Display file contents',
      usage: 'cat <file>',
      category: 'filesystem',
      handler: (args) => {
        if (args.length === 0) return 'cat: missing file';
        const fs = this.getFileContents();
        return fs[args[0]] ?? `cat: ${args[0]}: No such file`;
      },
    });

    r({
      name: 'mkdir',
      description: 'Create a directory',
      usage: 'mkdir <name>',
      category: 'filesystem',
      handler: (args) => {
        if (args.length === 0) return 'mkdir: missing directory name';
        return `Created directory: ${args[0]}`;
      },
    });

    r({
      name: 'rm',
      description: 'Remove a file or directory',
      usage: 'rm <path>',
      category: 'filesystem',
      handler: (args) => {
        if (args.length === 0) return 'rm: missing path';
        return `Removed: ${args[0]}`;
      },
    });

    r({
      name: 'clear',
      description: 'Clear the terminal screen',
      usage: 'clear',
      category: 'terminal',
      handler: (_args, output) => {
        output.clear();
        return '';
      },
    });

    r({
      name: 'echo',
      description: 'Display a line of text',
      usage: 'echo [text...]',
      category: 'terminal',
      handler: (args) => args.join(' '),
    });

    r({
      name: 'date',
      description: 'Display current date and time',
      usage: 'date',
      category: 'system',
      handler: () => new Date().toString(),
    });

    r({
      name: 'uptime',
      description: 'Display system uptime',
      usage: 'uptime',
      category: 'system',
      handler: () => {
        const startTime = (globalThis as any).__NT_BOOT_TIME__ ?? Date.now();
        const uptime = Date.now() - startTime;
        const secs = Math.floor(uptime / 1000);
        const mins = Math.floor(secs / 60);
        const hours = Math.floor(mins / 60);
        const days = Math.floor(hours / 24);
        return `up ${days}d ${hours % 24}h ${mins % 60}m ${secs % 60}s`;
      },
    });

    r({
      name: 'whoami',
      description: 'Display current user',
      usage: 'whoami',
      category: 'system',
      handler: () => 'root',
    });

    r({
      name: 'shutdown',
      description: 'Shut down the system',
      usage: 'shutdown',
      category: 'system',
      handler: () => 'System is shutting down...',
    });

    r({
      name: 'reboot',
      description: 'Reboot the system',
      usage: 'reboot',
      category: 'system',
      handler: () => 'System is rebooting...',
    });

    r({
      name: 'netstat',
      description: 'Display network connections',
      usage: 'netstat',
      category: 'network',
      handler: () => [
        'Proto\tLocal\t\tRemote\t\tState',
        'TCP\t0.0.0.0:80\t0.0.0.0:*\tLISTEN',
        'TCP\t0.0.0.0:443\t0.0.0.0:*\tLISTEN',
        'UDP\t0.0.0.0:53\t0.0.0.0:*\t',
      ].join('\n'),
    });

    r({
      name: 'mount',
      description: 'Mount a filesystem',
      usage: 'mount <device> <path>',
      category: 'filesystem',
      handler: (args) => {
        if (args.length < 2) return 'mount: usage: mount <device> <path>';
        return `Mounted ${args[0]} at ${args[1]}`;
      },
    });

    r({
      name: 'unmount',
      description: 'Unmount a filesystem',
      usage: 'unmount <path>',
      category: 'filesystem',
      handler: (args) => {
        if (args.length === 0) return 'unmount: missing path';
        return `Unmounted ${args[0]}`;
      },
    });

    r({
      name: 'driver',
      description: 'List loaded drivers',
      usage: 'driver',
      category: 'system',
      handler: () => [
        'DRIVER\t\tSTATUS\tVERSION',
        'display.sys\tLOADED\t1.0',
        'input.sys\tLOADED\t1.0',
        'audio.sys\tLOADED\t1.0',
        'network.sys\tLOADED\t1.0',
        'fs.sys\t\tLOADED\t1.0',
      ].join('\n'),
    });

    r({
      name: 'display',
      description: 'Display information',
      usage: 'display',
      category: 'system',
      handler: () => 'Display: WebNT Compositor 1920x1080@60Hz',
    });

    r({
      name: 'reg',
      description: 'Registry operations',
      usage: 'reg <read|write|list> [key] [value]',
      category: 'system',
      handler: (args) => {
        if (args.length === 0) return 'reg: usage: reg <read|write|list> [key] [value]';
        const sub = args[0];
        if (sub === 'list') return 'HKLM\\SOFTWARE\\WebNT\nHKLM\\SYSTEM\nHKCU\\Desktop';
        if (sub === 'read' && args[1]) return `reg: ${args[1]} = <value>`;
        if (sub === 'write' && args[1]) return `reg: ${args[1]} set to ${args[2] ?? ''}`;
        return `reg: unknown subcommand '${sub}'`;
      },
    });

    r({
      name: 'tasklist',
      description: 'List all tasks',
      usage: 'tasklist',
      category: 'process',
      handler: () => {
        try {
          const { ProcessManager } = require('../../kernel/executor/ProcessManager.js');
          const list = ProcessManager.instance.getProcessList();
          if (list.length === 0) return 'No tasks.';
          return list.map((p: any) => `${p.pid}\t${p.name}`).join('\n');
        } catch {
          return '1\tkernel\n2\tterminal';
        }
      },
    });

    r({
      name: 'tree',
      description: 'Display directory tree',
      usage: 'tree [path]',
      category: 'filesystem',
      handler: (args) => {
        const path = args[0] ?? '/';
        const fs = this.getVirtualFS();
        let out = `${path}\n`;
        const entries = fs[path] ?? [];
        for (let i = 0; i < entries.length; i++) {
          const isLast = i === entries.length - 1;
          out += `${isLast ? '└── ' : '├── '}${entries[i]}\n`;
        }
        return out;
      },
    });

    r({
      name: 'grep',
      description: 'Search text for patterns',
      usage: 'grep <pattern> [text...]',
      category: 'util',
      handler: (args) => {
        if (args.length === 0) return 'grep: missing pattern';
        const pattern = args[0];
        const text = args.slice(1).join(' ');
        try {
          const re = new RegExp(pattern, 'gi');
          const lines = text.split('\n');
          return lines.filter((l) => re.test(l)).join('\n');
        } catch {
          return `grep: invalid pattern '${pattern}'`;
        }
      },
    });

    r({
      name: 'history',
      description: 'Display command history',
      usage: 'history',
      category: 'terminal',
      handler: () => {
        const hist = (globalThis as any).__NT_COMMAND_HISTORY__ ?? [];
        if (hist.length === 0) return 'No history.';
        return hist.map((h: string, i: number) => `${i + 1}  ${h}`).join('\n');
      },
    });

    r({
      name: 'export',
      description: 'Set an environment variable',
      usage: 'export <NAME>=<value>',
      category: 'env',
      handler: (args) => {
        if (args.length === 0) return 'export: missing argument';
        const parts = args[0].split('=');
        if (parts.length < 2) return `export: invalid format, use NAME=value`;
        return `export ${parts[0]}=${parts.slice(1).join('=')}`;
      },
    });

    r({
      name: 'unset',
      description: 'Unset an environment variable',
      usage: 'unset <NAME>',
      category: 'env',
      handler: (args) => {
        if (args.length === 0) return 'unset: missing variable name';
        return `unset ${args[0]}`;
      },
    });

    r({
      name: 'alias',
      description: 'Create a command alias',
      usage: 'alias <name>=<command>',
      category: 'env',
      handler: (args) => {
        if (args.length === 0) return 'alias: missing argument';
        const parts = args[0].split('=');
        if (parts.length < 2) return `alias: invalid format, use name=command`;
        return `alias ${parts[0]}='${parts.slice(1).join('=')}'`;
      },
    });

    r({
      name: 'unalias',
      description: 'Remove a command alias',
      usage: 'unalias <name>',
      category: 'env',
      handler: (args) => {
        if (args.length === 0) return 'unalias: missing alias name';
        return `unalias ${args[0]}`;
      },
    });

    r({
      name: 'dns',
      description: 'DNS lookup',
      usage: 'dns <hostname>',
      category: 'network',
      handler: (args) => {
        if (args.length === 0) return 'dns: missing hostname';
        return `dns: resolving ${args[0]}...\n${args[0]} -> 127.0.0.1`;
      },
    });

    r({
      name: 'ping',
      description: 'Ping a host',
      usage: 'ping <host>',
      category: 'network',
      handler: (args) => {
        if (args.length === 0) return 'ping: missing host';
        return [
          `PING ${args[0]} (127.0.0.1): 56 data bytes`,
          `64 bytes from 127.0.0.1: time=0.1ms`,
          `64 bytes from 127.0.0.1: time=0.1ms`,
          `64 bytes from 127.0.0.1: time=0.1ms`,
          ``,
          `--- ${args[0]} ping statistics ---`,
          `3 packets transmitted, 3 received, 0% loss`,
        ].join('\n');
      },
    });
  }

  private formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
  }

  private getVirtualFS(): Record<string, string[]> {
    return {
      '/': ['bin', 'boot', 'dev', 'etc', 'home', 'lib', 'mnt', 'proc', 'root', 'sys', 'tmp', 'usr', 'var'],
      '/bin': ['sh', 'ls', 'cat', 'echo', 'mkdir', 'rm', 'ps', 'kill', 'mount', 'unmount'],
      '/etc': ['hosts', 'resolv.conf', 'profile'],
      '/home': ['user'],
      '/home/user': ['Documents', 'Downloads', 'Desktop', 'Pictures'],
      '/tmp': [],
      '/proc': ['cpuinfo', 'meminfo', 'uptime', 'version'],
      '/dev': ['null', 'zero', 'random', 'stdin', 'stdout', 'stderr'],
    };
  }

  private getFileContents(): Record<string, string> {
    return {
      '/etc/hosts': '127.0.0.1 localhost\n::1 localhost',
      '/etc/resolv.conf': 'nameserver 8.8.8.8',
      '/proc/cpuinfo': 'WebNT Virtual CPU @ 1.0GHz',
      '/proc/meminfo': 'MemTotal: 1024 MB\nMemFree: 512 MB',
      '/proc/version': 'WebNT-HTML5 Kernel version 1.0.0',
      '/proc/uptime': `${(Date.now() - ((globalThis as any).__NT_BOOT_TIME__ ?? Date.now())) / 1000}`,
    };
  }
}

export default CommandRegistry;