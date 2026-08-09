/**
 * 五子棋游戏逻辑模块
 * 包含棋盘状态管理、落子验证、胜负判定、画布渲染
 */

class GomokuGame {
  constructor() {
    this.board = [];          // 15x15二维数组，0=空 1=黑棋 2=白棋
    this.currentPlayer = 1;   // 1=黑棋(创建者) 2=白棋(加入者)
    this.myColor = 1;         // 本方颜色
    this.gameOver = false;
    this.winner = 0;          // 0=无 1=黑胜 2=白胜
    this.moveHistory = [];    // 落子历史 [{x, y, color}]
    this.lastMove = null;     // 最后一步落子
    
    this.canvas = null;
    this.ctx = null;
    this.onMoveCallback = null;   // 落子回调
    this.onGameOverCallback = null; // 游戏结束回调

    this._initBoard();
  }

  // 初始化棋盘
  _initBoard() {
    this.board = [];
    for (let i = 0; i < BOARD_SIZE; i++) {
      this.board[i] = [];
      for (let j = 0; j < BOARD_SIZE; j++) {
        this.board[i][j] = 0;
      }
    }
  }

  /**
   * 初始化画布
   * @param {string} canvasId - Canvas元素的ID
   */
  initCanvas(canvasId) {
    this.canvas = document.getElementById(canvasId);
    if (!this.canvas) return;
    this.canvas.width = CANVAS_SIZE;
    this.canvas.height = CANVAS_SIZE;
    this.ctx = this.canvas.getContext('2d');
    
    // 绑定点击事件
    this.canvas.addEventListener('click', (e) => this._handleCanvasClick(e));
    
    this.render();
  }

  /**
   * 设置玩家颜色
   * @param {number} color - 1=黑棋(创建者) 2=白棋(加入者)
   */
  setMyColor(color) {
    this.myColor = color;
    this.currentPlayer = 1; // 黑棋先手
  }

  /**
   * 设置落子回调
   * @param {Function} callback - 回调函数，接收 {x, y}
   */
  onMove(callback) {
    this.onMoveCallback = callback;
  }

  /**
   * 设置游戏结束回调
   * @param {Function} callback - 回调函数，接收 winner
   */
  onGameOver(callback) {
    this.onGameOverCallback = callback;
  }

  // ========== 画布渲染 ==========

  /**
   * 渲染整个棋盘
   */
  render() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const size = CANVAS_SIZE;
    const padding = BOARD_PADDING;
    const cellSize = CELL_SIZE;

    // 清空画布
    ctx.clearRect(0, 0, size, size);

    // 绘制棋盘背景
    ctx.fillStyle = BOARD_BG;
    ctx.fillRect(0, 0, size, size);

    // 绘制网格线
    ctx.strokeStyle = BOARD_LINE_COLOR;
    ctx.lineWidth = 1;
    for (let i = 0; i < BOARD_SIZE; i++) {
      const pos = padding + i * cellSize;
      // 横线
      ctx.beginPath();
      ctx.moveTo(padding, pos);
      ctx.lineTo(padding + (BOARD_SIZE - 1) * cellSize, pos);
      ctx.stroke();
      // 竖线
      ctx.beginPath();
      ctx.moveTo(pos, padding);
      ctx.lineTo(pos, padding + (BOARD_SIZE - 1) * cellSize);
      ctx.stroke();
    }

    // 绘制星位（天元 + 四隅星位）
    const starPoints = [
      [3, 3], [3, 7], [3, 11],
      [7, 3], [7, 7], [7, 11],
      [11, 3], [11, 7], [11, 11]
    ];
    ctx.fillStyle = STAR_POINT_COLOR;
    for (const [x, y] of starPoints) {
      ctx.beginPath();
      ctx.arc(padding + x * cellSize, padding + y * cellSize, 4, 0, Math.PI * 2);
      ctx.fill();
    }

    // 绘制棋子
    for (let i = 0; i < BOARD_SIZE; i++) {
      for (let j = 0; j < BOARD_SIZE; j++) {
        if (this.board[i][j] !== 0) {
          this._drawPiece(ctx, i, j, this.board[i][j]);
        }
      }
    }

    // 标记最后一步
    if (this.lastMove) {
      this._drawLastMoveMarker(ctx, this.lastMove.x, this.lastMove.y);
    }

    // 绘制坐标标签
    ctx.fillStyle = '#333';
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let i = 0; i < BOARD_SIZE; i++) {
      // 顶部坐标（字母）
      ctx.fillText(String.fromCharCode(65 + i), padding + i * cellSize, 12);
      // 左侧坐标（数字）
      ctx.fillText(String(i + 1), 12, padding + i * cellSize);
    }
  }

  /**
   * 绘制单个棋子
   */
  _drawPiece(ctx, x, y, color) {
    const cx = BOARD_PADDING + x * CELL_SIZE;
    const cy = BOARD_PADDING + y * CELL_SIZE;
    const r = PIECE_RADIUS;

    // 棋子阴影
    ctx.beginPath();
    ctx.arc(cx + 1, cy + 1, r, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,0.2)';
    ctx.fill();

    // 棋子本体
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    
    if (color === 1) {
      // 黑棋：渐变效果
      const gradient = ctx.createRadialGradient(cx - 4, cy - 4, 2, cx, cy, r);
      gradient.addColorStop(0, '#555');
      gradient.addColorStop(1, BLACK_COLOR);
      ctx.fillStyle = gradient;
    } else {
      // 白棋：渐变效果
      const gradient = ctx.createRadialGradient(cx - 4, cy - 4, 2, cx, cy, r);
      gradient.addColorStop(0, '#fff');
      gradient.addColorStop(1, WHITE_COLOR);
      ctx.fillStyle = gradient;
    }
    ctx.fill();
    ctx.strokeStyle = color === 1 ? '#000' : '#ccc';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  /**
   * 绘制最后一步标记（红色小点）
   */
  _drawLastMoveMarker(ctx, x, y) {
    const cx = BOARD_PADDING + x * CELL_SIZE;
    const cy = BOARD_PADDING + y * CELL_SIZE;
    ctx.beginPath();
    ctx.arc(cx, cy, 4, 0, Math.PI * 2);
    ctx.fillStyle = '#e74c3c';
    ctx.fill();
  }

  // ========== 交互处理 ==========

  /**
   * 处理画布点击事件
   */
  _handleCanvasClick(e) {
    if (this.gameOver) return;
    // 检查是否轮到本方
    if (this.currentPlayer !== this.myColor) return;

    const rect = this.canvas.getBoundingClientRect();
    const scaleX = this.canvas.width / rect.width;
    const scaleY = this.canvas.height / rect.height;
    
    const mx = (e.clientX - rect.left) * scaleX;
    const my = (e.clientY - rect.top) * scaleY;

    // 计算最近的交叉点
    const x = Math.round((mx - BOARD_PADDING) / CELL_SIZE);
    const y = Math.round((my - BOARD_PADDING) / CELL_SIZE);

    // 检查是否在有效范围内
    if (x < 0 || x >= BOARD_SIZE || y < 0 || y >= BOARD_SIZE) return;

    // 尝试落子
    if (this.placePiece(x, y)) {
      // 调用回调通知外部（将通过DataChannel发送）
      if (this.onMoveCallback) {
        this.onMoveCallback({ x, y });
      }
    }
  }

  // ========== 游戏逻辑 ==========

  /**
   * 在指定位置落子
   * @param {number} x - 横坐标
   * @param {number} y - 纵坐标
   * @param {number} color - 棋子颜色（可选，默认使用当前玩家）
   * @returns {boolean} 是否落子成功
   */
  placePiece(x, y, color) {
    // 检查位置是否有效
    if (x < 0 || x >= BOARD_SIZE || y < 0 || y >= BOARD_SIZE) return false;
    if (this.board[x][y] !== 0) return false;
    if (this.gameOver) return false;

    const pieceColor = color || this.currentPlayer;

    // 落子
    this.board[x][y] = pieceColor;
    this.lastMove = { x, y };
    this.moveHistory.push({ x, y, color: pieceColor });

    // 检查胜负
    if (this.checkWin(x, y, pieceColor)) {
      this.gameOver = true;
      this.winner = pieceColor;
      if (this.onGameOverCallback) {
        this.onGameOverCallback(pieceColor);
      }
    }

    // 切换玩家
    this.currentPlayer = this.currentPlayer === 1 ? 2 : 1;

    // 重新渲染
    this.render();
    return true;
  }

  /**
   * 检查五子连珠
   * 从落子位置向四个方向（横/竖/对角线）检查
   * @param {number} x - 落子横坐标
   * @param {number} y - 落子纵坐标
   * @param {number} color - 棋子颜色
   * @returns {boolean} 是否五子连珠
   */
  checkWin(x, y, color) {
    // 四个方向向量：水平、垂直、主对角线、副对角线
    const directions = [
      [1, 0],  // 水平
      [0, 1],  // 垂直
      [1, 1],  // 主对角线（\）
      [1, -1]  // 副对角线（/）
    ];

    for (const [dx, dy] of directions) {
      let count = 1; // 当前棋子

      // 正方向延伸
      for (let step = 1; step < 5; step++) {
        const nx = x + dx * step;
        const ny = y + dy * step;
        if (nx < 0 || nx >= BOARD_SIZE || ny < 0 || ny >= BOARD_SIZE) break;
        if (this.board[nx][ny] !== color) break;
        count++;
      }

      // 反方向延伸
      for (let step = 1; step < 5; step++) {
        const nx = x - dx * step;
        const ny = y - dy * step;
        if (nx < 0 || nx >= BOARD_SIZE || ny < 0 || ny >= BOARD_SIZE) break;
        if (this.board[nx][ny] !== color) break;
        count++;
      }

      // 五子连珠
      if (count >= 5) return true;
    }

    return false;
  }

  /**
   * 从指定位置开始，沿指定方向计算连续同色棋子数
   */
  _countDirection(x, y, dx, dy, color) {
    let count = 0;
    let cx = x + dx;
    let cy = y + dy;
    while (cx >= 0 && cx < BOARD_SIZE && cy >= 0 && cy < BOARD_SIZE && this.board[cx][cy] === color) {
      count++;
      cx += dx;
      cy += dy;
    }
    return count;
  }

  /**
   * 重置游戏
   */
  reset() {
    this._initBoard();
    this.currentPlayer = 1;
    this.gameOver = false;
    this.winner = 0;
    this.moveHistory = [];
    this.lastMove = null;
    this.render();
  }

  /**
   * 悔棋（撤销最后一步）
   * 仅用于本地预览，实际对战中需双方协商
   */
  undoLastMove() {
    if (this.moveHistory.length === 0) return false;
    const last = this.moveHistory.pop();
    this.board[last.x][last.y] = 0;
    this.currentPlayer = last.color;
    this.lastMove = this.moveHistory.length > 0 ? this.moveHistory[this.moveHistory.length - 1] : null;
    this.gameOver = false;
    this.winner = 0;
    this.render();
    return true;
  }
}