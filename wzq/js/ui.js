/**
 * UI管理模块 - 页面切换、事件绑定、状态更新
 * 协调各模块之间的交互
 */

class AppUI {
  constructor() {
    this.currentPage = 'login'; // login | lobby | game
    this.currentMode = null;    // lan | wan | ngrok
    this.username = '';
    this.pcManager = null;      // PeerConnectionManager实例
    this.game = null;           // GomokuGame实例
    this.localIP = null;
    this.publicIP = null;
    this.ngrokUrl = null;
    this.roomCode = null;       // 当前生成的房间码
    this.responseCode = null;   // 收到的回复码
    this.isCreator = false;     // 是否为房间创建者
    this.opponentName = '对手';

    this._init();
  }

  // ========== 初始化 ==========
  _init() {
    // 加载保存的用户名
    this.username = localStorage.getItem(STORAGE_KEYS.USERNAME) || '';
    if (this.username) {
      document.getElementById('username-input').value = this.username;
    }

    // 绑定全局事件
    this._bindEvents();
  }

  // 绑定所有事件
  _bindEvents() {
    // ===== 登录页 =====
    document.getElementById('login-btn').addEventListener('click', () => this._handleLogin());
    document.getElementById('username-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this._handleLogin();
    });

    // 模式选择按钮
    document.querySelectorAll('.mode-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const mode = btn.dataset.mode;
        this._selectMode(mode);
      });
    });

    // ===== 大厅页 =====
    // 创建房间
    document.getElementById('create-room-btn').addEventListener('click', () => this._handleCreateRoom());
    // 加入房间
    document.getElementById('join-room-btn').addEventListener('click', () => this._handleJoinRoom());
    // 复制房间码
    document.getElementById('copy-code-btn').addEventListener('click', () => this._handleCopyCode());
    // 复制回复码
    document.getElementById('copy-response-btn').addEventListener('click', () => this._handleCopyResponseCode());
    // 确认回复码
    document.getElementById('confirm-response-btn').addEventListener('click', () => this._handleConfirmResponse());
    // 返回
    document.getElementById('back-to-login-btn').addEventListener('click', () => this._goToPage('login'));
    document.getElementById('back-to-lobby-btn').addEventListener('click', () => this._handleBackToLobby());

    // ===== 游戏页 =====
    document.getElementById('restart-btn').addEventListener('click', () => this._handleRestart());
    document.getElementById('quit-btn').addEventListener('click', () => this._handleQuit());
    document.getElementById('send-chat-btn').addEventListener('click', () => this._handleSendChat());
    document.getElementById('chat-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this._handleSendChat();
    });
  }

  // ========== 页面切换 ==========
  _goToPage(page) {
    // 隐藏所有页面
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    // 显示目标页面
    document.getElementById(`${page}-page`).classList.add('active');
    this.currentPage = page;
  }

  // ========== 登录逻辑 ==========
  _handleLogin() {
    const username = document.getElementById('username-input').value.trim();
    if (!username) {
      alert('请输入用户名');
      return;
    }
    this.username = username;
    localStorage.setItem(STORAGE_KEYS.USERNAME, username);
    this._goToPage('lobby');
  }

  // ========== 模式选择 ==========
  async _selectMode(mode) {
    this.currentMode = mode;
    this.isCreator = false;

    // 更新模式标题
    const titles = {
      lan: '🏠 内网模式',
      wan: '🌐 外网模式',
      ngrok: '🚀 Ngrok模式'
    };
    document.getElementById('mode-title').textContent = titles[mode] || '选择模式';

    // 显示模式特定配置
    document.querySelectorAll('.mode-config').forEach(el => el.classList.add('hidden'));
    document.getElementById(`${mode}-config`).classList.remove('hidden');

    // 隐藏所有操作区域
    document.querySelectorAll('.room-action').forEach(el => el.classList.add('hidden'));

    // 获取IP
    if (mode === 'lan') {
      this.localIP = await getLocalIP();
      document.getElementById('lan-ip-display').textContent = this.localIP;
    } else if (mode === 'wan') {
      document.getElementById('wan-ip-status').textContent = '正在获取公网IP...';
      this.publicIP = await getPublicIP();
      document.getElementById('wan-ip-status').textContent = this.publicIP ? `公网IP: ${this.publicIP}` : '获取公网IP失败';
    } else if (mode === 'ngrok') {
      // 检查Ngrok令牌
      const savedToken = getNgrokToken();
      if (savedToken) {
        document.getElementById('ngrok-token-input').value = savedToken;
      }
      // 尝试获取Ngrok URL
      document.getElementById('ngrok-status').textContent = '正在检查Ngrok状态...';
      this.ngrokUrl = await getNgrokUrl();
      document.getElementById('ngrok-status').textContent = this.ngrokUrl ? `Ngrok URL: ${this.ngrokUrl}` : 'Ngrok未运行（请先启动Ngrok）';
    }

    this._goToPage('lobby');
  }

  // ========== 创建房间 ==========
  async _handleCreateRoom() {
    this.isCreator = true;
    
    // 创建WebRTC连接
    this.pcManager = new PeerConnectionManager(this.currentMode, {
      onMessage: (data) => this._handleIncomingMessage(data),
      onStateChange: (state) => this._updateConnectionState(state)
    });

    try {
      // 生成Offer SDP
      const sdp = await this.pcManager.createOffer();

      // 生成房间码
      const roomInfo = {
        sdp: sdp,
        nickname: this.username,
        ip: this.localIP || this.publicIP || 'unknown',
        ngrokUrl: this.ngrokUrl || undefined
      };

      const result = generateRoomCode(this.currentMode, roomInfo);
      this.roomCode = result.code;

      // 显示房间码
      document.getElementById('room-code-display').textContent = result.display;
      document.getElementById('room-code-full').textContent = result.code;
      document.getElementById('room-code-area').classList.remove('hidden');

      // 显示回复码输入区（等待对方回复）
      document.getElementById('response-input-area').classList.remove('hidden');
      document.getElementById('waiting-msg').textContent = '⏳ 等待对方粘贴房间码连接...';
      document.getElementById('waiting-msg').classList.remove('hidden');

      // 隐藏创建/加入按钮
      document.querySelectorAll('.room-action').forEach(el => el.classList.add('hidden'));

      this._updateConnectionState(CONN_STATE.WAITING);
    } catch (e) {
      console.error('创建房间失败:', e);
      alert('创建房间失败: ' + e.message);
    }
  }

  // ========== 加入房间 ==========
  async _handleJoinRoom() {
    const input = document.getElementById('join-code-input').value.trim();
    if (!input) {
      alert('请输入房间码');
      return;
    }

    // 解析房间码
    let roomData = parseRoomCode(input);
    if (!roomData) {
      alert('房间码无效，请检查后重试');
      return;
    }

    this.isCreator = false;
    this.opponentName = roomData.nickname || '对手';

    // 创建WebRTC连接
    this.pcManager = new PeerConnectionManager(this.currentMode, {
      onMessage: (data) => this._handleIncomingMessage(data),
      onStateChange: (state) => this._updateConnectionState(state)
    });

    try {
      // 创建Answer
      const sdp = await this.pcManager.createAnswer(roomData.sdp);

      // 生成回复码
      const responseCode = generateResponseCode(sdp, this.username);
      this.responseCode = responseCode;

      // 显示回复码
      document.getElementById('response-code-display').textContent = responseCode;
      document.getElementById('response-code-area').classList.remove('hidden');

      // 隐藏创建/加入按钮
      document.querySelectorAll('.room-action').forEach(el => el.classList.add('hidden'));

      this._updateConnectionState(CONN_STATE.CONNECTING);
    } catch (e) {
      console.error('加入房间失败:', e);
      alert('加入房间失败: ' + e.message);
    }
  }

  // ========== 复制功能 ==========
  _handleCopyCode() {
    const code = document.getElementById('room-code-full').textContent;
    navigator.clipboard.writeText(code).then(() => {
      this._showToast('房间码已复制');
    }).catch(() => {
      // 降级方案
      const textarea = document.createElement('textarea');
      textarea.value = code;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      this._showToast('房间码已复制');
    });
  }

  _handleCopyResponseCode() {
    const code = document.getElementById('response-code-display').textContent;
    navigator.clipboard.writeText(code).then(() => {
      this._showToast('回复码已复制，请发送给房间创建者');
    }).catch(() => {
      const textarea = document.createElement('textarea');
      textarea.value = code;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      this._showToast('回复码已复制，请发送给房间创建者');
    });
  }

  // ========== 确认回复码（创建者收到回复码后） ==========
  async _handleConfirmResponse() {
    const input = document.getElementById('response-code-input').value.trim();
    if (!input) {
      alert('请输入对方回复的回复码');
      return;
    }

    const responseData = parseResponseCode(input);
    if (!responseData) {
      alert('回复码无效，请检查后重试');
      return;
    }

    this.opponentName = responseData.nickname || '对手';

    try {
      await this.pcManager.setRemoteAnswer(responseData.sdp);
      this._showToast('连接建立成功！');
      this._startGame();
    } catch (e) {
      console.error('设置远程描述失败:', e);
      alert('连接失败: ' + e.message);
    }
  }

  // ========== 消息处理 ==========
  _handleIncomingMessage(data) {
    switch (data.type) {
      case 'move':
        // 对方落子
        if (this.game) {
          const color = this.isCreator ? 2 : 1; // 对方颜色
          this.game.placePiece(data.x, data.y, color);
          this._updateTurnIndicator();
        }
        break;
      case 'restart':
        // 对方请求重开
        if (this.game) {
          this.game.reset();
          this._updateTurnIndicator();
          this._showToast('对方请求重新开局');
        }
        break;
      case 'chat':
        // 聊天消息
        this._addChatMessage(this.opponentName, data.text);
        break;
    }
  }

  // ========== 连接状态更新 ==========
  _updateConnectionState(state) {
    const statusEl = document.getElementById('connection-status');
    const statusMap = {
      [CONN_STATE.IDLE]: { text: '⚪ 未连接', color: '#999' },
      [CONN_STATE.WAITING]: { text: '⏳ 等待对方连接...', color: '#f39c12' },
      [CONN_STATE.CONNECTING]: { text: '🔄 正在连接...', color: '#3498db' },
      [CONN_STATE.CONNECTED]: { text: '✅ 已连接', color: '#27ae60' },
      [CONN_STATE.DISCONNECTED]: { text: '❌ 连接已断开', color: '#e74c3c' }
    };

    const info = statusMap[state] || { text: '⚪ 未知状态', color: '#999' };
    statusEl.textContent = info.text;
    statusEl.style.color = info.color;

    // 同时更新游戏页面的连接状态
    const gameStatusEl = document.getElementById('game-connection-status');
    if (gameStatusEl) {
      gameStatusEl.textContent = info.text;
      gameStatusEl.style.color = info.color;
    }

    // 连接成功后自动开始游戏（如果是加入者，且已发送回复码）
    if (state === CONN_STATE.CONNECTED) {
      if (this.isCreator) {
        // 创建者：需要等确认回复码后开始游戏（在_handleConfirmResponse中处理）
      } else {
        // 加入者：连接成功即开始游戏
        this._startGame();
      }
    }
  }

  // ========== 游戏开始 ==========
  _startGame() {
    // 防止重复初始化
    if (this.game) return;

    // 初始化游戏
    this.game = new GomokuGame();
    this.game.initCanvas('game-canvas');

    // 设置玩家颜色
    const myColor = this.isCreator ? 1 : 2;
    this.game.setMyColor(myColor);

    // 设置落子回调
    this.game.onMove(({ x, y }) => {
      this.pcManager.send({ type: 'move', x, y });
      this._updateTurnIndicator();
    });

    // 设置游戏结束回调
    this.game.onGameOver((winner) => {
      const isWin = (this.isCreator && winner === 1) || (!this.isCreator && winner === 2);
      const msg = isWin ? '🎉 你赢了！' : '😞 你输了';
      setTimeout(() => {
        alert(msg);
      }, 100);
    });

    // 设置玩家信息
    document.getElementById('player-name').textContent = this.username;
    document.getElementById('opponent-name').textContent = this.opponentName;
    document.getElementById('player-color').textContent = myColor === 1 ? '● 黑棋' : '○ 白棋';
    document.getElementById('opponent-color').textContent = myColor === 1 ? '○ 白棋' : '● 黑棋';

    this._updateTurnIndicator();

    // 切换到游戏页面
    this._goToPage('game');
  }

  // ========== 回合指示 ==========
  _updateTurnIndicator() {
    const turnEl = document.getElementById('turn-indicator');
    if (!this.game || this.game.gameOver) {
      if (this.game && this.game.gameOver) {
        turnEl.textContent = this.game.winner === (this.isCreator ? 1 : 2) ? '🏆 你赢了！' : '🏆 你输了';
      }
      return;
    }
    const isMyTurn = this.game.currentPlayer === this.game.myColor;
    turnEl.textContent = isMyTurn ? '🎯 你的回合' : '⏳ 等待对方下棋...';
    turnEl.style.color = isMyTurn ? '#27ae60' : '#e67e22';
  }

  // ========== 重开/退出 ==========
  _handleRestart() {
    if (this.game) {
      this.game.reset();
      this._updateTurnIndicator();
      // 通知对方重开
      this.pcManager.send({ type: 'restart' });
    }
  }

  _handleQuit() {
    if (this.pcManager) {
      this.pcManager.close();
    }
    this.game = null;
    this.pcManager = null;
    this._goToPage('lobby');
    // 重置大厅状态
    document.querySelectorAll('.room-action').forEach(el => el.classList.remove('hidden'));
    document.getElementById('room-code-area').classList.add('hidden');
    document.getElementById('response-input-area').classList.add('hidden');
    document.getElementById('response-code-area').classList.add('hidden');
    document.getElementById('waiting-msg').classList.add('hidden');
    document.getElementById('connection-status').textContent = '⚪ 未连接';
    document.getElementById('connection-status').style.color = '#999';
  }

  _handleBackToLobby() {
    if (this.pcManager) {
      this.pcManager.close();
    }
    this.pcManager = null;
    // 重置大厅状态
    document.querySelectorAll('.room-action').forEach(el => el.classList.remove('hidden'));
    document.getElementById('room-code-area').classList.add('hidden');
    document.getElementById('response-input-area').classList.add('hidden');
    document.getElementById('response-code-area').classList.add('hidden');
    document.getElementById('waiting-msg').classList.add('hidden');
    document.getElementById('connection-status').textContent = '⚪ 未连接';
    document.getElementById('connection-status').style.color = '#999';
  }

  // ========== 聊天 ==========
  _handleSendChat() {
    const input = document.getElementById('chat-input');
    const text = input.value.trim();
    if (!text) return;
    
    this.pcManager.send({ type: 'chat', text });
    this._addChatMessage(this.username, text);
    input.value = '';
  }

  _addChatMessage(sender, text) {
    const container = document.getElementById('chat-messages');
    const msgEl = document.createElement('div');
    msgEl.className = 'chat-msg';
    msgEl.innerHTML = `<strong>${sender}:</strong> ${this._escapeHtml(text)}`;
    container.appendChild(msgEl);
    container.scrollTop = container.scrollHeight;
  }

  _escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // ========== Toast提示 ==========
  _showToast(message) {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.classList.add('show');
    setTimeout(() => {
      toast.classList.remove('show');
    }, 3000);
  }
}

// ========== 应用启动 ==========
document.addEventListener('DOMContentLoaded', () => {
  window.app = new AppUI();
});