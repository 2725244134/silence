/**
 * 音频配置常量
 * 集中管理所有音频相关配置
 */

export const AUDIO_CONFIG = {
  TARGET_SAMPLE_RATE: 16000,
  TARGET_CHANNELS: 1,
  DEFAULT_CHUNK_MS: 40,
};

export const AUDIO_CONSTRAINTS = {
  sampleRate: AUDIO_CONFIG.TARGET_SAMPLE_RATE,
  channelCount: AUDIO_CONFIG.TARGET_CHANNELS,
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
};

export const BATCH_CONFIG_DEFAULTS = {
  audio_fs: 16000,
  language: 'zh',
  use_punc: true,
  use_itn: true,
};

export const REALTIME_CONFIG_DEFAULTS = {
  mode: '2pass',
  audio_fs: 16000,
  chunk_size: [5, 10, 5],
  chunk_interval: 10,
  hotwords: '',
  use_punc: true,
  use_itn: true,
  encoder_chunk_look_back: 4,
  decoder_chunk_look_back: 1,
};

export const TRANSCRIPTION_MODES = {
  REALTIME: 'realtime',
  OFFLINE: 'offline',
};
