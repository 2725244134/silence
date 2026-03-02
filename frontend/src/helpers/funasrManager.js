const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");
const PythonInstaller = require("./pythonInstaller");
const { runCommand, TIMEOUTS } = require("../utils/process");

// 简单的全局缓存，避免频繁检查
let globalModelCheckCache = null;
let globalModelCheckTime = 0;
const GLOBAL_CACHE_TIME = 2000; // 减少到2秒缓存，确保及时更新

class FunASRManager {
  constructor(logger = null) {
    this.logger = logger || console; // 使用传入的logger或默认console
    this.pythonCmd = null; // 缓存 Python 可执行文件路径
    this.funasrInstalled = null; // 缓存安装状态
    this.isInitialized = false; // 跟踪启动初始化是否完成
    this.pythonInstaller = new PythonInstaller();
    this.modelsDownloaded = null; // 缓存模型下载状态
    
    // 简化缓存
    this._cachedPythonEnv = null;
    
    // realtime-only 模型配置
    this.modelConfigs = {
      realtime_asr: {
        name: "iic/speech_paraformer-large_asr_nat-zh-cn-16k-common-vocab8404-online",
        cache_path: path.join(
          "iic",
          "speech_paraformer-large_asr_nat-zh-cn-16k-common-vocab8404-online"
        ),
        expected_size: 840 * 1024 * 1024, // 约840MB
      },
    };
  }


  setupIsolatedEnvironment() {
    // Linux + uv / 系统Python：不使用嵌入式环境变量
    delete process.env.PYTHONHOME;
    delete process.env.PYTHONPATH;
    delete process.env.PYTHONUSERBASE;
    delete process.env.PYTHONSTARTUP;
    delete process.env.VIRTUAL_ENV;

    process.env.PYTHONDONTWRITEBYTECODE = '1';
    process.env.PYTHONIOENCODING = 'utf-8';
    process.env.PYTHONUNBUFFERED = '1';
  }

  buildPythonEnvironment() {
    // 构建 Linux/uv 运行时环境，不注入嵌入式路径
    if (this._cachedPythonEnv) {
      return this._cachedPythonEnv;
    }
    
    const env = {
      ...process.env,
      PYTHONDONTWRITEBYTECODE: '1',
      PYTHONIOENCODING: 'utf-8',
      PYTHONUNBUFFERED: '1',
      ELECTRON_USER_DATA: require('electron').app.getPath('userData')
    };

    delete env.PYTHONHOME;
    delete env.PYTHONPATH;
    delete env.PYTHONUSERBASE;
    delete env.PYTHONSTARTUP;
    delete env.VIRTUAL_ENV;
    
    this._cachedPythonEnv = env;
    
    return env;
  }

  /**
   * 获取模型缓存路径
   */
  getModelCacheCandidates() {
    const baseCachePath =
      process.env.MODELSCOPE_CACHE || path.join(os.homedir(), ".cache", "modelscope");

    return [
      path.join(baseCachePath, "hub", "models"),
      path.join(baseCachePath, "hub"),
      path.join(baseCachePath, "models"),
      baseCachePath,
    ].filter((candidate, index, arr) => arr.indexOf(candidate) === index);
  }

  getModelCachePath() {
    const candidates = this.getModelCacheCandidates();

    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        this.logger.info && this.logger.info("找到模型缓存路径:", candidate);
        return candidate;
      }
    }

    // 目录可能尚未创建，返回默认候选目录供后续流程使用
    return candidates[0];
  }

  resolveRealtimeModelFilePath() {
    const config = this.modelConfigs.realtime_asr;
    const candidateFiles = this.getModelCacheCandidates().map((cachePath) =>
      path.join(cachePath, config.cache_path, "model.pt")
    );

    const existingFile = candidateFiles.find((filePath) => fs.existsSync(filePath));

    return {
      modelFile: existingFile || candidateFiles[0],
      candidateFiles,
    };
  }


  async checkModelFiles() {
    /**
     * 检查所有模型文件是否存在（使用简单缓存避免频繁检查）
     */
    const now = Date.now();
    
    // 使用全局缓存避免频繁检查，但如果服务器状态可能已变化则强制检查
    if (globalModelCheckCache &&
        (now - globalModelCheckTime) < GLOBAL_CACHE_TIME) {
      return globalModelCheckCache;
    }
    
    try {
      const config = this.modelConfigs.realtime_asr;
      const { modelFile, candidateFiles } = this.resolveRealtimeModelFilePath();

      let fileSize = 0;
      let exists = false;
      let isComplete = false;

      if (fs.existsSync(modelFile)) {
        const stats = fs.statSync(modelFile);
        fileSize = stats.size;
        exists = true;
        isComplete = fileSize >= config.expected_size * 0.9;
      }

      const missingModels = isComplete ? [] : ["realtime_asr"];
      const allDownloaded = missingModels.length === 0;
      this.modelsDownloaded = allDownloaded;

      const results = {
        realtime_asr: {
          exists,
          path: modelFile,
          size: fileSize,
          expected_size: config.expected_size,
          complete: isComplete,
          candidates: candidateFiles,
        },
      };

      this.logger.info && this.logger.info('模型检查完成:', {
        allDownloaded,
        missingModels,
        details: results
      });
      
      const result = {
        success: true,
        models_downloaded: allDownloaded,
        missing_models: missingModels,
        details: results
      };
      
      // 更新全局缓存
      globalModelCheckCache = result;
      globalModelCheckTime = now;
      return result;
      
    } catch (error) {
      this.logger.error && this.logger.error('检查模型文件失败:', error);
      this.modelsDownloaded = false;
      const result = {
        success: false,
        error: error.message,
        models_downloaded: false,
        missing_models: ["realtime_asr"],
        details: {}
      };
      
      // 错误情况下不缓存，允许重试
      return result;
    }
  }

  async getDownloadProgress() {
    /**
     * 获取模型下载进度
     */
    try {
      const config = this.modelConfigs.realtime_asr;
      const { modelFile } = this.resolveRealtimeModelFilePath();

      let downloaded = 0;
      if (fs.existsSync(modelFile)) {
        const stats = fs.statSync(modelFile);
        downloaded = stats.size;
      }

      const total = Math.max(config.expected_size, 1);
      const progress = Math.min(100, (downloaded / total) * 100);
      const roundedProgress = Math.round(progress * 10) / 10;

      return {
        success: true,
        overall_progress: roundedProgress,
        models: {
          realtime_asr: {
            progress: roundedProgress,
            downloaded,
            total: config.expected_size,
            path: modelFile,
          },
        },
      };
      
    } catch (error) {
      this.logger.error && this.logger.error('获取下载进度失败:', error);
      return {
        success: false,
        error: error.message,
        overall_progress: 0,
        models: {}
      };
    }
  }

  getDownloadScriptPath() {
    /**
     * 获取下载脚本路径
     */
    if (process.env.NODE_ENV === "development") {
      return path.join(__dirname, "..", "..", "download_models.py");
    } else {
      return path.join(
        process.resourcesPath,
        "app.asar.unpacked",
        "download_models.py"
      );
    }
  }

  async downloadModels(progressCallback = null) {
    /**
     * 下载模型文件（使用独立的Python脚本并行下载）
     */
    try {
      this.logger.info && this.logger.info('开始下载FunASR模型...');
      
      // 先检查模型状态
      const checkResult = await this.checkModelFiles();
      if (checkResult.models_downloaded) {
        this.logger.info && this.logger.info('模型已存在，无需下载');
        return { success: true, message: "模型已存在，无需下载" };
      }
      
      const pythonCmd = await this.findPythonExecutable();
      const scriptPath = this.getDownloadScriptPath();
      
      this.logger.info && this.logger.info('启动模型下载脚本:', {
        pythonCmd,
        scriptPath,
        scriptExists: fs.existsSync(scriptPath)
      });
      
      if (!fs.existsSync(scriptPath)) {
        throw new Error(`下载脚本未找到: ${scriptPath}`);
      }
      
      return new Promise((resolve, reject) => {
        // 确保使用正确的Python环境
        const pythonEnv = this.buildPythonEnvironment();
        
        const downloadProcess = spawn(pythonCmd, [scriptPath], {
          stdio: ["pipe", "pipe", "pipe"],
          windowsHide: true,
          env: pythonEnv
        });
        
        let hasError = false;
        
        downloadProcess.stdout.on("data", (data) => {
          const lines = data.toString().split('\n').filter(line => line.trim());
          
          for (const line of lines) {
            try {
              const result = JSON.parse(line);
              
              if (result.error) {
                hasError = true;
                reject(new Error(result.error));
                return;
              }
              
              // 处理进度更新
              if (result.stage && progressCallback) {
                progressCallback({
                  stage: result.stage,
                  model: result.model,
                  progress: result.progress,
                  overall_progress: result.overall_progress,
                  completed: result.completed,
                  total: result.total
                });
              }
              
              // 处理最终结果
              if (result.success !== undefined) {
                if (result.success) {
                  this.modelsDownloaded = true;
                  resolve({ success: true, message: result.message || "模型下载完成" });
                } else {
                  hasError = true;
                  reject(new Error(result.error || "模型下载失败"));
                }
                return;
              }
              
            } catch (parseError) {
              // 忽略非JSON输出
              this.logger.debug && this.logger.debug('下载脚本非JSON输出:', line);
            }
          }
        });
        
        downloadProcess.stderr.on("data", (data) => {
          const errorOutput = data.toString();
          this.logger.error && this.logger.error('模型下载错误输出:', errorOutput);
        });
        
        downloadProcess.on("close", (code) => {
          if (!hasError) {
            if (code === 0) {
              this.modelsDownloaded = true;
              resolve({ success: true, message: "模型下载完成" });
            } else {
              reject(new Error(`模型下载进程退出，代码: ${code}`));
            }
          }
        });
        
        downloadProcess.on("error", (error) => {
          if (!hasError) {
            reject(new Error(`启动下载进程失败: ${error.message}`));
          }
        });
        
        // 设置超时（30分钟）
        setTimeout(() => {
          if (!hasError) {
            downloadProcess.kill();
            reject(new Error('模型下载超时'));
          }
        }, 30 * 60 * 1000);
      });
      
    } catch (error) {
      this.logger.error && this.logger.error('模型下载失败:', error);
      throw error;
    }
  }

  _clearModelCache() {
    /**
     * 清除模型检查缓存
     */
    globalModelCheckCache = null;
    globalModelCheckTime = 0;
  }

  async initializeAtStartup() {
    try {
      this.logger.info && this.logger.info('FunASR管理器启动初始化开始');

      const pythonCmd = await this.findPythonExecutable();
      this.logger.info && this.logger.info('Python可执行文件找到', { pythonCmd });

      const funasrStatus = await this.checkFunASRInstallation();
      this.logger.info && this.logger.info('FunASR安装状态检查完成', funasrStatus);

      this.isInitialized = true;

      // realtime-only: 启动时不再预热旧离线服务器
      this.preInitializeModels();
      this.logger.info && this.logger.info('FunASR管理器启动初始化完成');
    } catch (error) {
      // FunASR 在启动时不可用不是关键问题
      this.logger.warn && this.logger.warn('FunASR启动初始化失败，但不影响应用启动', error);
      this.isInitialized = true;
    }
  }

  async preInitializeModels() {
    // realtime-only: 模型由 WebSocket 服务器按需初始化
    this.logger.info && this.logger.info('preInitializeModels: 已废弃，使用 WebSocket 服务器');
    return Promise.resolve();
  }

  async findPythonExecutable() {
    // 如果有缓存结果则返回
    if (this.pythonCmd) {
      return this.pythonCmd;
    }

    this.setupIsolatedEnvironment();
    return await this.findPythonExecutableWithFallback();
  }

  async findPythonExecutableWithFallback() {
    // 保留原有的查找逻辑作为开发时的回退方案
    const projectRoot = path.join(__dirname, "..", "..");
      
    const possiblePaths = [
      // 优先使用 uv 虚拟环境中的 Python
      path.join(projectRoot, ".venv", "bin", "python3.11"),
      path.join(projectRoot, ".venv", "bin", "python3"),
      path.join(projectRoot, ".venv", "bin", "python"),
      // 然后尝试系统路径
      "python3.11",
      "python3",
      "python",
      "/usr/bin/python3.11",
      "/usr/bin/python3",
      "/usr/local/bin/python3.11",
      "/usr/local/bin/python3",
      "/usr/bin/python",
      "/usr/local/bin/python",
    ];

    for (const pythonPath of possiblePaths) {
      try {
        const version = await this.getPythonVersion(pythonPath);
        if (this.isPythonVersionSupported(version)) {
          this.pythonCmd = pythonPath;
          return pythonPath;
        }
      } catch (error) {
        continue;
      }
    }

    throw new Error(
      "未找到 Python 3.x。使用 installPython() 自动安装。"
    );
  }

  async getPythonVersion(pythonPath) {
    return new Promise((resolve) => {
      const testProcess = spawn(pythonPath, ["--version"], {
        env: this.buildPythonEnvironment()
      });
      let output = "";
      
      testProcess.stdout.on("data", (data) => output += data);
      testProcess.stderr.on("data", (data) => output += data);
      
      testProcess.on("close", (code) => {
        if (code === 0) {
          const match = output.match(/Python (\d+)\.(\d+)/i);
          resolve(match ? { major: +match[1], minor: +match[2] } : null);
        } else {
          resolve(null);
        }
      });
      
      testProcess.on("error", () => resolve(null));
    });
  }

  isPythonVersionSupported(version) {
    // 接受任何 Python 3.x 版本
    return version && version.major === 3;
  }

  async installPython(progressCallback = null) {
    try {
      // 清除缓存的 Python 命令，因为我们正在安装新的
      this.pythonCmd = null;
      
      const result = await this.pythonInstaller.installPython(progressCallback);
      
      // 安装后，尝试重新找到 Python
      try {
        await this.findPythonExecutable();
        return result;
      } catch (findError) {
        throw new Error("Python 已安装但在 PATH 中未找到。请重启应用程序。");
      }
      
    } catch (error) {
      this.logger.error && this.logger.error("Python 安装失败:", error);
      throw error;
    }
  }

  async checkPythonInstallation() {
    return await this.pythonInstaller.isPythonInstalled();
  }

  async checkFunASRInstallation() {
    // 如果有缓存结果则返回
    if (this.funasrInstalled !== null) {
      return this.funasrInstalled;
    }

    try {
      const pythonCmd = await this.findPythonExecutable();

      const result = await new Promise((resolve) => {
        // 确保使用正确的Python环境
        const pythonEnv = this.buildPythonEnvironment();
        
        const checkProcess = spawn(pythonCmd, [
          "-c",
          'import funasr; print("OK")',
        ], {
          env: pythonEnv
        });

        let output = "";
        let errorOutput = "";
        
        checkProcess.stdout.on("data", (data) => {
          output += data.toString();
        });
        
        checkProcess.stderr.on("data", (data) => {
          errorOutput += data.toString();
        });

        checkProcess.on("close", (code) => {
          if (code === 0 && output.includes("OK")) {
            resolve({ installed: true, working: true });
          } else {
            this.logger.error && this.logger.error('FunASR检查失败', {
              code,
              output,
              errorOutput
            });
            resolve({ installed: false, working: false, error: errorOutput || output });
          }
        });

        checkProcess.on("error", (error) => {
          resolve({ installed: false, working: false, error: error.message });
        });
      });

      this.funasrInstalled = result; // 缓存结果
      return result;
    } catch (error) {
      const errorResult = {
        installed: false,
        working: false,
        error: error.message,
      };
      this.funasrInstalled = errorResult;
      return errorResult;
    }
  }

  async upgradePip(pythonCmd) {
    return runCommand(pythonCmd, ["-m", "pip", "install", "--upgrade", "pip"], { timeout: TIMEOUTS.PIP_UPGRADE });
  }

  async installFunASR(progressCallback = null) {
    const pythonCmd = await this.findPythonExecutable();
    
    if (progressCallback) {
      progressCallback({ stage: "升级 pip...", percentage: 10 });
    }
    
    // 首先升级 pip 以避免版本问题
    try {
      await this.upgradePip(pythonCmd);
    } catch (error) {
      this.logger.warn && this.logger.warn("第一次 pip 升级尝试失败:", error.message);
      
      // 尝试用户安装方式升级 pip
      try {
        await runCommand(pythonCmd, ["-m", "pip", "install", "--user", "--upgrade", "pip"], { timeout: TIMEOUTS.PIP_UPGRADE });
      } catch (userError) {
        this.logger.warn && this.logger.warn("pip 升级完全失败，尝试继续");
      }
    }
    
    if (progressCallback) {
      progressCallback({ stage: "安装 FunASR...", percentage: 30 });
    }
    
    // 安装 FunASR 和相关依赖
    try {
      // 首先尝试常规安装
      await runCommand(pythonCmd, ["-m", "pip", "install", "-U", "funasr"], { timeout: TIMEOUTS.DOWNLOAD });
      
      if (progressCallback) {
        progressCallback({ stage: "安装 librosa...", percentage: 60 });
      }
      
      // 安装 librosa（音频处理库）
      await runCommand(pythonCmd, ["-m", "pip", "install", "-U", "librosa"], { timeout: TIMEOUTS.DOWNLOAD });
      
      if (progressCallback) {
        progressCallback({ stage: "安装完成！", percentage: 100 });
      }
      
      // 清除缓存状态
      this.funasrInstalled = null;
      
      return { success: true, message: "FunASR 安装成功" };
      
    } catch (error) {
      if (error.message.includes("Permission denied") || error.message.includes("access is denied")) {
        // 使用用户安装方式重试
        try {
          await runCommand(pythonCmd, ["-m", "pip", "install", "--user", "-U", "funasr"], { timeout: TIMEOUTS.DOWNLOAD });
          await runCommand(pythonCmd, ["-m", "pip", "install", "--user", "-U", "librosa"], { timeout: TIMEOUTS.DOWNLOAD });
          
          if (progressCallback) {
            progressCallback({ stage: "安装完成！", percentage: 100 });
          }
          
          this.funasrInstalled = null;
          return { success: true, message: "FunASR 安装成功（用户模式）" };
        } catch (userError) {
          throw new Error(`FunASR 安装失败: ${userError.message}`);
        }
      }
      
      // 增强常见问题的错误消息
      let message = error.message;
      if (message.includes("Microsoft Visual C++")) {
        message = "需要 Microsoft Visual C++ 构建工具。请安装 Visual Studio Build Tools。";
      } else if (message.includes("No matching distribution")) {
        message = "Python 版本不兼容。FunASR 需要 Python 3.8-3.11。";
      }
      
      throw new Error(message);
    }
  }

  async checkStatus() {
    try {
      const installStatus = await this.checkFunASRInstallation();
      const modelStatus = await this.checkModelFiles();

      let error = "FunASR未安装";
      if (installStatus.installed && !modelStatus.models_downloaded) {
        error = "模型文件未下载，请先下载模型";
      }

      return {
        success: installStatus.installed && modelStatus.models_downloaded,
        error,
        installed: installStatus.installed,
        models_downloaded: modelStatus.models_downloaded,
        missing_models: modelStatus.missing_models || [],
        initializing: false
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        installed: false,
        models_downloaded: false
      };
    }
  }
}

module.exports = FunASRManager;
