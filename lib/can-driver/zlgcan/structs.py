from ctypes import *

ZCAN_DEVICE_TYPE = c_uint32
ZCAN_DEVICE_INDEX = c_uint32
ZCAN_CHANNEL = c_uint32
ZCAN_Reserved = c_uint32
RES_ON = 1
RES_OFF = 0
CAN_TRES = 0x18

ZCAN_STATUS_ERR = 0
ZCAN_STATUS_OK = 1
ZCAN_STATUS_ONLINE = 2
ZCAN_STATUS_OFFLINE = 3
ZCAN_STATUS_UNSUPPORTED = 4

ZCAN_TYPE_CAN = c_uint(0)
ZCAN_TYPE_CANFD = c_uint(1)


class ZCAN_MSG_INFO(Structure):
    _fields_ = [("txm", c_uint, 4),
                ("fmt", c_uint, 4),
                ("sdf", c_uint, 1),
                ("sef", c_uint, 1),
                ("err", c_uint, 1),
                ("brs", c_uint, 1),
                ("est", c_uint, 1),
                ("pad", c_uint, 19)]


class ZCAN_MSG_HDR(Structure):
    _fields_ = [("ts", c_uint32),
                ("id", c_uint32),
                ("info", ZCAN_MSG_INFO),
                ("pad", c_uint16),
                ("chn", c_uint8),
                ("len", c_uint8)]


class ZCAN_20_MSG(Structure):
    _fields_ = [("msg_header", ZCAN_MSG_HDR),
                ("dat", c_ubyte * 8)]


class ZCAN_FD_MSG(Structure):
    _fields_ = [("msg_header", ZCAN_MSG_HDR),
                ("dat", c_ubyte * 64)]


class ZCAN_CAN_FRAME(Structure):
    _fields_ = [("can_id", c_uint, 29),
                ("err", c_uint, 1),
                ("rtr", c_uint, 1),
                ("eff", c_uint, 1),
                ("len", c_ubyte),
                ("__pad", c_ubyte),
                ("__res0", c_ubyte),
                ("__res1", c_ubyte),
                ("data", c_ubyte * 8)]


class ZCAN_CANFD_FRAME(Structure):
    _fields_ = [("can_id", c_uint, 29),
                ("err", c_uint, 1),
                ("rtr", c_uint, 1),
                ("eff", c_uint, 1),
                ("len", c_ubyte),
                ("brs", c_ubyte, 1),
                ("esi", c_ubyte, 1),
                ("__pad", c_ubyte, 6),
                ("__res0", c_ubyte),
                ("__res1", c_ubyte),
                ("data", c_ubyte * 64)]


class ZCAN_Transmit_Data(Structure):
    _fields_ = [("frame", ZCAN_CAN_FRAME), ("transmit_type", c_uint)]


class ZCAN_Receive_Data(Structure):
    _fields_ = [("frame", ZCAN_CAN_FRAME), ("timestamp", c_ulonglong)]


class ZCAN_TransmitFD_Data(Structure):
    _fields_ = [("frame", ZCAN_CANFD_FRAME), ("transmit_type", c_uint)]


class ZCAN_ReceiveFD_Data(Structure):
    _fields_ = [("frame", ZCAN_CANFD_FRAME), ("timestamp", c_ulonglong)]


class abit_config(Structure):
    _fields_ = [("tseg1", c_uint8),
                ("tseg2", c_uint8),
                ("sjw", c_uint8),
                ("smp", c_uint8),
                ("brp", c_uint16)]


class dbit_config(Structure):
    _fields_ = [("tseg1", c_uint8),
                ("tseg2", c_uint8),
                ("sjw", c_uint8),
                ("smp", c_uint8),
                ("brp", c_uint16)]


class ZCANFD_INIT(Structure):
    _fields_ = [("clk", c_uint32),
                ("mode", c_uint32),
                ("abit", abit_config),
                ("dbit", dbit_config)]


class Resistance(Structure):
    _fields_ = [("res", c_uint8)]


class _ZCAN_CHANNEL_CAN_INIT_CONFIG(Structure):
    _fields_ = [("acc_code", c_uint),
                ("acc_mask", c_uint),
                ("reserved", c_uint),
                ("filter", c_ubyte),
                ("timing0", c_ubyte),
                ("timing1", c_ubyte),
                ("mode", c_ubyte)]


class _ZCAN_CHANNEL_CANFD_INIT_CONFIG(Structure):
    _fields_ = [("acc_code", c_uint),
                ("acc_mask", c_uint),
                ("abit_timing", c_uint),
                ("dbit_timing", c_uint),
                ("brp", c_uint),
                ("filter", c_ubyte),
                ("mode", c_ubyte),
                ("pad", c_ushort),
                ("reserved", c_uint)]


class _ZCAN_CHANNEL_INIT_CONFIG(Union):
    _fields_ = [("can", _ZCAN_CHANNEL_CAN_INIT_CONFIG),
                ("canfd", _ZCAN_CHANNEL_CANFD_INIT_CONFIG)]


class ZCAN_CHANNEL_INIT_CONFIG(Structure):
    _fields_ = [("can_type", c_uint),
                ("config", _ZCAN_CHANNEL_INIT_CONFIG)]


class IProperty(Structure):
    _fields_ = [("SetValue", c_void_p),
                ("GetValue", c_void_p),
                ("GetPropertys", c_void_p)]
