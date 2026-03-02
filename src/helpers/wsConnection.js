/**
 * WebSocket 连接管理器
 * 负责连接、断开、重连、心跳
 */

import { CLIENT_MESSAGE_TYPES, SERVER_MESSAGE_TYPES } from '../constants/wsMessageTypes';

class WebSocketConnection {
  constructor(url) {
    this.url = url;
    this.ws = null;
    this.connected = false;
    this.ready = false;

    // 回调
    this.onOpen = null;
    this.onReady = null;
    this.onMessage = null;
    this.onError = null;
    this.onClose = null;

    // 重连
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    this.reconnectDelay = 1000;

    // 心跳
    this.pingInterval = null;
    this.pingIntervalMs = 30000;
  }

  /**
   * 连接到服务器
   */
  async connect() {
    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(this.url);

        this.ws.onopen = () => {
          console.log('[WS] 连接成功');
          this.connected = true;
          this.reconnectAttempts = 0;
          this.onOpen?.();
          this._startPing();
        };

        this.ws.onmessage = (event) => {
          this.onMessage?.(event.data);
        };

        this.ws.onerror = (error) => {
          console.error('[WS] 连接错误:', error);
          this.onError?.({ code: 'connection_error', message: '连接失败' });
          reject(error);
        };

        this.ws.onclose = () => {
          console.log('[WS] 连接关闭');
          this.connected = false;
          this.ready = false;
          this._stopPing();
          this.onClose?.();
          this._attemptReconnect();
        };

        // 等待 ready 消息
        const readyHandler = (event) => {
          try {
            const data = JSON.parse(event.data);
            if (data.type === SERVER_MESSAGE_TYPES.READY) {
              this.ready = true;
              this.onReady?.();
              cleanup();
              resolve();
            }
          } catch (e) {
            // 忽略非 JSON 消息
          }
        };

        const cleanup = () => {
          this.ws.removeEventListener('message', readyHandler);
          clearTimeout(timeoutId);
        };

        this.ws.addEventListener('message', readyHandler);

        // 超时处理
        const timeoutId = setTimeout(() => {
          if (!this.ready) {
            cleanup();
            reject(new Error('连接超时'));
            this.ws.close();
          }
        }, 10000);
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * 断开连接
   */
  disconnect() {
    this._stopPing();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.connected = false;
    this.ready = false;
  }

  /**
   * 发送 JSON 消息
   */
  send(data) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket 未连接');
    }
    this.ws.send(JSON.stringify(data));
  }

  /**
   * 发送二进制数据
   */
  sendBinary(data) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket 未连接');
    }

    let buffer;
    if (data instanceof ArrayBuffer) {
      buffer = data;
    } else if (data instanceof Uint8Array) {
      buffer = data.buffer;
    } else if (ArrayBuffer.isView(data)) {
      buffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
    } else {
      throw new Error('不支持的数据类型');
    }

    this.ws.send(buffer);
  }

  /**
   * 开始心跳
   */
  _startPing() {
    this._stopPing();
    this.pingInterval = setInterval(() => {
      if (this.connected && this.ready) {
        try {
          this.send({ type: CLIENT_MESSAGE_TYPES.PING, timestamp: Date.now() });
        } catch (e) {
          console.error('[WS] 心跳失败:', e);
        }
      }
    }, this.pingIntervalMs);
  }

  /**
   * 停止心跳
   */
  _stopPing() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  /**
   * 尝试重连
   */
  _attemptReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('[WS] 重连次数已达上限');
      return;
    }

    this.reconnectAttempts++;
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);

    console.log(`[WS] ${delay}ms 后尝试重连 (${this.reconnectAttempts}/${this.maxReconnectAttempts})`);

    setTimeout(() => {
      if (!this.connected) {
        this.connect().catch((e) => {
          console.error('[WS] 重连失败:', e);
        });
      }
    }, delay);
  }
}

export default WebSocketConnection;
