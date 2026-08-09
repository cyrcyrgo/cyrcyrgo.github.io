/**
 * 网络模块 - 管理WebRTC连接、IP检测、Ngrok
 * 包含 PeerConnectionManager 类，统一管理所有信令和连接
 */

// ========== 内网IP获取 ==========
// 通过WebRTC的ICE候选信息获取本机内网IP
function getLocalIP() {
  return new Promise((resolve) => {
    try {
      const pc = new RTCPeerConnection({ iceServers: [] });
      pc.createDataChannel('ip-detection');
      pc.createOffer().then(offer => pc.setLocalDescription(offer));
      pc.onicecandidate = (e) => {
        if (e.candidate) {
          const match = e.candidate.candidate.match(/(\d+\.\d+\.\d+\.\d+)/);
          if (match && !match[1].startsWith('127.')) {
            pc.close();
            resolve(match[1]);
          }
        }
      };
      // 3秒超时，返回回环地址
      setTimeout(() => {
        pc.close();
        resolve('127.0.0.1');
      }, 3000);
    } catch (e) {
      resolve('127.0.0.1');
    }
  });
}

// ========== 公网IP获取（多后备API） ==========
// 部分网络环境下 api.ipify.org 可能被屏蔽，使用多个后备API轮询
const PUBLIC_IP_SERVICES = [
  { url: 'https://api.ipify.org?format=json', parse: (d) => d.ip },
  { url: 'https://api.my-ip.io/ip.json', parse: (d) => d.ip },
  { url: 'https://ip-api.com/json/', parse: (d) => d.query },
  { url: 'https://httpbin.org/ip', parse: (d) => d.origin }
];

async function getPublicIP() {
  for (const service of PUBLIC_IP_SERVICES) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const res = await fetch(service.url, { signal: controller.signal });
      clearTimeout(timeout);
      if (!res.ok) continue;
      const data = await res.json();
      const ip = service.parse(data);
      if (ip) return ip;
    } catch (e) {
      console.warn(`公网IP服务 ${service.url} 失败:`, e.message);
      continue;
    }
  }
  console.error('所有公网IP服务均失败');
  return null;
}

// ========== Ngrok管理 ==========

// 检查Ngrok是否运行，并获取公网URL
async function getNgrokUrl() {
  try {
    const res = await fetch(NGROK_API_URL);
    const data = await res.json();
    const tunnel = data.tunnels.find(t => t.proto === 'https');
    return tunnel ? tunnel.public_url : null;
  } catch (e) {
    console.error('获取Ngrok URL失败:', e);
    return null;
  }
}

// 保存Ngrok令牌到本地存储
function saveNgrokToken(token) {
  localStorage.setItem(STORAGE_KEYS.NGROK_TOKEN, token);
}

// 获取保存的Ngrok令牌
function getNgrokToken() {
  return localStorage.getItem(STORAGE_KEYS.NGROK_TOKEN) || '';
}

// ========== WebRTC连接管理器 ==========
class PeerConnectionManager {
  /**
   * @param {string} mode - 连接模式: 'lan' | 'wan' | 'ngrok'
   * @param {Object} callbacks - 回调函数
   * @param {Function} callbacks.onMessage - 收到消息回调
   * @param {Function} callbacks.onStateChange - 连接状态变化回调
   * @param {Function} callbacks.onIceCandidate - ICE候选回调
   */
  constructor(mode, callbacks = {}) {
    this.mode = mode;
    this.callbacks = callbacks;
    this.pc = null;           // RTCPeerConnection实例
    this.dc = null;           // RTCDataChannel实例
    this.connectionState = CONN_STATE.IDLE;
    this.isCreator = false;   // 是否为创建者
    this.iceCandidates = [];  // 收集的ICE候选
    
    // 绑定回调
    this.onMessage = callbacks.onMessage || (() => {});
    this.onStateChange = callbacks.onStateChange || (() => {});
    this.onIceCandidate = callbacks.onIceCandidate || (() => {});
  }

  // 更新连接状态
  _setState(state) {
    this.connectionState = state;
    this.onStateChange(state);
  }

  // 创建RTCPeerConnection实例
  _createPC() {
    const config = getIceConfig(this.mode);
    this.pc = new RTCPeerConnection(config);

    // 监听连接状态变化
    this.pc.onconnectionstatechange = () => {
      const state = this.pc.connectionState;
      switch (state) {
        case 'connected':
          this._setState(CONN_STATE.CONNECTED);
          break;
        case 'disconnected':
        case 'failed':
          this._setState(CONN_STATE.DISCONNECTED);
          break;
        case 'connecting':
          this._setState(CONN_STATE.CONNECTING);
          break;
      }
    };

    // 监听ICE候选
    this.pc.onicecandidate = (e) => {
      if (e.candidate) {
        this.iceCandidates.push(e.candidate);
        this.onIceCandidate(e.candidate);
      }
    };

    return this.pc;
  }

  /**
   * 创建者：创建房间，生成Offer
   * @returns {Promise<string>} 返回本地SDP
   */
  async createOffer() {
    this.isCreator = true;
    this._createPC();

    // 创建数据通道
    this.dc = this.pc.createDataChannel('game', { ordered: true });
    this._setupDataChannel();

    // 创建Offer
    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);

    // 等待ICE收集完成（或超时）
    await this._waitForIceGathering();

    // 返回完整的本地SDP
    return this.pc.localDescription.sdp;
  }

  /**
   * 加入者：接收Offer，创建Answer
   * @param {string} offerSdp - 创建者的SDP
   * @returns {Promise<string>} 返回本地Answer SDP
   */
  async createAnswer(offerSdp) {
    this.isCreator = false;
    this._createPC();

    // 监听数据通道（由对方创建）
    this.pc.ondatachannel = (e) => {
      this.dc = e.channel;
      this._setupDataChannel();
    };

    // 设置远程描述（对方的Offer）
    const remoteDesc = new RTCSessionDescription({ type: 'offer', sdp: offerSdp });
    await this.pc.setRemoteDescription(remoteDesc);

    // 创建Answer
    const answer = await this.pc.createAnswer();
    await this.pc.setLocalDescription(answer);

    // 等待ICE收集完成
    await this._waitForIceGathering();

    return this.pc.localDescription.sdp;
  }

  /**
   * 创建者：设置对方的Answer SDP，完成连接
   * @param {string} answerSdp - 加入者的Answer SDP
   */
  async setRemoteAnswer(answerSdp) {
    const remoteDesc = new RTCSessionDescription({ type: 'answer', sdp: answerSdp });
    await this.pc.setRemoteDescription(remoteDesc);
  }

  // 等待ICE收集完成，带超时
  _waitForIceGathering() {
    return new Promise((resolve) => {
      // 如果已经收集完成，直接返回
      if (this.pc.iceGatheringState === 'complete') {
        resolve();
        return;
      }
      // 使用 addEventListener 而非赋值，避免覆盖其他监听器
      const handler = () => {
        if (this.pc.iceGatheringState === 'complete') {
          this.pc.removeEventListener('icegatheringstatechange', handler);
          resolve();
        }
      };
      this.pc.addEventListener('icegatheringstatechange', handler);
      // 超时保护：即使ICE收集未完成也继续
      setTimeout(() => {
        this.pc.removeEventListener('icegatheringstatechange', handler);
        if (this.pc.iceGatheringState !== 'complete') {
          console.warn('ICE收集超时，使用当前可用候选');
        }
        resolve();
      }, ICE_GATHERING_TIMEOUT);
    });
  }

  // 设置数据通道的事件监听
  _setupDataChannel() {
    if (!this.dc) return;

    this.dc.onopen = () => {
      console.log('数据通道已打开');
      this._setState(CONN_STATE.CONNECTED);
    };

    this.dc.onclose = () => {
      console.log('数据通道已关闭');
      this._setState(CONN_STATE.DISCONNECTED);
    };

    this.dc.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        this.onMessage(data);
      } catch (err) {
        console.error('消息解析失败:', err);
      }
    };
  }

  /**
   * 发送消息到对端
   * @param {Object} data - 要发送的数据（会被JSON序列化）
   */
  send(data) {
    if (this.dc && this.dc.readyState === 'open') {
      this.dc.send(JSON.stringify(data));
      return true;
    }
    console.warn('数据通道未就绪，无法发送消息');
    return false;
  }

  // 关闭连接
  close() {
    if (this.dc) {
      this.dc.close();
      this.dc = null;
    }
    if (this.pc) {
      this.pc.close();
      this.pc = null;
    }
    this._setState(CONN_STATE.IDLE);
  }
}