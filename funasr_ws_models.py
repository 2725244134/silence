#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
FunASR WebSocket 模型管理
"""

import logging
import os
import sys
import contextlib
from pathlib import Path

logger = logging.getLogger(__name__)


@contextlib.contextmanager
def suppress_stdout():
    """临时抑制stdout，避免第三方库输出破坏协议"""
    old_stdout = sys.stdout
    devnull = open(os.devnull, "w")
    try:
        sys.stdout = devnull
        yield
    finally:
        sys.stdout = old_stdout
        devnull.close()


class ModelManager:
    """模型管理器"""

    def __init__(self, damo_root=None):
        self.damo_root = damo_root or os.environ.get("DAMO_ROOT")
        self.asr_model = None
        self.vad_model = None
        self.punc_model = None
        self.realtime_asr_model = None
        self.initialized = False

    async def initialize(self):
        """初始化所有模型"""
        try:
            logger.info("开始加载模型...")
            from funasr import AutoModel

            # 加载 batch 模式模型
            logger.info("加载 ASR 模型...")
            self.asr_model = AutoModel(
                model=self._find_model("paraformer-zh"),
                vad_model=self._find_model("fsmn-vad"),
                punc_model=self._find_model("punc_ct-transformer"),
                disable_update=True,
            )

            # 加载 realtime 模式模型
            logger.info("加载 Realtime ASR 模型...")
            self.realtime_asr_model = AutoModel(
                model=self._find_model("paraformer-zh-streaming"),
                disable_update=True,
            )

            self.initialized = True
            logger.info("所有模型加载完成")
            return True
        except Exception as e:
            logger.error(f"模型加载失败: {e}")
            import traceback

            logger.error(traceback.format_exc())
            return False

    def _find_model(self, model_name):
        """查找模型路径"""
        if not self.damo_root:
            return model_name

        patterns = [
            f"{model_name}*",
            f"damo/{model_name}*",
            f"*{model_name}*",
        ]

        for pattern in patterns:
            matches = list(Path(self.damo_root).glob(pattern))
            if matches:
                return str(matches[0])

        return model_name

    def generate_batch(self, audio_data):
        """Batch 模式识别"""
        if not self.asr_model:
            raise RuntimeError("ASR 模型未加载")

        with suppress_stdout():
            result = self.asr_model.generate(input=audio_data, batch_size_s=300)
        return result

    def generate_realtime_chunk(self, session, audio_chunk, is_final=False):
        """Realtime 模式识别片段"""
        if not self.realtime_asr_model:
            raise RuntimeError("Realtime ASR 模型未加载")

        config = session["config"]
        with suppress_stdout():
            result = self.realtime_asr_model.generate(
                input=audio_chunk,
                cache=session["cache"],
                is_final=is_final,
                chunk_size=config.get("chunk_size", [5, 10, 5]),
                encoder_chunk_look_back=config.get("encoder_chunk_look_back", 4),
                decoder_chunk_look_back=config.get("decoder_chunk_look_back", 1),
                hotword=config.get("hotwords", ""),
            )
        return result

    @staticmethod
    def extract_text(result):
        """从识别结果中提取文本"""
        if not result:
            return ""
        if isinstance(result, list) and len(result) > 0:
            item = result[0]
            if isinstance(item, dict):
                return item.get("text", "")
            return str(item)
        if isinstance(result, dict):
            return result.get("text", "")
        return str(result)
