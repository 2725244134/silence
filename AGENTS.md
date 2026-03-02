# AGENTS.md

此文件为在此代码库中工作的AI助手提供指导。

## 项目管理

- **GitHub Project**: https://github.com/users/yan5xu/projects/2
- 所有任务、功能开发和Bug跟踪都在项目看板中管理
- 开发进度和里程碑规划可在项目看板中查看

## 非标准构建命令

- `pnpm run dev` - 同时运行渲染进程(Vite)和主进程(Electron)
- `pnpm run dev:renderer` - Vite开发服务器必须从`src/`目录运行(不是根目录)
- `pnpm run build:renderer` - 任何Electron构建命令之前都必须先执行此命令
- `pnpm run prepare:python` - 使用`uv`同步Python环境并下载FunASR模型
- `pnpm run prepare:python:uv` - 同`prepare:python`，显式使用`uv`
- `pnpm run test:python` - 快速测试Python依赖是否可用
- `pnpm start -- --status` - 通过应用本体查看CLI触发服务状态（开发环境）
- `pnpm start -- --trigger` - 通过应用本体触发一次听写热键事件（开发环境）
- `pnpm run clean` - 清理构建文件

## 关键架构模式

### FunASR服务器通信
- Python服务器(`funasr_server.py`)通过stdin/stdout进行JSON消息通信
- 音频转录前必须启动服务器(由`funasrManager.js`处理)
- 音频文件在系统临时目录创建，不在项目目录
- FunASR模型下载到用户数据目录，不是项目目录
- 支持模型自动下载和状态监控(`download_models.py`)
- 模型缺失时提供优雅的错误处理和下载提示
- 新增模型文件检查机制，避免未下载模型时的初始化错误

### IPC架构(非标准)
- 所有Electron IPC处理器集中在`src/helpers/ipcHandlers.js`
- 全局热键通过`evdev_hotkey_listener.py`监听（`uv run python`启动）
- 热键可通过设置项`global_hotkey`配置（当前支持`ALT+D`与`F1-F12`）
- 录音状态通过`hotkeyManager.js`在主进程和渲染进程间同步
- 新增模型管理IPC接口：`check-model-files`, `download-models`, `get-download-progress`
- 模型下载进度通过`model-download-progress`事件实时推送
- CLI触发服务通过Unix socket暴露（`/tmp/ququ-trigger-<uid>.sock`）

### 窗口管理
- 主窗口和控制面板是独立的BrowserWindow实例
- 历史窗口加载`src/history.html`(与主应用分离的入口点)
- 所有窗口使用`preload.js`进行安全API暴露

### 数据库架构
- 使用better-sqlite3，自定义架构在`src/helpers/database.js`
- 转录表同时存储raw_text(FunASR)和processed_text(AI优化)
- 设置在键值表中JSON序列化存储

## 项目特定约定

### 文件组织
- `src/helpers/`中的文件是管理器类(不是工具函数)
- `src/hooks/`中的钩子遵循Electron集成的自定义模式
- Python脚本(`funasr_server.py`, `download_models.py`, `evdev_hotkey_listener.py`)在项目根目录，不在src/
- `scripts/`目录包含构建辅助脚本

### 环境变量
- `ELECTRON_USER_DATA`由主进程设置，供Python脚本日志使用
- AI API配置通过应用内设置面板进行配置
- 开发模式通过`NODE_ENV=development`检测

### CSS架构
- 使用Tailwind 4.x，带中文字体优化
- 自定义CSS类：`.chinese-content`、`.chinese-title`、`.status-text`
- 硬编码WCAG 2.1兼容的对比度比例在CSS变量中
- Electron特定类：`.draggable`、`.non-draggable`

### 音频处理
- 音频以WAV格式在临时文件中处理
- FunASR处理VAD(语音活动检测)和标点恢复
- AI文本处理在FunASR转录完成后进行

### 日志管理
- 必须使用`src/helpers/logManager.js`而非console.log
- 应用日志和FunASR日志分别存储在用户数据目录
- 提供`logFunASR()`方法专门记录FunASR相关日志
- 日志以JSON格式存储，支持结构化查询
- Python日志路径通过`ELECTRON_USER_DATA`环境变量传入

## 关键注意事项

### 路径解析
- Vite配置使用`src/`作为基础目录，影响所有相对导入
- 生产构建引用`app.asar.unpacked`中的Python脚本
- 资源路径从src目录使用`../assets`

### Python集成
- 使用`uv`管理Python环境（Python 3.11+）
- 关键依赖：numpy<2, torch==2.0.1, torchaudio==2.0.2, librosa>=0.11.0, funasr>=1.2.7, evdev
- FunASR安装需要特定模型版本(v2.0.4)
- Python进程生成使用`windowsHide: true`选项
- 清除系统Python环境变量干扰：PYTHONUSERBASE, PYTHONSTARTUP, VIRTUAL_ENV
- Wayland自动粘贴链路：`wl-copy` + `ydotool`（需`ydotoold`）

### 状态管理
- 无外部状态库 - 使用React hooks配合Electron IPC
- 录音状态必须在进程间手动同步
- 窗口可见性状态影响热键注册

### 开发vs生产环境
- 开发模式有2秒延迟等待Vite启动
- Linux模式依赖系统`uv`与Python环境
- 日志文件位置在开发和生产构建中不同
- 构建流程自动检查Python依赖与模型

## 新增功能架构

### Linux/Wayland 热键与粘贴
- 全局热键通过`evdev`监听输入设备
- 自动粘贴通过`wl-copy + ydotool`实现（先写剪贴板，再发送`Ctrl+V`）
- 提供应用本体CLI接口：`--status` / `--trigger`

### 模型管理系统
- 三个核心模型：ASR(语音识别)、VAD(语音活动检测)、PUNC(标点恢复)
- 模型文件检查机制，支持大小和完整性验证
- 并行下载所有模型，支持实时进度显示
- 模型缺失时的优雅降级和用户提示
- 模型状态指示器组件提供可视化反馈

### 构建系统增强
- Linux构建前自动准备Python依赖与模型
- 支持清理命令移除构建缓存
