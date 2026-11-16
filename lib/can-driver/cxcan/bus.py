"""CXCAN FD bus wrapper."""

from cxcan.device import CxCanDevice


class CxCanBus:
    """CXCAN FD 总线（ControlCANFD.dll）。"""

    def __init__(self, bitrate=500000, data_bitrate=2000000):
        self.dev = CxCanDevice(bitrate, data_bitrate)
        self.opened = False

    def open(self):
        ret = self.dev.init()
        self.opened = ret == 0
        return ret

    def close(self):
        if self.opened:
            self.dev.deinit()
        self.opened = False

    def send(self, can_id, data, fd=0):
        return self.dev.send(can_id, data, fd)

    def send_channel(self, can_id, data, fd, channel):
        self.dev.select_channel(channel)
        return self.dev.send(can_id, data, fd)

    def receive(self, fd=0):
        return self.dev.receive(fd)

    def receive_all(self, fd=0):
        current = self.dev.channel_index
        result = []
        for channel in (0, 1):
            self.dev.select_channel(channel)
            result.extend(self.dev.receive(fd))
        self.dev.select_channel(current)
        return result

    def select_channel(self, channel):
        return self.dev.select_channel(channel)
