/**
 * 音频配置常量
 * 集中管理所有音频相关配置
 */

export const AUDIO_CONFIG = {
  // 本地 voxtral: 16kHz
  LOCAL_SAMPLE_RATE: 16000,
  // 云端 OpenAI Realtime: 24kHz
  CLOUD_SAMPLE_RATE: 24000,
  TARGET_CHANNELS: 1,
  // 音频发送间隔（本地和云端通用）
  DEFAULT_CHUNK_MS: 480,
};

export const AUDIO_CONSTRAINTS = {
  sampleRate: AUDIO_CONFIG.LOCAL_SAMPLE_RATE,
  channelCount: AUDIO_CONFIG.TARGET_CHANNELS,
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
};

/**
 * OpenAI Realtime session.update 默认配置
 */
export const REALTIME_SESSION_DEFAULTS = {
  modalities: ['text', 'audio'],
  input_audio_format: 'pcm16',
};

export const TRANSCRIPTION_MODES = {
  REALTIME: 'realtime',
};

/**
 * ASR 模式
 */
export const ASR_MODES = {
  LOCAL: 'local',   // 本地 voxtral realtime_ws_server
  CLOUD: 'cloud',   // 云端 OpenAI Realtime API
};
