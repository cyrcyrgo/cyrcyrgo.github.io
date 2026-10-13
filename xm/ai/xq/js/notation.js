/* 记谱法转换：内部坐标 (row, col) 与 标准中国象棋记谱法 双向转换
 * 依赖 window.XqRules（颜色、查找等工具）
 */
(function () {
  'use strict';
  const { colorOf } = window.XqRules;

  const RED_FILE = '一二三四五六七八九';   // 红方 1~9 路（从左到右）
  const BLACK_FILE = '123456789';           // 黑方 1~9 路（从左到右）

  const PIECE_CN = {
    K: '帅', A: '仕', B: '相', N: '马', R: '车', C: '炮', P: '兵',
    k: '将', a: '士', b: '象', n: '马', r: '车', c: '炮', p: '卒',
  };
  // 反向：汉字 → 棋子字母（同汉字可能对应多字母，解析用）
  const CN_TO_PIECE = {};
  for (const k in PIECE_CN) {
    const s = PIECE_CN[k];
    (CN_TO_PIECE[s] = CN_TO_PIECE[s] || []).push(k);
  }

  /* 汉字名 → 类型字母（大写的类型名），用于判定“用列号还是格数” */
  function pieceTypeOf(name) {
    const arr = CN_TO_PIECE[name] || [];
    return arr.length ? arr[0].toUpperCase() : null;
  }

  /* 内部列 → 记谱列号（1~9）。红方从左到右；黑方从右到左（黑方视角） */
  function colToFile(col, color) {
    return color === 'red' ? col + 1 : 9 - col;
  }
  function fileToCol(file, color) {
    return color === 'red' ? file - 1 : 9 - file;
  }

  /* 单个棋子 → 汉字（区分红黑同字，如 相/象） */
  function pieceName(p) {
    return PIECE_CN[p] || '?';
  }

  /* 判断同一列上该类型棋子是否多于一个，用于“前/后”修饰
   * 同文件定义：对红方，viewCol = col；对黑方，viewCol(黑视角) 即 colToFile 的原始列。 */
  function countOnFile(b, color, pieceType, col) {
    let n = 0;
    let rows = [];
    for (let r = 0; r < 10; r++) {
      const q = b[r][col];
      if (q === '.') continue;
      if (colorOf(q) === color && q.toUpperCase() === pieceType.toUpperCase()) {
        n++; rows.push(r);
      }
    }
    return { n, rows };
  }

  /* ============ 内部坐标 → 记谱法 ============ */
  function toNotation(b, fr, fc, tr, tc) {
    const p = b[fr][fc];
    const color = colorOf(p);
    const type = p.toUpperCase();
    const name = pieceName(p);

    // 前/后 修饰（同一文件同一类型棋子多于1个）
    const { n, rows } = countOnFile(b, color, type, fc);
    let frontBack = null;
    if (n > 1) {
      const sorted = rows.slice().sort((a, z) => (color === 'red' ? a - z : z - a));
      frontBack = sorted[0] === fr ? ('前' + name) : ('后' + name);
      // 前 = 更靠前的（对红方 row 更大即更接近对手；对黑方 row 更小即更接近对手）
    }

    const file = colToFile(fc, color);               // 起始列
    const fileStr = color === 'red' ? RED_FILE[file - 1] : String(file);

    // 判定 进/退/平
    let action, target;
    if (tr === tc ? false : false) { /* noop */ }
    if (tr === fr) { // 平
      action = '平';
      target = colToFile(tc, color);
    } else {
      const forward = color === 'red' ? tr > fr : tr < fr; // 进=向前
      action = forward ? '进' : '退';
      if (['K', 'A', 'B', 'N'].includes(type)) {
        // 马、仕/士、相/象：目标列号
        target = colToFile(tc, color);
      } else {
        // 车、炮、帅/将、兵/卒：前进/后退的格数
        target = Math.abs(tr - fr);
      }
    }
    const targetStr = color === 'red' ? RED_FILE[target - 1] : String(target);

    return (frontBack ? frontBack : name + fileStr) + action + targetStr;
  }

  /* ============ 记谱法 → 内部坐标 ============ */
  /* 给定走棋方 color 与棋盘，解析记谱字符串，返回 [fr, fc, tr, tc] 或 null */
  function parseMove(notation, b, color) {
    if (typeof notation !== 'string') return null;
    let s = notation.trim();
    if (!s) return null;

    const fileNums = color === 'red' ? RED_FILE : BLACK_FILE;
    const fileToNum = {};
    for (let i = 0; i < 9; i++) fileToNum[fileNums[i]] = i + 1;

    // 可能带“前/后”前缀
    let frontBack = null;
    let leadingName = null;
    if (s[0] === '前' || s[0] === '后') {
      frontBack = s[0];
      s = s.slice(1);
    }

    // 识别棋子名（车马炮相象仕士卒兵帅将）
    // 名字可能为 1~2 个汉字；先匹配名字表中最长的
    let name = null, nameLen = 0;
    for (const cn in CN_TO_PIECE) {
      if (cn.length > nameLen && s.startsWith(cn)) { name = cn; nameLen = cn.length; }
    }
    if (!name) return null;
    s = s.slice(nameLen);
    if (!leadingName) leadingName = name;

    // 起始列（1~9）
    if (s.length < 1) return null;
    const startFile = fileToNum[s[0]];
    if (!startFile) return null;
    s = s.slice(1);

    // 动作
    if (s.length < 1) return null;
    const action = s[0];
    s = s.slice(1);
    if (!['进', '退', '平'].includes(action)) return null;

    // 目标（列号 或 格数）
    if (s.length < 1) return null;
    const targetStr = s[0]; s = s.slice(1);
    // 依棋子类型判定目标表示：马/仕/象用列号；车/炮/帅/兵卒用格数
    const type = pieceTypeOf(name);
    const usesFile = ['N', 'A', 'B'].includes(type) && action !== '平';
    let target;
    if (action === '平') {
      target = { kind: 'file', file: fileToNum[targetStr] };
      if (!target.file) return null;
    } else if (usesFile) {
      target = { kind: 'file', file: fileToNum[targetStr] };
      if (!target.file) return null;
    } else {
      target = { kind: 'steps', steps: parseInt(targetStr, 10) };
      if (isNaN(target.steps)) return null;
    }

    // 确定所有候选位置
    const candidates = findCandidates(b, color, leadingName, frontBack, startFile);
    if (!candidates || candidates.length === 0) return null;

    // 计算最终落点
    const legals = window.XqRules.legalMoves(b, color);
    // 目标列（若目标为列号）
    const targetCol = target.kind === 'file' ? fileToCol(target.file, color) : null;

    for (const frc of candidates) {
      const fr = frc[0], fc = frc[1];

      if (action === '平') {
        // 只适用于车/炮/帅/将/兵（横走）
        const move = [fr, fc, fr, targetCol];
        const found = legals.find(m => m[0] === fr && m[1] === fc && m[2] === move[2] && m[3] === move[3]);
        if (found) return found;
        continue;
      }

      // 目标为列号的棋子（马、仕/士、相/象）：在合法走法中按 目标列 + 进/退 方向匹配
      if (target.kind === 'file') {
        for (const lm of legals) {
          if (lm[0] !== fr || lm[1] !== fc) continue;
          if (lm[3] !== targetCol) continue;
          if (action === '进' && !(color === 'red' ? lm[2] > fr : lm[2] < fr)) continue;
          if (action === '退' && !(color === 'red' ? lm[2] < fr : lm[2] > fr)) continue;
          return lm;
        }
        continue;
      }

      // 目标为步数（车、炮、帅/将、兵/卒）
      const steps = target.steps;
      let tr, tc;
      if (action === '进') { tr = color === 'red' ? fr + steps : fr - steps; tc = fc; }
      else { tr = color === 'red' ? fr - steps : fr + steps; tc = fc; }
      const move = [fr, fc, tr, tc];
      const found = legals.find(m => m[0] === fr && m[1] === fc && m[2] === tr && m[3] === tc);
      if (found) return found;
    }
    return null;
  }

  /* 根据棋子名、前/后、起始列，找出可能的 (row, col) 起点 */
  function findCandidates(b, color, name, frontBack, startFile) {
    const typeLetters = CN_TO_PIECE[name] || [];
    const fc = fileToCol(startFile, color);
    const out = [];
    for (let r = 0; r < 10; r++) {
      const q = b[r][fc];
      if (q === '.') continue;
      if (colorOf(q) !== color) continue;
      if (!typeLetters.includes(q)) continue; // 匹配字母（含大小写区分，但用 includes 容忍同字）
      out.push([r, fc]);
    }
    if (out.length === 0) return null;
    if (frontBack) {
      const sorted = out.slice().sort((a, z) => (color === 'red' ? a[0] - z[0] : z[0] - a[0]));
      return frontBack === '前' ? [sorted[0]] : [sorted[sorted.length - 1]];
    }
    return out;
  }

  window.Notation = {
    toNotation, parseMove, colToFile, fileToCol, pieceName, PIECE_CN,
  };
})();