"""虚拟 CAN 总线与总线工厂。

真实厂商总线放在各自的适配器包里（zlgcan.bus、cxcan.bus），由
agent.registry 按 devices.json 动态加载；这里只保留 virtual 和 make_bus。
"""

from collections import deque

from agent.interface import CanMessage

__all__ = ["VirtualBus", "make_bus"]


class VirtualBus:
    """调试回环总线：把 UDS 请求帧翻译成正响应帧，供无真机冒烟。

    只理解经典 CAN 单帧请求（负载 <= 7 字节）；多帧请求不响应（返回超时）。
    非生产路径，仅 --device virtual 使用。
    """

    def __init__(self, **kwargs):
        self._queue = deque()
        self._opened = False

    def open(self):
        self._opened = True
        return 0

    def close(self):
        self._queue.clear()
        self._opened = False

    def select_channel(self, channel):
        return 0

    def receive(self, fd=0):
        msgs = []
        while self._queue:
            msgs.append(self._queue.popleft())
        return msgs

    def receive_all(self, fd=0):
        return self.receive(fd)

    def send_channel(self, can_id, data, fd, channel):
        return self.send(can_id, data, fd)

    def send(self, can_id, data, fd=0):
        payload = self._extract_payload(data)
        resp = self._respond(payload) if payload else None
        if resp is not None:
            res_id = can_id + (0x40 if can_id < 0x10000 else 0x8000)
            self._enqueue_response(res_id, resp)
        return 1

    # ---- 内部 ----

    @staticmethod
    def _extract_payload(frame):
        """经典 CAN 单帧请求：PCI(长度) + 负载。非单帧返回 None。"""
        if not frame:
            return None
        pci = frame[0]
        if pci and (pci & 0xF0) == 0x00:
            size = min(pci, len(frame) - 1)
            return list(frame[1:1 + size])
        return None

    def _enqueue_response(self, res_id, resp):
        size = len(resp)
        if size <= 7:
            self._queue.append(CanMessage(can_id=res_id, data=[size] + resp))
            return
        # 首帧 + 连续帧（经典 CAN，负载 6+7 字节/帧）
        first = [0x10 | ((size >> 8) & 0x0F), size & 0xFF] + resp[:6]
        first += [0] * (8 - len(first))
        self._queue.append(CanMessage(can_id=res_id, data=first))
        rest = resp[6:]
        seq = 1
        while rest:
            chunk = rest[:7]
            rest = rest[7:]
            frame = [0x20 | (seq % 16)] + chunk
            frame += [0] * (8 - len(frame))
            self._queue.append(CanMessage(can_id=res_id, data=frame))
            seq += 1

    @staticmethod
    def _respond(payload):
        """按 SID 生成正响应负载；未知 SID -> None（引发超时）。"""
        sid = payload[0]
        if sid == 0x10:                      # 诊断会话
            return [0x50, payload[1]]
        if sid == 0x22:                      # 读 DID
            did = (payload[1] << 8) | payload[2]
            if did == 0xDEAD:                # 特例：负响应，用于演练失败分支
                return [0x7F, 0x22, 0x31]
            return [0x62, payload[1], payload[2], 0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88, 0x99]
        if sid == 0x2E:                      # 写 DID
            return [0x6E, payload[1], payload[2]]
        if sid == 0x19:                      # 读 DTC
            return [0x59, 0x00, 0x00, 0x00, 0x00, 0x00]
        if sid == 0x14:                      # 清 DTC
            return [0x54]
        if sid == 0x11:                      # ECU 复位
            return [0x51, payload[1]]
        if sid == 0x27:                      # 安全访问
            typ = payload[1]
            if typ & 0x01 == 1:              # 种子请求（奇数子功能）：回显 + 4 字节种子
                return [0x67, typ, 0x12, 0x34, 0x56, 0x78]
            return [0x67]                    # 密钥请求（type+1，偶数）
        if sid == 0x3E:                      # Tester Present
            return [0x7E]
        if sid == 0x31:                      # 例程控制
            return [0x71, payload[1], payload[2], payload[3]]
        if sid == 0x28:                      # 通信控制
            return [0x68, payload[1]]
        if sid == 0x85:                      # 控制 DTC 设置
            return [0xC5, payload[1]]
        return None


def make_bus(kind, bitrate=500000, data_bitrate=2000000):
    """按注册表中的设备 id 创建总线。"""
    from agent.registry import create_bus
    return create_bus(kind, bitrate=bitrate, data_bitrate=data_bitrate)
