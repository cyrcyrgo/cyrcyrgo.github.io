/**
 * 五子棋游戏 - 配置常量
 * 所有可调参数集中管理
 */

// ========== 棋盘配置 ==========
const BOARD_SIZE = 15;        // 棋盘大小（15x15）
const CELL_SIZE = 34;         // 每格像素大小
const BOARD_PADDING = 28;     // 棋盘边距
const CANVAS_SIZE = BOARD_PADDING * 2 + (BOARD_SIZE - 1) * CELL_SIZE; // 画布总大小

// ========== 棋子样式 ==========
const PIECE_RADIUS = CELL_SIZE * 0.42; // 棋子半径
const BLACK_COLOR = '#1a1a1a';         // 黑棋颜色
const WHITE_COLOR = '#f5f5f5';         // 白棋颜色
const BOARD_BG = '#dcb35c';            // 棋盘背景色
const BOARD_LINE_COLOR = '#333';       // 棋盘线颜色
const STAR_POINT_COLOR = '#333';       // 星位点颜色

// ========== 网络配置 ==========
const STUN_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' }
];

// 内网模式不需要STUN
const getIceConfig = (mode) => {
  if (mode === 'lan') {
    return { iceServers: [] };
  }
  return { iceServers: STUN_SERVERS };
};

// ========== 模式定义 ==========
const MODES = {
  LAN: 'lan',       // 内网模式
  WAN: 'wan',       // 外网模式
  NGROK: 'ngrok'    // Ngrok后备模式
};

const MODE_LABELS = {
  [MODES.LAN]: '🏠 内网模式',
  [MODES.WAN]: '🌐 外网模式',
  [MODES.NGROK]: '🚀 Ngrok模式'
};

// ========== 连接状态 ==========
const CONN_STATE = {
  IDLE: 'idle',
  WAITING: 'waiting',       // 等待对方连接
  CONNECTING: 'connecting', // 正在连接
  CONNECTED: 'connected',   // 已连接
  DISCONNECTED: 'disconnected' // 已断开
};

// ========== 信令交换超时 ==========
const ICE_GATHERING_TIMEOUT = 5000; // 等待ICE收集完成的超时时间(ms)

// ========== 本地存储键名 ==========
const STORAGE_KEYS = {
  USERNAME: 'wzq_username',
  NGROK_TOKEN: 'wzq_ngrok_token'
};

// ========== Ngrok配置 ==========
const NGROK_PORT = 8080;
const NGROK_API_URL = 'http://127.0.0.1:4040/api/tunnels';

// ========== 公网IP API ==========
// 实际实现在 network.js 中，使用多个后备API轮询