#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
FunASR WebSocket 会话管理
"""

import time
import logging

logger = logging.getLogger(__name__)


class SessionManager:
    """会话管理器"""

    def __init__(self):
        self.sessions = {}

    # 音频缓冲区限制 (10MB)
    MAX_BUFFER_SIZE = 10 * 1024 * 1024
    KEEP_BUFFER_SIZE = 1 * 1024 * 1024

    def create_session(self, session_id, mode, websocket, config):
        """创建会话（统一方法）"""
        if session_id in self.sessions:
            raise ValueError(f"会话已存在: {session_id}")

        session = {
            "id": session_id,
            "mode": mode,
            "websocket": websocket,
            "config": config,
            "audio_buffer": bytearray(),
            "created_at": time.time(),
            "last_activity": time.time(),
        }

        if mode == "realtime":
            session.update({
                "cache": {},
                "seq": 0,
                "latest_text": "",
            })

        self.sessions[session_id] = session
        logger.info(f"{mode.capitalize()} 会话创建: {session_id}")
        return session

    def create_batch_session(self, session_id, websocket, config):
        """创建 batch 会话"""
        return self.create_session(session_id, "batch", websocket, config)

    def create_realtime_session(self, session_id, websocket, config):
        """创建 realtime 会话"""
        return self.create_session(session_id, "realtime", websocket, config)

    def trim_audio_buffer(self, session_id):
        """修剪音频缓冲区防止内存泄漏"""
        if session_id in self.sessions:
            session = self.sessions[session_id]
            buffer_size = len(session["audio_buffer"])
            if buffer_size > self.MAX_BUFFER_SIZE:
                session["audio_buffer"] = session["audio_buffer"][-self.KEEP_BUFFER_SIZE:]
                logger.warning(f"会话 {session_id} 缓冲区过大 ({buffer_size} bytes)，已修剪至 {self.KEEP_BUFFER_SIZE} bytes")

    def get_session(self, session_id):
        """获取会话"""
        return self.sessions.get(session_id)

    def delete_session(self, session_id):
        """删除会话"""
        if session_id in self.sessions:
            del self.sessions[session_id]
            logger.info(f"会话删除: {session_id}")

    def find_active_session(self, websocket):
        """查找 websocket 的活动会话"""
        for session in self.sessions.values():
            if session["websocket"] == websocket:
                return session
        return None

    def cleanup_client_sessions(self, websocket):
        """清理客户端的所有会话"""
        to_remove = [
            sid
            for sid, session in self.sessions.items()
            if session["websocket"] == websocket
        ]
        for sid in to_remove:
            del self.sessions[sid]
            logger.info(f"清理会话: {sid}")

    def update_activity(self, session_id):
        """更新会话活动时间"""
        if session_id in self.sessions:
            self.sessions[session_id]["last_activity"] = time.time()

    def get_stats(self):
        """获取统计信息"""
        return {
            "total_sessions": len(self.sessions),
            "batch_sessions": sum(
                1 for s in self.sessions.values() if s["mode"] == "batch"
            ),
            "realtime_sessions": sum(
                1 for s in self.sessions.values() if s["mode"] == "realtime"
            ),
        }
