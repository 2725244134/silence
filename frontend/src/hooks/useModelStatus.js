import { useState, useEffect, useCallback } from 'react';
import { ASR_MODES } from '../config/audioConfig';

// 检查是否为控制面板或设置页面
const isControlPanelOrSettings = () => {
  const urlParams = new URLSearchParams(window.location.search);
  return urlParams.get('panel') === 'control' || urlParams.get('page') === 'settings';
};

/**
 * 模型状态监控Hook
 * 监控本地模型的下载、加载状态
 * 云端模式时直接返回 ready
 * @param {string} asrMode - 'local' | 'cloud'
 */
export const useModelStatus = (asrMode = ASR_MODES.LOCAL) => {
  const [modelStatus, setModelStatus] = useState({
    isLoading: true,
    isReady: false,
    isDownloading: false,
    modelsDownloaded: false,
    error: null,
    progress: 0,
    downloadProgress: 0,
    missingModels: [],
    stage: 'checking' // checking, need_download, downloading, loading, ready, error
  });

  // 检查模型文件状态
  const checkModelFiles = useCallback(async () => {
    try {
      if (window.electronAPI) {
        const result = await window.electronAPI.checkModelFiles();
        return result;
      }
      return { success: false, models_downloaded: false };
    } catch (error) {
      console.error('检查模型文件失败:', error);
      return { success: false, models_downloaded: false };
    }
  }, []);

  // 检查FunASR服务器状态
  const checkServerStatus = useCallback(async () => {
    try {
      if (window.electronAPI) {
        if (window.electronAPI.checkWsServerStatus) {
          return await window.electronAPI.checkWsServerStatus();
        }
        return { success: false, server_ready: false, error: 'WebSocket 状态接口不可用' };
      }
      return { success: false };
    } catch (error) {
      console.error('检查服务器状态失败:', error);
      return { success: false };
    }
  }, []);

  // 综合检查模型状态
  const checkModelStatus = useCallback(async () => {
    // 云端模式直接标记就绪
    if (asrMode === ASR_MODES.CLOUD) {
      setModelStatus(prev => ({
        ...prev,
        isLoading: false,
        isDownloading: false,
        isReady: true,
        modelsDownloaded: true,
        error: null,
        progress: 100,
        stage: 'ready'
      }));
      return;
    }

    try {
      if (!window.electronAPI) {
        setModelStatus(prev => ({
          ...prev,
          isLoading: false,
          isDownloading: false,
          isReady: false,
          error: 'Electron API 不可用',
          stage: 'error'
        }));
        return;
      }

      // 检查模型文件
      const modelFiles = await checkModelFiles();
      const serverStatus = await checkServerStatus();
      
      if (!modelFiles.success) {
        setModelStatus(prev => ({
          ...prev,
          isLoading: false,
          isDownloading: false,
          error: '检查模型文件失败',
          stage: 'error'
        }));
        return;
      }

      const realtimeReady = Boolean(serverStatus?.success && serverStatus?.server_ready);
      const modelsDownloaded = Boolean(modelFiles.models_downloaded);
      const missingModels = modelsDownloaded ? [] : (modelFiles.missing_models || []);

      if (!modelsDownloaded) {
        // 模型未下载
        setModelStatus(prev => ({
          ...prev,
          isLoading: false,
          isDownloading: false,
          isReady: false,
          modelsDownloaded: false,
          missingModels,
          error: null,
          progress: 0,
          stage: 'need_download'
        }));
        return;
      }

      if (realtimeReady) {
        // 模型已下载且服务器就绪
        setModelStatus(prev => ({
          ...prev,
          isLoading: false,
          isDownloading: false,
          isReady: true,
          modelsDownloaded: true,
          missingModels: [],
          error: null,
          progress: 100,
          stage: 'ready'
        }));
      } else if (serverStatus?.initializing) {
        // 模型已下载，正在加载
        setModelStatus(prev => ({
          ...prev,
          isLoading: true,
          isDownloading: false,
          isReady: false,
          modelsDownloaded: true,
          missingModels: [],
          error: null,
          progress: 50,
          stage: 'loading'
        }));
      } else {
        // 模型已下载但服务器未就绪
        const serverError = serverStatus?.error;
        setModelStatus(prev => ({
          ...prev,
          isLoading: false,
          isDownloading: false,
          isReady: false,
          modelsDownloaded: true,
          missingModels: [],
          error: serverError || '服务器未就绪',
          progress: 0,
          stage: 'error'
        }));
      }
      
    } catch (error) {
      if (window.electronAPI && window.electronAPI.log) {
        window.electronAPI.log('error', '检查模型状态失败:', error);
      }
      setModelStatus(prev => ({
        ...prev,
        isLoading: false,
        isDownloading: false,
        isReady: false,
        error: error.message || '模型状态检查失败',
        progress: 0,
        stage: 'error'
      }));
    }
  }, [asrMode, checkModelFiles, checkServerStatus]);

  // 下载模型
  const downloadModels = useCallback(async () => {
    try {
      if (!window.electronAPI) {
        throw new Error('Electron API 不可用');
      }

      // 设置下载状态，并阻止定时器干扰
      setModelStatus(prev => ({
        ...prev,
        isDownloading: true,
        downloadProgress: 0,
        error: null,
        stage: 'downloading',
        isLoading: false // 确保不显示加载状态
      }));

      const result = await window.electronAPI.downloadModels();
      
      if (result.success) {
        // 下载成功，设置为加载状态
        setModelStatus(prev => ({
          ...prev,
          isDownloading: false,
          modelsDownloaded: true,
          downloadProgress: 100,
          stage: 'loading',
          isLoading: true
        }));
        
        // 下载完成后重启FunASR服务器以加载模型
        try {
          console.log('模型下载完成，重启 WebSocket 服务器...');
          if (!window.electronAPI.restartWsServer) {
            throw new Error('WebSocket 重启接口不可用');
          }
          await window.electronAPI.restartWsServer();
          console.log('WebSocket 服务器重启完成');
          
          // 重启后等待一段时间再检查状态
          setTimeout(() => {
            checkModelStatus();
          }, 3000); // 增加等待时间到3秒
          
        } catch (restartError) {
          console.error('重启FunASR服务器失败:', restartError);
          setModelStatus(prev => ({
            ...prev,
            isLoading: false,
            error: '重启服务器失败: ' + restartError.message,
            stage: 'error'
          }));
        }
        
        return { success: true };
      } else {
        throw new Error(result.error || '下载失败');
      }
      
    } catch (error) {
      console.error('下载模型失败:', error);
      setModelStatus(prev => ({
        ...prev,
        isDownloading: false,
        isLoading: false,
        error: error.message || '下载模型失败',
        stage: 'error'
      }));
      return { success: false, error: error.message };
    }
  }, [checkModelStatus]);

  // 初始化时检查状态
  useEffect(() => {
    if (isControlPanelOrSettings()) {
      console.log('控制面板或设置页面，跳过模型状态检查');
      return;
    }
    
    checkModelStatus();
  }, [checkModelStatus]);

  // 设置定期检查（仅在主窗口且模型未就绪时）
  useEffect(() => {
    if (isControlPanelOrSettings() || modelStatus.isReady || modelStatus.isDownloading) {
      return;
    }

    const interval = setInterval(() => {
      if (!modelStatus.isReady && !modelStatus.isDownloading) {
        checkModelStatus();
      }
    }, 3000); // 减少间隔，确保及时检测到状态变化

    return () => clearInterval(interval);
  }, [modelStatus.isReady, modelStatus.isDownloading, checkModelStatus]);

  // 监听下载进度事件
  useEffect(() => {
    if (window.electronAPI && window.electronAPI.onModelDownloadProgress) {
      const unsubscribe = window.electronAPI.onModelDownloadProgress((event, progress) => {
        setModelStatus(prev => ({
          ...prev,
          isDownloading: true,
          isLoading: false,
          downloadProgress: progress.overall_progress || progress.progress || 0,
          stage: 'downloading'
        }));
      });

      return unsubscribe;
    }
  }, []);

  return {
    ...modelStatus,
    checkModelStatus,
    downloadModels,
    checkModelFiles
  };
};
