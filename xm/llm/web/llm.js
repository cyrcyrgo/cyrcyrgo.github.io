/**
 * 浏览器端精简 LLM 推理引擎（纯 JS，逐 token 增量解码 + KV Cache）。
 * 与 Python 端 minillm/model.py 的计算完全对齐：
 *   RMSNorm(Pre-Norm) -> GQA 注意力(RoPE) -> SwiGLU FFN -> 残差 -> 权重共享输出头 -> 采样
 */
(function (global) {
  "use strict";

  function matvec(W, x, outDim, inDim) {
    // W: Float32Array [outDim, inDim] 行优先；y = W @ x
    const y = new Float32Array(outDim);
    for (let o = 0; o < outDim; o++) {
      let s = 0;
      const base = o * inDim;
      for (let i = 0; i < inDim; i++) s += W[base + i] * x[i];
      y[o] = s;
    }
    return y;
  }

  function rmsnorm(x, w, eps) {
    let ss = 0;
    for (let i = 0; i < x.length; i++) ss += x[i] * x[i];
    const inv = 1 / Math.sqrt(ss / x.length + eps);
    const y = new Float32Array(x.length);
    for (let i = 0; i < x.length; i++) y[i] = x[i] * inv * w[i];
    return y;
  }

  function silu(x) {
    return x / (1 + Math.exp(-x));
  }

  class MiniLLMJS {
    constructor(cfg, tensors) {
      this.cfg = cfg;
      this.t = tensors; // name -> Float32Array
      this.h = cfg.hidden_size;
      this.hd = cfg.hidden_size / cfg.num_attention_heads;
      this.nHeads = cfg.num_attention_heads;
      this.nKv = cfg.num_key_value_heads;
      this.nGroups = this.nHeads / this.nKv;
      this.nLayers = cfg.num_hidden_layers;
      this.vocab = cfg.vocab_size;
      this.eps = cfg.rms_norm_eps;
      this.theta = cfg.rope_theta;
      this.maxPos = cfg.max_position_embeddings;
      this.tie = cfg.tie_word_embeddings;
      this._buildRope();
      this.reset();
    }

    _buildRope() {
      const D = this.hd, half = D / 2;
      const invFreq = new Float32Array(half);
      for (let j = 0; j < half; j++) invFreq[j] = 1 / Math.pow(this.theta, (2 * j) / D);
      const cos = new Float32Array(this.maxPos * D);
      const sin = new Float32Array(this.maxPos * D);
      for (let p = 0; p < this.maxPos; p++) {
        for (let j = 0; j < half; j++) {
          const a = p * invFreq[j];
          const c = Math.cos(a), s = Math.sin(a);
          cos[p * D + j] = c; cos[p * D + j + half] = c;
          sin[p * D + j] = s; sin[p * D + j + half] = s;
        }
      }
      this.ropeCos = cos;
      this.ropeSin = sin;
    }

    reset() {
      // 每层 KV Cache：数组元素为每个位置的长度 nKv*hd 的向量
      this.kCache = [];
      this.vCache = [];
      for (let l = 0; l < this.nLayers; l++) {
        this.kCache.push([]);
        this.vCache.push([]);
      }
      this.pos = 0;
    }

    _rope(vec, offset, pos) {
      // 对 vec[offset .. offset+hd) 施加 RoPE
      const D = this.hd, half = D / 2, base = pos * D;
      const out = new Float32Array(D);
      for (let d = 0; d < D; d++) {
        const x = vec[offset + d];
        const rh = d < half ? -vec[offset + d + half] : vec[offset + d - half];
        out[d] = x * this.ropeCos[base + d] + rh * this.ropeSin[base + d];
      }
      return out;
    }

    _w(name) {
      const w = this.t[name];
      if (!w) throw new Error("缺少权重: " + name);
      return w;
    }

    /** 单 token 前向：返回 logits（Float32Array，长度 vocab） */
    forward(tokenId) {
      const h = this.h, hd = this.hd, nHeads = this.nHeads, nKv = this.nKv;
      const pos = this.pos;
      let x = new Float32Array(this.t["embed_tokens.weight"].subarray(tokenId * h, tokenId * h + h));

      for (let l = 0; l < this.nLayers; l++) {
        const p = "layers." + l + ".";
        // 注意力
        const hn = rmsnorm(x, this._w(p + "input_layernorm.weight"), this.eps);
        const q = matvec(this._w(p + "self_attn.q_proj.weight"), hn, nHeads * hd, h);
        const k = matvec(this._w(p + "self_attn.k_proj.weight"), hn, nKv * hd, h);
        const v = matvec(this._w(p + "self_attn.v_proj.weight"), hn, nKv * hd, h);

        const qr = new Float32Array(nHeads * hd);
        for (let hh = 0; hh < nHeads; hh++) qr.set(this._rope(q, hh * hd, pos), hh * hd);
        const kr = new Float32Array(nKv * hd);
        for (let hh = 0; hh < nKv; hh++) kr.set(this._rope(k, hh * hd, pos), hh * hd);

        this.kCache[l].push(kr);
        this.vCache[l].push(v);
        const seqLen = this.kCache[l].length;

        const attnOut = new Float32Array(nHeads * hd);
        const scale = 1 / Math.sqrt(hd);
        for (let hh = 0; hh < nHeads; hh++) {
          const kvh = Math.floor(hh / this.nGroups);
          const scores = new Float32Array(seqLen);
          let maxS = -Infinity;
          for (let t = 0; t < seqLen; t++) {
            const kt = this.kCache[l][t];
            let s = 0;
            for (let d = 0; d < hd; d++) s += qr[hh * hd + d] * kt[kvh * hd + d];
            s *= scale;
            scores[t] = s;
            if (s > maxS) maxS = s;
          }
          let sum = 0;
          for (let t = 0; t < seqLen; t++) { scores[t] = Math.exp(scores[t] - maxS); sum += scores[t]; }
          for (let d = 0; d < hd; d++) {
            let acc = 0;
            for (let t = 0; t < seqLen; t++) acc += (scores[t] / sum) * this.vCache[l][t][kvh * hd + d];
            attnOut[hh * hd + d] = acc;
          }
        }
        const proj = matvec(this._w(p + "self_attn.o_proj.weight"), attnOut, h, nHeads * hd);
        for (let i = 0; i < h; i++) x[i] += proj[i];

        // FFN (SwiGLU)
        const hn2 = rmsnorm(x, this._w(p + "post_attention_layernorm.weight"), this.eps);
        const inter = this.cfg.intermediate_size;
        const gate = matvec(this._w(p + "mlp.gate_proj.weight"), hn2, inter, h);
        const up = matvec(this._w(p + "mlp.up_proj.weight"), hn2, inter, h);
        const act = new Float32Array(inter);
        for (let i = 0; i < inter; i++) act[i] = silu(gate[i]) * up[i];
        const down = matvec(this._w(p + "mlp.down_proj.weight"), act, h, inter);
        for (let i = 0; i < h; i++) x[i] += down[i];
      }

      x = rmsnorm(x, this._w("norm.weight"), this.eps);
      const headW = this.tie ? this.t["embed_tokens.weight"] : this.t["lm_head.weight"];
      this.pos += 1;
      return matvec(headW, x, this.vocab, h);
    }

    /** 采样：temperature / top-k / top-p */
    static sample(logits, temperature, topK, topP) {
      if (temperature <= 0) {
        let bi = 0;
        for (let i = 1; i < logits.length; i++) if (logits[i] > logits[bi]) bi = i;
        return bi;
      }
      const idx = Array.from(logits.keys());
      const vals = Float32Array.from(logits, (v) => v / temperature);
      idx.sort((a, b) => vals[b] - vals[a]);

      let cand = idx;
      if (topK > 0) cand = cand.slice(0, Math.min(topK, cand.length));

      if (topP < 1.0) {
        let maxV = vals[cand[0]], sum = 0;
        const probs = cand.map((i) => { const e = Math.exp(vals[i] - maxV); sum += e; return e; });
        let cum = 0;
        const kept = [];
        for (let i = 0; i < cand.length; i++) {
          cum += probs[i] / sum;
          kept.push(cand[i]);
          if (cum > topP) break;
        }
        cand = kept;
      }

      let maxV = vals[cand[0]], sum = 0;
      const probs = cand.map((i) => { const e = Math.exp(vals[i] - maxV); sum += e; return e; });
      let r = Math.random() * sum;
      for (let i = 0; i < cand.length; i++) {
        r -= probs[i];
        if (r <= 0) return cand[i];
      }
      return cand[cand.length - 1];
    }
  }

  global.MiniLLMJS = MiniLLMJS;
})(window);