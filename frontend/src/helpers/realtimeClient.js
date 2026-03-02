/**
 * OpenAI Realtime API 客户端
 * 整合连接管理和消息处理，同时支持本地 voxtral 和云端 OpenAI
 */

import WebSocketConnection from './wsConnection';
import MessageProcessor from './wsMessageProcessor';
import { CLIENT_EVENT_TYPES, SERVER_EVENT_TYPES } from '../constants/wsMessageTypes';

class RealtimeClient {
  /**
   * @param {string} url - WebSocket URL
   * @param {Object} options
   * @param {string[]} [options.protocols] - WebSocket subprotocols (用于云端 auth)
   */
  constructor(url = 'ws://localhost:8765', options = {}) {
    this.connection = new WebSocketConnection(url, {
      protocols: options.protocols,
      connectTimeoutMs: options.connectTimeoutMs,
    });
    this.processor = new MessageProcessor(this.connection);

    // 设置回调转发
    this.connection.onReady = (data) => this.onSessionCreated?.(data);
    this.connection.onError = (error) => this.onError?.(error);
    this.connection.onClose = () => {
      this.processor.cleanup();
      this.onClose?.();
    };

    // 注册消息处理器
    this.processor.on(SERVER_EVENT_TYPES.TRANSCRIPT_DELTA, (msg) => {
      this.onTranscriptionDelta?.(msg);
    });
    this.processor.on(SERVER_EVENT_TYPES.TRANSCRIPT_DONE, (msg) => {
      this.onTranscriptionDone?.(msg);
    });
    this.processor.on(SERVER_EVENT_TYPES.ERROR, (msg) => {
      const errorMsg = msg.error?.message || msg.message || '未知错误';
      this.onError?.({ code: msg.error?.code, message: errorMsg, type: msg.error?.type });
    });
    this.processor.on(SERVER_EVENT_TYPES.INPUT_AUDIO_BUFFER_SPEECH_STARTED, (msg) => {
      this.onSpeechStarted?.(msg);
    });
    this.processor.on(SERVER_EVENT_TYPES.INPUT_AUDIO_BUFFER_SPEECH_STOPPED, (msg) => {
      this.onSpeechStopped?.(msg);
    });
  }

  // 回调
  onSessionCreated = null;
  onTranscriptionDelta = null;
  onTranscriptionDone = null;
  onSpeechStarted = null;
  onSpeechStopped = null;
  onError = null;
  onClose = null;

  /**
   * 连接到服务器，等待 session.created
   * @returns {Promise<Object>} session.created 数据
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
   * 发送 session.update 配置会话
   * @param {Object} sessionConfig - 会话配置参数
   * @returns {Promise<Object>} session.updated 响应
   */
  async updateSession(sessionConfig = {}) {
    if (!this.connection.ready) {
      throw new Error('服务器未就绪');
    }

    return this.processor.sendAndWait(
      {
        type: CLIENT_EVENT_TYPES.SESSION_UPDATE,
        session: sessionConfig,
      },
      SERVER_EVENT_TYPES.SESSION_UPDATED
    );
  }

  /**
   * 追加 base64 编码音频到缓冲区
   * @param {string} base64Audio - base64 编码的 PCM16 音频
   */
  appendAudio(base64Audio) {
    this.connection.send({
      type: CLIENT_EVENT_TYPES.INPUT_AUDIO_BUFFER_APPEND,
      audio: base64Audio,
    });
  }

  /**
   * 提交音频缓冲区，表示本段音频结束
   * @returns {Promise<Object>} committed 响应
   */
  async commitAudioBuffer() {
    return this.processor.sendAndWait(
      { type: CLIENT_EVENT_TYPES.INPUT_AUDIO_BUFFER_COMMIT },
      SERVER_EVENT_TYPES.INPUT_AUDIO_BUFFER_COMMITTED,
      10000
    );
  }

  /**
   * 清空音频缓冲区（取消当前输入）
   */
  clearAudioBuffer() {
    this.connection.send({
      type: CLIENT_EVENT_TYPES.INPUT_AUDIO_BUFFER_CLEAR,
    });
  }

  /**
   * 取消当前响应
   */
  cancelResponse() {
    this.connection.send({
      type: CLIENT_EVENT_TYPES.RESPONSE_CANCEL,
    });
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

export default RealtimeClient;
