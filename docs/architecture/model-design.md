# 多模型架构设计文档

## 命名说明

- `base_model.js` - 基础模型类（Python 风格命名）
- `funasr_model.js` - FunASR 模型实现
- `model_manager.js` - 模型管理器（不是"池"，只是注册和管理模型）
- `model_servers/` - 模型服务器脚本目录

## 文件结构

```
项目根目录/
├── model_servers/              # 模型服务器脚本目录
│   ├── funasr_server.py       # FunASR 模型服务器
│   └── whisper_server.py      # Whisper 模型服务器（未来）
├── download_models.py          # 模型下载脚本
├── evdev_hotkey_listener.py   # 热键监听器
└── src/helpers/
    ├── models/
    │   ├── base_model.js      # 基础模型类
    │   └── funasr_model.js    # FunASR 模型实现
    └── model_manager.js       # 模型管理器
```

## 核心组件

### 1. ModelManager (模型管理器)

**职责：**
- 注册和管理所有可用的模型
- 根据模型ID获取模型实例
- 设置和获取当前使用的模型
- 提供可用模型列表

**接口：**
```javascript
class ModelManager {
  register(id, modelInstance)  // 注册模型
  get(id)                       // 获取模型实例
  list()                        // 获取所有模型信息
  setCurrent(id)                // 设置当前模型
  getCurrent()                  // 获取当前模型
  stopAll()                     // 停止所有模型
  has(id)                       // 检查模型是否存在
}
```

### 2. BaseModel (基础模型类)

**职责：**
- 定义统一的模型接口
- 提供通用的进程管理方法
- 标准化输入输出格式

**接口：**
```javascript
class BaseModel {
  async start()                          // 启动模型
  async stop()                           // 停止模型
  async transcribe(audioPath, options)   // 转写音频
  getInfo()                              // 获取模型信息
  getStatus()                            // 获取模型状态
  isReady()                              // 检查是否就绪
}
```

### 3. FunasrModel (FunASR 模型实现)

**职责：**
- 实现 FunASR 特定的启动逻辑
- 管理 FunASR 的三个子模型（ASR、VAD、PUNC）
- 处理 FunASR 特定的通信协议

## 使用示例

```javascript
const ModelManager = require('./helpers/model_manager');
const FunasrModel = require('./helpers/models/funasr_model');

// 创建管理器
const manager = new ModelManager(logger);

// 注册 FunASR 模型
const funasrConfig = {
  id: 'funasr-zh',
  name: 'FunASR 中文',
  description: '阿里巴巴 Paraformer 中文语音识别',
  languages: ['zh', 'zh-CN'],
  serverScript: 'funasr_server.py'
};
const funasrModel = new FunasrModel(funasrConfig, logger);
manager.register('funasr-zh', funasrModel);

// 设置当前模型
manager.setCurrent('funasr-zh');

// 使用当前模型转写
const model = manager.getCurrent();
const result = await model.transcribe(audioPath);
```

## Phase 1 实施步骤

### ✅ 已完成
1. 创建 `base_model.js` 基础类
2. 创建 `funasr_model.js` 实现
3. 创建 `model_manager.js` 管理器

### 下一步
4. 修改 `main.js` 使用新的 ModelManager
5. 保持现有功能完全不变
6. 测试验证

## 设计原则

1. **简洁命名** - 使用 Python 风格，避免 Java 风格的 Adapter
2. **清晰职责** - Manager 只是注册表，不是进程池
3. **统一接口** - 所有模型通过相同接口调用
4. **向后兼容** - 保持现有 API 不变
