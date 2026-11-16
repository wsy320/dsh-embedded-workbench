#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""zlg-can 技能 CLI：让 AI agent 通过命令行驱动 ZLG CAN 设备（通用 raw CAN + UDS 诊断）。

用法（一次性多命令用 `;` 分隔，整组单进程执行，失败即停）：
    python tool.py -d virtual "set_ids 0x772 0x7B2; uds_session 3; uds_read_did 0xF195"
    python tool.py --req-id 0x772 --res-id 0x7B2 "uds_clear_dtc"

UDS 目标 ECU 的请求/响应 CAN ID 通过 `set_ids <req> [res]` 或
`--req-id/--res-id` 指定（无默认，不绑定设备）。
参数十六进制一律带 0x（十进制亦可）；data 段为逐字节十六进制（可带 0x）。
输出默认 JSON（agent 解析）；-v 输出人类可读文本。
"""

import json
import os
import shlex
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from agent.bus import make_bus            # noqa: E402
from agent.uds import UdsClient           # noqa: E402

VERSION = "0.1.0"

COMMAND_HELP = """命令一览（`;` 分隔连串执行；有命令失败即整批停止）：

全局：
  help                         打印本帮助
  set_ids <req> [res]          设置 UDS 目标请求/响应 CAN ID（res 缺省 = req+0x40）

CAN 原始层：
  can_open                     初始化设备（通常自动，无需显式）
  can_close                    关闭设备
  can_send <can_id> <bytes...>  发送单帧: 如 can_send 0x123 01 02 03
  can_receive [fd]             读接收缓冲并返回帧列表: fd 0=经典 1=CANFD
  can_select_channel <0|1>     切换物理通道 CAN0/CAN1

UDS 诊断（需先 set_ids）：
  uds_session <session>        会话: 1默认 2编程 3扩展 (0x60 其他)
  uds_read_did <did>           读数据标识符
  uds_write_did <did> <bytes...>  写数据标识符（破坏性）
  uds_read_dtc [mask]          读故障码, 默认 mask 0x09
  uds_clear_dtc                清故障码（破坏性）
  uds_ecu_reset <type>         ECU 复位: 0x01硬复位 0x03软复位
  uds_communication_ctrl <sub> [comm_type]  通信控制 0x28
  uds_control_dtc_setting <sub>  控制 DTC 设置 0x85
  uds_routine_control <rtype> <rid> <wait_s> <bytes...>  例程控制 0x31
  uds_tester_present           Tester Present 保活
  uds_request <bytes...>       通用 UDS 请求 [advanced]，任意 SID
"""


# ---------------- 参数解析 ----------------
def parse_int(s):
    """0x 前缀十六进制或十进制。"""
    t = s.strip()
    try:
        return int(t, 0)
    except ValueError:
        return int(t, 10)


def parse_bytes(tokens):
    """逐字节十六进制（可带 0x）。"""
    out = []
    for tok in tokens:
        t = tok.strip()
        if t.lower().startswith("0x"):
            out.append(int(t, 16))
        elif len(t) <= 2 and t.upper().isalnum():
            out.append(int(t, 16))
        else:
            raise ValueError(f"bad byte token: {tok!r}")
    return out


# ---------------- 执行器 ----------------
class Runner:
    def __init__(self, device, req_id, res_id, channel, verbose=False, fd=0):
        self.device = device
        self.req_id = req_id
        self.res_id = res_id
        self.channel = channel
        self.verbose = verbose
        self.fd = fd
        self.bus = None
        self.client = None

    # -- 生命周期 --
    def ensure_bus(self):
        if self.bus is not None:
            return
        bus = make_bus(self.device)
        ret = bus.open()
        if ret != 0:
            bus.close()
            raise RuntimeError(
                f"CAN 设备({self.device})打开失败(ret={ret})：设备未连接、驱动缺失或已被 GUI 占用"
            )
        bus.select_channel(self.channel)
        self.bus = bus
        if self.req_id is not None and self.res_id is not None:
            self.client = UdsClient(bus, self.req_id, self.res_id, fd=self.fd)

    def ensure_uds(self):
        if self.client is None:
            if self.req_id is None or self.res_id is None:
                raise RuntimeError("未设置 UDS 目标 ID：先 set_ids <req> <res> 或用 --req-id/--res-id")
            self.ensure_bus()
            self.client = UdsClient(self.bus, self.req_id, self.res_id, fd=self.fd)
        return self.client

    def close(self):
        if self.bus is not None:
            try:
                self.bus.close()
            finally:
                self.bus = None
                self.client = None

    # -- 单命令 --
    def run_one(self, text):
        try:
            parts = shlex.split(text)
        except ValueError as e:
            return {"ok": False, "error": f"bad args: {e}"}
        if not parts:
            return None
        cmd, args = parts[0], parts[1:]

        if cmd == "help":
            return {"ok": True, "detail": COMMAND_HELP}
        if cmd == "set_ids":
            if not args:
                return {"ok": False, "error": "set_ids 需要请求 ID（可选响应 ID）"}
            req = parse_int(args[0])
            res = parse_int(args[1]) if len(args) > 1 else req + 0x40
            self.ensure_bus()
            self.req_id, self.res_id = req, res
            self.client = UdsClient(self.bus, req, res, fd=self.fd)
            return {"ok": True, "detail": f"uds ids req={hex(req)} res={hex(res)}"}

        # CAN 层
        if cmd == "can_open":
            self.ensure_bus()
            return {"ok": True, "detail": "device open"}
        if cmd == "can_close":
            self.close()
            return {"ok": True, "detail": "device closed"}
        if cmd == "can_select_channel":
            ch = parse_int(args[0]) if args else 0
            self.ensure_bus()
            self.bus.select_channel(ch)
            self.channel = ch
            return {"ok": True, "detail": f"channel {ch}"}
        if cmd == "can_send":
            if len(args) < 2:
                return {"ok": False, "error": "can_send 需要 can_id 和 data"}
            can_id = parse_int(args[0])
            data = parse_bytes(args[1:])
            self.ensure_bus()
            ret = self.bus.send(can_id, data, self.fd)
            return {"ok": ret > 0, "detail": f"sent id={hex(can_id)} n={len(data)} fd={self.fd} ret={ret}"}
        if cmd == "can_receive":
            fd = parse_int(args[0]) if args else self.fd
            self.ensure_bus()
            msgs = self.bus.receive(fd)
            frames = [{"can_id": m.can_id, "data": " ".join(f"{b:02X}" for b in m.data), "fd": m.fd}
                      for m in msgs]
            return {"ok": True, "frames": frames, "count": len(frames)}

        # UDS 层
        if cmd.startswith("uds_"):
            return self.run_uds(cmd, args)

        return {"ok": False, "error": f"未知命令 {cmd!r}（help 看列表）"}

    def run_uds(self, cmd, args):
        client = self.ensure_uds()
        try:
            if cmd == "uds_session":
                res = client.session(parse_int(args[0]))
            elif cmd == "uds_read_did":
                res = client.read_did(parse_int(args[0]))
            elif cmd == "uds_write_did":
                if len(args) < 2:
                    return {"ok": False, "error": "uds_write_did 需要 did 和 payload"}
                res = client.write_did(parse_int(args[0]), parse_bytes(args[1:]))
            elif cmd == "uds_read_dtc":
                res = client.read_dtc(parse_int(args[0]) if args else 0x09)
            elif cmd == "uds_clear_dtc":
                res = client.clear_dtc()
            elif cmd == "uds_ecu_reset":
                res = client.ecu_reset(parse_int(args[0]))
            elif cmd == "uds_communication_ctrl":
                res = client.communication_control(parse_int(args[0]),
                                                   parse_int(args[1]) if len(args) > 1 else 0x01)
            elif cmd == "uds_control_dtc_setting":
                res = client.control_dtc_setting(parse_int(args[0]))
            elif cmd == "uds_routine_control":
                if len(args) < 4:
                    return {"ok": False, "error": "uds_routine_control 需要 rtype rid wait_s data..."}
                res = client.routine_control(parse_int(args[0]), parse_int(args[1]),
                                             parse_bytes(args[3:]), float(args[2]))
            elif cmd == "uds_tester_present":
                res = client.tester_present()
            elif cmd == "uds_request":
                if not args:
                    return {"ok": False, "error": "uds_request 需要请求字节"}
                res = client.raw_request(parse_bytes(args))
            else:
                return {"ok": False, "error": f"未知 UDS 命令 {cmd!r}"}
        except (ValueError, IndexError, TypeError) as e:
            return {"ok": False, "error": f"参数错误: {e}"}
        except Exception as e:
            return {"ok": False, "error": f"{type(e).__name__}: {e}"}

        out = {"ok": res["ok"], "error": res["error"]}
        out["response"] = " ".join(f"{b:02X}" for b in res.get("response", []))
        if res.get("detail"):
            out["detail"] = res["detail"]
        return out

    # -- 批量 --
    def run_all(self, segments):
        results = []
        overall = True
        for seg in segments:
            one = self.run_one(seg)
            if one is None:
                continue
            results.append(one)
            if not one["ok"]:
                overall = False
                break  # 失败即整批停止
        return {"ok": overall, "commands": results}


def _strip_inline_device(segments, flag_device):
    """`device <type>` 允许作为第一条命令；有 -d 标志时以标志为准。"""
    if not segments:
        return segments, flag_device
    parts = shlex.split(segments[0])
    if parts and parts[0] == "device" and len(parts) > 1:
        if flag_device is None:
            flag_device = parts[1]
        segments = segments[1:]  # 吃掉该条
    return segments, flag_device


def main(argv=None):
    import argparse
    from agent.registry import device_ids
    p = argparse.ArgumentParser(prog="zlg-can", description="CAN / UDS 通用诊断工具")
    p.add_argument("-d", "--device", choices=device_ids() or ["zlg", "virtual"], default=None,
                   help="设备类型（默认 zlg，virtual 为演练回环）")
    p.add_argument("--req-id", default=None, help="UDS 请求 CAN ID（如 0x772）")
    p.add_argument("--res-id", default=None, help="UDS 响应 CAN ID（如 0x7B2，缺省 = req+0x40）")
    p.add_argument("-c", "--channel", type=int, default=0, help="物理通道 0/1（默认 0）")
    p.add_argument("-f", "--fd", type=int, default=0, choices=[0, 1],
                   help="帧类型：0 经典 CAN（默认）/ 1 CANFD")
    p.add_argument("-v", "--verbose", action="store_true", help="人类可读输出")
    p.add_argument("commands", nargs="*", help="命令串，`;` 分隔连串执行")
    args = p.parse_args(argv)

    segments = []
    for c in args.commands:
        segments.extend([s.strip() for s in c.split(";") if s.strip()])
    segments, device = _strip_inline_device(segments, args.device)

    if not segments:
        print(COMMAND_HELP)
        return 0

    device = device or "zlg"
    req_id = parse_int(args.req_id) if args.req_id else None
    res_id = parse_int(args.res_id) if args.res_id else (None if req_id is None else req_id + 0x40)

    runner = Runner(device, req_id, res_id, args.channel, verbose=args.verbose, fd=args.fd)
    try:
        result = runner.run_all(segments)
    except Exception as e:  # 设备级致命错误
        result = {"ok": False, "commands": [], "error": f"{type(e).__name__}: {e}"}
    finally:
        runner.close()

    if args.verbose:
        print(f"# zlg-can v{VERSION}  device={device} channel={args.channel} fd={args.fd}")
        for i, one in enumerate(result.get("commands", [])):
            mark = "OK" if one["ok"] else "FAIL"
            line = f"[{i}] {mark}  {one.get('error') or one.get('response') or one.get('detail') or ''}"
            print(line)
        print("RESULT:", "OK" if result["ok"] else "FAILED")
    else:
        print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
