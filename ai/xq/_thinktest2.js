global.window = global;
global.localStorage = {
  _d: { xq_ai_settings: JSON.stringify({
    key: 'sk-e418dd47b2764484a82f3e1676d14ca1',
    url: 'https://api.deepseek.com/v1/chat/completions',
    model: 'deepseek-v4-flash',
  }) },
  getItem(k) { return this._d[k] || null; },
  setItem(k, v) { this._d[k] = v; },
};
require('./js/xiangqi.js');
require('./js/settings.js');

const board = Xq.initBoard();
const legalMs = Xq.legalMoves(board, 'black');
const preview = legalMs.slice(0, 180).map(m =>
  '  (' + m[0] + ',' + m[1] + ' ' + (board[m[0]][m[1]] || '.') + ')→(' + m[2] + ',' + m[3] + ')'
).join('\n');
const boardWHeaders = (function () {
  const colHeader = '   ' + '012345678';
  const rows = Xq.boardText(board).split('\n');
  return [colHeader].concat(rows.map((r, i) => (' ' + i).slice(-2) + ' ' + r + ' ' + (' ' + i).slice(-2))).concat([colHeader]).join('\n');
})();

const system = [
  '你是中国象棋 AI。',
  '棋盘坐标系：row 行 0..9（0 最上、9 最下），col 列 0..8（0 最左、8 最右），严格从零开始。',
  '红方棋子 = 大写：K帅 A仕 B相 N马 R车 C炮 P兵；黑方棋子 = 小写：k将 a士 b象 n马 r车 c炮 p卒。',
  '你执黑方，你的棋子都是小写。你只能移动你自己颜色（小写）的棋子。',
  '',
  '工作流（必须严格遵守）：',
  '  ① 先进行分析和思考（这些可以放在你自己的思维链里，系统会忽略、不算作你的最终输出）；',
  '  ② 思考完毕后，把【最终决定】作为正式回答输出，并且必须且只能输出一个裸 JSON；',
  '  ③ 最终决定 JSON 格式精确为：{"from":"R,C","to":"R,C"}，R、C 为整数，不要再写解释、代码块、标签、多余字符。',
  '  ⚠ 系统只会提取正式回答里的最后一个 JSON 作为你的最终坐标，草稿和思维链里的任何 JSON 都不会被采信。',
].join('\n');

const user = [
  '棋盘（4 个边缘都带行号列号，可对照确认坐标）：',
  boardWHeaders,
  '',
  '你执黑方（小写）。下面列出【当前合法走法全集】(from_row,from_col 棋子)→(to_row,to_col)，你必须从下列候选中挑一条（任选其一即可），不要自己编造：',
  preview,
  '',
  '步骤：① 先按你自己的方式深入思考；② 思考结束后，把最终决定以且仅以一个 JSON 输出，格式：{"from":"R,C","to":"R,C"}。',
].join('\n');

(async () => {
  const t0 = Date.now();
  let lastPrint = 0;
  try {
    const res = await XQSettings.chat(
      [{role:'system',content:system},{role:'user',content:user}],
      {
        onProgress: (p) => {
          const now = Date.now();
          if (now - lastPrint < 10000) return;
          lastPrint = now;
          process.stderr.write('[' + ((now-t0)/1000).toFixed(0) + 's] reasoning=' + p.reasoningChars + ' content=' + p.contentChars + '\n');
        },
      }
    );
    const took = ((Date.now() - t0) / 1000).toFixed(1);
    console.log('=== SUMMARY ===');
    console.log('TOOK=', took, 's');
    console.log('REASONING_LEN=', res.reasoning.length);
    console.log('CONTENT=', JSON.stringify(res.content));
    const matches = String(res.content || '').match(/\{[\s\S]*?\}/g);
    const blockJson = matches && matches.length ? matches[matches.length - 1] : res.content;
    const f = blockJson.match(/"from"\s*:\s*"?(\d+),(\d+)"?/);
    const t = blockJson.match(/"to"\s*:\s*"?(\d+),(\d+)"?/);
    if (!f || !t) { console.log('PARSE_FAIL=1'); process.exit(1); }
    const [fr,fc,tr,tc] = [+f[1],+f[2],+t[1],+t[2]];
    const legal = legalMs.find(mm => mm[0]===fr&&mm[1]===fc&&mm[2]===tr&&mm[3]===tc);
    console.log('PARSED_MOVE=', [fr,fc,tr,tc]);
    console.log('FROM_PIECE=', JSON.stringify(board[fr] && board[fr][fc]));
    console.log('VALID_LEGAL=', !!legal);
    process.exit(legal ? 0 : 2);
  } catch (e) { console.error('ERR=', e && e.message || e); process.exit(1); }
})();