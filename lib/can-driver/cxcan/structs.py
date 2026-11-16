"""
CXCAN FD device structures (compatible with ZLG CAN FD but different DLL).
"""
from ctypes import *


# Device type
VCI_USBCAN2 = 41

# Status
STATUS_OK = 1
INVALID_DEVICE_HANDLE = 0
INVALID_CHANNEL_HANDLE = 0

# CAN type
TYPE_CAN = 0
TYPE_CANFD = 1


# --- Structures ---

class VCI_INIT_CONFIG(Structure):
    _fields_ = [
        ("AccCode", c_uint),
        ("AccMask", c_uint),
        ("Reserved", c_uint),
        ("Filter", c_ubyte),
        ("Timing0", c_ubyte),
        ("Timing1", c_ubyte),
        ("Mode", c_ubyte)
    ]


class VCI_CAN_OBJ(Structure):
    _fields_ = [
        ("ID", c_uint),
        ("TimeStamp", c_uint),
        ("TimeFlag", c_ubyte),
        ("SendType", c_ubyte),
        ("RemoteFlag", c_ubyte),
        ("ExternFlag", c_ubyte),
        ("DataLen", c_ubyte),
        ("Data", c_ubyte * 8),
        ("Reserved", c_ubyte * 3)
    ]


class _ZCAN_CHANNEL_CAN_INIT_CONFIG(Structure):
    _fields_ = [
        ("acc_code", c_uint),
        ("acc_mask", c_uint),
        ("reserved", c_uint),
        ("filter", c_ubyte),
        ("timing0", c_ubyte),
        ("timing1", c_ubyte),
        ("mode", c_ubyte)
    ]


class _ZCAN_CHANNEL_CANFD_INIT_CONFIG(Structure):
    _fields_ = [
        ("acc_code", c_uint),
        ("acc_mask", c_uint),
        ("abit_timing", c_uint),
        ("dbit_timing", c_uint),
        ("brp", c_uint),
        ("filter", c_ubyte),
        ("mode", c_ubyte),
        ("pad", c_ushort),
        ("reserved", c_uint)
    ]


class _ZCAN_CHANNEL_INIT_CONFIG(Union):
    _fields_ = [
        ("can", _ZCAN_CHANNEL_CAN_INIT_CONFIG),
        ("canfd", _ZCAN_CHANNEL_CANFD_INIT_CONFIG)
    ]


class ZCAN_CHANNEL_INIT_CONFIG(Structure):
    _fields_ = [
        ("can_type", c_uint),
        ("config", _ZCAN_CHANNEL_INIT_CONFIG)
    ]


class ZCAN_CAN_FRAME(Structure):
    _fields_ = [
        ("can_id", c_uint, 29),
        ("err", c_uint, 1),
        ("rtr", c_uint, 1),
        ("eff", c_uint, 1),
        ("can_dlc", c_ubyte),
        ("__pad", c_ubyte),
        ("__res0", c_ubyte),
        ("__res1", c_ubyte),
        ("data", c_ubyte * 8)
    ]


class ZCAN_CANFD_FRAME(Structure):
    _fields_ = [
        ("can_id", c_uint, 29),
        ("err", c_uint, 1),
        ("rtr", c_uint, 1),
        ("eff", c_uint, 1),
        ("len", c_ubyte),
        ("brs", c_ubyte, 1),
        ("esi", c_ubyte, 1),
        ("__res", c_ubyte, 6),
        ("__res0", c_ubyte),
        ("__res1", c_ubyte),
        ("data", c_ubyte * 64)
    ]


class ZCAN_Transmit_Data(Structure):
    _fields_ = [
        ("frame", ZCAN_CAN_FRAME),
        ("transmit_type", c_uint)
    ]


class ZCAN_Receive_Data(Structure):
    _fields_ = [
        ("frame", ZCAN_CAN_FRAME),
        ("timestamp", c_ulonglong)
    ]


class ZCAN_TransmitFD_Data(Structure):
    _fields_ = [
        ("frame", ZCAN_CANFD_FRAME),
        ("transmit_type", c_uint)
    ]


class ZCAN_ReceiveFD_Data(Structure):
    _fields_ = [
        ("frame", ZCAN_CANFD_FRAME),
        ("timestamp", c_ulonglong)
    ]
