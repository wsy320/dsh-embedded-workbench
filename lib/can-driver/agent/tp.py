"""ISO-TP 分帧（自包含重写，逻辑参考仓库 can/LibCANTP.py）。

单帧/首帧/连续帧/流控帧的处理语义与原实现对齐，但收发直接走 agent.bus，
无全局状态、无回调线程，同步 request/response 引擎。
"""

import time

__all__ = ["IsoTp"]


class IsoTp:
    """一条 ISO-TP 链路：请求发到 req_id，响应收自 res_id。"""

    def __init__(self, bus, req_id, res_id, fd=0):
        self.bus = bus
        self.req_id = req_id
        self.res_id = res_id
        self.fd = fd
        self.max_len = 64 if fd else 8
        # 最近一次 request 的响应帧 CAN ID（原始值，可能含扩展/标志位）；未收到为 None。
        self.last_resp_id = None

    # ---------------- 发送 ----------------

    def _send(self, can_id, data):
        return self.bus.send(can_id, data, self.fd)

    def _write_single(self, data):
        if self.fd:
            # CANFD 单帧头随 payload 长度变（对齐 flashtool LibCANTP writeSingleFrame）：
            # payload>=8 补 [0,len] 头；<8 用 [len]+payload（无 0 头）
            if len(data) >= 8:
                self._send(self.req_id, [0, len(data)] + data)
            else:
                self._send(self.req_id, [len(data)] + data)
        else:
            # 这块 ECU 要求经典 CAN 单帧固定 8 字节 DLC；只发 3 字节
            # （PCI+2 字节）时它不回响应。
            frame = [len(data)] + data
            frame += [0] * (self.max_len - len(frame))
            self._send(self.req_id, frame)

    def _write_first(self, data):
        self._seq = 0
        n = len(data)
        frame = [0x10 | ((n >> 8) & 0x0F), n & 0xFF] + data[:self.max_len - 2]
        frame += [0] * (self.max_len - len(frame))
        self._send(self.req_id, frame)
        return data[self.max_len - 2:]

    def _write_consecutive(self, data):
        self._seq = (self._seq + 1) % 16
        head = self.max_len - 1
        frame = [0x20 | self._seq] + data[:head]
        frame += [0] * (self.max_len - len(frame))
        self._send(self.req_id, frame)
        return data[head:]

    def _incoming(self):
        """Drain both classic-CAN and CAN-FD queues on the selected channel."""
        frames = []
        for mode in (0, 1):
            try:
                frames.extend(self.bus.receive(mode) or [])
            except Exception:
                # A transport without FD support may raise; classic frames still matter.
                pass
        return frames

    def _wait_flow_control(self, timeout):
        deadline = time.time() + timeout
        while time.time() < deadline:
            for m in self._incoming():
                if m.can_id == self.res_id and m.data and (m.data[0] & 0xF0) == 0x30:
                    return m.data[1], m.data[2]  # bs, stmin
            time.sleep(0.002)
        return None

    def send_request(self, data, fc_timeout=1.0):
        """发送一个完整 TP 报文（可能多帧）。"""
        data = list(data)
        if len(data) < self.max_len - 1:
            self._write_single(data)
            return
        rest = self._write_first(data)
        if not rest:
            return
        fc = self._wait_flow_control(fc_timeout)
        if fc is None:
            raise TimeoutError("ISO-TP flow control timeout")
        bs, stmin = fc
        sent = 0
        while rest:
            rest = self._write_consecutive(rest)
            sent += 1
            if stmin:
                time.sleep(stmin / 10000.0)
            if bs and bs != 0xFF and sent % bs == 0:
                fc = self._wait_flow_control(fc_timeout)
                if fc is None:
                    raise TimeoutError("ISO-TP flow control timeout (block)")
                bs, stmin = fc

    # ---------------- 接收 ----------------

    def _write_flow_ctrl(self, bs=0, stmin=0x14):
        # 流控发回对端（对端在本侧 req_id 上收）
        frame = [0x30, bs, stmin]
        frame += [0] * (self.max_len - len(frame))
        self._send(self.req_id, frame)

    def receive(self, timeout):
        """收一个完整 TP 报文；超时返回 None。"""
        deadline = time.time() + timeout
        pending = None  # [size, buf, last_seq]
        while time.time() < deadline:
            for m in self._incoming():
                d = m.data
                if m.can_id != self.res_id or not d:
                    continue
                self.last_resp_id = m.can_id
                frame_fd = bool(getattr(m, 'fd', 0)) or len(d) > 8
                pci = d[0]
                typ = pci & 0xF0
                if typ == 0x00:                       # 单帧
                    if frame_fd and len(d) > 8:
                        # CANFD 长单帧 = [0, len] + payload（物理 DLC>8，对齐
                        # flashtool readSingleFrame len>8 分支）
                        size = d[1] if len(d) > 1 else 0
                        return list(d[2:2 + size])
                    return list(d[1:1 + pci])
                if typ == 0x10:                       # 首帧
                    size = ((pci & 0x0F) << 8) | d[1]
                    pending = [size, list(d[2:]), 0]
                    self._write_flow_ctrl()
                elif typ == 0x20 and pending is not None:   # 连续帧
                    seq = pci & 0x0F
                    pending[2] = (pending[2] + 1) % 16
                    if seq != pending[2]:
                        pending = None
                        continue
                    pending[1] += list(d[1:])
                    if len(pending[1]) >= pending[0]:
                        return pending[1][:pending[0]]
                elif typ == 0x30:                     # 流控（本方向不期望收到）
                    continue
            time.sleep(0.002)
        return None

    def request(self, payload, p2=0.1, p2_star=5.0, fc_timeout=1.0):
        """请求-响应一对：发送 payload，收完整响应；超时返回 None。

        P2 是首帧响应等待时间（默认 100 ms）；收到 NRC 0x78（响应待处理）
        后改用 P2*（默认 5 s）继续等待，每收到一次 0x78 都重新开始计时。
        """
        self.last_resp_id = None
        self.send_request(payload, fc_timeout)
        resp = self.receive(p2)
        while (resp is not None and len(resp) >= 3
               and resp[0] == 0x7F and resp[2] == 0x78):
            resp = self.receive(p2_star)
        return resp
