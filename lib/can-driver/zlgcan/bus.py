"""ZLG USBCANFD bus wrapper."""

from zlgcan.device import ZlgCanDevice


class ZlgBus:
    """真实 ZLG USBCANFD-200U 总线。"""

    def __init__(self, bitrate=500000, data_bitrate=2000000):
        self.dev = ZlgCanDevice(bitrate, data_bitrate)
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
        return self.dev.send_channel(can_id, data, fd, channel)

    def receive(self, fd=0):
        return self.dev.receive(fd)

    def receive_all(self, fd=0):
        return self.dev.receive_all(fd)

    def select_channel(self, channel):
        return self.dev.select_channel(channel)
