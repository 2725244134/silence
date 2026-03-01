# 多模型架构设计文档

## 一、核心组件

### 1. ModelPoolManager (模型池管理器)

**职责：**
- 注册和管理所有可用的模型
- 根据模型ID获取模型实例
- 控制模型进程的启动和停止
- 提供可用模型列表给UI

**接口定义：**
```javascript
class ModelPoolManager {
  constructor(logger)

  // 注册模型
  registerModel(config: ModelConfig): void

  // 获取模型实例（自动启动）
  async getModel(modelId: string): ModelAdapter

  // 获取所有可用模型信息
  listModels(): Array<ModelInfo>

  // 停止指定模型
  async stopModel(modelId: string): void

  // 停止所有模型
  async stopAll(): void
}
```

**使用示例：**
```javascript
const pool = new ModelPoolManager(logger);

// 注册模型
pool.registerModel({
  id: 'funasr-zh',
  name: 'FunASR 中文',
  adapter: FunASRAdapter,
  config: { /* ... */ }
});

// 用户选择模型后，获取并使用
const model = await pool.getModel('funasr-zh');
const result = await model.transcribe(audioPath);
```

---

### 2. ModelAdapter (模型适配器 - 抽象基类)

**职责：**
- 定义统一的模型接口
- 封装不同模型的实现差异
- 管理Python进程通信
- 标准化输入输出格式

**接口定义：**
```javascript
class ModelAdapter {
  constructor(config, logger)

  // 启动模型进程
  async start(): Promise<boolean>

  // 停止模型进程
  async stop(): void

  // 转写音频
  async transcribe(audioPath: string, options?: object): Promise<TranscribeResult>

  // 获取模型信息
  getInfo(): ModelInfo

  // 检查模型状态
  isReady(): boolean
}
```

**标准输出格式：**
```javascript
interface TranscribeResult {
  success: boolean
  text: string
  duration?: number
  processingTime?: number
  error?: string
}

interface ModelInfo {
  id: string
  name: string
  description: string
  languages: string[]
  status: 'stopped' | 'starting' | 'ready' | 'error'
}
```

---

## 二、具体模型适配器实现

### FunASRAdapter (继承 ModelAdapter)

**特定职责：**
- 启动 funasr_server.py 进程
- 处理FunASR特定的参数格式
- 管理VAD和标点模型

**配置示例：**
```javascript
{
  id: 'funasr-zh',
  name: 'FunASR 中文',
  description: '阿里巴巴 Paraformer 中文语音识别',
  languages: ['zh', 'zh-CN'],
  serverScript: 'funasr_server.py',
  autoStart: true,
  config: {
    asr_model: 'damo/speech_paraformer-large...',
    vad_model: 'damo/speech_fsmn_vad...',
    punc_model: 'damo/punc_ct-transformer...'
  }
}
```

### WhisperAdapter (继承 ModelAdapter)

**特定职责：**
- 启动 whisper_server.py 进程
- 处理Whisper特定的参数（language, task等）
- 支持多语言转写

**配置示例：**
```javascript
{
  id: 'whisper-multilang',
  name: 'Whisper 多语言',
  description: 'OpenAI Whisper 多语言语音识别',
  languages: ['zh', 'en', 'ja', 'ko', 'es', 'fr'],
  serverScript: 'whisper_server.py',
  autoStart: false,
  config: {
    model_size: 'medium',
    device: 'cpu'
  }
}
```

---

## 三、数据流

```
用户在UI选择模型 (modelId)
    ↓
调用 pool.getModel(modelId)
    ↓
ModelPoolManager 返回对应的 Adapter 实例
    ↓
调用 adapter.transcribe(audioPath)
    ↓
Adapter 通过 stdin/stdout 与 Python 进程通信
    ↓
返回标准化的 TranscribeResult
```

---

## 四、配置文件

### models.config.json

```json
{
  "models": [
    {
      "id": "funasr-zh",
      "name": "FunASR 中文",
      "description": "阿里巴巴 Paraformer 中文语音识别",
      "adapter": "FunASRAdapter",
      "languages": ["zh", "zh-CN"],
      "autoStart": true,
      "serverScript": "funasr_server.py",
      "config": {
        "asr_model": "damo/speech_paraformer-large_asr_nat-zh-cn-16k-common-vocab8404-pytorch",
        "vad_model": "damo/speech_fsmn_vad_zh-cn-16k-common-pytorch",
        "punc_model": "damo/punc_ct-transformer_zh-cn-common-vocab272727-pytorch"
      }
    },
    {
      "id": "whisper-multilang",
      "name": "Whisper 多语言",
      "description": "OpenAI Whisper 多语言语音识别",
      "adapter": "WhisperAdapter",
      "languages": ["zh", "en", "ja", "ko", "es", "fr"],
      "autoStart": false,
      "serverScript": "whisper_server.py",
      "config": {
        "model_size": "medium",
        "device": "cpu"
      }
    }
  ]
}
```

---

## 五、UI集成

### 设置面板添加模型选择

```javascript
// 在 SettingsPanel.jsx 中
const [selectedModel, setSelectedModel] = useState('funasr-zh');
const [availableModels, setAvailableModels] = useState([]);

useEffect(() => {
  // 获取可用模型列表
  window.api.getAvailableModels().then(models => {
    setAvailableModels(models);
  });
}, []);

// 模型选择下拉框
<select value={selectedModel} onChange={e => setSelectedModel(e.target.value)}>
  {availableModels.map(model => (
    <option key={model.id} value={model.id}>
      {model.name} - {model.description}
    </option>
  ))}
</select>
```

### IPC 接口

```javascript
// 在 ipcHandlers.js 中添加
ipcMain.handle('get-available-models', async () => {
  return modelPool.listModels();
});

ipcMain.handle('set-preferred-model', async (event, modelId) => {
  // 保存用户偏好到数据库
  await db.setSetting('preferred_model', modelId);
});

// 修改现有的转写接口
ipcMain.handle('transcribe-audio', async (event, audioPath) => {
  const preferredModel = await db.getSetting('preferred_model') || 'funasr-zh';
  const model = await modelPool.getModel(preferredModel);
  return await model.transcribe(audioPath);
});
```

---

## 六、实施步骤

### Phase 1: 重构现有代码（保持功能不变）

1. 创建 `src/helpers/adapters/baseModelAdapter.js` (抽象基类)
2. 将现有 `funasrManager.js` 重构为 `src/helpers/adapters/funasrAdapter.js`
3. 创建 `src/helpers/modelPoolManager.js`
4. 修改 `main.js` 使用新的 ModelPoolManager

**目标：** 功能完全一致，只是代码结构改变

### Phase 2: 添加配置支持

1. 创建 `config/models.json` 配置文件
2. ModelPoolManager 从配置文件加载模型
3. 添加 IPC 接口获取模型列表

**目标：** 支持配置驱动，但仍只有一个模型

### Phase 3: 添加新模型

1. 实现 `src/helpers/adapters/whisperAdapter.js`
2. 创建 `whisper_server.py`
3. 在配置文件中注册新模型
4. UI 添加模型选择功能

**目标：** 支持多个模型，用户可选择

### Phase 4: 优化体验

1. 添加模型状态显示（启动中、就绪、错误）
2. 实现模型预加载（可选）
3. 添加模型切换动画和提示

---

## 七、关键设计原则

1. **简单优先**：不做自动路由，用户手动选择
2. **统一接口**：所有模型通过相同的接口调用
3. **配置驱动**：新增模型只需添加配置和适配器
4. **向后兼容**：保持现有API不变
5. **渐进增强**：分阶段实施，每个阶段都可用

---

## 八、文件结构

```
ququ/
├── config/
│   └── models.json                    # 模型配置
├── src/
│   └── helpers/
│       ├── modelPoolManager.js        # 模型池管理器
│       └── adapters/
│           ├── baseModelAdapter.js    # 抽象基类
│           ├── funasrAdapter.js       # FunASR适配器
│           └── whisperAdapter.js      # Whisper适配器
├── funasr_server.py                   # FunASR服务器
├── whisper_server.py                  # Whisper服务器
└── base_asr_server.py                 # Python基类（可选）
```

---

## 九、优势

✅ **架构清晰**：只有2个核心组件，职责明确
✅ **易于扩展**：新增模型只需实现适配器
✅ **用户友好**：简单的下拉选择，无需理解复杂逻辑
✅ **向后兼容**：现有功能完全保留
✅ **渐进实施**：可以分阶段完成，每阶段都可用
