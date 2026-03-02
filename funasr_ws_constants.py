#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
WebSocket 协议常量定义
"""

# 消息类型 - 客户端到服务器
class ClientMessageTypes:
    START_BATCH = "start_batch"
    END_BATCH = "end_batch"
    START_REALTIME = "start_realtime"
    END_REALTIME = "end_realtime"
    CANCEL = "cancel"
    PING = "ping"


# 消息类型 - 服务器到客户端
class ServerMessageTypes:
    READY = "ready"
    STARTED = "started"
    PARTIAL_RESULT = "partial_result"
    FINAL_RESULT = "final_result"
    ERROR = "error"
    CANCELLED = "cancelled"
    PONG = "pong"


# 错误码
class ErrorCodes:
    INVALID_MESSAGE = "invalid_message"
    INVALID_AUDIO = "invalid_audio"
    SESSION_NOT_FOUND = "session_not_found"
    SESSION_EXISTS = "session_exists"
    MODEL_NOT_READY = "model_not_ready"
    INTERNAL_ERROR = "internal_error"
    RATE_LIMIT = "rate_limit"


# 会话模式
class SessionModes:
    BATCH = "batch"
    REALTIME = "realtime"


# 音频配置常量
class AudioConfig:
    SAMPLE_RATE = 16000
    CHANNELS = 1
    BYTES_PER_SAMPLE = 2  # 16-bit PCM
    BYTES_PER_SECOND = SAMPLE_RATE * BYTES_PER_SAMPLE  # 32000
