/**
 * WebSocket 消息类型常量
 * 避免使用字符串字面量，提高类型安全性
 */

// 客户端 -> 服务器
export const CLIENT_MESSAGE_TYPES = {
  START_BATCH: 'start_batch',
  END_BATCH: 'end_batch',
  START_REALTIME: 'start_realtime',
  END_REALTIME: 'end_realtime',
  CANCEL: 'cancel',
  PING: 'ping',
};

// 服务器 -> 客户端
export const SERVER_MESSAGE_TYPES = {
  READY: 'ready',
  STARTED: 'started',
  PARTIAL_RESULT: 'partial_result',
  FINAL_RESULT: 'final_result',
  ERROR: 'error',
  CANCELLED: 'cancelled',
  PONG: 'pong',
};

// 所有消息类型
export const WS_MESSAGE_TYPES = {
  ...CLIENT_MESSAGE_TYPES,
  ...SERVER_MESSAGE_TYPES,
};
