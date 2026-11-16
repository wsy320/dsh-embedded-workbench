# dsh-embedded-workbench · 嵌入式工作台

DeepSeek Harness 插件：在 Web UI 的**右侧 Sidebar** 里提供 **串口终端 + ZLG / CXCAN CAN** 的多标签工作台，
并把两路状态以只读工具交给 agent。

> 这是独立实现，不复用 `dsh-embedded-bench` 的代码或 HTTP 协议。

## 能力

| 标签 | 内容 |
| --- | --- |
| 串口 | 端口枚举、波特率/数据位/校验/停止位/流控/编码，RX/TX 实时日志（HEX 或 文本），行尾选择，Enter 发送，CSV 录制 |
| CAN | 设备/通道选择（zlgcan、CXCAN、CAN0/CAN1、虚拟）、波特率可选（125k–1M，FD 数据段 1–5M）、同时接收 CAN0+CAN1 的经典/FD 帧、发送通道/帧类型/数据长度可选、逐帧/分类显示（分类按 ID 合并，显示周期与帧数）、通道/方向/ID/类型/长度/数据帧表、ID 过滤（支持 `?`/`*` 通配）、发送帧、帧率/缓存计数、CSV 录制 |
| UDS | 常用 UDS 服务一键发送（会话、复位、清/读故障码、读/写 DID（DID 可输入）、DTC 控制、Tester Present）、请求/响应 ID 可调、P2 100ms/P2* 5s、TX/RX 记录与耗时 |
| 设置 | Python、录制目录、串口与 CAN 默认值 |

- 通过 `dsh-better-sidebar` 的 `ctx.betterSidebar.registerTab` 注册为一个侧边栏 tab，和对话并排，不占用主区。右侧栏较窄时收发日志与配置卡片自动上下排列。
- 帧与串口数据按 **300ms 游标增量轮询**（`serialRecent` / `canRecent` 的 `since`），连接状态每 1.5 秒轮询；请求走相对路径，浏览器与 Desktop 的 `dsh-app://app` 页面都由 DSH 转发到 Host。
- Agent 工具 `embedded_workbench_get`：只读，返回两路状态与最近若干行。
- 不引入 `@deepseek-ai/*` 运行时依赖；Host 只用 Node 内建，Client 只 `require('react')`。

## 结构

| 文件 | 作用 |
| --- | --- |
| `index.js` | Host 入口：注册 HTTP 路由与 `embedded_workbench_get` |
| `lib/workbench.js` | 双桥编排、环形缓存、CSV、游标查询、设置持久化 |
| `lib/serial.js` | pyserial 子进程协议（`device: virtual` 不需要硬件或 pyserial） |
| `lib/can.js` | 内置 `tool.py` + `IsoTp` 子进程；stdin 用线程、空闲也持续 drain |
| `lib/can-driver/` | 通用 CAN 设备框架：ZLG / CXCAN 适配器、虚拟总线、`devices.json` 清单；**厂商 DLL 不随包分发**，见「CAN 厂商驱动」一节 |
| `client.js` | 浏览器模块：better-sidebar tab 面板 + 字典 |
| `test/smoke.mjs` | 离线冒烟：虚拟串口 + 虚拟 CAN + HTTP + 录制 + 设置 |
| `test/client.mjs` | 客户端契约：factory id、slot 与字典注册 |

## 安装

依赖 `dsh-better-sidebar`（侧边栏工作台）：本插件通过它的 `ctx.betterSidebar.registerTab` 注册工作台 tab。先安装并在 profile 中启用 `dsh-better-sidebar`。

从 npm 安装：

```bash
npm install @wsy320/dsh-embedded-workbench
```

`files` 白名单只包含插件代码与各 `lib/can-driver/**/dll/README.txt`，**不会打包任何厂商 DLL**。

在 DeepSeek Harness 会话里（需要 Full access）用官方插件管理器安装：

```text
plugin_manager  action: install_bundle
                target: @wsy320/dsh-embedded-workbench
```

安装会把它加入 profile 的 `package.json` 和 `dsh.profile.bundles`；新装 bundle 可能经 HMR 生效，
替换已装包则需要重启 DSH。

手工安装（等价，供排查）：

```bash
dsh plugin --profile desktop add @wsy320/dsh-embedded-workbench
# 再把 "@wsy320/dsh-embedded-workbench" 追加到 ~/.dsh/profiles/desktop/package.json
# 的 dsh.profile.bundles 数组，然后重启 DSH
```

本地开发时用 `link:` 指向源码目录，改完立即生效、无需发布：

```bash
dsh plugin --profile desktop add "link:/path/to/dsh-embedded-workbench"
```

## CAN 厂商驱动

**本插件不附带任何厂商 DLL**。`zlgcan.dll`、`ControlCANFD.dll`、`libusbcanfd.so`
及 `kerneldlls/` 的版权归各厂商所有，不随 npm 包分发。串口和虚拟 CAN
（`device: virtual`）不需要 DLL；只有连真实设备时才需要自己放一次。

当前注册的设备：

| id | 厂商 DLL | 默认目录 | 环境变量 | 平台 |
| --- | --- | --- | --- | --- |
| `zlg` | `zlgcan.dll` + `kerneldlls/` | `lib/can-driver/zlgcan/dll/` | `EWB_ZLG_DLL_DIR` | Windows / Linux |
| `cxcan` | `ControlCANFD.dll` | `lib/can-driver/cxcan/dll/` | `EWB_CXCAN_DLL_DIR` | Windows |
| `virtual` | 无 | — | — | 全平台 |

安装后的默认路径通常是：

```text
<profile>/node_modules/@wsy320/dsh-embedded-workbench/lib/can-driver/
├── zlgcan/dll/
│   ├── zlgcan.dll
│   └── kerneldlls/        ← 整个子目录，与 zlgcan.dll 同级
└── cxcan/dll/
    └── ControlCANFD.dll
```

ZLG 的 `kerneldlls/` 必须与 `zlgcan.dll` 同级保留，DLL 运行时会去那里找具体设备驱动。
Linux 下 ZLG 对应文件是 `libusbcanfd.so`，放在 `zlgcan/dll/`。

也可以把驱动放到任意固定目录，避免 `npm update` 覆盖，然后设置环境变量再启动 DSH：

```bat
set EWB_ZLG_DLL_DIR=C:\tools\zlg\dll
set EWB_CXCAN_DLL_DIR=C:\tools\cxcan\dll
```

```bash
export EWB_ZLG_DLL_DIR=/opt/zlg/dll
```

环境变量可以指向目录，也可以直接指向 DLL/so；优先级最高。

### 新增 CAN 设备

`lib/can-driver/devices.json` 是 Python、Host 和前端共用的设备清单。新增厂商只需要：

1. 在 `lib/can-driver/<vendor>/` 放 ctypes 封装和 `dll/README.txt`；
2. 在 `lib/can-driver/<vendor>/bus.py` 增加总线类，构造函数接受
   `bitrate=` / `data_bitrate=`，实现 `open/close/send/send_channel/receive/receive_all/select_channel`；
3. 在 `devices.json` 增加一条 `{id, label, bus: "<vendor>.bus:XxxBus", platforms, dll, env}`。

不需要改 `make_bus()` 或前端设备下拉：Host 会把 `devices` 随状态返回，前端动态生成选项。
新增厂商的 `.py` 与 `dll/README.txt` 会被 `package.json` 的 `files` 白名单收进 npm 包，
`dll/` 下的二进制不在白名单内，因此永不发布；`.gitignore` 同样排除它们。

### 注意位数

DLL 位数必须与**运行插件所用的 Python 一致**。多数环境是 64 位 Python，
位数不符时 Python 会报 `OSError: [WinError 193] %1 不是有效的 Win32 应用程序`，
换对应位数的驱动即可。

### 找不到时

CAN 面板打开真实设备会报错并给出**该放的确切路径**，照提示拷进去、重开设备即可，
不需要重启 DSH。默认目录不存在时驱动会自动创建。

## 配置

设置页保存到 `$DSH_HOME/embedded-workbench/settings.json`（默认 `~/.dsh/...`），
下一次打开设备时生效，**不需要重启 DSH**。该文件按机器共享，同一台机器上的多个 profile 会读到同一份设备配置。
也可以写在 profile 的 `cordis.patch.yml` 作为初始值：

```yaml
- id: dsh-embedded-workbench
  name: '@wsy320/dsh-embedded-workbench'
  config:
    python: python
    recordDir: ""
    serial:
      device: serial        # serial | virtual
      port: COM7
      baud: 115200
      dataBits: 8
      parity: N             # N | E | O | M | S
      stopBits: 1
      flow: none            # none | rtscts | xonxoff
      encoding: utf-8
      dtr: false            # applied before open(), never after
      rts: false
    can:
      device: zlg           # zlg | cxcan | virtual
      channel: 0
      fd: 0
      bitrate: 500000        # arbitration bitrate, e.g. 125000/250000/500000/1000000
      dataBitrate: 2000000   # CAN FD data-phase bitrate
      reqId: "0x76F"
      resId: "0x7AF"
      pollSeconds: 0.1
      startup: ""
```

真实串口需要 `pyserial`（`pip install pyserial`）。`device: virtual` 的串口会把每次写回显成 RX，
用于无硬件演练；虚拟 CAN 的 `send` 不会回环到接收队列，这是内置 `zlg-can` 虚拟总线的行为。

高波特率注意：驱动以 200 ms 读超时读取；`50 ms` 在 FTDI + 3 Mbaud 下会丢整段启动日志（实测只剩一个
break 字节）。`dtr`/`rts` 在 `open()` 之前写入 DCB；打开后再拉低会让这块板子的 UART 停止输出。

## HTTP 接口

面板与 Host 只通过这一条路由通信：

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `POST` | `/api/embedded-workbench` | JSON 命令：`status` `serialPorts` `serialOpen` `serialClose` `serialWrite` `serialLine` `serialRecent` `serialClear` `canOpen` `canClose` `canSend` `canRecent` `canClear` `uds` `dtc` `run` `recordStart` `recordStop` `saveSettings` |

`serialRecent` / `canRecent` 接受 `{ since, limit }`，返回 `{ rows, seq }`；面板把最后一行的 `seq` 作为下一次的 `since`。

同源检查：带跨站 `Origin` 或 `sec-fetch-site: cross-site` 的浏览器请求返回 403。路由直接注册在
`ctx.webServer` 上，**不经过 DSH API Gateway 的浏览器认证**，因此默认只应绑定 loopback；
不要在把 Web 监听暴露到非可信网络时使用。

## 边界与已知限制

- 每个方向同时只开一个设备；换端口/波特率需要先断开。
- CAN 帧时间支持两种模式：绝对时间（以本次连接 CAN 设备的时刻为 0，显示已过秒数）和相对时间（当前帧与上一帧的间隔，单位秒）。
- 串口文本按配置的编码整块解码；跨块的多字节字符由 Python 的增量解码器处理，但二进制协议请用 HEX。
- CAN 驱动（Python 部分）随插件分发在 `lib/can-driver/`，不依赖外部 `zlg-can` 技能目录；但**厂商 DLL 不在包里**，需要按「CAN 厂商驱动」一节放好，真实设备才能连上。
- `run` 控制台复用同一个 `Runner`，因此 `set_ids` 会作用于同批后续命令；`can_close` 仍会关闭共享总线。
- 面板状态属于进程，不属于会话；多个会话共享同一条总线，这是实验室工作台的预期。
- 录制文件默认写 `%USERPROFILE%\Desktop\embedded-workbench`。

## 开发

```bash
node test/client.mjs      # 客户端契约，不需要 DSH
node test/smoke.mjs       # Host + HTTP，不需要 DSH 或硬件
node --check index.js client.js lib/*.js
```

MIT。
