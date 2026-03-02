/**
 * WebSocket 消息处理器
 * 负责消息的发送、接收、等待响应
 */

import { SERVER_MESSAGE_TYPES } from '../constants/wsMessageTypes';

class MessageProcessor {
  constructor(connection) {
    this.connection = connection;
    this.messageHandlers = new Map();
    this.waitingPromises = new Map();

    // 设置消息处理
    this.connection.onMessage = (data) => this._handleMessage(data);
  }

  /**
   * 注册消息处理器
   */
  on(type, handler) {
    this.messageHandlers.set(type, handler);
  }

  /**
   * 移除消息处理器
   */
  off(type) {
    this.messageHandlers.delete(type);
  }

  /**
   * 发送消息并等待响应
   */
  async sendAndWait(message, expectedType, sessionId, timeout = 60000) {
    this.connection.send(message);

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waitingPromises.delete(key);
        reject(new Error(`等待 ${expectedType} 消息超时`));
      }, timeout);

      const key = sessionId ? `${expectedType}:${sessionId}` : expectedType;
      this.waitingPromises.set(key, { resolve, reject, timer });
    });
  }

  /**
   * 处理接收到的消息
   */
  _handleMessage(data) {
    try {
      const message = JSON.parse(data);
      const type = message.type;

      // 检查是否有等待的 Promise
      const key1 = message.session_id ? `${type}:${message.session_id}` : null;
      const key2 = type;

      for (const key of [key1, key2]) {
        if (key && this.waitingPromises.has(key)) {
          const { resolve, reject, timer } = this.waitingPromises.get(key);
          clearTimeout(timer);
          this.waitingPromises.delete(key);

          // 错误消息
          if (type === SERVER_MESSAGE_TYPES.ERROR) {
            reject(new Error(message.message));
          } else {
            resolve(message);
          }
          return;
        }
      }

      // 调用注册的处理器
      const handler = this.messageHandlers.get(type);
      if (handler) {
        handler(message);
      }
    } catch (e) {
      console.error('[WS] 消息解析失败:', e);
    }
  }

  /**
   * 清理所有等待的 Promise
   */
  cleanup() {
    for (const [key, { reject, timer }] of this.waitingPromises.entries()) {
      clearTimeout(timer);
      reject(new Error('连接已关闭'));
    }
    this.waitingPromises.clear();
  }
}

export default MessageProcessor;
