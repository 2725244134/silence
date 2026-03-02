const path = require("path");
const { runCommand, TIMEOUTS } = require("../utils/process");

class PythonInstaller {
  constructor(logger = null) {
    this.pythonVersion = "3.11";
    this.logger = logger;
  }

  async ensureUvAvailable() {
    try {
      await runCommand("uv", ["--version"], { timeout: TIMEOUTS.QUICK_CHECK });
      return true;
    } catch (_error) {
      return false;
    }
  }

  async installPython(progressCallback = null) {
    if (process.platform !== "linux") {
      throw new Error("当前版本仅支持 Linux/Wayland");
    }

    const uvAvailable = await this.ensureUvAvailable();
    if (!uvAvailable) {
      throw new Error("未检测到 uv。请先安装 uv: https://astral.sh/uv/");
    }

    if (progressCallback) {
      progressCallback({ stage: "安装 Python 运行时 (uv)...", percentage: 25 });
    }
    await runCommand("uv", ["python", "install", this.pythonVersion], { timeout: TIMEOUTS.INSTALL });

    if (progressCallback) {
      progressCallback({ stage: "同步项目依赖 (uv sync)...", percentage: 70 });
    }
    await runCommand("uv", ["sync"], { timeout: TIMEOUTS.INSTALL });

    if (progressCallback) {
      progressCallback({ stage: "Python 环境准备完成", percentage: 100 });
    }

    return { success: true, method: "uv" };
  }

  async isPythonInstalled() {
    const projectRoot = path.join(__dirname, "..", "..");
    const venvPython = path.join(projectRoot, ".venv", "bin", "python");

    try {
      const result = await runCommand(venvPython, ["--version"], { timeout: TIMEOUTS.QUICK_CHECK });
      const versionMatch = result.output.match(/Python (\d+\.\d+)/);
      if (versionMatch) {
        return {
          installed: true,
          command: venvPython,
          version: parseFloat(versionMatch[1]),
          source: ".venv",
        };
      }
    } catch (_error) {
      // fallback below
    }

    try {
      const result = await runCommand("python3", ["--version"], { timeout: TIMEOUTS.QUICK_CHECK });
      const versionMatch = result.output.match(/Python (\d+\.\d+)/);
      if (versionMatch) {
        return {
          installed: true,
          command: "python3",
          version: parseFloat(versionMatch[1]),
          source: "system",
        };
      }
    } catch (_error) {
      // no-op
    }

    return { installed: false };
  }
}

module.exports = PythonInstaller;
