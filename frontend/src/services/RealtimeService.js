/**
 * OpenAI Realtime 服务实现
 * 同时支持本地 voxtral 和云端 OpenAI Realtime API
 */

import { ASRService, TranscriptionMode, ServiceStatus } from './ASRServiceInterface';
import RealtimeClient from '../helpers/realtimeClient';
import { AUDIO_CONFIG, REALTIME_SESSION_DEFAULTS, ASR_MODES } from '../config/audioConfig';
import { pcm16ToBase64 } from '../utils/audioUtils';

export class RealtimeService extends ASRService {
  constructor(config = {}) {
    super(config);

    this.asrMode = config.asrMode || ASR_MODES.LOCAL;
    this.url = config.url || (this.asrMode === ASR_MODES.CLOUD
      ? 'wss://api.openai.com/v1/realtime?intent=transcription'
      : 'ws://localhost:8765');
    this.apiKey = config.apiKey || '';
    this.client = null;
  }

  getName() {
    return this.asrMode === ASR_MODES.CLOUD ? 'OpenAI Realtime' : 'Voxtral Realtime';
  }

  getSupportedModes() {
    return [TranscriptionMode.REALTIME];
  }

  async connect() {
    if (this.client?.isConnected()) {
      return;
    }

    this._updateStatus(ServiceStatus.CONNECTING);

    try {
      const options = {};
      if (this.asrMode === ASR_MODES.CLOUD && this.apiKey) {
        options.protocols = ['realtime', `openai-insecure-api-key.${this.apiKey}`];
      }

      this.client = new RealtimeClient(this.url, options);

      this.client.onSessionCreated = () => {
        this._updateStatus(ServiceStatus.READY);
      };

      this.client.onTranscriptionDelta = (message) => {
        this._emitPartialResult({
          text: message.transcript || message.delta || '',
          isFinal: false,
        });
      };

      this.client.onTranscriptionDone = (message) => {
        this._emitFinalResult({
          text: message.transcript || '',
          isFinal: true,
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

    this._updateStatus(ServiceStatus.TRANSCRIBING);

    try {
      await this.client.updateSession({
        ...REALTIME_SESSION_DEFAULTS,
        ...options.config,
      });
      return 'session';
    } catch (error) {
      this._emitError(error);
      throw error;
    }
  }

  async sendAudio(audioData) {
    if (!this.client) {
      throw new Error('客户端未连接');
    }

    try {
      // audioData 可以是 Uint8Array (PCM16) 或已经是 base64 string
      const base64 = typeof audioData === 'string'
        ? audioData
        : pcm16ToBase64(audioData);
      this.client.appendAudio(base64);
    } catch (error) {
      this._emitError(error);
      throw error;
    }
  }

  async stopTranscription() {
    if (!this.client) {
      throw new Error('客户端未连接');
    }

    try {
      await this.client.commitAudioBuffer();
      this._updateStatus(ServiceStatus.READY);
    } catch (error) {
      this._emitError(error);
      throw error;
    }
  }

  async cancelTranscription() {
    if (!this.client) {
      return;
    }

    try {
      this.client.clearAudioBuffer();
      this.client.cancelResponse();
      this._updateStatus(ServiceStatus.READY);
    } catch (error) {
      this._emitError(error);
      throw error;
    }
  }

  getAudioFormat() {
    const sampleRate = this.asrMode === ASR_MODES.CLOUD
      ? AUDIO_CONFIG.CLOUD_SAMPLE_RATE
      : AUDIO_CONFIG.LOCAL_SAMPLE_RATE;

    return {
      sampleRate,
      channels: AUDIO_CONFIG.TARGET_CHANNELS,
      encoding: 'pcm16',
      chunkDuration: AUDIO_CONFIG.DEFAULT_CHUNK_MS,
    };
  }

  getClient() {
    return this.client;
  }
}
