#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
FunASR WebSocket 消息处理器
"""

import json
import logging
import time
import traceback

logger = logging.getLogger(__name__)


class MessageHandler:
    """WebSocket 消息处理器"""

    def __init__(self, model_manager, session_manager):
        self.models = model_manager
        self.sessions = session_manager

    async def handle_json_message(self, websocket, message):
        """处理 JSON 消息"""
        try:
            data = json.loads(message)
        except json.JSONDecodeError:
            await self._send_error(
                websocket, "invalid_message", "无效的 JSON 格式", fatal=False
            )
            return

        msg_type = data.get("type")

        handlers = {
            "start_realtime": self._handle_start_realtime,
            "end_realtime": self._handle_end_realtime,
            "cancel": self._handle_cancel,
            "ping": self._handle_ping,
        }

        handler = handlers.get(msg_type)
        if handler:
            await handler(websocket, data)
        else:
            await self._send_error(
                websocket,
                "invalid_message",
                f"未知消息类型: {msg_type}",
                fatal=False,
            )

    async def handle_binary_message(self, websocket, data):
        """处理二进制音频数据"""
        session = self.sessions.find_active_session(websocket)
        if not session:
            await self._send_error(
                websocket, "session_not_found", "没有活动会话", fatal=True
            )
            return

        session["audio_buffer"].extend(data)
        self.sessions.update_activity(session["id"])

        # Realtime 模式立即处理
        if session["mode"] == "realtime":
            await self._process_realtime_chunk(websocket, session, data)
            # 修剪缓冲区防止内存泄漏
            self.sessions.trim_audio_buffer(session["id"])

    # ========== Realtime 模式处理 ==========

    async def _handle_start_realtime(self, websocket, data):
        """开始 realtime 会话"""
        session_id = data.get("session_id")
        if not session_id:
            await self._send_error(
                websocket, "invalid_message", "缺少 session_id", fatal=True
            )
            return

        try:
            config = data.get("config", {})
            self.sessions.create_realtime_session(session_id, websocket, config)

            await self._send_message(
                websocket,
                {
                    "type": "started",
                    "session_id": session_id,
                    "mode": "realtime",
                    "timestamp": int(time.time() * 1000),
                },
            )
        except ValueError as e:
            await self._send_error(websocket, "session_exists", str(e), fatal=True)

    async def _process_realtime_chunk(self, websocket, session, chunk_data):
        """处理实时音频片段"""
        try:
            session["seq"] += 1

            result = self.models.generate_realtime_chunk(session, chunk_data, is_final=False)
            text = self.models.extract_text(result)
            if text:
                session["latest_text"] = text

            await self._send_message(
                websocket,
                {
                    "type": "partial_result",
                    "session_id": session["id"],
                    "seq": session["seq"],
                    "text": session["latest_text"],
                    "is_final": False,
                    "timestamp": int(time.time() * 1000),
                },
            )

        except Exception as e:
            logger.error(f"Realtime 处理失败: {e}")
            await self._send_error(
                websocket, "internal_error", f"处理失败: {str(e)}", fatal=False
            )

    async def _handle_end_realtime(self, websocket, data):
        """结束 realtime 会话"""
        session_id = data.get("session_id")
        session = self.sessions.get_session(session_id)

        if not session:
            await self._send_error(
                websocket,
                "session_not_found",
                f"会话不存在: {session_id}",
                fatal=True,
            )
            return

        try:
            # 最终处理
            result = self.models.generate_realtime_chunk(session, b"", is_final=True)
            final_text = self.models.extract_text(result) or session["latest_text"]

            await self._send_message(
                websocket,
                {
                    "type": "final_result",
                    "session_id": session_id,
                    "mode": "realtime",
                    "text": final_text,
                    "is_final": True,
                    "duration": len(session["audio_buffer"]) / 32000.0,
                    "timestamp": int(time.time() * 1000),
                },
            )

            logger.info(f"Realtime 会话完成: {session_id}, 文本长度: {len(final_text)}")
        except Exception as e:
            logger.error(f"Realtime 结束失败: {e}")
            await self._send_error(
                websocket, "internal_error", f"结束失败: {str(e)}", fatal=True
            )
        finally:
            self.sessions.delete_session(session_id)

    # ========== 通用处理 ==========

    async def _handle_cancel(self, websocket, data):
        """取消会话"""
        session_id = data.get("session_id")
        if session_id:
            self.sessions.delete_session(session_id)
            logger.info(f"会话已取消: {session_id}")

        await self._send_message(
            websocket,
            {
                "type": "cancelled",
                "session_id": session_id,
                "timestamp": int(time.time() * 1000),
            },
        )

    async def _handle_ping(self, websocket, data):
        """处理心跳"""
        await self._send_message(
            websocket, {"type": "pong", "timestamp": int(time.time() * 1000)}
        )

    # ========== 工具方法 ==========

    async def _send_message(self, websocket, data):
        """发送 JSON 消息"""
        await websocket.send(json.dumps(data, ensure_ascii=False))

    async def _send_error(self, websocket, code, message, fatal=False):
        """发送错误消息"""
        await self._send_message(
            websocket,
            {
                "type": "error",
                "code": code,
                "message": message,
                "fatal": fatal,
                "timestamp": int(time.time() * 1000),
            },
        )
