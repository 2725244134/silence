const { clipboard } = require("electron");
const { spawn, spawnSync } = require("child_process");

class ClipboardManager {
  constructor(logger) {
    this.logger = logger;
    this.pasteTimeoutMs = 3000;
  }

  safeLog(message, data = null) {
    if (this.logger && this.logger.info) {
      try {
        this.logger.info(message, data);
      } catch (_error) {
        // ignore logger transport errors
      }
    }
  }

  safeError(message, data = null) {
    if (this.logger && this.logger.error) {
      try {
        this.logger.error(message, data);
      } catch (_error) {
        // ignore logger transport errors
      }
    }
  }

  isCommandAvailable(command) {
    const result = spawnSync("bash", ["-lc", `command -v ${command}`], {
      stdio: "ignore",
    });
    return result.status === 0;
  }

  checkPasteDependencies() {
    const missing = [];
    if (!this.isCommandAvailable("wl-copy")) missing.push("wl-copy");
    if (!this.isCommandAvailable("ydotool")) missing.push("ydotool");
    return {
      ok: missing.length === 0,
      missing,
    };
  }

  runCommand(command, args, options = {}) {
    const timeoutMs = options.timeoutMs || this.pasteTimeoutMs;

    return new Promise((resolve, reject) => {
      const proc = spawn(command, args, {
        stdio: options.stdio || ["ignore", "pipe", "pipe"],
      });

      let stderr = "";
      let stdout = "";

      if (proc.stdout) {
        proc.stdout.on("data", (chunk) => {
          stdout += chunk.toString();
        });
      }

      if (proc.stderr) {
        proc.stderr.on("data", (chunk) => {
          stderr += chunk.toString();
        });
      }

      const timer = setTimeout(() => {
        proc.kill("SIGKILL");
        reject(new Error(`${command} 执行超时`));
      }, timeoutMs);

      proc.on("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });

      proc.on("close", (code) => {
        clearTimeout(timer);
        if (code === 0) {
          resolve({ stdout, stderr });
          return;
        }
        reject(new Error(`${command} 退出码 ${code}: ${stderr || stdout}`));
      });
    });
  }

  async syncWaylandClipboard(text) {
    return new Promise((resolve, reject) => {
      const proc = spawn("wl-copy", [], {
        stdio: ["pipe", "pipe", "pipe"],
      });

      let stderr = "";
      proc.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });

      proc.on("error", (error) => {
        reject(error);
      });

      proc.on("close", (code) => {
        if (code === 0) {
          resolve();
          return;
        }
        reject(new Error(`wl-copy 退出码 ${code}: ${stderr}`));
      });

      proc.stdin.write(text || "");
      proc.stdin.end();
    });
  }

  async triggerPasteCombo() {
    // ydotool keycodes: 29=LEFTCTRL, 47=V
    await this.runCommand("ydotool", ["key", "29:1", "47:1", "47:0", "29:0"]);
  }

  async insertTextDirectly(text) {
    return await this.pasteText(text);
  }

  async pasteText(text) {
    const deps = this.checkPasteDependencies();
    if (!deps.ok) {
      throw new Error(
        `缺少依赖: ${deps.missing.join(", ")}。请安装 wl-clipboard 和 ydotool，并确保 ydotoold 已启动。`
      );
    }

    const originalClipboard = clipboard.readText();

    try {
      clipboard.writeText(text);
      await this.syncWaylandClipboard(text);
      await this.triggerPasteCombo();

      setTimeout(async () => {
        try {
          clipboard.writeText(originalClipboard);
          await this.syncWaylandClipboard(originalClipboard);
        } catch (restoreError) {
          this.safeError("恢复剪贴板失败", { error: restoreError.message });
        }
      }, 100);
    } catch (error) {
      this.safeError("Wayland 自动粘贴失败", { error: error.message });
      throw new Error(
        `自动粘贴失败: ${error.message}。文本已写入剪贴板，请手动 Ctrl+V。`
      );
    }
  }

  // 兼容旧接口名：语义改为 Linux 依赖可用性
  async enableMacOSAccessibility() {
    const deps = this.checkPasteDependencies();
    return deps.ok;
  }

  // 兼容旧接口名：语义改为 Linux 依赖可用性
  async checkAccessibilityPermissions() {
    const deps = this.checkPasteDependencies();
    return deps.ok;
  }

  // 兼容旧接口名：Linux 下不做系统设置跳转
  openSystemSettings() {
    this.safeLog("Linux 环境不支持自动打开权限设置，请手动安装/配置 ydotoold");
  }

  async copyText(text) {
    clipboard.writeText(text);
    return { success: true };
  }

  async readClipboard() {
    return clipboard.readText();
  }

  async writeClipboard(text) {
    clipboard.writeText(text);
    return { success: true };
  }
}

module.exports = ClipboardManager;
