"""
CXCAN FD device implementation.
Based on the example code from D:\\share\\python(x64)_example_python3.8.8_v2.0
"""
import sys
import os
import time
import threading
from ctypes import *
from datetime import datetime

from agent.interface import CanDevice, CanMessage, get_fd_len
from agent.vendor_dll import load_vendor_dll
from cxcan.structs import *


def _load_cxcan_lib():
    """Load ControlCANFD.dll through the shared vendor-DLL resolver."""
    return load_vendor_dll(
        "cxcan", __file__, {"win32": "ControlCANFD.dll"},
        env_var="EWB_CXCAN_DLL_DIR", legacy_attr="_cxcan_dll_dir",
        loader=windll, hint="ControlCANFD.dll 来自 CXCAN / 创芯科技官方驱动包。",
    )


class CxCanDevice(CanDevice):
    """CXCAN FD CAN device implementation."""

    VERSION = "2.0"

    def __init__(self, abit_baud=500000, dbit_baud=2000000):
        super().__init__()
        self.lib = _load_cxcan_lib()
        self.abit_baud = int(abit_baud)
        self.dbit_baud = int(dbit_baud)

        # 定义函数返回类型和参数类型
        self.lib.ZCAN_OpenDevice.restype = c_void_p
        self.lib.ZCAN_OpenDevice.argtypes = [c_uint, c_uint, c_uint]
        self.lib.ZCAN_SetAbitBaud.restype = c_uint
        self.lib.ZCAN_SetAbitBaud.argtypes = [c_void_p, c_ulong, c_ulong]
        self.lib.ZCAN_SetDbitBaud.restype = c_uint
        self.lib.ZCAN_SetDbitBaud.argtypes = [c_void_p, c_ulong, c_ulong]
        self.lib.ZCAN_SetCANFDStandard.restype = c_uint
        self.lib.ZCAN_SetCANFDStandard.argtypes = [c_void_p, c_ulong, c_ulong]
        self.lib.ZCAN_InitCAN.restype = c_void_p
        self.lib.ZCAN_InitCAN.argtypes = [c_void_p, c_ulong, c_void_p]
        self.lib.ZCAN_StartCAN.restype = c_uint
        self.lib.ZCAN_StartCAN.argtypes = [c_void_p]
        self.lib.ZCAN_Transmit.restype = c_uint
        self.lib.ZCAN_Transmit.argtypes = [c_void_p, c_void_p, c_ulong]
        self.lib.ZCAN_TransmitFD.restype = c_uint
        self.lib.ZCAN_TransmitFD.argtypes = [c_void_p, c_void_p, c_ulong]
        self.lib.ZCAN_GetReceiveNum.restype = c_uint
        self.lib.ZCAN_GetReceiveNum.argtypes = [c_void_p, c_ulong]
        self.lib.ZCAN_Receive.restype = c_uint
        self.lib.ZCAN_Receive.argtypes = [c_void_p, c_void_p, c_ulong, c_long]
        self.lib.ZCAN_ReceiveFD.restype = c_uint
        self.lib.ZCAN_ReceiveFD.argtypes = [c_void_p, c_void_p, c_ulong, c_long]
        self.lib.ZCAN_ResetCAN.restype = c_uint
        self.lib.ZCAN_ResetCAN.argtypes = [c_void_p]
        self.lib.ZCAN_CloseDevice.restype = c_uint
        self.lib.ZCAN_CloseDevice.argtypes = [c_void_p]

        self.device_type = VCI_USBCAN2
        self.device_index = 0
        self.channel_index = 0

        self._version = self.VERSION
        self.handle = 0
        self.channel_handle = 0
        self.can0_handle = 0
        self.can1_handle = 0

    # --- Internal helpers ---

    def _canfd_start(self, channel):
        """Initialize CAN FD channel."""
        # 设置通道仲裁域波特率
        ret = self.lib.ZCAN_SetAbitBaud(self.handle, channel, self.abit_baud)
        if ret != STATUS_OK:
            print(f"Set CAN{channel} abit={self.abit_baud} failed!")
            return 0

        # 设置通道数据域波特率
        ret = self.lib.ZCAN_SetDbitBaud(self.handle, channel, self.dbit_baud)
        if ret != STATUS_OK:
            print(f"Set CAN{channel} dbit={self.dbit_baud} failed!")
            return 0

        # 设置通道 FD Mode: ISO
        ret = self.lib.ZCAN_SetCANFDStandard(self.handle, channel, 0)
        if ret != STATUS_OK:
            print(f"Set CAN{channel} ISO mode failed!")
            return 0

        # 初始化通道
        init_config = ZCAN_CHANNEL_INIT_CONFIG()
        init_config.can_type = TYPE_CANFD
        init_config.config.canfd.mode = 0

        chn_handle = self.lib.ZCAN_InitCAN(self.handle, channel, byref(init_config))
        if not chn_handle:
            print(f"Init CAN{channel} failed!")
            return 0

        # 启动通道
        ret = self.lib.ZCAN_StartCAN(chn_handle)
        if ret != STATUS_OK:
            print(f"Start CAN{channel} failed!")
            return 0

        return chn_handle

    def _fill_tx_msg(self, msg, can_id, data, fd):
        """填充单条发送消息。"""
        msg.transmit_type = 0  # 0=正常发送
        msg.frame.rtr = 0
        msg.frame.can_id = can_id
        msg.frame.eff = 0 if can_id <= 0x7FF else 1
        if fd == 0:
            msg.frame.can_dlc = 8
        else:
            msg.frame.brs = 1  # BRS
            msg.frame.len = get_fd_len(len(data))
            if fd == 2 and len(data) <= 8:
                msg.frame.len = 8
        for i, val in enumerate(data):
            msg.frame.data[i] = val

    def _build_tx_array(self, can_id, frames, fd):
        msg_type = ZCAN_Transmit_Data if fd == 0 else ZCAN_TransmitFD_Data
        msgs = (msg_type * len(frames))()
        for i, data in enumerate(frames):
            self._fill_tx_msg(msgs[i], can_id, data, fd)
        return msgs

    def _build_tx_msg(self, can_id, data, fd):
        """Build transmit message structure."""
        return self._build_tx_array(can_id, [data], fd)

    def _transmit(self, msg, fd):
        """Transmit message."""
        if fd == 0:
            return self.lib.ZCAN_Transmit(self.channel_handle, byref(msg), 1)
        else:
            return self.lib.ZCAN_TransmitFD(self.channel_handle, byref(msg), 1)

    def _transmit_many(self, msgs, fd, count):
        if fd == 0:
            return self.lib.ZCAN_Transmit(self.channel_handle, byref(msgs), count)
        else:
            return self.lib.ZCAN_TransmitFD(self.channel_handle, byref(msgs), count)

    # --- CanDevice interface ---

    def init(self):
        # 打开设备
        self.handle = self.lib.ZCAN_OpenDevice(self.device_type, 0, 0)
        if not self.handle:
            print("Open CXCAN Device failed!")
            return 1
        print(f"Open CXCAN Device OK, device handle: 0x{self.handle:x}.")

        # 初始化通道0
        self.can0_handle = self._canfd_start(0)
        if self.can0_handle == 0:
            print("CAN0 start failed!")
            return 1

        # 初始化通道1
        self.can1_handle = self._canfd_start(1)
        if self.can1_handle == 0:
            print("CAN1 start failed!")
            return 1

        print(f"CXCAN handles: can0={self.can0_handle}, can1={self.can1_handle}")
        return 0

    def deinit(self):
        # 停止通道
        self.lib.ZCAN_ResetCAN(self.can0_handle)
        self.lib.ZCAN_ResetCAN(self.can1_handle)
        # 关闭设备
        self.lib.ZCAN_CloseDevice(self.handle)

    def send(self, can_id, data, fd=0):
        msg = self._build_tx_msg(can_id, data, fd)
        ret = self._transmit(msg, fd)
        return ret

    def send_many(self, can_id, frames, fd=0):
        if not frames:
            return 0
        msgs = self._build_tx_array(can_id, frames, fd)
        return self._transmit_many(msgs, fd, len(frames))

    def receive(self, fd=0, wait_ms=0):
        if fd == 0:
            ret1 = self.lib.ZCAN_GetReceiveNum(self.channel_handle, TYPE_CAN)
        else:
            ret1 = self.lib.ZCAN_GetReceiveNum(self.channel_handle, TYPE_CANFD)

        block = False
        if not ret1:
            if wait_ms <= 0:
                return []
            ret1 = 1
            block = True

        timeout = wait_ms if block else 2000
        if fd == 0:
            raw_msgs = (ZCAN_Receive_Data * ret1)()
            count = self.lib.ZCAN_Receive(self.channel_handle, byref(raw_msgs), ret1, timeout)
        else:
            raw_msgs = (ZCAN_ReceiveFD_Data * ret1)()
            count = self.lib.ZCAN_ReceiveFD(self.channel_handle, byref(raw_msgs), ret1, timeout)

        result = []

        for i in range(count):
            can_id = raw_msgs[i].frame.can_id
            if fd == 0:
                dlen = raw_msgs[i].frame.can_dlc
            else:
                dlen = raw_msgs[i].frame.len
            data = [raw_msgs[i].frame.data[j] for j in range(dlen)]

            msg = CanMessage(can_id=can_id, data=data, fd=fd, channel=self.channel_index)
            result.append(msg)

        return result

    def select_channel(self, channel):
        self.channel_index = channel
        if channel == 0:
            self.channel_handle = self.can0_handle
        elif channel == 1:
            self.channel_handle = self.can1_handle
        return 0 if self.channel_handle else 1
