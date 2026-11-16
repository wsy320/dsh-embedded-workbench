import sys
import os
import time
import atexit
import threading
from ctypes import *
from datetime import datetime

from zlgcan.structs import *
from agent.interface import CanDevice, CanMessage
from agent.vendor_dll import load_vendor_dll


def _sink_dll_stdout():
    """zlgcan.dll 在进程退出时才把 `usbcanfd-200u m_hWnd = ...` flush 到 stdout，
    会污染 `python tool.py > out.json` 的整段输出。设备成功打开后注册此钩子：
    退出时把 fd1 重定向到 stderr，使 DLL 的退出打印进 stderr 而非 stdout 文件。

    只在设备成功 init 时注册一次（全局 guard），纯 import / 未开设备不触发。
    已在 CLI 层自行处理（如 gwm-radar-flash flash.py 的 _emit）的调用方不受影响
    ——二次重定向是幂等的。
    """
    try:
        os.dup2(sys.stderr.fileno(), sys.stdout.fileno())
    except Exception:
        pass


def _ensure_dll_stdout_sink():
    if not getattr(_ensure_dll_stdout_sink, "_registered", False):
        _ensure_dll_stdout_sink._registered = True
        atexit.register(_sink_dll_stdout)


def GetIProperty(dll, device_handle):
    dll.GetIProperty.restype = POINTER(IProperty)
    return dll.GetIProperty(device_handle)


def SetValue(iproperty, path, value):
    func = CFUNCTYPE(c_uint, c_char_p, c_char_p)(iproperty.contents.SetValue)
    return func(c_char_p(path.encode("utf-8")), c_char_p(value.encode("utf-8")))


def GetValue(iproperty, path):
    func = CFUNCTYPE(c_char_p, c_char_p)(iproperty.contents.GetValue)
    return func(c_char_p(path.encode("utf-8")))


def _load_zlg_lib():
    """Load zlgcan.dll / libusbcanfd.so through the shared vendor-DLL resolver."""
    return load_vendor_dll(
        "zlg", __file__, {"win32": "zlgcan.dll", "linux": "libusbcanfd.so"},
        env_var="EWB_ZLG_DLL_DIR", legacy_attr="_zlg_dll_dir",
        loader=cdll, hint="zlgcan.dll 与 kerneldlls/ 必须同级保留。",
    )


class ZlgCanDevice(CanDevice):
    """ZLG USBCANFD-200U CAN device implementation."""

    VERSION = "1.03"

    def __init__(self, abit_baud=500000, dbit_baud=2000000):
        super().__init__()
        self.lib = _load_zlg_lib()
        self.abit_baud = int(abit_baud)
        self.dbit_baud = int(dbit_baud)

        if sys.platform == 'win32':
            self.device_type = ZCAN_DEVICE_TYPE(41)
        elif sys.platform.startswith('linux'):
            self.device_type = ZCAN_DEVICE_TYPE(33)

        self.device_index = ZCAN_DEVICE_INDEX(0)
        self.channel_index = 0
        self.reserved = ZCAN_Reserved(0)

        self._version = self.VERSION
        self.handle = 0
        self.channel_handle = 0
        self.can0_handle = 0
        self.can1_handle = 0

    # --- Internal helpers ---

    def _canfd_start(self, dev_type, device_index, channel):
        Res = Resistance()
        Res.res = RES_ON
        if sys.platform == 'win32':
            ip = GetIProperty(self.lib, self.handle)
            ret = SetValue(ip, str(channel) + "/canfd_standard", "0")
            if ret != ZCAN_STATUS_OK:
                print("Set CANFD standard failed!", file=sys.stderr)
                return 0
            ret = SetValue(ip, str(channel) + "/initenal_resistance", "1")
            if ret != ZCAN_STATUS_OK:
                print("Open resistance failed!", file=sys.stderr)
                return 0
            ret = SetValue(ip, str(channel) + "/canfd_abit_baud_rate", str(self.abit_baud))
            if ret != ZCAN_STATUS_OK:
                print("Set arbitration baud failed!", file=sys.stderr)
                return 0
            ret = SetValue(ip, str(channel) + "/canfd_dbit_baud_rate", str(self.dbit_baud))
            if ret != ZCAN_STATUS_OK:
                print("Set data baud failed!", file=sys.stderr)
                return 0

            chn_init_cfg = ZCAN_CHANNEL_INIT_CONFIG()
            chn_init_cfg.can_type = ZCAN_TYPE_CANFD
            chn_init_cfg.config.canfd.mode = 0
            chn_handle = self.lib.ZCAN_InitCAN(self.handle, channel, chn_init_cfg)
            if chn_handle is None:
                return 0
            self.lib.ZCAN_StartCAN(chn_handle)
            return chn_handle

        elif sys.platform.startswith('linux'):
            self.lib.VCI_SetReference(dev_type, device_index, channel, CAN_TRES, byref(Res))
            if self._version == "1.03":
                canfd_init = ZCANFD_INIT()
                canfd_init.clk = 90000000
                canfd_init.mode = 0
                canfd_init.abit.tseg1 = 70
                canfd_init.abit.tseg2 = 17
                canfd_init.abit.sjw = 3
                canfd_init.abit.smp = 0
                canfd_init.abit.brp = 1
                canfd_init.dbit.tseg1 = 10
                canfd_init.dbit.tseg2 = 2
                canfd_init.dbit.sjw = 2
                canfd_init.dbit.smp = 0
                canfd_init.dbit.brp = 2
            elif self._version == "1.01":
                canfd_init = ZCANFD_INIT()
                canfd_init.clk = 60000000
                canfd_init.mode = 0
                canfd_init.abit.tseg1 = 14
                canfd_init.abit.tseg2 = 3
                canfd_init.abit.sjw = 3
                canfd_init.abit.smp = 0
                canfd_init.abit.brp = 5
                canfd_init.dbit.tseg1 = 9
                canfd_init.dbit.tseg2 = 3
                canfd_init.dbit.sjw = 2
                canfd_init.dbit.smp = 0
                canfd_init.dbit.brp = 1

            ret = self.lib.VCI_InitCAN(dev_type, device_index, channel, byref(canfd_init))
            if ret != 0:
                self.lib.VCI_StartCAN(dev_type, device_index, channel)
            return ret

    def _build_tx_msg(self, can_id, data, fd):
        if sys.platform == 'win32':
            if fd == 0:
                msg = (ZCAN_Transmit_Data * 1)()
                msg[0].transmit_type = 0
                msg[0].frame.rtr = 0
                msg[0].frame.len = len(data)
                msg[0].frame.can_id = can_id
            else:
                msg = (ZCAN_TransmitFD_Data * 1)()
                msg[0].transmit_type = 0
                msg[0].frame.rtr = 0
                msg[0].frame.brs = 0
                msg[0].frame.can_id = can_id
                msg[0].frame.len = self._get_fd_len(len(data))
                if fd == 2 and len(data) <= 8:
                    msg[0].frame.len = 8
            if can_id <= 0x7FF:
                msg[0].frame.eff = 0
            else:
                msg[0].frame.eff = 1
            for i, val in enumerate(data):
                msg[0].frame.data[i] = val

        elif sys.platform.startswith('linux'):
            if fd == 0:
                msg = (ZCAN_20_MSG * 1)()
                msg[0].msg_header.ts = 0
                msg[0].msg_header.info.txm = 0
                msg[0].msg_header.info.sdf = 0
                msg[0].msg_header.info.sef = 0
                msg[0].msg_header.info.err = 0
                msg[0].msg_header.info.est = 0
                msg[0].msg_header.pad = 0
                msg[0].msg_header.chn = 0
                msg[0].msg_header.len = len(data)
                msg[0].msg_header.id = can_id
            else:
                msg = (ZCAN_FD_MSG * 1)()
                msg[0].msg_header.ts = 0
                msg[0].msg_header.id = can_id
                msg[0].msg_header.info.txm = 0
                msg[0].msg_header.info.fmt = 1
                msg[0].msg_header.info.sdf = 0
                msg[0].msg_header.info.sef = 1
                msg[0].msg_header.info.err = 0
                msg[0].msg_header.info.brs = 0
                msg[0].msg_header.info.est = 0
                msg[0].msg_header.pad = 0
                msg[0].msg_header.chn = 0
                msg[0].msg_header.len = self._get_fd_len(len(data))
                if fd == 2 and len(data) <= 8:
                    msg[0].msg_header.len = 8

            if can_id <= 0x7FF:
                msg[0].msg_header.info.sef = 0
            else:
                msg[0].msg_header.info.sef = 1

            for i, val in enumerate(data):
                msg[0].dat[i] = val

        return msg

    def _transmit(self, msg, fd):
        if sys.platform == 'win32':
            if fd == 0:
                return self.lib.ZCAN_Transmit(self.channel_handle, byref(msg), 1)
            else:
                return self.lib.ZCAN_TransmitFD(self.channel_handle, byref(msg), 1)
        elif sys.platform.startswith('linux'):
            if fd == 0:
                return self.lib.VCI_Transmit(self.device_type, self.device_index,
                                             self.channel_index, byref(msg), 1)
            else:
                return self.lib.VCI_TransmitFD(self.device_type, self.device_index,
                                               self.channel_index, byref(msg), 1)

    @staticmethod
    def _get_fd_len(length):
        if length <= 8:
            return length
        elif 8 < length <= 12:
            return 12
        elif 12 < length <= 16:
            return 16
        elif 16 < length <= 20:
            return 20
        elif 20 < length <= 24:
            return 24
        elif 24 < length <= 32:
            return 32
        elif 32 < length <= 48:
            return 48
        elif 48 < length <= 64:
            return 64

    # --- CanDevice interface ---

    def init(self):
        if sys.platform == 'win32':
            self.handle = self.lib.ZCAN_OpenDevice(self.device_type, 0, 0)
            print("device handle:%d." % self.handle, file=sys.stderr)
        elif sys.platform.startswith('linux'):
            self.lib.VCI_OpenDevice(self.device_type, self.device_index, self.reserved)

        self.can0_handle = self._canfd_start(self.device_type, self.device_index, 0)
        self.can1_handle = self._canfd_start(self.device_type, self.device_index, 1)
        print("can0_handle:%d,can1_handle:%d." % (self.can0_handle, self.can1_handle), file=sys.stderr)
        if self.can0_handle == 0 or self.can1_handle == 0:
            print("canfd start failed!", file=sys.stderr)
            return 1
        _ensure_dll_stdout_sink()
        return 0

    def deinit(self):
        if sys.platform == 'win32':
            self.lib.ZCAN_ResetCAN(self.can0_handle)
            self.lib.ZCAN_ResetCAN(self.can1_handle)
            self.lib.ZCAN_CloseDevice(self.handle)
        elif sys.platform.startswith('linux'):
            self.lib.VCI_ResetCAN(self.device_type, self.device_index, 0)
            self.lib.VCI_ResetCAN(self.device_type, self.device_index, 1)
            self.lib.VCI_CloseDevice(self.device_type, self.device_index)

    def send(self, can_id, data, fd=0):
        msg = self._build_tx_msg(can_id, data, fd)
        ret = self._transmit(msg, fd)
        return ret

    def send_channel(self, can_id, data, fd, channel):
        self.select_channel(channel)
        return self.send(can_id, data, fd)

    def receive_channel(self, channel, fd=0):
        handle = self.can0_handle if channel == 0 else self.can1_handle
        if not handle:
            return []
        channelfd = 0x80000000 | channel
        if sys.platform == 'win32':
            if fd == 0:
                ret1 = self.lib.ZCAN_GetReceiveNum(handle, ZCAN_TYPE_CAN)
            else:
                ret1 = self.lib.ZCAN_GetReceiveNum(handle, ZCAN_TYPE_CANFD)
        elif sys.platform.startswith('linux'):
            if fd == 0:
                ret1 = self.lib.VCI_GetReceiveNum(self.device_type, self.device_index, channel)
            else:
                ret1 = self.lib.VCI_GetReceiveNum(self.device_type, self.device_index, channelfd)

        if not ret1:
            return []

        if sys.platform == 'win32':
            if fd == 0:
                raw_msgs = (ZCAN_Receive_Data * ret1)()
                count = self.lib.ZCAN_Receive(handle, byref(raw_msgs), ret1, 2000)
            else:
                raw_msgs = (ZCAN_ReceiveFD_Data * ret1)()
                count = self.lib.ZCAN_ReceiveFD(handle, byref(raw_msgs), ret1, 2000)
        elif sys.platform.startswith('linux'):
            if fd == 0:
                raw_msgs = (ZCAN_20_MSG * ret1)()
                count = self.lib.VCI_Receive(self.device_type, self.device_index,
                                             channel, byref(raw_msgs), ret1, 2000)
            else:
                raw_msgs = (ZCAN_FD_MSG * ret1)()
                count = self.lib.VCI_ReceiveFD(self.device_type, self.device_index,
                                               channel, byref(raw_msgs), ret1, 2000)

        result = []

        for i in range(count):
            if sys.platform == 'win32':
                can_id = raw_msgs[i].frame.can_id
                dlen = raw_msgs[i].frame.len
                data = [raw_msgs[i].frame.data[j] for j in range(dlen)]
            elif sys.platform.startswith('linux'):
                can_id = raw_msgs[i].msg_header.id
                dlen = raw_msgs[i].msg_header.len
                data = [raw_msgs[i].dat[j] for j in range(dlen)]

            stamp = getattr(raw_msgs[i], 'timestamp', None)
            if stamp is None and hasattr(raw_msgs[i], 'msg_header'):
                stamp = raw_msgs[i].msg_header.ts
            msg = CanMessage(can_id=can_id, data=data, fd=fd, timestamp=stamp, channel=channel)
            result.append(msg)

        return result

    def receive(self, fd=0):
        return self.receive_channel(self.channel_index, fd)

    def receive_all(self, fd=0):
        result = []
        for channel in (0, 1):
            result.extend(self.receive_channel(channel, fd))
        result.sort(key=lambda msg: msg.timestamp or 0)
        return result

    def select_channel(self, channel):
        self.channel_index = channel
        if channel == 0:
            self.channel_handle = self.can0_handle
        elif channel == 1:
            self.channel_handle = self.can1_handle
        return 0 if self.channel_handle else 1
