/**
 * ASR 服务抽象接口
 * 定义所有语音识别服务必须实现的方法
 */

export const TranscriptionMode = {
  BATCH: 'batch',      // 离线整段识别
  REALTIME: 'realtime', // 实时流式识别
};

export const ServiceStatus = {
  DISCONNECTED: 'disconnected',
  CONNECTING: 'connecting',
  READY: 'ready',
  TRANSCRIBING: 'transcribing',
  ERROR: 'error',
};

/**
 * ASR 服务抽象基类
 * 所有 ASR 服务实现都应继承此类
 */
export class ASRService {
  constructor(config = {}) {
    this.config = config;
    this.status = ServiceStatus.DISCONNECTED;

    // 回调函数
    this.onStatusChange = null;
    this.onPartialResult = null;
    this.onFinalResult = null;
    this.onError = null;
  }

  /**
   * 获取服务名称
   * @returns {string}
   */
  getName() {
    throw new Error('子类必须实现 getName()');
  }

  /**
   * 获取支持的模式
   * @returns {string[]} TranscriptionMode 数组
   */
  getSupportedModes() {
    throw new Error('子类必须实现 getSupportedModes()');
  }

  /**
   * 连接到服务
   * @returns {Promise<void>}
   */
  async connect() {
    throw new Error('子类必须实现 connect()');
  }

  /**
   * 断开连接
   * @returns {Promise<void>}
   */
  async disconnect() {
    throw new Error('子类必须实现 disconnect()');
  }

  /**
   * 检查服务是否就绪
   * @returns {boolean}
   */
  isReady() {
    return this.status === ServiceStatus.READY;
  }

  /**
   * 开始转录会话
   * @param {Object} options - 转录选项
   * @param {string} options.mode - 转录模式 (batch/realtime)
   * @param {Object} options.config - 服务特定配置
   * @returns {Promise<string>} 会话 ID
   */
  async startTranscription(options = {}) {
    throw new Error('子类必须实现 startTranscription()');
  }

  /**
   * 发送音频数据
   * @param {ArrayBuffer|Uint8Array} audioData - 音频数据
   * @returns {Promise<void>}
   */
  async sendAudio(audioData) {
    throw new Error('子类必须实现 sendAudio()');
  }

  /**
   * 停止转录会话
   * @param {string} sessionId - 会话 ID
   * @returns {Promise<Object>} 最终结果
   */
  async stopTranscription(sessionId) {
    throw new Error('子类必须实现 stopTranscription()');
  }

  /**
   * 取消转录会话
   * @param {string} sessionId - 会话 ID
   * @param {string} reason - 取消原因
   * @returns {Promise<void>}
   */
  async cancelTranscription(sessionId, reason = 'user_cancel') {
    throw new Error('子类必须实现 cancelTranscription()');
  }

  /**
   * 获取音频格式要求
   * @returns {Object} 音频格式配置
   */
  getAudioFormat() {
    throw new Error('子类必须实现 getAudioFormat()');
  }

  /**
   * 获取服务配置
   * @returns {Object}
   */
  getConfig() {
    return this.config;
  }

  /**
   * 更新服务配置
   * @param {Object} config
   */
  updateConfig(config) {
    this.config = { ...this.config, ...config };
  }

  /**
   * 更新状态
   * @protected
   */
  _updateStatus(newStatus) {
    if (this.status !== newStatus) {
      this.status = newStatus;
      this.onStatusChange?.(newStatus);
    }
  }

  /**
   * 触发部分结果回调
   * @protected
   */
  _emitPartialResult(result) {
    this.onPartialResult?.(result);
  }

  /**
   * 触发最终结果回调
   * @protected
   */
  _emitFinalResult(result) {
    this.onFinalResult?.(result);
  }

  /**
   * 触发错误回调
   * @protected
   */
  _emitError(error) {
    this._updateStatus(ServiceStatus.ERROR);
    this.onError?.(error);
  }
}
