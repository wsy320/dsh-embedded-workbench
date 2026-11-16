"""UDS 诊断服务（自包含重写，通用 CAN 工具）。

只依赖 agent.tp / agent.bus；不复用仓库 uds.py / uds_tp.py / uds_service.py。
本模块仅提供通用 UDS 服务原语（会话/读写 DID/DTC/复位/例程/原始请求）。
安全访问（0x27）的 seed-key 算法与 ECU 专属密钥属于上层技能
（如 gwm-radar-flash/security.py），不在此处。
"""

from agent.tp import IsoTp

# ---------------- SID 常量 ----------------
SID_READ_DID = 0x22
SID_WRITE_DID = 0x2E
SID_ECU_RESET = 0x11
SID_DIAG_SESSION = 0x10
SID_COMM_CTRL = 0x28
SID_CTRL_DTC = 0x85
SID_READ_DTC = 0x19
SID_CLEAR_DTC = 0x14
SID_ROUTINE_CTRL = 0x31
SID_TESTER = 0x3E


# ---------------- 结果封装 ----------------
def _ok(response):
    return {"ok": True, "response": list(response), "error": None}


def _fail(response=None, error="failed"):
    return {"ok": False, "response": list(response) if response else [], "error": error}


def _completed(result, sid_positive):
    resp = result
    if resp is None:
        return _fail(error="timeout")
    if resp and resp[0] == 0x7F:
        return _fail(resp, "negative")
    if sid_positive is not None and (not resp or resp[0] != sid_positive):
        return _fail(resp, "unexpected response")
    return _ok(resp)


# ---------------- UDS 客户端 ----------------
class UdsClient:
    """绑定一组请求/响应 CAN ID 的 UDS 客户端。"""

    def __init__(self, bus, req_id, res_id, fd=0):
        self.req_id = req_id
        self.res_id = res_id
        self.tp = IsoTp(bus, req_id, res_id, fd=fd)

    # ---------------- 诊断服务 ----------------

    def session(self, session_type):
        return _completed(self.tp.request([SID_DIAG_SESSION, session_type & 0xFF]),
                          SID_DIAG_SESSION | 0x40)

    def read_did(self, did):
        payload = [SID_READ_DID, (did >> 8) & 0xFF, did & 0xFF]
        return _completed(self.tp.request(payload), SID_READ_DID | 0x40)

    def write_did(self, did, payload):
        data = [SID_WRITE_DID, (did >> 8) & 0xFF, did & 0xFF] + list(payload)
        return _completed(self.tp.request(data), SID_WRITE_DID | 0x40)

    def read_dtc(self, mask=0x09):
        return _completed(self.tp.request([SID_READ_DTC, 0x02, mask & 0xFF]),
                          SID_READ_DTC | 0x40)

    def clear_dtc(self):
        return _completed(self.tp.request([SID_CLEAR_DTC, 0xFF, 0xFF, 0xFF]),
                          SID_CLEAR_DTC | 0x40)

    def ecu_reset(self, reset_type):
        return _completed(self.tp.request([SID_ECU_RESET, reset_type & 0xFF]),
                          SID_ECU_RESET | 0x40)

    def communication_control(self, subfunction, comm_type=0x01):
        return _completed(self.tp.request([SID_COMM_CTRL, subfunction & 0xFF, comm_type & 0xFF]),
                          SID_COMM_CTRL | 0x40)

    def control_dtc_setting(self, subfunction):
        return _completed(self.tp.request([SID_CTRL_DTC, subfunction & 0xFF]),
                          SID_CTRL_DTC | 0x40)

    def routine_control(self, routine_type, routine_id, user_data, wait_time=5.0):
        data = [SID_ROUTINE_CTRL, routine_type & 0xFF,
                (routine_id >> 8) & 0xFF, routine_id & 0xFF] + list(user_data)
        return _completed(self.tp.request(data, p2_star=wait_time), SID_ROUTINE_CTRL | 0x40)

    def tester_present(self):
        return _completed(self.tp.request([SID_TESTER]), SID_TESTER | 0x40)

    def raw_request(self, data):
        """通用 UDS 请求通道 [advanced]：任意 SID，返回原始响应。"""
        resp = self.tp.request(list(data))
        if resp is None:
            return _fail(error="timeout")
        if resp and resp[0] == 0x7F:
            return _fail(resp, "negative")
        return _ok(resp)
