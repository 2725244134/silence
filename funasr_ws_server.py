#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
FunASR WebSocket 服务器主入口
"""

import asyncio
import json
import logging
import os
import signal
import sys
import tempfile
import time

try:
    import websockets
except ImportError:
    print("错误: 需要安装 websockets 库")
    print("请运行: pip install websockets")
    sys.exit(1)

from funasr_ws_models import ModelManager
from funasr_ws_session import SessionManager
from funasr_ws_handler import MessageHandler


# 日志配置
def get_log_path():
    if "ELECTRON_USER_DATA" in os.environ:
        log_dir = os.path.join(os.environ["ELECTRON_USER_DATA"], "logs")
    else:
        log_dir = os.path.join(tempfile.gettempdir(), "ququ_logs")
    os.makedirs(log_dir, exist_ok=True)
    return os.path.join(log_dir, "funasr_websocket_server.log")


log_file_path = get_log_path()
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(message)s",
    handlers=[
        logging.FileHandler(log_file_path, encoding="utf-8"),
        logging.StreamHandler(),
    ],
)
logger = logging.getLogger(__name__)
logger.info(f"FunASR WebSocket 服务器日志: {log_file_path}")


class FunASRWebSocketServer:
    """FunASR WebSocket 服务器"""

    def __init__(self, damo_root=None, host="localhost", port=10095):
        self.host = host
        self.port = port
        self.running = True

        # 初始化管理器
        self.model_manager = ModelManager(damo_root)
        self.session_manager = SessionManager()
        self.message_handler = MessageHandler(
            self.model_manager, self.session_manager
        )

        # 统计
        self.total_connections = 0
        self.active_connections = 0

        # 信号处理
        signal.signal(signal.SIGTERM, self._signal_handler)
        signal.signal(signal.SIGINT, self._signal_handler)

        # 环境设置
        self._setup_environment()

    def _setup_environment(self):
        """设置运行环境"""
        try:
            os.environ["OMP_NUM_THREADS"] = "4"
            logger.info("运行环境设置完成")
        except Exception as e:
            logger.warning(f"环境设置失败: {e}")

    def _signal_handler(self, signum, frame):
        """信号处理"""
        logger.info(f"收到信号 {signum}，准备退出...")
        self.running = False

    async def handle_client(self, websocket, path):
        """处理客户端连接"""
        client_id = f"{websocket.remote_address[0]}:{websocket.remote_address[1]}"
        self.total_connections += 1
        self.active_connections += 1

        logger.info(f"客户端连接: {client_id}")

        try:
            # 发送就绪消息
            await websocket.send(
                json.dumps({"type": "ready", "timestamp": int(time.time() * 1000)})
            )

            async for message in websocket:
                try:
                    if isinstance(message, str):
                        # JSON 消息
                        await self.message_handler.handle_json_message(
                            websocket, message
                        )
                    else:
                        # 二进制音频数据
                        await self.message_handler.handle_binary_message(
                            websocket, message
                        )
                except Exception as e:
                    logger.error(f"处理消息失败: {e}")
                    await websocket.send(
                        json.dumps(
                            {
                                "type": "error",
                                "code": "internal_error",
                                "message": str(e),
                                "fatal": False,
                                "timestamp": int(time.time() * 1000),
                            }
                        )
                    )

        except websockets.exceptions.ConnectionClosed:
            logger.info(f"客户端断开: {client_id}")
        except Exception as e:
            logger.error(f"连接错误: {e}")
        finally:
            self.active_connections -= 1
            self.session_manager.cleanup_client_sessions(websocket)

    async def start(self):
        """启动服务器"""
        logger.info("开始加载模型...")
        if not await self.model_manager.initialize():
            logger.error("模型初始化失败，退出")
            return

        logger.info(f"启动 WebSocket 服务器: {self.host}:{self.port}")
        async with websockets.serve(self.handle_client, self.host, self.port):
            logger.info("服务器就绪，等待连接...")
            await asyncio.Future()  # 永久运行


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser()
    parser.add_argument("--damo-root", type=str, help="模型根目录")
    parser.add_argument("--host", type=str, default="localhost", help="监听地址")
    parser.add_argument("--port", type=int, default=10095, help="监听端口")
    args = parser.parse_args()

    server = FunASRWebSocketServer(
        damo_root=args.damo_root, host=args.host, port=args.port
    )

    try:
        asyncio.run(server.start())
    except KeyboardInterrupt:
        logger.info("服务器停止")
