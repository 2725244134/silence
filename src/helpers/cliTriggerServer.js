const fs = require("fs");
const net = require("net");
const os = require("os");
const path = require("path");

class CliTriggerServer {
  constructor(logger = null) {
    this.logger = logger;
    this.server = null;
    this.onTrigger = null;
  }

  static getSocketPath() {
    const uid = typeof process.getuid === "function" ? process.getuid() : "user";
    return path.join(os.tmpdir(), `ququ-trigger-${uid}.sock`);
  }

  getSocketPath() {
    return CliTriggerServer.getSocketPath();
  }

  setTriggerHandler(handler) {
    this.onTrigger = handler;
  }

  start() {
    if (this.server) {
      return this.getSocketPath();
    }

    const socketPath = this.getSocketPath();
    try {
      fs.unlinkSync(socketPath);
    } catch (error) {
      if (error.code !== 'ENOENT' && this.logger && this.logger.warn) {
        this.logger.warn("清理旧 CLI socket 失败", { socketPath, error: error.message });
      }
    }

    this.server = net.createServer((conn) => {
      let buffer = "";
      const MAX_BUFFER_SIZE = 1024;

      conn.on("data", (chunk) => {
        buffer += chunk.toString();

        if (buffer.length > MAX_BUFFER_SIZE) {
          conn.write(JSON.stringify({ success: false, error: "request too large" }) + "\n");
          conn.end();
          return;
        }

        if (!buffer.includes("\n")) return;
        const line = buffer.split("\n")[0].trim();

        if (line === "trigger") {
          if (this.onTrigger) {
            this.onTrigger({ source: "cli" });
          }
          conn.write(JSON.stringify({ success: true, message: "triggered" }) + "\n");
          conn.end();
          return;
        }

        if (line === "status") {
          conn.write(
            JSON.stringify({ success: true, message: "ok", socket: socketPath }) + "\n"
          );
          conn.end();
          return;
        }

        conn.write(
          JSON.stringify({ success: false, error: "unknown command", supported: ["trigger", "status"] }) + "\n"
        );
        conn.end();
      });

      conn.on("error", () => {
        // ignore connection errors
      });
    });

    this.server.on("error", (error) => {
      if (this.logger && this.logger.error) {
        this.logger.error("CLI trigger server 错误", error);
      }
    });

    this.server.listen(socketPath, () => {
      if (this.logger && this.logger.info) {
        this.logger.info("CLI trigger server 已启动", { socketPath });
      }
      try {
        fs.chmodSync(socketPath, 0o600);
      } catch (error) {
        // ignore chmod errors
      }
    });

    return socketPath;
  }

  stop() {
    const socketPath = this.getSocketPath();

    if (this.server) {
      this.server.close();
      this.server = null;
    }

    try {
      fs.unlinkSync(socketPath);
    } catch (error) {
      if (error.code !== 'ENOENT' && this.logger && this.logger.warn) {
        this.logger.warn("清理 CLI socket 失败", { socketPath, error: error.message });
      }
    }
  }
}

module.exports = CliTriggerServer;
