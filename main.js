const { app, BrowserWindow } = require("electron");
const net = require("net");

// 导入日志管理器
const LogManager = require("./src/helpers/logManager");

// 初始化日志管理器
const logger = new LogManager();

// 添加全局错误处理
process.on("uncaughtException", (error) => {
  logger.error("Uncaught Exception:", error);
  if (error.code === "EPIPE") {
    return;
  }
  logger.error("Error stack:", error.stack);
});

process.on("unhandledRejection", (reason, promise) => {
  logger.error("Unhandled Rejection at:", { promise, reason });
});

// 导入助手模块
const EnvironmentManager = require("./src/helpers/environment");
const WindowManager = require("./src/helpers/windowManager");
const DatabaseManager = require("./src/helpers/database");
const ClipboardManager = require("./src/helpers/clipboard");
const FunASRManager = require("./src/helpers/funasrManager");
const FunASRWebSocketServerManager = require("./src/helpers/funasrWsServerManager");
const TrayManager = require("./src/helpers/tray");
const HotkeyManager = require("./src/helpers/hotkeyManager");
const IPCHandlers = require("./src/helpers/ipcHandlers");
const CliTriggerServer = require("./src/helpers/cliTriggerServer");

function resolveCliCommand(argv) {
  const args = (argv || []).slice(1).map((arg) => String(arg).toLowerCase());

  if (args.includes("--trigger") || args.includes("trigger")) {
    return "trigger";
  }

  if (args.includes("--status") || args.includes("status")) {
    return "status";
  }

  return null;
}

async function runCliCommand(command) {
  const socketPath = CliTriggerServer.getSocketPath();
  const request = command === "trigger" ? "trigger" : "status";

  return new Promise((resolve) => {
    let finished = false;
    const done = (code) => {
      if (finished) return;
      finished = true;
      resolve(code);
    };

    const client = net.createConnection(socketPath);
    let output = "";

    const timeoutId = setTimeout(() => {
      client.destroy();
      console.error(
        JSON.stringify({
          success: false,
          error: "CLI 请求超时",
          socket: socketPath,
        })
      );
      done(1);
    }, 3000);

    client.on("connect", () => {
      client.write(`${request}\n`);
    });

    client.on("data", (chunk) => {
      output += chunk.toString();
    });

    client.on("end", () => {
      clearTimeout(timeoutId);
      const text = output.trim();
      if (!text) {
        console.error(JSON.stringify({ success: false, error: "空响应", socket: socketPath }));
        done(2);
        return;
      }

      try {
        const payload = JSON.parse(text);
        if (payload.success) {
          console.log(JSON.stringify(payload));
          done(0);
          return;
        }
        console.error(JSON.stringify(payload));
        done(1);
      } catch (_error) {
        console.log(text);
        done(0);
      }
    });

    client.on("error", (error) => {
      clearTimeout(timeoutId);
      console.error(
        JSON.stringify({
          success: false,
          error: `无法连接到 QuQu CLI socket: ${socketPath}`,
          detail: error.message,
        })
      );
      done(1);
    });
  });
}

// 设置生产环境PATH
function setupProductionPath() {
  logger.info('设置生产环境PATH', {
    platform: process.platform,
    nodeEnv: process.env.NODE_ENV,
    currentPath: process.env.PATH
  });

  if (process.env.NODE_ENV === 'development') {
    return;
  }

  const commonPaths = ['/usr/local/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin'];
  const currentPath = process.env.PATH || '';
  const pathsToAdd = commonPaths.filter(p => !currentPath.includes(p));

  if (pathsToAdd.length === 0) {
    return;
  }

  const newPath = `${currentPath}:${pathsToAdd.join(':')}`;
  process.env.PATH = newPath;
  logger.info('PATH已更新', {
    添加的路径: pathsToAdd,
    新PATH: newPath
  });
}

const cliCommand = resolveCliCommand(process.argv);

if (cliCommand) {
  runCliCommand(cliCommand).then((code) => {
    process.exit(code);
  });
} else {
  // 在初始化管理器之前设置PATH
  setupProductionPath();

  // 设置用户数据目录环境变量，供Python脚本使用
  process.env.ELECTRON_USER_DATA = app.getPath('userData');
  logger.info('设置用户数据目录环境变量', {
    ELECTRON_USER_DATA: process.env.ELECTRON_USER_DATA
  });

  // 初始化管理器
  const environmentManager = new EnvironmentManager();
  const windowManager = new WindowManager();
  const databaseManager = new DatabaseManager();
  const clipboardManager = new ClipboardManager(logger);
  const funasrManager = new FunASRManager(logger);
  const wsServerManager = new FunASRWebSocketServerManager(logger, funasrManager);
  const trayManager = new TrayManager();
  const hotkeyManager = new HotkeyManager(logger);
  const cliTriggerServer = new CliTriggerServer(logger);

  // 初始化数据库
  const dataDirectory = environmentManager.ensureDataDirectory();
  databaseManager.initialize(dataDirectory);

  // 使用所有管理器初始化IPC处理器
  const ipcHandlers = new IPCHandlers({
    environmentManager,
    databaseManager,
    clipboardManager,
    funasrManager,
    wsServerManager,
    windowManager,
    hotkeyManager,
    cliTriggerServer,
    logger,
  });

  // 主应用启动函数
  async function startApp() {
  logger.info('应用启动开始', {
    nodeEnv: process.env.NODE_ENV,
    platform: process.platform,
    arch: process.arch,
    electronVersion: process.versions.electron,
    appVersion: app.getVersion()
  });

  // 注释掉 accessibility 支持 - 可能干扰文本插入
  // try {
  //   app.setAccessibilitySupportEnabled(true);
  //   logger.info('✅ 已启用 Electron accessibility 支持');
  // } catch (error) {
  //   logger.warn('⚠️ 启用 accessibility 支持失败:', error.message);
  // }

  // 记录系统信息
  logger.info('系统信息', logger.getSystemInfo());

  // 开发模式下添加小延迟让Vite正确启动
  if (process.env.NODE_ENV === "development") {
    logger.info('开发模式，等待Vite启动...');
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  // 在启动时初始化FunASR管理器（不等待以避免阻塞）
  logger.info('开始初始化FunASR管理器...');
  funasrManager.initializeAtStartup().catch((err) => {
    logger.warn("FunASR在启动时不可用，这不是关键问题", err);
  });
  logger.info('开始初始化 WebSocket 服务器...');
  wsServerManager.initializeAtStartup().catch((err) => {
    logger.warn("WebSocket 服务器在启动时不可用，这不是关键问题", err);
  });

  // 创建主窗口
  try {
    logger.info('创建主窗口...');
    await windowManager.createMainWindow();
    logger.info('主窗口创建成功');
  } catch (error) {
    logger.error("创建主窗口时出错:", error);
  }

  // 创建控制面板窗口
  try {
    logger.info('创建控制面板窗口...');
    await windowManager.createControlPanelWindow();
    logger.info('控制面板窗口创建成功');
  } catch (error) {
    logger.error("创建控制面板窗口时出错:", error);
  }

  // 设置托盘
  logger.info('设置系统托盘...');
  trayManager.setWindows(
    windowManager.mainWindow,
    windowManager.controlPanelWindow
  );
  trayManager.setCreateControlPanelCallback(() =>
    windowManager.createControlPanelWindow()
  );
  await trayManager.createTray();
  logger.info('系统托盘设置完成');

  // 启动 CLI 触发服务（Linux/Wayland）
  cliTriggerServer.setTriggerHandler((payload) => {
    if (windowManager.mainWindow && !windowManager.mainWindow.isDestroyed()) {
      windowManager.mainWindow.webContents.send("hotkey-triggered", {
        hotkey: "CLI_TRIGGER",
        ...payload,
      });
    }
  });
  const socketPath = cliTriggerServer.start();
  logger.info("CLI trigger 服务已启动", { socketPath });

  logger.info('应用启动完成');
  }

  // 应用事件处理器
  app.whenReady().then(() => {
    startApp();
  });

  app.on("window-all-closed", () => {
    app.quit();
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      windowManager.createMainWindow();
    }
  });

  app.on("will-quit", () => {
    hotkeyManager.unregisterAllHotkeys();
    cliTriggerServer.stop();
    wsServerManager.stopServer().catch((err) => {
      logger.warn("关闭 WebSocket 服务器失败", err);
    });
  });

  // 导出管理器供其他模块使用
  module.exports = {
    environmentManager,
    windowManager,
    databaseManager,
    clipboardManager,
    funasrManager,
    wsServerManager,
    trayManager,
    hotkeyManager,
    cliTriggerServer,
    logger
  };
}
