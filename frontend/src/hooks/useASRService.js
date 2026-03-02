/**
 * ASR 服务通用 Hook
 * 提供统一的接口使用任何 ASR 服务
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import { ASRServiceFactory, ASRServiceType } from '../services/ASRServiceFactory';
import { ServiceStatus, TranscriptionMode } from '../services/ASRServiceInterface';

/**
 * 使用 ASR 服务的通用 Hook
 * @param {string} serviceType - 服务类型 (funasr, whisper, etc.)
 * @param {Object} config - 服务配置
 */
export const useASRService = (serviceType = ASRServiceType.FUNASR, config = {}) => {
  const [status, setStatus] = useState(ServiceStatus.DISCONNECTED);
  const [partialText, setPartialText] = useState('');
  const [finalText, setFinalText] = useState('');
  const [error, setError] = useState(null);

  const serviceRef = useRef(null);
  const sessionIdRef = useRef(null);

  /**
   * 初始化服务
   */
  const initializeService = useCallback(async () => {
    if (serviceRef.current?.isReady()) {
      return serviceRef.current;
    }

    try {
      const service = ASRServiceFactory.create(serviceType, config);

      // 设置回调
      service.onStatusChange = (newStatus) => {
        setStatus(newStatus);
      };

      service.onPartialResult = (result) => {
        setPartialText(result.text || '');
      };

      service.onFinalResult = (result) => {
        setFinalText(result.text || '');
      };

      service.onError = (err) => {
        setError(err.message || '未知错误');
      };

      await service.connect();
      serviceRef.current = service;
      return service;
    } catch (err) {
      setError(`初始化服务失败: ${err.message}`);
      throw err;
    }
  }, [serviceType, config]);

  /**
   * 开始转录
   * @param {string} mode - 转录模式 (batch/realtime)
   * @param {Object} options - 转录选项
   */
  const startTranscription = useCallback(async (mode = TranscriptionMode.REALTIME, options = {}) => {
    try {
      setError(null);
      setPartialText('');
      setFinalText('');

      const service = await initializeService();
      const sessionId = await service.startTranscription({ mode, config: options });

      sessionIdRef.current = sessionId;
      return sessionId;
    } catch (err) {
      setError(`开始转录失败: ${err.message}`);
      throw err;
    }
  }, [initializeService]);

  /**
   * 发送音频数据
   * @param {ArrayBuffer|Uint8Array} audioData
   */
  const sendAudio = useCallback(async (audioData) => {
    if (!serviceRef.current) {
      throw new Error('服务未初始化');
    }

    try {
      await serviceRef.current.sendAudio(audioData);
    } catch (err) {
      setError(`发送音频失败: ${err.message}`);
      throw err;
    }
  }, []);

  /**
   * 停止转录
   */
  const stopTranscription = useCallback(async () => {
    if (!serviceRef.current || !sessionIdRef.current) {
      return null;
    }

    try {
      const result = await serviceRef.current.stopTranscription(sessionIdRef.current);
      sessionIdRef.current = null;
      return result;
    } catch (err) {
      setError(`停止转录失败: ${err.message}`);
      throw err;
    }
  }, []);

  /**
   * 取消转录
   */
  const cancelTranscription = useCallback(async (reason = 'user_cancel') => {
    if (!serviceRef.current) {
      return;
    }

    try {
      await serviceRef.current.cancelTranscription(sessionIdRef.current, reason);
      sessionIdRef.current = null;
      setPartialText('');
      setFinalText('');
      setError(null);
    } catch (err) {
      setError(`取消转录失败: ${err.message}`);
    }
  }, []);

  /**
   * 断开服务
   */
  const disconnect = useCallback(async () => {
    if (serviceRef.current) {
      await serviceRef.current.disconnect();
      serviceRef.current = null;
    }
  }, []);

  /**
   * 获取音频格式要求
   */
  const getAudioFormat = useCallback(() => {
    if (!serviceRef.current) {
      return null;
    }
    return serviceRef.current.getAudioFormat();
  }, []);

  /**
   * 获取服务名称
   */
  const getServiceName = useCallback(() => {
    if (!serviceRef.current) {
      return serviceType;
    }
    return serviceRef.current.getName();
  }, [serviceType]);

  // 清理
  useEffect(() => {
    return () => {
      disconnect();
    };
  }, [disconnect]);

  return {
    // 状态
    status,
    partialText,
    finalText,
    error,
    isReady: status === ServiceStatus.READY,
    isTranscribing: status === ServiceStatus.TRANSCRIBING,

    // 方法
    startTranscription,
    sendAudio,
    stopTranscription,
    cancelTranscription,
    disconnect,
    getAudioFormat,
    getServiceName,

    // 原始服务实例（高级用法）
    service: serviceRef.current,
  };
};
