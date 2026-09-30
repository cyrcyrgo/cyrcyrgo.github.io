/**
 * 浏览器端 BPE 分词器（byte-level BPE，与 Python 端 tokenizers.ByteLevelBPETokenizer 完全一致）。
 * 读取 tokenizer/vocab.json 与 tokenizer/merges.txt。
 */
(function (global) {
  "use strict";

  // GPT-2 的字节 <-> unicode 映射，保证任意字节都能表示成可打印字符
  function bytesToUnicode() {
    const bs = [];
    for (let i = 33; i <= 126; i++) bs.push(i);
    for (let i = 161; i <= 172; i++) bs.push(i);
    for (let i = 174; i <= 255; i++) bs.push(i);
    const cs = bs.slice();
    let n = 0;
    for (let b = 0; b < 256; b++) {
      if (bs.indexOf(b) === -1) {
        bs.push(b);
        cs.push(256 + n);
        n++;
      }
    }
    const b2u = {}, u2b = {};
    for (let i = 0; i < bs.length; i++) {
      const ch = String.fromCodePoint(cs[i]);
      b2u[bs[i]] = ch;
      u2b[ch] = bs[i];
    }
    return { b2u, u2b };
  }

  // 与 HF ByteLevel 预分词一致的正则
  const PAT = /'s|'t|'re|'ve|'m|'ll|'d| ?\p{L}+| ?\p{N}+| ?[^\s\p{L}\p{N}]+|\s+(?!\S)|\s+/gu;

  class BPETokenizer {
    constructor(vocab, merges, specialTokens) {
      this.vocab = vocab;                 // { token: id }
      this.idsToToken = {};
      for (const [tok, id] of Object.entries(vocab)) this.idsToToken[id] = tok;
      this.ranks = new Map();
      merges.forEach((m, i) => this.ranks.set(m, i));
      this.specials = specialTokens || {};
      const { b2u, u2b } = bytesToUnicode();
      this.b2u = b2u;
      this.u2b = u2b;
      this.decoder = new TextDecoder("utf-8", { fatal: false });
      this.encoder = new TextEncoder();
    }

    static async load(vocabUrl, mergesUrl, specialTokens) {
      const [v, m] = await Promise.all([
        fetch(vocabUrl).then((r) => r.json()),
        fetch(mergesUrl).then((r) => r.text()),
      ]);
      const merges = m.split("\n").map((l) => l.trim()).filter((l) => l.length > 0 && !l.startsWith("#"));
      return new BPETokenizer(v, merges, specialTokens);
    }

    _bpe(token) {
      let word = token.split("");
      if (word.length < 2) return word;
      while (true) {
        let bestRank = Infinity, bestIdx = -1;
        for (let i = 0; i < word.length - 1; i++) {
          const r = this.ranks.get(word[i] + " " + word[i + 1]);
          if (r !== undefined && r < bestRank) {
            bestRank = r;
            bestIdx = i;
          }
        }
        if (bestIdx < 0) break;
        word.splice(bestIdx, 2, word[bestIdx] + word[bestIdx + 1]);
      }
      return word;
    }

    encode(text) {
      const ids = [];
      const matches = text.match(PAT) || [];
      for (const piece of matches) {
        const bytes = this.encoder.encode(piece);
        let mapped = "";
        for (let i = 0; i < bytes.length; i++) mapped += this.b2u[bytes[i]];
        for (const tok of this._bpe(mapped)) {
          const id = this.vocab[tok];
          if (id !== undefined) ids.push(id);
        }
      }
      return ids;
    }

    decode(ids) {
      let mapped = "";
      for (const id of ids) {
        const tok = this.idsToToken[id];
        if (tok === undefined) continue;
        if (this.specials[tok] !== undefined) {
          mapped += tok; // 特殊 token 原样保留
          continue;
        }
        mapped += tok;
      }
      // unicode 映射字符 -> 字节
      const bytes = [];
      for (const ch of mapped) {
        const b = this.u2b[ch];
        if (b !== undefined) {
          bytes.push(b);
        } else {
          const enc = this.encoder.encode(ch);
          for (const x of enc) bytes.push(x);
        }
      }
      return this.decoder.decode(new Uint8Array(bytes));
    }
  }

  global.BPETokenizer = BPETokenizer;
})(window);