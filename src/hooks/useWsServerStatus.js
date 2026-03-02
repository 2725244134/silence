import { useState, useEffect, useCallback } from 'react';

/**
 * WebSocket 服务器状态 Hook
 * 监控 WebSocket 服务器的状态
 */
export const useWsServerStatus = () => {
  const [isReady, setIsReady] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [serverUrl, setServerUrl] = useState(null);

  const checkStatus = useCallback(async () => {
    if (!window.electronAPI?.checkWsServerStatus) {
      setIsLoading(false);
      setError('WebSocket API 不可用');
      return;
    }

    try {
      const status = await window.electronAPI.checkWsServerStatus();

      if (status.success && status.server_ready) {
        setIsReady(true);
        setError(null);

        // 获取服务器 URL
        const urlResult = await window.electronAPI.getWsServerUrl();
        if (urlResult.success) {
          setServerUrl(urlResult.url);
        }
      } else {
        setIsReady(false);
        setError(status.error || '服务器未就绪');
      }
    } catch (err) {
      setIsReady(false);
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    checkStatus();

    // 每 5 秒检查一次状态
    const interval = setInterval(checkStatus, 5000);

    return () => clearInterval(interval);
  }, [checkStatus]);

  const restart = useCallback(async () => {
    if (!window.electronAPI?.restartWsServer) {
      return { success: false, error: 'API 不可用' };
    }

    setIsLoading(true);
    try {
      const result = await window.electronAPI.restartWsServer();
      await checkStatus();
      return result;
    } catch (err) {
      setError(err.message);
      return { success: false, error: err.message };
    } finally {
      setIsLoading(false);
    }
  }, [checkStatus]);

  return {
    isReady,
    isLoading,
    error,
    serverUrl,
    checkStatus,
    restart,
  };
};
