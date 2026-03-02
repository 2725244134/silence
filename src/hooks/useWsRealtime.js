import { useState, useRef, useCallback, useEffect } from 'react';
import FunASRWebSocketClient from '../helpers/funasrWsClient';
import { concatFloat32, resampleFloat32, float32ToPCM16, AUDIO_CONFIG } from '../utils/audioUtils';
import { AUDIO_CONSTRAINTS } from '../config/audioConfig';

const { TARGET_SAMPLE_RATE, TARGET_CHANNELS, DEFAULT_CHUNK_MS } = AUDIO_CONFIG;

/**
 * WebSocket 实时录音 Hook
 */
export const useWebSocketRealtime = () => {
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

  const sessionIdRef = useRef(null);
  const floatRemainderRef = useRef(new Float32Array(0));
  const sampleRateRef = useRef(TARGET_SAMPLE_RATE);
  const needsResamplingRef = useRef(false);

  /**
   * 初始化客户端
   */
  const initializeClient = useCallback(async () => {
    if (clientRef.current?.isConnected()) {
      return clientRef.current;
    }

    const client = new FunASRWebSocketClient('ws://localhost:10095');

    client.onPartialResult = (message) => {
      setPartialText(message.text || '');
    };

    client.onFinalResult = (message) => {
      setFinalText(message.text || '');
    };

    client.onError = (error) => {
      setError(error.message);
    };

    await client.connect();
    clientRef.current = client;
    return client;
  }, []);

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
   * 处理音频帧
   */
  const ingestAudioFrame = useCallback((frame) => {
    if (!(frame instanceof Float32Array) || frame.length === 0) {
      return;
    }

    const normalized = needsResamplingRef.current
      ? resampleFloat32(frame, sampleRateRef.current, TARGET_SAMPLE_RATE)
      : frame;

    const merged = concatFloat32(floatRemainderRef.current, normalized);
    const chunkSamples = Math.round((TARGET_SAMPLE_RATE * DEFAULT_CHUNK_MS) / 1000);

    if (merged.length < chunkSamples) {
      floatRemainderRef.current = merged;
      return;
    }

    let offset = 0;
    while (offset + chunkSamples <= merged.length) {
      const chunkFloat = merged.subarray(offset, offset + chunkSamples);
      const chunkBytes = float32ToPCM16(chunkFloat);

      try {
        clientRef.current?.sendRealtimeAudio(chunkBytes);
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
    try {
      setError(null);
      setPartialText('');
      setFinalText('');
      floatRemainderRef.current = new Float32Array(0);

      const client = await initializeClient();

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: AUDIO_CONSTRAINTS,
      });

      const context = new (window.AudioContext || window.webkitAudioContext)({
        sampleRate: TARGET_SAMPLE_RATE,
      });

      sampleRateRef.current = context.sampleRate;
      needsResamplingRef.current = context.sampleRate !== TARGET_SAMPLE_RATE;

      const workletModuleUrl = new URL(
        '../workers/realtimeAudioProcessor.js',
        import.meta.url
      );
      await context.audioWorklet.addModule(workletModuleUrl);

      const source = context.createMediaStreamSource(stream);
      const node = new AudioWorkletNode(context, 'realtime-audio-processor');
      node.port.onmessage = (event) => ingestAudioFrame(event.data);

      source.connect(node);

      const sessionId = crypto.randomUUID();
      await client.startRealtime(sessionId);

      sessionIdRef.current = sessionId;
      streamRef.current = stream;
      audioContextRef.current = context;
      sourceNodeRef.current = source;
      workletNodeRef.current = node;

      setIsRecording(true);
      setIsProcessing(false);
    } catch (err) {
      setError(`无法开始录音: ${err.message}`);
      setIsRecording(false);
      await teardownAudioGraph();
    }
  }, [initializeClient, ingestAudioFrame, teardownAudioGraph]);

  /**
   * 停止录音
   */
  const stopRecording = useCallback(async () => {
    if (!sessionIdRef.current) {
      setIsRecording(false);
      return;
    }

    setIsRecording(false);
    setIsProcessing(true);

    try {
      await teardownAudioGraph();

      if (floatRemainderRef.current.length > 0) {
        const finalBytes = float32ToPCM16(floatRemainderRef.current);
        floatRemainderRef.current = new Float32Array(0);
        clientRef.current?.sendRealtimeAudio(finalBytes);
      }

      const result = await clientRef.current?.endRealtime(sessionIdRef.current);
      setFinalText(result?.text || '');
    } catch (err) {
      setError(`停止录音失败: ${err.message}`);
    } finally {
      sessionIdRef.current = null;
      setIsProcessing(false);
    }
  }, [teardownAudioGraph]);

  /**
   * 取消录音
   */
  const cancelRecording = useCallback(async () => {
    const activeSession = sessionIdRef.current;

    await teardownAudioGraph();

    if (activeSession && clientRef.current) {
      try {
        await clientRef.current.cancel(activeSession);
      } catch (e) {
        console.error('取消会话失败:', e);
      }
    }

    sessionIdRef.current = null;
    floatRemainderRef.current = new Float32Array(0);

    setIsRecording(false);
    setIsProcessing(false);
    setError(null);
    setPartialText('');
    setFinalText('');
  }, [teardownAudioGraph]);

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
