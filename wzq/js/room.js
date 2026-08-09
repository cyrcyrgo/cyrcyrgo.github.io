/**
 * 房间码模块 - 生成和解析各模式房间码
 * 房间码通过Base64编码JSON传递，包含信令信息
 */

// ========== 房间码生成 ==========

/**
 * 生成房间码（创建者→加入者）
 * @param {string} mode - 模式: 'lan' | 'wan' | 'ngrok'
 * @param {Object} options
 * @param {string} options.sdp - 本地SDP描述
 * @param {string} options.ip - IP地址（内网或公网）
 * @param {string} options.nickname - 玩家昵称
 * @param {string} options.ngrokUrl - Ngrok URL（仅Ngrok模式）
 * @returns {Object} { code: string, display: string }
 */
function generateRoomCode(mode, { sdp, ip, nickname, ngrokUrl }) {
  const payload = {
    type: mode === 'ngrok' ? 'ngrok' : 'p2p',
    sdp: sdp,
    nickname: nickname || '匿名',
    timestamp: Date.now()
  };

  if (mode === 'lan') {
    payload.ip = ip;
  } else if (mode === 'ngrok') {
    payload.ngrokUrl = ngrokUrl;
  } else {
    payload.ip = ip;
  }

  // 将JSON编码为Base64
  const jsonStr = JSON.stringify(payload);
  const base64 = btoa(unescape(encodeURIComponent(jsonStr)));

  // 生成显示用的房间码
  let display;
  if (mode === 'lan') {
    display = `${ip}:8888`;
  } else if (mode === 'ngrok') {
    display = `NGROK-${base64.substring(0, 8)}...`;
  } else {
    display = `P2P-${base64.substring(0, 8)}...`;
  }

  return { code: base64, display };
}

/**
 * 生成回复码（加入者→创建者）
 * 用于完成信令交换的第二阶段
 * @param {string} sdp - 本地Answer SDP
 * @param {string} nickname - 玩家昵称
 * @returns {string} Base64编码的回复码
 */
function generateResponseCode(sdp, nickname) {
  const payload = {
    type: 'response',
    sdp: sdp,
    nickname: nickname || '匿名',
    timestamp: Date.now()
  };
  const jsonStr = JSON.stringify(payload);
  return btoa(unescape(encodeURIComponent(jsonStr)));
}

// ========== 房间码解析 ==========

/**
 * 解析房间码
 * @param {string} code - Base64编码的房间码
 * @returns {Object|null} 解析后的数据对象，失败返回null
 */
function parseRoomCode(code) {
  try {
    // 先尝试解码Base64
    const jsonStr = decodeURIComponent(escape(atob(code)));
    const data = JSON.parse(jsonStr);
    
    // 验证必要字段
    if (!data.sdp || !data.type) {
      console.error('房间码格式无效：缺少必要字段');
      return null;
    }

    return data;
  } catch (e) {
    console.error('房间码解析失败:', e);
    return null;
  }
}

/**
 * 解析回复码
 * @param {string} code - Base64编码的回复码
 * @returns {Object|null} 解析后的数据对象
 */
function parseResponseCode(code) {
  try {
    const jsonStr = decodeURIComponent(escape(atob(code)));
    const data = JSON.parse(jsonStr);
    if (data.type !== 'response' || !data.sdp) {
      console.error('回复码格式无效');
      return null;
    }
    return data;
  } catch (e) {
    console.error('回复码解析失败:', e);
    return null;
  }
}

/**
 * 检测房间码类型
 * @param {string} input - 用户输入
 * @returns {string|null} 检测到的模式，或null
 */
function detectRoomCodeType(input) {
  if (!input || input.trim() === '') return null;

  // 内网IP格式: 192.168.x.x:port 或 10.x.x.x:port
  const lanPattern = /^(\d{1,3}\.){3}\d{1,3}:\d+$/;
  if (lanPattern.test(input.trim())) {
    return 'lan_raw_ip';
  }

  // 尝试解码Base64
  try {
    const jsonStr = decodeURIComponent(escape(atob(input.trim())));
    const data = JSON.parse(jsonStr);
    if (data.type === 'ngrok') return 'ngrok';
    if (data.type === 'p2p') return 'p2p';
    if (data.type === 'response') return 'response';
  } catch (e) {
    // 不是有效的Base64编码
  }

  return null;
}