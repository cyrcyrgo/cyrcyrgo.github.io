/**
 * TerminalLexer - Command line lexer for the WebNT-HTML5 Web OS Kernel.
 * Tokenizes user input into a stream of tokens for the command executor.
 */

export enum TokenType {
  WORD = 'WORD',
  STRING = 'STRING',
  NUMBER = 'NUMBER',
  PIPE = 'PIPE',
  REDIRECT_IN = 'REDIRECT_IN',
  REDIRECT_OUT = 'REDIRECT_OUT',
  REDIRECT_APPEND = 'REDIRECT_APPEND',
  BACKGROUND = 'BACKGROUND',
  SEMICOLON = 'SEMICOLON',
  AND = 'AND',
  OR = 'OR',
  VARIABLE = 'VARIABLE',
  ENV_VAR = 'ENV_VAR',
  EOF = 'EOF',
}

export interface Token {
  type: TokenType;
  value: string;
  position: number;
}

let _instance: TerminalLexer | null = null;

export class TerminalLexer {
  private input: string = '';
  private position: number = 0;
  private envVars: Record<string, string> = {};

  static get instance(): TerminalLexer {
    if (!_instance) {
      _instance = new TerminalLexer();
    }
    return _instance;
  }

  private constructor() {}

  setEnvVars(vars: Record<string, string>): void {
    this.envVars = { ...vars };
  }

  tokenize(input: string): Token[] {
    this.input = input;
    this.position = 0;
    const tokens: Token[] = [];

    while (this.position < this.input.length) {
      const ch = this.peek();

      if (ch === null) break;

      if (ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n') {
        this.advance();
        continue;
      }

      if (ch === '#') {
        while (this.position < this.input.length && this.peek() !== '\n') {
          this.advance();
        }
        continue;
      }

      if (ch === '|') {
        this.advance();
        if (this.peek() === '|') {
          this.advance();
          tokens.push({ type: TokenType.OR, value: '||', position: this.position - 2 });
        } else {
          tokens.push({ type: TokenType.PIPE, value: '|', position: this.position - 1 });
        }
        continue;
      }

      if (ch === '&') {
        this.advance();
        if (this.peek() === '&') {
          this.advance();
          tokens.push({ type: TokenType.AND, value: '&&', position: this.position - 2 });
        } else {
          tokens.push({ type: TokenType.BACKGROUND, value: '&', position: this.position - 1 });
        }
        continue;
      }

      if (ch === ';') {
        this.advance();
        tokens.push({ type: TokenType.SEMICOLON, value: ';', position: this.position - 1 });
        continue;
      }

      if (ch === '>') {
        this.advance();
        if (this.peek() === '>') {
          this.advance();
          tokens.push({ type: TokenType.REDIRECT_APPEND, value: '>>', position: this.position - 2 });
        } else {
          tokens.push({ type: TokenType.REDIRECT_OUT, value: '>', position: this.position - 1 });
        }
        continue;
      }

      if (ch === '<') {
        this.advance();
        tokens.push({ type: TokenType.REDIRECT_IN, value: '<', position: this.position - 1 });
        continue;
      }

      if (ch === '\'' || ch === '"') {
        const token = this.readQuotedString(ch);
        tokens.push(token);
        continue;
      }

      if (ch === '\\') {
        this.advance();
        const next = this.peek();
        if (next !== null) {
          this.advance();
          const escaped = this.readWordFrom('\\' + next);
          tokens.push(escaped);
        }
        continue;
      }

      if (ch === '$') {
        const token = this.readVariable();
        tokens.push(token);
        continue;
      }

      if (this.isDigit(ch)) {
        const token = this.readNumber();
        tokens.push(token);
        continue;
      }

      const word = this.readWord();
      tokens.push(word);
    }

    tokens.push({ type: TokenType.EOF, value: '', position: this.position });
    return tokens;
  }

  private peek(): string | null {
    if (this.position >= this.input.length) return null;
    return this.input[this.position];
  }

  private advance(): string | null {
    if (this.position >= this.input.length) return null;
    return this.input[this.position++];
  }

  private isDigit(ch: string): boolean {
    return ch >= '0' && ch <= '9';
  }

  private isWordChar(ch: string): boolean {
    return /^[a-zA-Z0-9_\-./*+?!@%^=:,]$/.test(ch);
  }

  private readQuotedString(quote: string): Token {
    const start = this.position;
    this.advance();
    let value = '';
    let escaped = false;

    while (this.position < this.input.length) {
      const ch = this.peek();
      if (ch === null) break;

      if (escaped) {
        if (quote === '"') {
          if (ch === 'n') value += '\n';
          else if (ch === 't') value += '\t';
          else if (ch === 'r') value += '\r';
          else if (ch === '\\') value += '\\';
          else if (ch === '"') value += '"';
          else if (ch === '$') value += '$';
          else value += ch;
        } else {
          value += '\\' + ch;
        }
        escaped = false;
        this.advance();
        continue;
      }

      if (ch === '\\' && quote === '"') {
        escaped = true;
        this.advance();
        continue;
      }

      if (ch === quote) {
        this.advance();
        break;
      }

      if (ch === '$' && quote === '"') {
        const varToken = this.readVariable();
        value += varToken.value;
        continue;
      }

      value += ch;
      this.advance();
    }

    return { type: TokenType.STRING, value, position: start };
  }

  private readVariable(): Token {
    const start = this.position;
    this.advance();

    if (this.peek() === '{') {
      this.advance();
      let name = '';
      while (this.position < this.input.length) {
        const ch = this.peek();
        if (ch === '}') {
          this.advance();
          break;
        }
        if (ch !== null) {
          name += ch;
          this.advance();
        } else {
          break;
        }
      }
      const resolved = this.envVars[name] ?? '';
      return { type: TokenType.ENV_VAR, value: resolved, position: start };
    }

    let name = '';
    while (this.position < this.input.length) {
      const ch = this.peek();
      if (ch !== null && /^[a-zA-Z0-9_]$/.test(ch)) {
        name += ch;
        this.advance();
      } else {
        break;
      }
    }

    if (name.length === 0) {
      return { type: TokenType.WORD, value: '$', position: start };
    }

    const resolved = this.envVars[name] ?? '';
    return { type: TokenType.ENV_VAR, value: resolved, position: start };
  }

  private readNumber(): Token {
    const start = this.position;
    let value = '';
    while (this.position < this.input.length) {
      const ch = this.peek();
      if (ch !== null && this.isDigit(ch)) {
        value += ch;
        this.advance();
      } else {
        break;
      }
    }
    return { type: TokenType.NUMBER, value, position: start };
  }

  private readWord(): Token {
    const start = this.position;
    let value = '';
    while (this.position < this.input.length) {
      const ch = this.peek();
      if (ch !== null && this.isWordChar(ch)) {
        value += ch;
        this.advance();
      } else {
        break;
      }
    }
    return { type: TokenType.WORD, value, position: start };
  }

  private readWordFrom(initial: string): Token {
    const start = this.position;
    let value = initial;
    while (this.position < this.input.length) {
      const ch = this.peek();
      if (ch !== null && this.isWordChar(ch)) {
        value += ch;
        this.advance();
      } else {
        break;
      }
    }
    return { type: TokenType.WORD, value, position: start };
  }
}

export default TerminalLexer;