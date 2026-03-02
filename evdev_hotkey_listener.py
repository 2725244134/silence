#!/usr/bin/env python3
import argparse
import errno
import json
import select
import signal
import sys
import time

from evdev import InputDevice, ecodes, list_devices

RUNNING = True


def _handle_signal(_signum, _frame):
    global RUNNING
    RUNNING = False


def emit(payload):
    sys.stdout.write(json.dumps(payload, ensure_ascii=False) + "\n")
    sys.stdout.flush()


MODIFIER_GROUPS = {
    "ALT": {ecodes.KEY_LEFTALT, ecodes.KEY_RIGHTALT},
    "CTRL": {ecodes.KEY_LEFTCTRL, ecodes.KEY_RIGHTCTRL},
    "SHIFT": {ecodes.KEY_LEFTSHIFT, ecodes.KEY_RIGHTSHIFT},
    "SUPER": {ecodes.KEY_LEFTMETA, ecodes.KEY_RIGHTMETA},
}


def resolve_key_code(key_name: str) -> int:
    normalized = key_name.upper()
    if normalized in MODIFIER_GROUPS:
        raise ValueError(f"修饰键 {normalized} 不能作为主触发键")

    if not normalized.startswith("KEY_"):
        normalized = f"KEY_{normalized}"
    if normalized not in ecodes.ecodes:
        raise ValueError(f"不支持的按键: {normalized}")
    return ecodes.ecodes[normalized]


def parse_combo(combo: str):
    tokens = [token.strip().upper() for token in combo.split("+") if token.strip()]
    if not tokens:
        raise ValueError("组合键不能为空")

    trigger_keys = []
    modifier_groups = []

    for token in tokens:
        if token in MODIFIER_GROUPS:
            modifier_groups.append(MODIFIER_GROUPS[token])
            continue
        trigger_keys.append(resolve_key_code(token))

    if len(trigger_keys) != 1:
        raise ValueError("当前仅支持一个主触发键（例如 ALT+D）")

    trigger_key = trigger_keys[0]
    watched_codes = {trigger_key}
    for group in modifier_groups:
        watched_codes.update(group)

    return trigger_key, modifier_groups, watched_codes, tokens


def open_keyboard_devices(target_key_code: int, exclude_paths=None, exclusive=False):
    excluded = set(exclude_paths or [])
    devices = []
    for dev_path in list_devices():
        if dev_path in excluded:
            continue
        dev = None
        try:
            dev = InputDevice(dev_path)
            caps = dev.capabilities().get(ecodes.EV_KEY, [])
            if target_key_code in caps:
                if exclusive:
                    dev.grab()
                devices.append(dev)
            else:
                dev.close()
        except PermissionError:
            if dev is not None:
                try:
                    dev.close()
                except OSError:
                    pass
            continue
        except OSError:
            if dev is not None:
                try:
                    dev.close()
                except OSError:
                    pass
            continue
    return devices


def close_device(dev: InputDevice):
    try:
        dev.ungrab()
    except OSError:
        pass
    try:
        dev.close()
    except OSError:
        pass


def main():
    parser = argparse.ArgumentParser(description="QuQu evdev 热键监听")
    parser.add_argument("--combo", default="ALT+D", help="监听组合键，如 ALT+D")
    parser.add_argument("--debounce-ms", type=int, default=200, help="防抖毫秒")
    parser.add_argument("--exclusive", action="store_true", help="独占抓取设备（默认关闭）")
    args = parser.parse_args()

    signal.signal(signal.SIGINT, _handle_signal)
    signal.signal(signal.SIGTERM, _handle_signal)

    try:
        key_code, modifier_groups, watched_codes, normalized_tokens = parse_combo(args.combo)
    except ValueError as exc:
        emit({"type": "error", "error": str(exc)})
        return 1

    devices = open_keyboard_devices(key_code, exclusive=args.exclusive)
    if not devices:
        emit({
            "type": "error",
            "error": "未找到可读取的输入设备。请确认已安装并配置 evdev 权限（通常需要将用户加入 input 组或配置 udev 规则）。",
        })
        return 2

    emit(
        {
            "type": "ready",
            "combo": "+".join(normalized_tokens),
            "devices": [f"{d.path}:{d.name}" for d in devices],
            "exclusive": bool(args.exclusive),
        }
    )

    last_fire_at = 0.0
    debounce_sec = max(args.debounce_ms, 0) / 1000.0
    pressed_codes = set()

    recoverable_errors = {errno.ENODEV, errno.EBADF, errno.EIO}
    last_rescan_at = time.monotonic()
    rescan_interval_sec = 1.0

    try:
        while RUNNING:
            if not devices:
                replenished = open_keyboard_devices(key_code, exclusive=args.exclusive)
                if replenished:
                    devices.extend(replenished)
                    pressed_codes.clear()
                    emit(
                        {
                            "type": "ready",
                            "combo": "+".join(normalized_tokens),
                            "devices": [f"{d.path}:{d.name}" for d in devices],
                            "exclusive": bool(args.exclusive),
                        }
                    )
                time.sleep(0.2)
                continue

            try:
                ready, _, _ = select.select(devices, [], [], 0.5)
            except OSError as exc:
                if exc.errno in recoverable_errors:
                    for dev in devices:
                        close_device(dev)
                    devices = []
                    pressed_codes.clear()
                    continue
                raise

            for dev in list(ready):
                try:
                    events = dev.read()
                except OSError as exc:
                    if exc.errno in recoverable_errors:
                        close_device(dev)
                        devices = [active for active in devices if active.path != dev.path]
                        pressed_codes.clear()
                        continue
                    raise

                for event in events:
                    if event.type != ecodes.EV_KEY:
                        continue
                    if event.code not in watched_codes:
                        continue

                    if event.value == 1:
                        pressed_codes.add(event.code)
                    elif event.value == 0:
                        pressed_codes.discard(event.code)
                    else:
                        # 2 == key repeat
                        continue

                    if event.code != key_code or event.value != 1:
                        continue

                    # 所有修饰键组都至少命中一个按键，才触发
                    modifier_matched = all(
                        any(mod_code in pressed_codes for mod_code in group)
                        for group in modifier_groups
                    )
                    if not modifier_matched:
                        continue

                    now = time.monotonic()
                    if now - last_fire_at < debounce_sec:
                        continue
                    last_fire_at = now

                    emit(
                        {
                            "type": "hotkey",
                            "combo": "+".join(normalized_tokens),
                            "device": dev.path,
                            "timestamp": int(time.time() * 1000),
                        }
                    )

            now = time.monotonic()
            if now - last_rescan_at >= rescan_interval_sec:
                last_rescan_at = now
                existing_paths = {d.path for d in devices}
                new_devices = open_keyboard_devices(
                    key_code,
                    exclude_paths=existing_paths,
                    exclusive=args.exclusive,
                )
                if new_devices:
                    devices.extend(new_devices)
                    emit(
                        {
                            "type": "ready",
                            "combo": "+".join(normalized_tokens),
                            "devices": [f"{d.path}:{d.name}" for d in devices],
                            "exclusive": bool(args.exclusive),
                        }
                    )
    finally:
        for dev in devices:
            close_device(dev)
        emit({"type": "stopped"})

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
