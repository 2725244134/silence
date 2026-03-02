const { spawn, spawnSync } = require("child_process");
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

  _cleanupStaleProcesses() {
    if (process.platform !== "linux") {
      return;
    }

    const patterns = [
      "funasr_ws_server.py",
    ];

    for (const pattern of patterns) {
      try {
        spawnSync("pkill", ["-f", pattern], { stdio: "ignore" });
      } catch (_error) {
        // ignore cleanup errors to avoid blocking startup
      }
    }
  }

  _buildReadyStatus() {
    return {
      success: true,
      server_ready: true,
      host: this.host,
      port: this.port,
      url: `ws://${this.host}:${this.port}`,
    };
  }

  _isManagedProcessAlive() {
    return Boolean(
      this.serverProcess &&
      this.serverProcess.exitCode === null &&
      !this.serverProcess.killed
    );
  }

  async _isServerReachable(timeoutMs = 800) {
    return new Promise((resolve) => {
      const socket = net.createConnection({
        host: this.host,
        port: this.port,
      });

      let finished = false;
      const done = (ok) => {
        if (finished) return;
        finished = true;
        try {
          socket.destroy();
        } catch (_e) {
          // ignore
        }
        resolve(ok);
      };

      socket.setTimeout(timeoutMs);
      socket.once("connect", () => done(true));
      socket.once("timeout", () => done(false));
      socket.once("error", () => done(false));
    });
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
   * 启动 WebSocket 服务器
   */
  async startServer() {
    if (this.serverReady) {
      if (this._isManagedProcessAlive()) {
        return this._buildReadyStatus();
      }
      this.serverReady = false;
    }

    if (this.initializationPromise) {
      return this.initializationPromise;
    }

    const startup = this._startServerInternal();
    let trackedPromise = null;
    trackedPromise = startup.finally(() => {
      if (this.initializationPromise === trackedPromise) {
        this.initializationPromise = null;
      }
    });

    this.initializationPromise = trackedPromise;
    return trackedPromise;
  }

  async _startServerInternal() {
    try {
      this._cleanupStaleProcesses();

      const status = await this.baseManager.checkFunASRInstallation();
      if (!status.installed) {
        this.logger.warn && this.logger.warn("FunASR 未安装，跳过 WebSocket 服务器启动");
        return { success: false, error: "FunASR 未安装" };
      }

      const serverPath = path.join(__dirname, "../../funasr_ws_server.py");
      const cachePath = this.baseManager.getModelCachePath();

      // realtime 模式固定端口，避免前端与服务端端口漂移
      this.port = 10095;
      const portAvailable = await this._isPortAvailable(this.port);
      if (!portAvailable) {
        const reachable = await this._isServerReachable();
        if (reachable) {
          this.serverReady = true;
          this.logger.info && this.logger.info(`复用已存在的 WebSocket 服务器: ws://${this.host}:${this.port}`);
          return this._buildReadyStatus();
        }
        return {
          success: false,
          server_ready: false,
          error: `端口 ${this.port} 被占用`,
        };
      }

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

        let settled = false;
        const settleResolve = (payload) => {
          if (settled) return;
          settled = true;
          clearTimeout(startupTimeout);
          resolve(payload);
        };
        const settleReject = (error) => {
          if (settled) return;
          settled = true;
          clearTimeout(startupTimeout);
          reject(error);
        };
        const markReady = () => {
          if (this.serverReady) return;
          this.serverReady = true;
          this.logger.info && this.logger.info(`WebSocket 服务器就绪: ws://${this.host}:${this.port}`);
          settleResolve(this._buildReadyStatus());
        };

        const startupTimeout = setTimeout(() => {
          this.logger.warn && this.logger.warn("WebSocket 服务器启动超时");
          if (this.serverProcess) {
            this.serverProcess.kill();
          }
          settleResolve({ success: false, error: "启动超时" });
        }, 600000); // 10分钟超时，给模型下载足够时间

        // 监听 stdout
        this.serverProcess.stdout.on("data", (data) => {
          const output = data.toString();
          this.logger.debug && this.logger.debug("WS Server stdout:", output);

          // 检测服务器就绪
          if (output.includes("服务器就绪") || output.includes("等待连接")) {
            markReady();
          }
        });

        // 监听 stderr
        this.serverProcess.stderr.on("data", (data) => {
          const errorOutput = data.toString();
          if (errorOutput.includes("服务器就绪") || errorOutput.includes("等待连接")) {
            markReady();
          }
          const normalizedOutput = errorOutput.trim();
          if (!normalizedOutput) {
            return;
          }
          if (/ - INFO - /.test(normalizedOutput)) {
            this.logger.info && this.logger.info("WS Server:", normalizedOutput);
          } else if (/ - (WARNING|WARN) - /.test(normalizedOutput)) {
            this.logger.warn && this.logger.warn("WS Server:", normalizedOutput);
          } else if (/ - ERROR - /.test(normalizedOutput)) {
            this.logger.error && this.logger.error("WS Server:", normalizedOutput);
          }
        });

        // 监听进程退出
        this.serverProcess.on("close", (code) => {
          this.logger.warn && this.logger.warn(`WebSocket 服务器进程退出，代码: ${code}`);
          this.serverProcess = null;
          this.serverReady = false;
          if (!settled) {
            settleResolve({
              success: false,
              error: `服务器进程已退出（code=${code}）`,
            });
          }
        });

        this.serverProcess.on("error", (error) => {
          this.logger.error && this.logger.error("WebSocket 服务器进程错误:", error);
          this.serverProcess = null;
          this.serverReady = false;
          settleReject(error);
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
    if (this.serverReady && this._isManagedProcessAlive()) {
      return this._buildReadyStatus();
    }

    if (this.serverReady && !this._isManagedProcessAlive()) {
      this.serverReady = false;
    }

    const isInitializing = this.initializationPromise !== null || this._isManagedProcessAlive();
    const installStatus = await this.baseManager.checkFunASRInstallation();
    return {
      success: false,
      installed: installStatus.installed,
      server_ready: false,
      initializing: isInitializing,
      error: installStatus.installed
        ? (isInitializing ? "服务器初始化中" : "服务器未就绪")
        : "FunASR 未安装",
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
