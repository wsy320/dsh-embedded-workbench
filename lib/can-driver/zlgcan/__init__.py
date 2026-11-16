"""ZLG CAN 驱动（本仓库自带实现）。

device.py / structs.py 是与 ZLG zlgcan.dll 对接的 Python 封装，import 指向
包内的 agent.interface 与 zlgcan.structs，因此整个驱动随插件自包含，不依赖
外部技能目录或别的包。

`dll/` 下的二进制（zlgcan.dll、libusbcanfd.so 及 kerneldlls/）来自 ZLG 官方
驱动包，不是本仓库代码，许可归 ZLG 所有。
"""

from zlgcan.device import ZlgCanDevice

__all__ = ["ZlgCanDevice"]
