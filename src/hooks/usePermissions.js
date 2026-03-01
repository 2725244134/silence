import { useState, useCallback } from "react";

export const usePermissions = (showAlertDialog) => {
  const [micPermissionGranted, setMicPermissionGranted] = useState(false);
  const [accessibilityPermissionGranted, setAccessibilityPermissionGranted] = useState(false);

  const requestMicPermission = useCallback(async () => {
    try {
      await navigator.mediaDevices.getUserMedia({ audio: true });
      setMicPermissionGranted(true);
      if (showAlertDialog) {
        showAlertDialog({
          title: "✅ 麦克风权限测试成功",
          description: "麦克风权限正常工作！现在可以进行语音录制了。"
        });
      } else {
        alert("✅ 麦克风权限正常工作！现在可以进行语音录制了。");
      }
    } catch (err) {
      if (window.electronAPI && window.electronAPI.log) {
        window.electronAPI.log('error', '麦克风权限被拒绝:', err);
      }
      setMicPermissionGranted(false);
      if (showAlertDialog) {
        showAlertDialog({
          title: "❌ 需要麦克风权限",
          description: "请授予麦克风权限以使用语音转录功能。"
        });
      } else {
        alert("❌ 需要麦克风权限！请授予麦克风权限以使用语音转录功能。");
      }
    }
  }, [showAlertDialog]);

  const testAccessibilityPermission = useCallback(async () => {
    try {
      await window.electronAPI.pasteText("蛐蛐Wayland自动粘贴测试");
      setAccessibilityPermissionGranted(true);
      if (showAlertDialog) {
        showAlertDialog({
          title: "✅ 自动粘贴能力测试成功",
          description: "Wayland 注入链路正常。请检查测试文本是否出现在其他应用中。"
        });
      } else {
        alert("✅ Wayland 自动粘贴能力正常！请检查测试文本是否出现在其他应用中。");
      }
    } catch (err) {
      if (window.electronAPI && window.electronAPI.log) {
        window.electronAPI.log('error', 'Wayland 自动粘贴能力测试失败:', err);
      }
      setAccessibilityPermissionGranted(false);
      if (showAlertDialog) {
        showAlertDialog({
          title: "❌ 自动粘贴能力不可用",
          description: "请安装 wl-copy 和 ydotool，并确保 ydotoold 服务已启动。"
        });
      } else {
        alert("❌ 自动粘贴不可用！请安装 wl-copy/ydotool 并启动 ydotoold。");
      }
    }
  }, [showAlertDialog]);

  return {
    micPermissionGranted,
    accessibilityPermissionGranted,
    requestMicPermission,
    testAccessibilityPermission,
    setMicPermissionGranted,
    setAccessibilityPermissionGranted,
  };
};
