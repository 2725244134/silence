const { spawn, spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const PythonInstaller = require("./pythonInstaller");

class HotkeyManager {
  constructor(logger = null) {
    this.logger = logger;
    this.registeredHotkeys = new Map();
    this.lastHotkeyTrigger = new Map();
    this.hotkeyDebounceTime = 200;

    this.listenerProcess = null;
    this.listenerStdoutBuffer = "";
    this.activeEvdevKey = null;

    this.listenerStdoutHandler = null;
    this.listenerStderrHandler = null;
    this.listenerErrorHandler = null;
    this.listenerCloseHandler = null;

    this.onF2DoubleClick = null;
    this.isRecording = false;
  }

  getListenerScriptPath() {
    if (process.env.NODE_ENV === "development") {
      return path.join(__dirname, "..", "..", "python", "evdev_hotkey_listener.py");
    }

    if (!process.resourcesPath) {
      return path.join(__dirname, "..", "..", "python", "evdev_hotkey_listener.py");
    }

    return path.join(
      process.resourcesPath,
      "app.asar.unpacked",
      "python",
      "evdev_hotkey_listener.py"
    );
  }

  normalizeHotkeyToEvdevCombo(hotkey) {
    if (!hotkey || typeof hotkey !== "string") return null;

    const normalized = hotkey.trim().toUpperCase();

    if (/^ALT\+[A-Z]$/.test(normalized)) {
      return normalized;
    }

    if (/^ALT\+F\d{1,2}$/.test(normalized)) {
      return normalized;
    }

    if (/^F\d{1,2}$/.test(normalized)) {
      return normalized;
    }

    if (/^[A-Z]$/.test(normalized)) {
      return normalized;
    }

    if (normalized === "SPACE") {
      return "SPACE";
    }

    return null;
  }

  ensureUvAvailable() {
    const result = spawnSync("uv", ["--version"], { stdio: "ignore" });
    return result.status === 0;
  }

  async ensureUvAvailableAsync() {
    const installer = new PythonInstaller(this.logger);
    return await installer.ensureUvAvailable();
  }

  getProjectRoot() {
    if (process.env.NODE_ENV !== "development" && process.resourcesPath) {
      // 打包后 __dirname 位于 app.asar 内，不能作为子进程 cwd 使用
      return process.resourcesPath;
    }
    return path.join(__dirname, "..", "..");
  }

  handleHotkeyTrigger(hotkey) {
    const callback = this.registeredHotkeys.get(hotkey);
    if (!callback) return;

    const now = Date.now();
    const lastTrigger = this.lastHotkeyTrigger.get(hotkey) || 0;
    if (now - lastTrigger < this.hotkeyDebounceTime) {
      return;
    }

    this.lastHotkeyTrigger.set(hotkey, now);
    callback();
  }

  checkEvdevDependency(pythonCmd, args, projectRoot) {
    const depCheck = spawnSync(pythonCmd, [...args, "-c", "import evdev"], {
      cwd: projectRoot,
      stdio: "ignore",
    });
    return depCheck.status === 0;
  }

  startEvdevListener(hotkey, evdevCombo) {
    const scriptPath = this.getListenerScriptPath();
    this.stopEvdevListener();

    const projectRoot = this.getProjectRoot();
    const venvPython = path.join(projectRoot, ".venv", "bin", "python");
    const listenerArgs = [
      scriptPath,
      "--combo",
      evdevCombo,
      "--debounce-ms",
      String(this.hotkeyDebounceTime),
    ];

    let useVenv = false;
    try {
      fs.accessSync(venvPython, fs.constants.X_OK);
      useVenv = true;
    } catch {
      // venv not available, will use uv
    }

    if (useVenv) {
      if (!this.checkEvdevDependency(venvPython, [], projectRoot)) {
        if (this.logger && this.logger.error) {
          this.logger.error("Python 环境缺少 evdev 依赖，请执行 `pnpm run prepare:python:uv`");
        }
        return Promise.resolve(false);
      }

      this.listenerProcess = spawn(venvPython, listenerArgs, {
        cwd: projectRoot,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
    } else {
      if (!this.ensureUvAvailable()) {
        if (this.logger && this.logger.error) {
          this.logger.error("未检测到 uv，且 .venv/bin/python 不存在，无法启动 evdev 热键监听");
        }
        return Promise.resolve(false);
      }

      if (!this.checkEvdevDependency("uv", ["run", "python"], projectRoot)) {
        if (this.logger && this.logger.error) {
          this.logger.error("uv Python 环境缺少 evdev 依赖，请执行 `pnpm run prepare:python:uv`");
        }
        return Promise.resolve(false);
      }

      this.listenerProcess = spawn(
        "uv",
        ["run", "python", ...listenerArgs],
        {
          cwd: projectRoot,
          stdio: ["ignore", "pipe", "pipe"],
          windowsHide: true,
        }
      );
    }

    this.activeEvdevKey = evdevCombo;
    this.listenerStdoutBuffer = "";
    let startupSettled = false;
    let startupResolve = null;
    const startupPromise = new Promise((resolve) => {
      startupResolve = resolve;
    });
    const settleStartup = (ok) => {
      if (startupSettled) return;
      startupSettled = true;
      clearTimeout(startupTimeout);
      startupResolve(ok);
    };
    const startupTimeout = setTimeout(() => {
      if (this.logger && this.logger.error) {
        this.logger.error("evdev 热键监听启动超时，未收到 ready 消息", { hotkey, evdevCombo });
      }
      this.stopEvdevListener();
      settleStartup(false);
    }, 3000);

    this.listenerStdoutHandler = (chunk) => {
      this.listenerStdoutBuffer += chunk.toString();

      if (this.listenerStdoutBuffer.length > 10000) {
        this.listenerStdoutBuffer = "";
        return;
      }

      const lines = this.listenerStdoutBuffer.split("\n");
      this.listenerStdoutBuffer = lines.pop() || "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        try {
          const payload = JSON.parse(trimmed);

          if (payload.type === "ready") {
            if (this.logger && this.logger.info) {
              this.logger.info("evdev 热键监听已启动", payload);
            }
            settleStartup(true);
            continue;
          }

          if (payload.type === "hotkey") {
            this.handleHotkeyTrigger(hotkey);
            continue;
          }

          if (payload.type === "error" && this.logger && this.logger.error) {
            this.logger.error("evdev 热键监听错误", payload);
            if (!startupSettled) {
              this.stopEvdevListener();
              settleStartup(false);
            }
          }
        } catch (error) {
          if (this.logger && this.logger.debug) {
            this.logger.debug("evdev 输出非 JSON", { line: trimmed });
          }
        }
      }
    };

    this.listenerStderrHandler = (chunk) => {
      if (this.logger && this.logger.error) {
        this.logger.error("evdev stderr", { message: chunk.toString() });
      }
    };

    this.listenerErrorHandler = (error) => {
      if (this.logger && this.logger.error) {
        this.logger.error("启动 evdev 热键监听失败", error);
      }
      this.listenerProcess = null;
      this.activeEvdevKey = null;
      settleStartup(false);
    };

    this.listenerCloseHandler = (code) => {
      if (this.logger && this.logger.warn) {
        this.logger.warn("evdev 热键监听已退出", { code });
      }
      this.listenerProcess = null;
      this.activeEvdevKey = null;
      if (!startupSettled) {
        settleStartup(false);
      }
    };

    this.listenerProcess.stdout.on("data", this.listenerStdoutHandler);
    this.listenerProcess.stderr.on("data", this.listenerStderrHandler);
    this.listenerProcess.on("error", this.listenerErrorHandler);
    this.listenerProcess.on("close", this.listenerCloseHandler);

    return startupPromise;
  }

  stopEvdevListener() {
    if (!this.listenerProcess) return;

    if (this.listenerStdoutHandler) {
      this.listenerProcess.stdout?.removeListener("data", this.listenerStdoutHandler);
    }
    if (this.listenerStderrHandler) {
      this.listenerProcess.stderr?.removeListener("data", this.listenerStderrHandler);
    }
    if (this.listenerErrorHandler) {
      this.listenerProcess.removeListener("error", this.listenerErrorHandler);
    }
    if (this.listenerCloseHandler) {
      this.listenerProcess.removeListener("close", this.listenerCloseHandler);
    }

    try {
      this.listenerProcess.kill("SIGTERM");
    } catch (error) {
      // ignore
    }

    this.listenerProcess = null;
    this.activeEvdevKey = null;
    this.listenerStdoutBuffer = "";
  }

  async registerF2DoubleClick(callback) {
    // 与旧接口保持兼容：Linux 下退化为 F2 单击触发
    this.onF2DoubleClick = callback;
    return this.registerHotkey("F2", () => {
      const action = this.isRecording ? "stop" : "start";
      if (this.onF2DoubleClick) {
        this.onF2DoubleClick({ action, currentState: this.isRecording });
      }
    });
  }

  async registerHotkey(hotkey, callback) {
    const evdevCombo = this.normalizeHotkeyToEvdevCombo(hotkey);
    if (!evdevCombo) {
      if (this.logger && this.logger.error) {
        this.logger.error("不支持的热键格式，仅支持单键或 Alt+单键（如 F2 / A / ALT+D）", { hotkey });
      }
      return false;
    }

    if (this.registeredHotkeys.has(hotkey)) {
      this.registeredHotkeys.set(hotkey, callback);
      return true;
    }

    const started = await this.startEvdevListener(hotkey, evdevCombo);
    if (!started) return false;

    this.registeredHotkeys.clear();
    this.registeredHotkeys.set(hotkey, callback);

    if (this.logger && this.logger.info) {
      this.logger.info("热键注册成功(evdev)", { hotkey, evdevCombo });
    }

    return true;
  }

  unregisterHotkey(hotkey) {
    if (!this.registeredHotkeys.has(hotkey)) {
      return false;
    }

    this.registeredHotkeys.delete(hotkey);
    this.lastHotkeyTrigger.delete(hotkey);

    if (this.registeredHotkeys.size === 0) {
      this.stopEvdevListener();
    }

    if (this.logger && this.logger.info) {
      this.logger.info("热键已注销", { hotkey });
    }

    return true;
  }

  unregisterAllHotkeys() {
    this.registeredHotkeys.clear();
    this.lastHotkeyTrigger.clear();
    this.stopEvdevListener();

    if (this.logger && this.logger.info) {
      this.logger.info("所有热键已注销");
    }
  }

  getRegisteredHotkeys() {
    return Array.from(this.registeredHotkeys.keys());
  }

  isHotkeyRegistered(hotkey) {
    return this.registeredHotkeys.has(hotkey);
  }

  setRecordingState(isRecording) {
    this.isRecording = isRecording;
  }

  getRecordingState() {
    return this.isRecording;
  }
}

module.exports = HotkeyManager;
