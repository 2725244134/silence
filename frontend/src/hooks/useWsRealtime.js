import { useState, useRef, useCallback, useEffect } from 'react';
import RealtimeClient from '../helpers/realtimeClient';
import { concatFloat32, resampleFloat32, float32ToPCM16, pcm16ToBase64 } from '../utils/audioUtils';
import { AUDIO_CONFIG, AUDIO_CONSTRAINTS, REALTIME_SESSION_DEFAULTS, ASR_MODES } from '../config/audioConfig';

const { DEFAULT_CHUNK_MS } = AUDIO_CONFIG;

/**
 * WebSocket 实时录音 Hook (OpenAI Realtime 协议)
 * @param {Object} options
 * @param {string} [options.asrMode] - 'local' | 'cloud'
 * @param {string} [options.apiKey] - 云端模式的 OpenAI API Key
 * @param {string} [options.localUrl] - 本地模式 WebSocket URL
 */
export const useWebSocketRealtime = (options = {}) => {
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState(null);
  const [partialText, setPartialText] = useState('');
  const [finalText, setFinalText] = useState('');

  const clientRef = useRef(null);
  const streamRef = useRef(null);
  const audioContextRef = useRef(null);
  const sourceNodeRef = useRef(null);
  const workletNodeRef = useRef(null);

  const floatRemainderRef = useRef(new Float32Array(0));
  const sampleRateRef = useRef(AUDIO_CONFIG.LOCAL_SAMPLE_RATE);
  const targetSampleRateRef = useRef(AUDIO_CONFIG.LOCAL_SAMPLE_RATE);
  const needsResamplingRef = useRef(false);
  const startInFlightRef = useRef(false);
  const stopInFlightRef = useRef(false);
  const stopRequestedDuringStartRef = useRef(false);
  const donePromiseRef = useRef(null);

  const logToMain = useCallback((level, message, data = null) => {
    try {
      if (window.electronAPI?.log) {
        const payload = data ? `${message} | ${JSON.stringify(data)}` : message;
        window.electronAPI.log(level, payload);
      }
    } catch (_error) {
      // ignore logging failures
    }
  }, []);

  /**
   * 获取 WebSocket URL 和连接选项
   */
  const getConnectionConfig = useCallback(async () => {
    const asrMode = options.asrMode || ASR_MODES.LOCAL;

    if (asrMode === ASR_MODES.CLOUD) {
      const apiKey = options.apiKey || '';
      if (!apiKey) {
        throw new Error('云端模式需要 API Key');
      }
      return {
        url: 'wss://api.openai.com/v1/realtime?intent=transcription',
        protocols: ['realtime', `openai-insecure-api-key.${apiKey}`],
        targetSampleRate: AUDIO_CONFIG.CLOUD_SAMPLE_RATE,
      };
    }

    // 本地模式
    let wsUrl = options.localUrl || 'ws://localhost:8765';
    try {
      if (window.electronAPI?.getWsServerUrl) {
        const urlResp = await window.electronAPI.getWsServerUrl();
        if (urlResp?.success && urlResp.url) {
          wsUrl = urlResp.url;
        }
      }
    } catch (_error) {
      // fallback to default url
    }

    return {
      url: wsUrl,
      protocols: undefined,
      targetSampleRate: AUDIO_CONFIG.LOCAL_SAMPLE_RATE,
    };
  }, [options.asrMode, options.apiKey, options.localUrl]);

  /**
   * 本地模式：等待 WS 服务器就绪
   */
  const ensureWsReady = useCallback(async (timeoutMs = 30000) => {
    if (options.asrMode === ASR_MODES.CLOUD) {
      return; // 云端模式不需要等待本地服务器
    }

    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      if (!window.electronAPI?.checkWsServerStatus) {
        throw new Error('WebSocket 状态接口不可用');
      }

      const status = await window.electronAPI.checkWsServerStatus();
      if (status?.success && status?.server_ready) {
        return status;
      }

      if (!status?.initializing && status?.error && status.error !== '服务器未就绪') {
        throw new Error(status.error);
      }

      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    throw new Error(`WebSocket 服务器未就绪，等待超时(${timeoutMs}ms)`);
  }, [options.asrMode]);

  /**
   * 初始化客户端
   */
  const initializeClient = useCallback(async () => {
    if (clientRef.current?.isConnected()) {
      return clientRef.current;
    }

    const config = await getConnectionConfig();
    targetSampleRateRef.current = config.targetSampleRate;

    const client = new RealtimeClient(config.url, {
      protocols: config.protocols,
    });

    client.onTranscriptionDelta = (message) => {
      setPartialText(message.transcript || message.delta || '');
    };

    client.onTranscriptionDone = (message) => {
      setFinalText(message.transcript || '');
      // 解决停止录音时等待的 done promise
      if (donePromiseRef.current) {
        donePromiseRef.current.resolve(message);
        donePromiseRef.current = null;
      }
    };

    client.onError = (error) => {
      const msg = error?.message || 'WebSocket 客户端错误';
      setError(msg);
      logToMain('error', 'Realtime WS 客户端错误', { msg, error });
      // 如果正在等待 done，也要 reject
      if (donePromiseRef.current) {
        donePromiseRef.current.reject(new Error(msg));
        donePromiseRef.current = null;
      }
    };

    try {
      await client.connect();
      logToMain('info', 'Realtime WS 客户端连接成功', { url: config.url });
    } catch (error) {
      logToMain('error', 'Realtime WS 客户端连接失败', {
        url: config.url,
        message: error?.message || String(error),
      });
      throw error;
    }

    clientRef.current = client;
    return client;
  }, [getConnectionConfig, logToMain]);

  /**
   * 清理音频资源
   */
  const teardownAudioGraph = useCallback(async () => {
    try {
      if (workletNodeRef.current) {
        workletNodeRef.current.port.onmessage = null;
        workletNodeRef.current.disconnect();
      }
      if (sourceNodeRef.current) {
        sourceNodeRef.current.disconnect();
      }
      if (audioContextRef.current) {
        await audioContextRef.current.close();
      }
    } catch (e) {
      console.error('清理音频资源失败:', e);
    }

    workletNodeRef.current = null;
    sourceNodeRef.current = null;
    audioContextRef.current = null;

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
  }, []);

  /**
   * 处理音频帧: float32 → PCM16 → base64 → appendAudio
   */
  const ingestAudioFrame = useCallback((frame) => {
    if (!(frame instanceof Float32Array) || frame.length === 0) {
      return;
    }

    const targetRate = targetSampleRateRef.current;
    const normalized = needsResamplingRef.current
      ? resampleFloat32(frame, sampleRateRef.current, targetRate)
      : frame;

    const merged = concatFloat32(floatRemainderRef.current, normalized);
    const chunkSamples = Math.round((targetRate * DEFAULT_CHUNK_MS) / 1000);

    if (merged.length < chunkSamples) {
      floatRemainderRef.current = merged;
      return;
    }

    let offset = 0;
    while (offset + chunkSamples <= merged.length) {
      const chunkFloat = merged.subarray(offset, offset + chunkSamples);
      const chunkPCM = float32ToPCM16(chunkFloat);
      const base64 = pcm16ToBase64(chunkPCM);

      try {
        clientRef.current?.appendAudio(base64);
      } catch (e) {
        console.error('发送音频失败:', e);
      }

      offset += chunkSamples;
    }

    floatRemainderRef.current = merged.slice(offset);
  }, []);

  /**
   * 开始录音
   */
  const startRecording = useCallback(async () => {
    if (startInFlightRef.current || stopInFlightRef.current || isRecording) {
      return;
    }

    startInFlightRef.current = true;
    stopRequestedDuringStartRef.current = false;

    try {
      setError(null);
      setPartialText('');
      setFinalText('');
      floatRemainderRef.current = new Float32Array(0);

      await ensureWsReady();
      const client = await initializeClient();

      // 发送 session.update 配置会话
      await client.updateSession({
        ...REALTIME_SESSION_DEFAULTS,
      });

      const targetRate = targetSampleRateRef.current;

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          ...AUDIO_CONSTRAINTS,
          sampleRate: targetRate,
        },
      });

      const context = new (window.AudioContext || window.webkitAudioContext)({
        sampleRate: targetRate,
      });

      sampleRateRef.current = context.sampleRate;
      needsResamplingRef.current = context.sampleRate !== targetRate;

      const workletModuleUrl = new URL(
        '../workers/realtimeAudioProcessor.js',
        import.meta.url
      );
      await context.audioWorklet.addModule(workletModuleUrl);

      const source = context.createMediaStreamSource(stream);
      const node = new AudioWorkletNode(context, 'realtime-audio-processor');
      node.port.onmessage = (event) => ingestAudioFrame(event.data);

      source.connect(node);

      streamRef.current = stream;
      audioContextRef.current = context;
      sourceNodeRef.current = source;
      workletNodeRef.current = node;

      setIsRecording(true);
      setIsProcessing(false);
      logToMain('info', 'Realtime 录音启动成功');
    } catch (err) {
      const message = err?.message || '未知错误';
      setError(`无法开始录音: ${message}`);
      logToMain('error', 'Realtime 录音启动失败', { message });
      setIsRecording(false);
      await teardownAudioGraph();
    } finally {
      startInFlightRef.current = false;
    }
  }, [ensureWsReady, initializeClient, ingestAudioFrame, isRecording, logToMain, teardownAudioGraph]);

  /**
   * 停止录音
   */
  const stopRecording = useCallback(async () => {
    if (stopInFlightRef.current) {
      return;
    }

    if (startInFlightRef.current) {
      stopRequestedDuringStartRef.current = true;
      return;
    }

    if (!clientRef.current?.isConnected()) {
      setIsRecording(false);
      return;
    }

    stopInFlightRef.current = true;
    setIsRecording(false);
    setIsProcessing(true);

    try {
      await teardownAudioGraph();

      // 发送剩余的音频数据
      if (floatRemainderRef.current.length > 0) {
        const finalPCM = float32ToPCM16(floatRemainderRef.current);
        floatRemainderRef.current = new Float32Array(0);
        const base64 = pcm16ToBase64(finalPCM);
        clientRef.current?.appendAudio(base64);
      }

      // 提交缓冲区并等待最终结果
      const donePromise = new Promise((resolve, reject) => {
        donePromiseRef.current = { resolve, reject };
      });

      // 设置超时
      const timeoutId = setTimeout(() => {
        if (donePromiseRef.current) {
          donePromiseRef.current.reject(new Error('等待识别结果超时'));
          donePromiseRef.current = null;
        }
      }, 60000);

      await clientRef.current?.commitAudioBuffer();
      const result = await donePromise;
      clearTimeout(timeoutId);

      setFinalText(result?.transcript || '');
    } catch (err) {
      const message = err?.message || '未知错误';
      if (message.includes('超时') && clientRef.current) {
        try {
          clientRef.current.cancelResponse();
        } catch (_cancelError) {
          // ignore cancel error
        }
      }
      setError(`停止录音失败: ${message}`);
      logToMain('error', 'Realtime 停止录音失败', { message });
    } finally {
      setIsProcessing(false);
      stopInFlightRef.current = false;
    }
  }, [logToMain, teardownAudioGraph]);

  /**
   * 取消录音
   */
  const cancelRecording = useCallback(async () => {
    await teardownAudioGraph();

    if (clientRef.current?.isConnected()) {
      try {
        clientRef.current.clearAudioBuffer();
        clientRef.current.cancelResponse();
      } catch (e) {
        console.error('取消会话失败:', e);
      }
    }

    floatRemainderRef.current = new Float32Array(0);
    stopRequestedDuringStartRef.current = false;

    if (donePromiseRef.current) {
      donePromiseRef.current.reject(new Error('录音已取消'));
      donePromiseRef.current = null;
    }

    setIsRecording(false);
    setIsProcessing(false);
    setError(null);
    setPartialText('');
    setFinalText('');
  }, [teardownAudioGraph]);

  useEffect(() => {
    if (!isRecording) return;
    if (!stopRequestedDuringStartRef.current) return;
    stopRequestedDuringStartRef.current = false;
    stopRecording();
  }, [isRecording, stopRecording]);

  useEffect(() => {
    return () => {
      cancelRecording();
      clientRef.current?.disconnect();
    };
  }, [cancelRecording]);

  return {
    isRecording,
    isProcessing,
    error,
    partialText,
    finalText,
    startRecording,
    stopRecording,
    cancelRecording,
  };
};

// 兼容现有调用方（App.jsx）使用的旧导出名
export const useWsRealtime = useWebSocketRealtime;
