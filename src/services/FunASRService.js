/**
 * FunASR 服务实现
 * 基于 WebSocket 的 FunASR 语音识别服务
 */

import { ASRService, TranscriptionMode, ServiceStatus } from './ASRServiceInterface';
import FunASRWebSocketClient from '../helpers/funasrWsClient';
import { AUDIO_CONFIG } from '../config/audioConfig';

export class FunASRService extends ASRService {
  constructor(config = {}) {
    super(config);

    this.url = config.url || 'ws://localhost:10095';
    this.client = null;
    this.currentSessionId = null;
    this.currentMode = null;
  }

  getName() {
    return 'FunASR';
  }

  getSupportedModes() {
    return [TranscriptionMode.REALTIME];  // 只支持实时模式
  }

  async connect() {
    if (this.client?.isConnected()) {
      return;
    }

    this._updateStatus(ServiceStatus.CONNECTING);

    try {
      this.client = new FunASRWebSocketClient(this.url);

      // 设置回调
      this.client.onReady = () => {
        this._updateStatus(ServiceStatus.READY);
      };

      this.client.onPartialResult = (message) => {
        this._emitPartialResult({
          text: message.text,
          isFinal: false,
          timestamp: message.timestamp,
        });
      };

      this.client.onFinalResult = (message) => {
        this._emitFinalResult({
          text: message.text,
          isFinal: true,
          duration: message.duration,
          timestamp: message.timestamp,
        });
      };

      this.client.onError = (error) => {
        this._emitError(error);
      };

      this.client.onClose = () => {
        this._updateStatus(ServiceStatus.DISCONNECTED);
      };

      await this.client.connect();
    } catch (error) {
      this._emitError(error);
      throw error;
    }
  }

  async disconnect() {
    if (this.client) {
      this.client.disconnect();
      this.client = null;
    }
    this._updateStatus(ServiceStatus.DISCONNECTED);
  }

  async startTranscription(options = {}) {
    if (!this.isReady()) {
      throw new Error('服务未就绪');
    }

    const { mode = TranscriptionMode.REALTIME, config = {} } = options;
    const sessionId = crypto.randomUUID();

    this._updateStatus(ServiceStatus.TRANSCRIBING);
    this.currentSessionId = sessionId;
    this.currentMode = mode;

    try {
      if (mode === TranscriptionMode.BATCH) {
        await this.client.startBatch(sessionId, config);
      } else if (mode === TranscriptionMode.REALTIME) {
        await this.client.startRealtime(sessionId, config);
      } else {
        throw new Error(`不支持的模式: ${mode}`);
      }

      return sessionId;
    } catch (error) {
      this._emitError(error);
      throw error;
    }
  }

  async sendAudio(audioData) {
    if (!this.client || !this.currentSessionId) {
      throw new Error('没有活动的转录会话');
    }

    try {
      if (this.currentMode === TranscriptionMode.BATCH) {
        this.client.sendBatchAudio(audioData);
      } else if (this.currentMode === TranscriptionMode.REALTIME) {
        this.client.sendRealtimeAudio(audioData);
      }
    } catch (error) {
      this._emitError(error);
      throw error;
    }
  }

  async stopTranscription(sessionId) {
    if (!this.client) {
      throw new Error('客户端未连接');
    }

    try {
      let result;
      if (this.currentMode === TranscriptionMode.BATCH) {
        result = await this.client.endBatch(sessionId || this.currentSessionId);
      } else if (this.currentMode === TranscriptionMode.REALTIME) {
        result = await this.client.endRealtime(sessionId || this.currentSessionId);
      }

      this.currentSessionId = null;
      this.currentMode = null;
      this._updateStatus(ServiceStatus.READY);

      return {
        text: result.text,
        duration: result.duration,
        timestamp: result.timestamp,
      };
    } catch (error) {
      this._emitError(error);
      throw error;
    }
  }

  async cancelTranscription(sessionId, reason = 'user_cancel') {
    if (!this.client) {
      return;
    }

    try {
      await this.client.cancel(sessionId || this.currentSessionId, reason);
      this.currentSessionId = null;
      this.currentMode = null;
      this._updateStatus(ServiceStatus.READY);
    } catch (error) {
      this._emitError(error);
      throw error;
    }
  }

  getAudioFormat() {
    return {
      sampleRate: AUDIO_CONFIG.TARGET_SAMPLE_RATE,
      channels: AUDIO_CONFIG.TARGET_CHANNELS,
      encoding: 'pcm16',
      chunkDuration: AUDIO_CONFIG.DEFAULT_CHUNK_MS,
    };
  }

  /**
   * FunASR 特定方法：获取底层客户端
   * @returns {FunASRWebSocketClient}
   */
  getClient() {
    return this.client;
  }
}
