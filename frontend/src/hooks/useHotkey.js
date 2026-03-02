import { useState, useEffect, useCallback, useRef } from 'react';

/**
 * 热键管理Hook
 * 处理全局快捷键功能
 */
export const useHotkey = () => {
  const [hotkey, setHotkey] = useState('ALT+D');
  const [isRegistered, setIsRegistered] = useState(false);
  const registeredHotkeyRef = useRef(null); // 跟踪已注册的热键
  const isRegisteredRef = useRef(false);
  const hotkeyRef = useRef('ALT+D');
  const registerInFlightRef = useRef(null);
  const registerInFlightHotkeyRef = useRef(null);

  // 获取当前热键
  useEffect(() => {
    const getCurrentHotkey = async () => {
      try {
        if (window.electronAPI) {
          const currentHotkey = await window.electronAPI.getCurrentHotkey();
          if (currentHotkey) {
            setHotkey(currentHotkey);
          }
        }
      } catch (error) {
        if (window.electronAPI && window.electronAPI.log) {
          window.electronAPI.log('warn', '获取当前热键失败:', error);
        }
      }
    };

    getCurrentHotkey();
  }, []);

  useEffect(() => {
    isRegisteredRef.current = isRegistered;
  }, [isRegistered]);

  useEffect(() => {
    hotkeyRef.current = hotkey;
  }, [hotkey]);

  // 专注于可配置的全局热键

  // 注册传统热键 - 添加防重复注册机制
  const registerHotkey = useCallback(async (newHotkey) => {
    const normalizedHotkey =
      typeof newHotkey === 'string' && newHotkey.trim()
        ? newHotkey.trim().toUpperCase()
        : 'ALT+D';

    if (registerInFlightRef.current) {
      if (registerInFlightHotkeyRef.current === normalizedHotkey) {
        return registerInFlightRef.current;
      }
      await registerInFlightRef.current;
    }

    const registerTask = (async () => {
      try {
        // 防重复注册：如果已经注册了相同的热键，直接返回成功
        if (registeredHotkeyRef.current === normalizedHotkey && isRegisteredRef.current) {
          console.log(`热键 ${normalizedHotkey} 已注册，跳过重复注册`);
          return true;
        }

        if (window.electronAPI) {
          const result = await window.electronAPI.registerHotkey(normalizedHotkey);
          if (result?.success) {
            registeredHotkeyRef.current = normalizedHotkey;
            setHotkey(normalizedHotkey);
            setIsRegistered(true);
            return true;
          }
        }
        return false;
      } catch (error) {
        if (window.electronAPI && window.electronAPI.log) {
          window.electronAPI.log('error', '注册热键失败:', error);
        }
        return false;
      }
    })();

    registerInFlightRef.current = registerTask;
    registerInFlightHotkeyRef.current = normalizedHotkey;
    try {
      return await registerTask;
    } finally {
      if (registerInFlightRef.current === registerTask) {
        registerInFlightRef.current = null;
        registerInFlightHotkeyRef.current = null;
      }
    }
  }, []);

  // 注销传统热键
  const unregisterHotkey = useCallback(async (hotkeyToUnregister) => {
    try {
      if (window.electronAPI) {
        const targetHotkey = hotkeyToUnregister || hotkeyRef.current;
        const result = await window.electronAPI.unregisterHotkey(targetHotkey);
        if (result.success) {
          setIsRegistered(false);
        }
      }
    } catch (error) {
      if (window.electronAPI && window.electronAPI.log) {
        window.electronAPI.log('error', '注销热键失败:', error);
      }
    }
  }, []);

  // 同步录音状态到主进程
  const syncRecordingState = useCallback(async (isRecording) => {
    try {
      if (window.electronAPI) {
        await window.electronAPI.setRecordingState(isRecording);
      }
    } catch (error) {
      if (window.electronAPI && window.electronAPI.log) {
        window.electronAPI.log('error', '同步录音状态失败:', error);
      }
    }
  }, []);

  // 格式化热键显示
  const formatHotkey = (hotkeyString) => {
    return hotkeyString
      .replace('CommandOrControl', 'Ctrl')
      .replace('Shift', '⇧')
      .replace('Alt', 'Alt')
      .replace('Space', '空格')
      .replace('F2', 'F2')
      .replace('+', ' + ');
  };

  return {
    hotkey: formatHotkey(hotkey),
    rawHotkey: hotkey,
    isRegistered,
    registerHotkey,
    unregisterHotkey,
    syncRecordingState
  };
};
