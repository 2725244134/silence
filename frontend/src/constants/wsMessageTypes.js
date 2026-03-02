/**
 * OpenAI Realtime API 事件类型常量
 * 同时兼容本地 voxtral 和云端 OpenAI Realtime
 */

// 客户端 -> 服务器
export const CLIENT_EVENT_TYPES = {
  SESSION_UPDATE: 'session.update',
  INPUT_AUDIO_BUFFER_APPEND: 'input_audio_buffer.append',
  INPUT_AUDIO_BUFFER_COMMIT: 'input_audio_buffer.commit',
  INPUT_AUDIO_BUFFER_CLEAR: 'input_audio_buffer.clear',
  RESPONSE_CANCEL: 'response.cancel',
};

// 服务器 -> 客户端
export const SERVER_EVENT_TYPES = {
  SESSION_CREATED: 'session.created',
  SESSION_UPDATED: 'session.updated',
  INPUT_AUDIO_BUFFER_COMMITTED: 'input_audio_buffer.committed',
  INPUT_AUDIO_BUFFER_SPEECH_STARTED: 'input_audio_buffer.speech_started',
  INPUT_AUDIO_BUFFER_SPEECH_STOPPED: 'input_audio_buffer.speech_stopped',
  TRANSCRIPT_DELTA: 'response.audio_transcript.delta',
  TRANSCRIPT_DONE: 'response.audio_transcript.done',
  RESPONSE_CANCELLED: 'response.cancelled',
  ERROR: 'error',
};
