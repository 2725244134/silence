/**
 * FunASR WebSocket 客户端
 * 整合连接管理和消息处理
 */

import WebSocketConnection from './wsConnection';
import MessageProcessor from './wsMessageProcessor';
import { BATCH_CONFIG_DEFAULTS, REALTIME_CONFIG_DEFAULTS } from '../config/audioConfig';
import { CLIENT_MESSAGE_TYPES, SERVER_MESSAGE_TYPES } from '../constants/wsMessageTypes';

class FunASRWebSocketClient {
  constructor(url = 'ws://localhost:10095') {
    this.connection = new WebSocketConnection(url);
    this.processor = new MessageProcessor(this.connection);
    this.currentSession = null;

    // 设置回调转发
    this.connection.onReady = () => this.onReady?.();
    this.connection.onError = (error) => this.onError?.(error);
    this.connection.onClose = () => {
      this.processor.cleanup();
      this.onClose?.();
    };

    // 注册消息处理器
    this.processor.on(SERVER_MESSAGE_TYPES.PARTIAL_RESULT, (msg) => this.onPartialResult?.(msg));
    this.processor.on(SERVER_MESSAGE_TYPES.FINAL_RESULT, (msg) => this.onFinalResult?.(msg));
    this.processor.on(SERVER_MESSAGE_TYPES.ERROR, (msg) => this.onError?.(msg));
  }

  // 回调
  onReady = null;
  onPartialResult = null;
  onFinalResult = null;
  onError = null;
  onClose = null;

  /**
   * 连接到服务器
   */
  async connect() {
    return this.connection.connect();
  }

  /**
   * 断开连接
   */
  disconnect() {
    this.connection.disconnect();
  }

  /**
   * 开始 batch 会话
   */
  async startBatch(sessionId, config = {}) {
    if (!this.connection.ready) {
      throw new Error('服务器未就绪');
    }

    this.currentSession = { id: sessionId, mode: 'batch', config };

    return this.processor.sendAndWait(
      {
        type: CLIENT_MESSAGE_TYPES.START_BATCH,
        session_id: sessionId,
        config: {
          ...BATCH_CONFIG_DEFAULTS,
          ...config,
        },
      },
      SERVER_MESSAGE_TYPES.STARTED,
      sessionId
    );
  }

  /**
   * 发送 batch 音频数据
   */
  sendBatchAudio(audioData) {
    if (!this.currentSession || this.currentSession.mode !== 'batch') {
      throw new Error('没有活动的 batch 会话');
    }
    this.connection.sendBinary(audioData);
  }

  /**
   * 结束 batch 会话
   */
  async endBatch(sessionId) {
    const result = await this.processor.sendAndWait(
      {
        type: CLIENT_MESSAGE_TYPES.END_BATCH,
        session_id: sessionId || this.currentSession?.id,
      },
      SERVER_MESSAGE_TYPES.FINAL_RESULT,
      sessionId
    );
    this.currentSession = null;
    return result;
  }

  /**
   * 开始 realtime 会话
   */
  async startRealtime(sessionId, config = {}) {
    if (!this.connection.ready) {
      throw new Error('服务器未就绪');
    }

    this.currentSession = { id: sessionId, mode: 'realtime', config };

    return this.processor.sendAndWait(
      {
        type: CLIENT_MESSAGE_TYPES.START_REALTIME,
        session_id: sessionId,
        config: {
          ...REALTIME_CONFIG_DEFAULTS,
          ...config,
        },
      },
      SERVER_MESSAGE_TYPES.STARTED,
      sessionId
    );
  }

  /**
   * 发送 realtime 音频片段
   */
  sendRealtimeAudio(audioData) {
    if (!this.currentSession || this.currentSession.mode !== 'realtime') {
      throw new Error('没有活动的 realtime 会话');
    }
    this.connection.sendBinary(audioData);
  }

  /**
   * 结束 realtime 会话
   */
  async endRealtime(sessionId) {
    const result = await this.processor.sendAndWait(
      {
        type: CLIENT_MESSAGE_TYPES.END_REALTIME,
        session_id: sessionId || this.currentSession?.id,
      },
      SERVER_MESSAGE_TYPES.FINAL_RESULT,
      sessionId
    );
    this.currentSession = null;
    return result;
  }

  /**
   * 取消会话
   */
  async cancel(sessionId, reason = 'user_cancel') {
    const result = await this.processor.sendAndWait(
      {
        type: CLIENT_MESSAGE_TYPES.CANCEL,
        session_id: sessionId || this.currentSession?.id,
        reason,
      },
      SERVER_MESSAGE_TYPES.CANCELLED,
      sessionId
    );
    this.currentSession = null;
    return result;
  }

  /**
   * 发送心跳
   */
  ping() {
    this.connection.send({ type: CLIENT_MESSAGE_TYPES.PING, timestamp: Date.now() });
  }

  /**
   * 检查是否已连接
   */
  isConnected() {
    return this.connection.connected;
  }

  /**
   * 检查服务器是否就绪
   */
  isReady() {
    return this.connection.ready;
  }
}

export default FunASRWebSocketClient;
