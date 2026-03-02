/**
 * WebSocket 连接管理器 (OpenAI Realtime 协议)
 * 负责连接、断开、重连
 */

import { SERVER_EVENT_TYPES } from '../constants/wsMessageTypes';

class WebSocketConnection {
  constructor(url, options = {}) {
    this.url = url;
    this.ws = null;
    this.connected = false;
    this.ready = false;
    this.connectTimeoutMs = options.connectTimeoutMs || 20000;
    this.protocols = options.protocols || undefined;

    // 回调
    this.onOpen = null;
    this.onReady = null;
    this.onMessage = null;
    this.onError = null;
    this.onClose = null;

    // 重连
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = options.maxReconnectAttempts ?? 5;
    this.reconnectDelay = options.reconnectDelay || 1000;
    this._autoReconnect = options.autoReconnect ?? false;
  }

  /**
   * 连接到服务器，等待 session.created 事件
   */
  async connect() {
    return new Promise((resolve, reject) => {
      try {
        this.ws = this.protocols
          ? new WebSocket(this.url, this.protocols)
          : new WebSocket(this.url);

        this.ws.onopen = () => {
          console.log('[WS] 连接成功');
          this.connected = true;
          this.reconnectAttempts = 0;
          this.onOpen?.();
        };

        this.ws.onmessage = (event) => {
          this.onMessage?.(event.data);
        };

        this.ws.onerror = (error) => {
          console.error('[WS] 连接错误:', error);
          this.onError?.({ code: 'connection_error', message: '连接失败', detail: String(error?.message || '') });
          reject(error);
        };

        this.ws.onclose = () => {
          console.log('[WS] 连接关闭');
          this.connected = false;
          this.ready = false;
          this.onClose?.();
          if (this._autoReconnect) {
            this._attemptReconnect();
          }
        };

        // 等待 session.created 事件
        const readyHandler = (event) => {
          try {
            const data = JSON.parse(event.data);
            if (data.type === SERVER_EVENT_TYPES.SESSION_CREATED) {
              this.ready = true;
              this.sessionInfo = data.session || {};
              this.onReady?.(data);
              cleanup();
              resolve(data);
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

        const timeoutId = setTimeout(() => {
          if (!this.ready) {
            cleanup();
            const timeoutMessage = `连接超时(${this.connectTimeoutMs}ms)，未收到 session.created`;
            this.onError?.({ code: 'connection_timeout', message: timeoutMessage });
            reject(new Error(timeoutMessage));
            this.ws.close();
          }
        }, this.connectTimeoutMs);
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * 断开连接
   */
  disconnect() {
    this._autoReconnect = false;
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
