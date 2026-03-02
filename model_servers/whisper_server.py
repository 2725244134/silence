#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Whisper 模型服务器
通过 stdin/stdout 进行 JSON 通信
"""

import sys
import json
import logging

# 设置日志
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)


class WhisperServer:
    def __init__(self):
        self.model = None
        self.initialized = False
        self.running = True

    def load_model(self):
        """加载 Whisper 模型"""
        try:
            import whisper
            logger.info("开始加载 Whisper 模型...")
            self.model = whisper.load_model("medium")
            self.initialized = True
            logger.info("Whisper 模型加载完成")
            return True
        except Exception as e:
            logger.error(f"模型加载失败: {str(e)}")
            return False

    def transcribe(self, audio_path, options=None):
        """转写音频"""
        if not self.initialized:
            return {"success": False, "error": "模型未初始化"}

        try:
            options = options or {}
            result = self.model.transcribe(
                audio_path,
                language=options.get("language"),
                task=options.get("task", "transcribe")
            )

            return {
                "success": True,
                "text": result["text"],
                "language": result.get("language", "unknown")
            }
        except Exception as e:
            logger.error(f"转写失败: {str(e)}")
            return {"success": False, "error": str(e)}

    def emit(self, payload):
        """发送 JSON 消息到 stdout"""
        sys.stdout.write(json.dumps(payload, ensure_ascii=False) + "\n")
        sys.stdout.flush()

    def handle_command(self, command):
        """处理命令"""
        cmd_type = command.get("type")

        if cmd_type == "init":
            success = self.load_model()
            self.emit({"type": "ready", "success": success})

        elif cmd_type == "transcribe":
            result = self.transcribe(
                command["audio_path"],
                command.get("options", {})
            )
            self.emit({
                "type": "transcribe_response",
                "request_id": command.get("request_id"),
                **result
            })

        elif cmd_type == "shutdown":
            self.running = False
            self.emit({"type": "shutdown_response", "success": True})

    def run(self):
        """主循环"""
        # 自动初始化
        success = self.load_model()
        self.emit({"type": "ready", "success": success})

        while self.running:
            try:
                line = sys.stdin.readline()
                if not line:
                    break
                command = json.loads(line)
                self.handle_command(command)
            except Exception as e:
                logger.error(f"处理命令失败: {str(e)}")
                self.emit({"type": "error", "message": str(e)})


if __name__ == "__main__":
    server = WhisperServer()
    server.run()
