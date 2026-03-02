# ASR 服务架构设计

## 概述

本项目采用抽象接口 + 工厂模式设计，支持多种 ASR 服务的无缝切换和扩展。

## 架构层次

```
┌─────────────────────────────────────────┐
│         React Components / UI           │
└─────────────────┬───────────────────────┘
                  │
┌─────────────────▼───────────────────────┐
│      useASRService (通用 Hook)          │  ← 统一接口
└─────────────────┬───────────────────────┘
                  │
┌─────────────────▼───────────────────────┐
│      ASRServiceFactory (工厂)           │  ← 服务创建
└─────────────────┬───────────────────────┘
                  │
        ┌─────────┴─────────┬─────────────┐
        │                   │             │
┌───────▼────────┐  ┌──────▼──────┐  ┌──▼────────┐
│  FunASRService │  │WhisperService│  │GoogleSpeech│
│  (WebSocket)   │  │   (HTTP)     │  │  (gRPC)   │
└────────────────┘  └──────────────┘  └───────────┘
        │                   │             │
        └─────────┬─────────┴─────────────┘
                  │
        ┌─────────▼─────────┐
        │  ASRService (抽象) │  ← 基类/接口
        └───────────────────┘
```

## 核心组件

### 1. ASRServiceInterface (抽象基类)

定义所有 ASR 服务必须实现的接口：

```javascript
class ASRService {
  // 生命周期
  async connect()
  async disconnect()

  // 转录操作
  async startTranscription(options)
  async sendAudio(audioData)
  async stopTranscription(sessionId)
  async cancelTranscription(sessionId, reason)

  // 元数据
  getName()
  getSupportedModes()
  getAudioFormat()

  // 回调
  onStatusChange
  onPartialResult
  onFinalResult
  onError
}
```

### 2. FunASRService (具体实现)

FunASR WebSocket 服务的实现：
- 继承 `ASRService`
- 封装 `FunASRWebSocketClient`
- 实现所有抽象方法
- 支持 batch 和 realtime 模式

### 3. ASRServiceFactory (工厂)

负责创建和管理服务实例：
- 注册服务实现
- 创建服务实例
- 查询可用服务

### 4. useASRService (通用 Hook)

提供统一的 React Hook 接口：
- 自动管理服务生命周期
- 统一的状态管理
- 统一的错误处理
- 支持任何 ASR 服务

## 使用示例

### 基础用法

```javascript
import { useASRService } from '../hooks/useASRService';
import { ASRServiceType } from '../services/ASRServiceFactory';
import { TranscriptionMode } from '../services/ASRServiceInterface';

function MyComponent() {
  const {
    status,
    partialText,
    finalText,
    error,
    startTranscription,
    sendAudio,
    stopTranscription,
  } = useASRService(ASRServiceType.FUNASR);

  const handleStart = async () => {
    await startTranscription(TranscriptionMode.REALTIME);
  };

  return (
    <div>
      <button onClick={handleStart}>开始录音</button>
      <p>实时结果: {partialText}</p>
      <p>最终结果: {finalText}</p>
    </div>
  );
}
```

### 切换服务

```javascript
// 使用 FunASR
const asr = useASRService(ASRServiceType.FUNASR);

// 切换到 Whisper (未来)
const asr = useASRService(ASRServiceType.WHISPER, {
  apiKey: 'xxx',
  model: 'whisper-1'
});

// 切换到 Google Speech (未来)
const asr = useASRService(ASRServiceType.GOOGLE, {
  credentials: {...}
});
```

## 添加新服务

### 步骤 1: 实现服务类

```javascript
// src/services/WhisperService.js
import { ASRService, TranscriptionMode, ServiceStatus } from './ASRServiceInterface';

export class WhisperService extends ASRService {
  getName() {
    return 'Whisper';
  }

  getSupportedModes() {
    return [TranscriptionMode.BATCH]; // Whisper 只支持批量
  }

  async connect() {
    // 实现连接逻辑
    this._updateStatus(ServiceStatus.READY);
  }

  async startTranscription(options) {
    // 实现开始转录
    const sessionId = crypto.randomUUID();
    this._updateStatus(ServiceStatus.TRANSCRIBING);
    return sessionId;
  }

  async sendAudio(audioData) {
    // 累积音频数据
  }

  async stopTranscription(sessionId) {
    // 发送到 Whisper API
    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.config.apiKey}`,
      },
      body: formData,
    });

    const result = await response.json();
    this._emitFinalResult({ text: result.text });
    return result;
  }

  getAudioFormat() {
    return {
      sampleRate: 16000,
      channels: 1,
      encoding: 'wav',
    };
  }
}
```

### 步骤 2: 注册服务

```javascript
// src/services/ASRServiceFactory.js
import { WhisperService } from './WhisperService';

ASRServiceFactory.register(ASRServiceType.WHISPER, WhisperService);
```

### 步骤 3: 使用新服务

```javascript
const asr = useASRService(ASRServiceType.WHISPER, {
  apiKey: process.env.OPENAI_API_KEY,
  model: 'whisper-1',
});
```

## 优势

1. **解耦**: UI 层不依赖具体实现
2. **可扩展**: 添加新服务只需实现接口
3. **可测试**: 可以 mock ASRService 进行测试
4. **统一体验**: 所有服务使用相同的 API
5. **灵活配置**: 每个服务可以有自己的配置
6. **类型安全**: 明确的接口定义

## 未来扩展

可以添加的服务：
- **WhisperService**: OpenAI Whisper API
- **GoogleSpeechService**: Google Cloud Speech-to-Text
- **AzureSpeechService**: Azure Cognitive Services
- **DeepgramService**: Deepgram API
- **LocalWhisperService**: 本地 Whisper 模型

可以添加的功能：
- 服务健康检查
- 自动故障转移
- 服务性能监控
- 多服务并行识别
- 结果融合
