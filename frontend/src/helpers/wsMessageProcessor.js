/**
 * WebSocket 消息处理器 (OpenAI Realtime 协议)
 * 负责消息的发送、接收、等待响应
 */

import { SERVER_EVENT_TYPES } from '../constants/wsMessageTypes';

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
  async sendAndWait(message, expectedType, timeout = 60000) {
    this.connection.send(message);

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waitingPromises.delete(expectedType);
        reject(new Error(`等待 ${expectedType} 消息超时`));
      }, timeout);

      this.waitingPromises.set(expectedType, { resolve, reject, timer });
    });
  }

  /**
   * 从 OpenAI error 事件中提取错误消息
   * 支持两种格式: { error: { message } } 和 { message }
   */
  _extractErrorMessage(message) {
    if (message.error?.message) {
      return message.error.message;
    }
    return message.message || '服务器返回错误';
  }

  /**
   * 处理接收到的消息
   */
  _handleMessage(data) {
    try {
      const message = JSON.parse(data);
      const type = message.type;

      // 错误消息优先处理等待中的 Promise
      if (type === SERVER_EVENT_TYPES.ERROR) {
        const errorMsg = this._extractErrorMessage(message);

        // 如果有任何等待中的 Promise，reject 第一个
        if (this.waitingPromises.size > 0) {
          const [key, pending] = this.waitingPromises.entries().next().value;
          clearTimeout(pending.timer);
          this.waitingPromises.delete(key);
          pending.reject(new Error(errorMsg));
          return;
        }
      }

      // 检查是否有等待此类型的 Promise
      if (this.waitingPromises.has(type)) {
        const { resolve, timer } = this.waitingPromises.get(type);
        clearTimeout(timer);
        this.waitingPromises.delete(type);
        resolve(message);
        return;
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
