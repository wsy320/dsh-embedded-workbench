ZLG CAN vendor files go here / ZLG CAN 厂商文件放在这里

本目录不包含厂商 DLL，npm 包里只保留这个说明文件。

Windows:
  zlgcan.dll
  kerneldlls/            (整个目录，必须与 zlgcan.dll 同级)

Linux:
  libusbcanfd.so

从 ZLG 官方驱动包（ZCANPRO / USBCANFD TOOL 或官网下载）中拷贝。
DLL 位数必须与运行插件的 Python 一致（通常 64 位）。

如果不想改 node_modules，可以把驱动放到任意目录并设置环境变量：
  EWB_ZLG_DLL_DIR=C:\path\to\zlg\dll
