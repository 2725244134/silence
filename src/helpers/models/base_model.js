const { spawn } = require("child_process");
const path = require("path");

/**
 * 基础模型类
 * 所有语音识别模型都应该继承此类
 */
class BaseModel {
  constructor(config, logger = null) {
    this.config = config;
    this.logger = logger || console;
    this.process = null;
    this.ready = false;
    this.starting = false;
    this.stdoutBuffer = "";
    this.initPromise = null;
  }

  /**
   * 获取模型信息
   */
  getInfo() {
    return {
      id: this.config.id,
      name: this.config.name,
      description: this.config.description || "",
      languages: this.config.languages || [],
      status: this.getStatus(),
    };
  }

  /**
   * 获取模型状态
   * @returns {string} 'stopped' | 'starting' | 'ready' | 'error'
   */
  getStatus() {
    if (this.ready) return "ready";
    if (this.starting) return "starting";
    if (this.process) return "starting";
    return "stopped";
  }

  /**
   * 检查模型是否就绪
   */
  isReady() {
    return this.ready;
  }

  /**
   * 启动模型进程（子类必须实现）
   */
  async start() {
    throw new Error("子类必须实现 start() 方法");
  }

  /**
   * 停止模型进程（子类必须实现）
   */
  async stop() {
    throw new Error("子类必须实现 stop() 方法");
  }

  /**
   * 转写音频（子类必须实现）
   */
  async transcribe(audioPath, options = {}) {
    throw new Error("子类必须实现 transcribe() 方法");
  }

  /**
   * 获取服务器脚本路径
   */
  getServerScriptPath() {
    const scriptName = this.config.serverScript;
    if (process.env.NODE_ENV === "development") {
      return path.join(__dirname, "..", "..", "..", "python", scriptName);
    } else {
      return path.join(process.resourcesPath, "app.asar.unpacked", "python", scriptName);
    }
  }

  /**
   * 构建Python环境变量
   */
  buildPythonEnvironment() {
    const env = {
      ...process.env,
      PYTHONDONTWRITEBYTECODE: "1",
      PYTHONIOENCODING: "utf-8",
      PYTHONUNBUFFERED: "1",
    };

    delete env.PYTHONHOME;
    delete env.PYTHONPATH;
    delete env.PYTHONUSERBASE;
    delete env.PYTHONSTARTUP;
    delete env.VIRTUAL_ENV;

    return env;
  }

  /**
   * 发送命令到Python进程
   */
  sendCommand(command) {
    if (!this.process || !this.process.stdin) {
      throw new Error("进程未启动或stdin不可用");
    }
    const json = JSON.stringify(command);
    this.process.stdin.write(json + "\n");
  }

  /**
   * 清理资源
   */
  cleanup() {
    this.process = null;
    this.ready = false;
    this.starting = false;
    this.stdoutBuffer = "";
    this.initPromise = null;
  }
}

module.exports = BaseModel;
