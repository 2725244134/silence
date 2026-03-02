const { spawn } = require("child_process");
const path = require("path");
const net = require("net");

/**
 * FunASR WebSocket 服务器管理器
 * 负责启动和管理 Python WebSocket 服务器
 */
class FunASRWebSocketServerManager {
  constructor(logger = null, baseFunasrManager = null) {
    this.logger = logger || console;
    this.baseManager = baseFunasrManager;

    this.serverProcess = null;
    this.serverReady = false;
    this.host = "localhost";
    this.port = 10095;
    this.initializationPromise = null;
  }

  /**
   * 应用启动时初始化
   */
  async initializeAtStartup() {
    try {
      if (!this.baseManager) {
        throw new Error("缺少基础 FunASR 管理器依赖");
      }

      await this.baseManager.findPythonExecutable();
      await this.baseManager.checkFunASRInstallation();
      await this.startServer();
    } catch (error) {
      this.logger.warn && this.logger.warn("WebSocket 服务器启动失败，但不影响应用启动", error);
    }
  }

  /**
   * 检查 uv 是否可用
   */
  async _checkUvAvailable() {
    return new Promise((resolve) => {
      const testProcess = spawn("uv", ["--version"], {
        stdio: "ignore",
      });

      testProcess.on("close", (code) => {
        resolve(code === 0);
      });

      testProcess.on("error", () => {
        resolve(false);
      });
    });
  }

  /**
   * 检查端口是否可用
   */
  async _isPortAvailable(port) {
    return new Promise((resolve) => {
      const server = net.createServer();
      server.once("error", () => resolve(false));
      server.once("listening", () => {
        server.close();
        resolve(true);
      });
      server.listen(port, "localhost");
    });
  }

  /**
   * 查找可用端口
   */
  async _findAvailablePort(startPort = 10095, maxAttempts = 10) {
    for (let i = 0; i < maxAttempts; i++) {
      const port = startPort + i;
      if (await this._isPortAvailable(port)) {
        return port;
      }
    }
    throw new Error(`无法找到可用端口 (尝试范围: ${startPort}-${startPort + maxAttempts - 1})`);
  }

  /**
   * 启动 WebSocket 服务器
   */
  async startServer() {
    if (this.initializationPromise) {
      return this.initializationPromise;
    }

    this.initializationPromise = this._startServerInternal();
    return this.initializationPromise;
  }

  async _startServerInternal() {
    try {
      const status = await this.baseManager.checkFunASRInstallation();
      if (!status.installed) {
        this.logger.warn && this.logger.warn("FunASR 未安装，跳过 WebSocket 服务器启动");
        return { success: false, error: "FunASR 未安装" };
      }

      const serverPath = path.join(__dirname, "../../funasr_ws_server.py");
      const cachePath = this.baseManager.getModelCachePath();

      // 查找可用端口
      this.port = await this._findAvailablePort(10095);
      this.logger.info && this.logger.info(`使用端口: ${this.port}`);

      this.baseManager.setupIsolatedEnvironment();
      const pythonEnv = this.baseManager.buildPythonEnvironment();

      // 优先使用 uv run，如果不可用则回退到直接使用 Python
      const projectRoot = path.join(__dirname, "../..");
      const useUv = await this._checkUvAvailable();

      // 准备命令和参数
      let command, args;
      if (useUv) {
        this.logger.info && this.logger.info("使用 uv run 启动服务器");
        command = "uv";
        args = [
          "run",
          "--directory",
          projectRoot,
          "python",
          serverPath,
          "--damo-root",
          cachePath,
          "--host",
          this.host,
          "--port",
          this.port.toString(),
        ];
      } else {
        this.logger.info && this.logger.info("使用直接 Python 启动服务器");
        const pythonCmd = await this.baseManager.findPythonExecutable();
        command = pythonCmd;
        args = [
          serverPath,
          "--damo-root",
          cachePath,
          "--host",
          this.host,
          "--port",
          this.port.toString(),
        ];
      }

      return new Promise((resolve, reject) => {
        this.logger.info && this.logger.info("启动 FunASR WebSocket 服务器...");

        this.serverProcess = spawn(command, args, {
          stdio: ["ignore", "pipe", "pipe"],
          windowsHide: true,
          env: pythonEnv,
          cwd: projectRoot,
        });

        let startupTimeout = setTimeout(() => {
          this.logger.warn && this.logger.warn("WebSocket 服务器启动超时");
          if (this.serverProcess) {
            this.serverProcess.kill();
          }
          resolve({ success: false, error: "启动超时" });
        }, 600000); // 10分钟超时，给模型下载足够时间

        // 监听 stdout
        this.serverProcess.stdout.on("data", (data) => {
          const output = data.toString();
          this.logger.debug && this.logger.debug("WS Server stdout:", output);

          // 检测服务器就绪
          if (output.includes("服务器就绪") || output.includes("等待连接")) {
            clearTimeout(startupTimeout);
            this.serverReady = true;
            this.logger.info && this.logger.info(`WebSocket 服务器就绪: ws://${this.host}:${this.port}`);
            resolve({ success: true, host: this.host, port: this.port });
          }
        });

        // 监听 stderr
        this.serverProcess.stderr.on("data", (data) => {
          const errorOutput = data.toString();
          if (/ - INFO - /.test(errorOutput)) {
            this.logger.info && this.logger.info("WS Server:", errorOutput.trim());
          } else if (/ - (WARNING|WARN) - /.test(errorOutput)) {
            this.logger.warn && this.logger.warn("WS Server:", errorOutput.trim());
          } else {
            this.logger.error && this.logger.error("WS Server stderr:", errorOutput.trim());
          }
        });

        // 监听进程退出
        this.serverProcess.on("close", (code) => {
          this.logger.warn && this.logger.warn(`WebSocket 服务器进程退出，代码: ${code}`);
          this.serverProcess = null;
          this.serverReady = false;
        });

        this.serverProcess.on("error", (error) => {
          clearTimeout(startupTimeout);
          this.logger.error && this.logger.error("WebSocket 服务器进程错误:", error);
          this.serverProcess = null;
          this.serverReady = false;
          reject(error);
        });
      });
    } catch (error) {
      this.logger.error && this.logger.error("启动 WebSocket 服务器异常:", error);
      throw error;
    }
  }

  /**
   * 停止服务器
   */
  async stopServer() {
    if (!this.serverProcess) {
      this.initializationPromise = null;
      return;
    }

    this.logger.info && this.logger.info("停止 WebSocket 服务器...");

    return new Promise((resolve) => {
      if (this.serverProcess) {
        this.serverProcess.once("close", () => {
          this.logger.info && this.logger.info("WebSocket 服务器已停止");
          resolve();
        });

        this.serverProcess.kill("SIGTERM");

        // 5秒后强制杀死
        setTimeout(() => {
          if (this.serverProcess) {
            this.logger.warn && this.logger.warn("强制杀死 WebSocket 服务器进程");
            this.serverProcess.kill("SIGKILL");
          }
        }, 5000);
      } else {
        resolve();
      }

      this.serverProcess = null;
      this.serverReady = false;
      this.initializationPromise = null;
    });
  }

  /**
   * 重启服务器
   */
  async restartServer() {
    await this.stopServer();
    this.initializationPromise = null;
    return await this.startServer();
  }

  /**
   * 检查状态
   */
  async checkStatus() {
    if (this.serverReady && this.serverProcess) {
      return {
        success: true,
        server_ready: true,
        host: this.host,
        port: this.port,
        url: `ws://${this.host}:${this.port}`,
      };
    }

    const installStatus = await this.baseManager.checkFunASRInstallation();
    return {
      success: false,
      installed: installStatus.installed,
      server_ready: false,
      initializing: this.initializationPromise !== null,
      error: installStatus.installed ? "服务器未就绪" : "FunASR 未安装",
    };
  }

  /**
   * 获取服务器 URL
   */
  getServerUrl() {
    if (this.serverReady) {
      return `ws://${this.host}:${this.port}`;
    }
    return null;
  }
}

module.exports = FunASRWebSocketServerManager;
