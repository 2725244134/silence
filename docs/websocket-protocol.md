# FunASR WebSocket 协议规范 v1.0

## 概述

本协议定义了客户端与 FunASR 服务端之间的 WebSocket 通信规范，支持两种工作模式：
- **batch**: 离线整段识别（上传完整音频文件）
- **realtime**: 实时流式识别（分片推送音频数据）

## 连接

### 端点
```
ws://localhost:10095/
```

### 握手参数（可选）
```
?mode=realtime&session_id=xxx
```

## 消息格式

### 消息类型

所有文本消息使用 JSON 格式，二进制消息为原始音频数据。

#### 客户端 → 服务端

| 类型 | 格式 | 说明 |
|------|------|------|
| `start_batch` | JSON | 开始批量识别会话 |
| `batch_audio` | Binary | 批量模式音频数据 |
| `end_batch` | JSON | 结束批量识别 |
| `start_realtime` | JSON | 开始实时识别会话 |
| `realtime_audio` | Binary | 实时模式音频数据 |
| `end_realtime` | JSON | 结束实时识别 |
| `cancel` | JSON | 取消会话 |
| `ping` | JSON | 心跳 |

#### 服务端 → 客户端

| 类型 | 格式 | 说明 |
|------|------|------|
| `ready` | JSON | 服务就绪 |
| `started` | JSON | 会话已开始 |
| `partial_result` | JSON | 中间识别结果（仅 realtime） |
| `final_result` | JSON | 最终识别结果 |
| `error` | JSON | 错误通知 |
| `pong` | JSON | 心跳响应 |

## 协议详细定义

### 1. Batch 模式

#### 1.1 开始会话
```json
{
  "type": "start_batch",
  "session_id": "uuid-xxx",
  "config": {
    "audio_fs": 16000,
    "language": "zh",
    "use_punc": true,
    "use_itn": true
  }
}
```

**响应：**
```json
{
  "type": "started",
  "session_id": "uuid-xxx",
  "mode": "batch",
  "timestamp": 1234567890
}
```

#### 1.2 发送音频数据
```
Binary message: PCM16 audio data (16kHz, mono)
```

可以分多次发送，服务端会累积。

#### 1.3 结束会话并获取结果
```json
{
  "type": "end_batch",
  "session_id": "uuid-xxx"
}
```

**响应：**
```json
{
  "type": "final_result",
  "session_id": "uuid-xxx",
  "mode": "batch",
  "text": "识别的完整文本",
  "duration": 5.2,
  "timestamp": 1234567890
}
```

### 2. Realtime 模式

#### 2.1 开始会话
```json
{
  "type": "start_realtime",
  "session_id": "uuid-xxx",
  "config": {
    "mode": "2pass",
    "audio_fs": 16000,
    "chunk_size": [5, 10, 5],
    "chunk_interval": 10,
    "hotwords": "",
    "use_punc": true,
    "use_itn": true,
    "encoder_chunk_look_back": 4,
    "decoder_chunk_look_back": 1
  }
}
```

**响应：**
```json
{
  "type": "started",
  "session_id": "uuid-xxx",
  "mode": "realtime",
  "timestamp": 1234567890
}
```

#### 2.2 发送音频片段
```
Binary message: PCM16 audio chunk (建议 40ms = 640 samples @ 16kHz)
```

**响应（中间结果）：**
```json
{
  "type": "partial_result",
  "session_id": "uuid-xxx",
  "seq": 123,
  "text": "你好世",
  "is_final": false,
  "timestamp": 1234567890
}
```

#### 2.3 结束会话
```json
{
  "type": "end_realtime",
  "session_id": "uuid-xxx"
}
```

**响应（最终结果）：**
```json
{
  "type": "final_result",
  "session_id": "uuid-xxx",
  "mode": "realtime",
  "text": "你好世界",
  "is_final": true,
  "duration": 2.5,
  "timestamp": 1234567890
}
```

### 3. 通用消息

#### 3.1 取消会话
```json
{
  "type": "cancel",
  "session_id": "uuid-xxx",
  "reason": "user_cancel"
}
```

**响应：**
```json
{
  "type": "cancelled",
  "session_id": "uuid-xxx",
  "timestamp": 1234567890
}
```

#### 3.2 错误通知
```json
{
  "type": "error",
  "session_id": "uuid-xxx",
  "code": "invalid_audio",
  "message": "音频格式不支持",
  "fatal": true,
  "timestamp": 1234567890
}
```

#### 3.3 心跳
```json
{
  "type": "ping",
  "timestamp": 1234567890
}
```

**响应：**
```json
{
  "type": "pong",
  "timestamp": 1234567890
}
```

## 会话流程

### Batch 模式流程
```
Client                          Server
  |                               |
  |--- ws://connect ------------->|
  |<-- {"type":"ready"} ----------|
  |                               |
  |--- {"type":"start_batch"} --->|
  |<-- {"type":"started"} --------|
  |                               |
  |--- [binary audio chunk 1] --->|
  |--- [binary audio chunk 2] --->|
  |--- [binary audio chunk N] --->|
  |                               |
  |--- {"type":"end_batch"} ----->|
  |<-- {"type":"final_result"} ---|
  |                               |
  |--- close -------------------->|
```

### Realtime 模式流程
```
Client                          Server
  |                               |
  |--- ws://connect ------------->|
  |<-- {"type":"ready"} ----------|
  |                               |
  |--- {"type":"start_realtime"} >|
  |<-- {"type":"started"} --------|
  |                               |
  |--- [binary audio] ----------->|
  |<-- {"type":"partial_result"} -|
  |                               |
  |--- [binary audio] ----------->|
  |<-- {"type":"partial_result"} -|
  |                               |
  |--- {"type":"end_realtime"} -->|
  |<-- {"type":"final_result"} ---|
  |                               |
  |--- close -------------------->|
```

## 错误码

| 错误码 | 说明 |
|--------|------|
| `invalid_message` | 消息格式错误 |
| `invalid_audio` | 音频格式不支持 |
| `session_not_found` | 会话不存在 |
| `session_exists` | 会话已存在 |
| `model_not_ready` | 模型未就绪 |
| `internal_error` | 内部错误 |
| `rate_limit` | 请求过于频繁 |

## 音频格式要求

- **采样率**: 16000 Hz
- **声道**: 单声道 (mono)
- **位深**: 16-bit
- **编码**: PCM (little-endian)
- **格式**: Raw PCM data (无 WAV header)

## 性能建议

1. **Realtime 模式**：建议每 40ms 发送一次音频片段（640 samples）
2. **Batch 模式**：建议分块发送，每块不超过 1MB
3. **心跳间隔**：建议每 30 秒发送一次 ping
4. **超时设置**：
   - 连接超时: 10s
   - 识别超时: 60s (batch), 30s (realtime 无数据)
   - 心跳超时: 60s

## 安全性

1. 仅监听 localhost，不对外暴露
2. 可选：添加 token 认证（握手参数 `?token=xxx`）
3. 限制单个会话最大音频长度（batch: 10分钟，realtime: 30分钟）
4. 限制并发连接数（默认 10）
