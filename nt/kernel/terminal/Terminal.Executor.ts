/**
 * TerminalExecutor - Command executor for the WebNT-HTML5 Web OS Kernel.
 * Handles piping, redirection, background execution, and chaining.
 */

import { TerminalLexer, TokenType, Token } from './Terminal.Lexer.js';
import { CommandRegistry } from './Terminal.CommandRegistry.js';

export interface ExecutionContext {
  env: Record<string, string>;
  cwd: string;
  processId: number;
}

export interface ExecutionResult {
  output: string;
  exitCode: number;
}

interface PendingCommand {
  name: string;
  args: string[];
  redirectIn: string | null;
  redirectOut: string | null;
  redirectAppend: string | null;
  background: boolean;
}

let _instance: TerminalExecutor | null = null;

export class TerminalExecutor {
  private context: ExecutionContext = {
    env: {},
    cwd: '/',
    processId: 0,
  };
  private aliases: Map<string, string> = new Map();
  private history: string[] = [];
  private builtinOutput: string[] = [];

  static get instance(): TerminalExecutor {
    if (!_instance) {
      _instance = new TerminalExecutor();
    }
    return _instance;
  }

  private constructor() {
    (globalThis as any).__NT_COMMAND_HISTORY__ = this.history;
    (globalThis as any).__NT_BOOT_TIME__ = Date.now();
  }

  setContext(ctx: Partial<ExecutionContext>): void {
    if (ctx.env) this.context.env = { ...this.context.env, ...ctx.env };
    if (ctx.cwd !== undefined) this.context.cwd = ctx.cwd;
    if (ctx.processId !== undefined) this.context.processId = ctx.processId;
  }

  getContext(): ExecutionContext {
    return { ...this.context, env: { ...this.context.env } };
  }

  async execute(commandLine: string, context?: Partial<ExecutionContext>): Promise<ExecutionResult> {
    if (context) {
      this.setContext(context);
    }

    this.history.push(commandLine);
    if (this.history.length > 500) this.history.shift();

    const trimmed = commandLine.trim();
    if (trimmed.length === 0) {
      return { output: '', exitCode: 0 };
    }

    TerminalLexer.instance.setEnvVars(this.context.env);
    const tokens = TerminalLexer.instance.tokenize(trimmed);

    const commands = this.parseCommands(tokens);
    if (commands.length === 0) {
      return { output: '', exitCode: 0 };
    }

    return this.executeCommands(commands);
  }

  private parseCommands(tokens: Token[]): PendingCommand[][] {
    const chains: PendingCommand[][] = [];
    let currentChain: PendingCommand[] = [];
    let currentCmd: PendingCommand = this.newPendingCommand();
    let i = 0;
    let args: string[] = [];
    let expectFile: 'in' | 'out' | 'append' | null = null;

    while (i < tokens.length) {
      const token = tokens[i];

      if (token.type === TokenType.EOF) {
        break;
      }

      if (token.type === TokenType.SEMICOLON) {
        if (currentCmd.name || args.length > 0) {
          currentCmd.args = args;
          currentChain.push(currentCmd);
          currentCmd = this.newPendingCommand();
          args = [];
        }
        if (currentChain.length > 0) {
          chains.push(currentChain);
          currentChain = [];
        }
        i++;
        continue;
      }

      if (token.type === TokenType.AND || token.type === TokenType.OR) {
        if (currentCmd.name || args.length > 0) {
          currentCmd.args = args;
          currentChain.push(currentCmd);
          currentCmd = this.newPendingCommand();
          args = [];
        }
        currentCmd.background = token.type === TokenType.AND;
        i++;
        continue;
      }

      if (token.type === TokenType.PIPE) {
        if (currentCmd.name || args.length > 0) {
          currentCmd.args = args;
          currentChain.push(currentCmd);
          currentCmd = this.newPendingCommand();
          args = [];
        }
        i++;
        continue;
      }

      if (token.type === TokenType.BACKGROUND) {
        currentCmd.background = true;
        i++;
        continue;
      }

      if (token.type === TokenType.REDIRECT_IN) {
        expectFile = 'in';
        i++;
        continue;
      }

      if (token.type === TokenType.REDIRECT_OUT) {
        expectFile = 'out';
        i++;
        continue;
      }

      if (token.type === TokenType.REDIRECT_APPEND) {
        expectFile = 'append';
        i++;
        continue;
      }

      if (expectFile !== null) {
        if (token.type === TokenType.WORD || token.type === TokenType.STRING) {
          if (expectFile === 'in') currentCmd.redirectIn = token.value;
          else if (expectFile === 'out') currentCmd.redirectOut = token.value;
          else if (expectFile === 'append') currentCmd.redirectAppend = token.value;
          expectFile = null;
        }
        i++;
        continue;
      }

      if (currentCmd.name === '') {
        currentCmd.name = token.value;
      } else {
        args.push(token.value);
      }

      i++;
    }

    if (currentCmd.name || args.length > 0) {
      currentCmd.args = args;
      currentChain.push(currentCmd);
    }
    if (currentChain.length > 0) {
      chains.push(currentChain);
    }

    return chains;
  }

  private async executeCommands(chains: PendingCommand[][]): Promise<ExecutionResult> {
    let finalOutput = '';
    let finalExitCode = 0;

    for (let ci = 0; ci < chains.length; ci++) {
      const chain = chains[ci];
      let pipeInput = '';
      let chainOutput = '';
      let chainExitCode = 0;

      for (let pi = 0; pi < chain.length; pi++) {
        const cmd = chain[pi];
        const resolvedName = this.aliases.get(cmd.name) ?? cmd.name;

        // Redirect input from file
        if (cmd.redirectIn) {
          const fileContents = this.getFileContents();
          pipeInput = fileContents[cmd.redirectIn] ?? '';
        }

        const result = await this.executeSingleCommand(
          resolvedName,
          cmd.args,
          pipeInput,
          cmd.redirectOut,
          cmd.redirectAppend
        );

        pipeInput = result.output;
        chainOutput = result.output;
        chainExitCode = result.exitCode;

        if (result.exitCode !== 0) break;
      }

      finalOutput += (finalOutput ? '\n' : '') + chainOutput;
      finalExitCode = chainExitCode;
    }

    return { output: finalOutput, exitCode: finalExitCode };
  }

  private async executeSingleCommand(
    name: string,
    args: string[],
    pipeInput: string,
    redirectOut: string | null,
    redirectAppend: string | null
  ): Promise<ExecutionResult> {
    const registry = CommandRegistry.instance;
    const cmd = registry.getCommand(name);

    if (!cmd) {
      return { output: `${name}: command not found`, exitCode: 127 };
    }

    const outputLines: string[] = [];
    const errLines: string[] = [];

    const output = {
      stdout: (text: string) => outputLines.push(text),
      stderr: (text: string) => errLines.push(text),
      clear: () => { outputLines.length = 0; },
    };

    try {
      let result = cmd.handler(args, output);
      if (result instanceof Promise) {
        result = await result;
      }

      if (pipeInput && outputLines.length === 0) {
        result = pipeInput;
      }

      let finalOutput = typeof result === 'string' ? result : outputLines.join('\n');
      if (errLines.length > 0) {
        finalOutput = finalOutput + (finalOutput ? '\n' : '') + errLines.join('\n');
      }

      if (redirectOut) {
        this.writeFile(redirectOut, finalOutput);
        return { output: '', exitCode: 0 };
      }
      if (redirectAppend) {
        this.appendFile(redirectAppend, finalOutput);
        return { output: '', exitCode: 0 };
      }

      return { output: finalOutput, exitCode: 0 };
    } catch (err: any) {
      return { output: `${name}: ${err.message ?? 'unknown error'}`, exitCode: 1 };
    }
  }

  private newPendingCommand(): PendingCommand {
    return {
      name: '',
      args: [],
      redirectIn: null,
      redirectOut: null,
      redirectAppend: null,
      background: false,
    };
  }

  private getFileContents(): Record<string, string> {
    return {
      '/etc/hosts': '127.0.0.1 localhost\n::1 localhost',
      '/etc/resolv.conf': 'nameserver 8.8.8.8',
    };
  }

  private writeFile(path: string, content: string): void {
    (globalThis as any).__NT_VIRTUAL_FS__ ??= {};
    (globalThis as any).__NT_VIRTUAL_FS__[path] = content;
  }

  private appendFile(path: string, content: string): void {
    (globalThis as any).__NT_VIRTUAL_FS__ ??= {};
    (globalThis as any).__NT_VIRTUAL_FS__[path] =
      ((globalThis as any).__NT_VIRTUAL_FS__[path] ?? '') + content;
  }
}

export default TerminalExecutor;