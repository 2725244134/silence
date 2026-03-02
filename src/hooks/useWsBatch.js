import { useState, useRef, useCallback, useEffect } from 'react';
import FunASRWebSocketClient from '../helpers/funasrWsClient';

/**
 * WebSocket Batch 转录 Hook
 */
export const useWsBatch = () => {
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);

  const clientRef = useRef(null);

  const initializeClient = useCallback(async () => {
    if (clientRef.current?.connection.connected) {
      return clientRef.current;
    }

    const client = new FunASRWebSocketClient('ws://localhost:10095');
    await client.connect();
    clientRef.current = client;
    return client;
  }, []);

  const transcribe = useCallback(
    async (audioData) => {
      setIsProcessing(true);
      setError(null);
      setResult(null);

      try {
        const client = await initializeClient();
        const sessionId = crypto.randomUUID();

        await client.startBatch(sessionId);
        client.sendBatchAudio(audioData);
        const finalResult = await client.endBatch(sessionId);

        setResult(finalResult);
        return finalResult;
      } catch (err) {
        setError(err.message);
        throw err;
      } finally {
        setIsProcessing(false);
      }
    },
    [initializeClient]
  );

  useEffect(() => {
    return () => {
      clientRef.current?.disconnect();
    };
  }, []);

  return {
    isProcessing,
    error,
    result,
    transcribe,
  };
};
