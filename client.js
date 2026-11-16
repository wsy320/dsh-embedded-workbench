/**
 * Embedded Workbench — the browser half.
 *
 * One sidebar shortcut and one right-sidebar tab, no settings-service schema:
 * the panel owns its own settings document (written by the Host) so nothing
 * here has to survive `structuredClone` or a Schemastery projection.
 *
 * Data flows over one relative route: JSON commands by POST, with a 300 ms
 * cursor poll for RX/TX chunks and CAN frames. Relative URLs work in a browser
 * tab and in the Desktop `dsh-app://app/` page, whose protocol handler forwards
 * `/api/*` to the Host.
 *
 * @module dsh-embedded-workbench/client
 */
window.__ModuleLoader__.load({
  id: '@wsy320/dsh-embedded-workbench',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useState, useEffect, useRef, useCallback } = React

    const PANEL = 'embedded-workbench'
    const NS = 'dsh-embedded-workbench'
    const ENDPOINT = '/api/embedded-workbench'
    const MAX_SERIAL_ROWS = 800
    const MAX_CAN_ROWS = 800

    const ZH = {
      'panel.title': '嵌入式工作台',
      'panel.subtitle': '串口终端与 ZLG USBCANFD CAN：实时收发、CSV 录制；agent 通过 embedded_workbench_get 读取同一份状态。',
      'panel.short': '串口、CAN 与 UDS 诊断',
      'tab.serial': '串口',
      'tab.can': 'CAN',
      'tab.uds': 'UDS',
      'tab.settings': '设置',
      'state.closed': '未连接',
      'state.connecting': '连接中',
      'state.ready': '已连接',
      'state.error': '异常',
      'action.connect': '连接',
      'action.disconnect': '断开',
      'action.refresh': '刷新',
      'action.clear': '清空',
      'action.pause': '暂停',
      'action.resume': '继续',
      'action.send': '发送',
      'action.save': '保存',
      'action.reload': '重读',
      'action.startRecord': '开始录制',
      'action.stopRecord': '停止录制',
      'serial.port': '端口',
      'serial.device': '设备',
      'serial.baud': '波特率',
      'serial.empty': '还没有数据。连接后收发的字节会出现在这里。',
      'serial.sendPlaceholder': '要发送的内容，Enter 发送',
      'serial.mode.text': '文本',
      'serial.mode.hex': 'HEX',
      'serial.newline': '行尾',
      'serial.newline.none': '无',
      'serial.newline.lf': 'LF',
      'serial.newline.crlf': 'CRLF',
      'serial.newline.cr': 'CR',
      'serial.view': '视图',
      'serial.view.hex': '显示hex',
      'serial.view.text': '显示文本',
      'serial.filter.all': '收发',
      'serial.filter.rx': '仅收',
      'serial.filter.tx': '仅发',
      'serial.bytesIn': '收字节',
      'serial.bytesOut': '发字节',
      'serial.lines': '行数',
      'serial.rate': '字节/秒',
      'serial.virtual': '虚拟回环',
      'serial.virtualHint': '当前是虚拟回环：不会打开真实串口。请把设备切到「真实串口」。',
      'can.title': 'CAN 帧',
      'can.channel': '通道',
      'can.sendChannel': '发送通道',
      'can.dir': '方向',
      'can.type': '类型',
      'can.len': '长度',
      'can.id': 'CAN ID',
      'can.data': '数据',
      'can.filter': 'ID 过滤',
      'can.view.frame': '逐帧显示',
      'can.view.group': '分类显示',
      'can.period': '周期',
      'can.count': '帧数',
      'can.time': '时间',
      'can.time.abs': '绝对时间',
      'can.time.rel': '相对时间',
      'can.filterPlaceholder': '如 0x7B2、0x30?、0x3*（留空全部）',
      'can.empty': '还没有帧。连接后收到的帧会出现在这里。',
      'can.sendTitle': '发送帧',
      'can.sendType': '帧类型',
      'can.sendLength': '数据长度',
      'can.typeCan': '经典 CAN',
      'can.typeFd': 'CAN FD',
      'can.frames': '累计帧',
      'can.rate': '帧/秒',
      'can.ring': '缓存',
      'can.recording': '录制',
      'rec.none': '未录制',
      'rec.rows': '行',
      'uds.title': 'UDS 诊断',
      'uds.reqId': '请求 ID',
      'uds.resId': '响应 ID',
      'uds.quick': '常用 UDS 服务',
      'uds.group.session': '会话与保活',
      'uds.group.reset': '复位',
      'uds.group.dtc': '故障码',
      'uds.group.data': 'DID 读/写',
      'uds.didPlaceholder': 'DID，如 F190',
      'uds.dataPlaceholder': '写入数据，如 01 02',
      'uds.readDid': '读 DID',
      'uds.writeDid': '写 DID',
      'uds.badDid': 'DID 必须是 1–4 位十六进制',
      'uds.badData': '写入数据必须是偶数个十六进制字节',
      'uds.defaultSession': '默认会话',
      'uds.programSession': '编程会话',
      'uds.extendedSession': '扩展会话',
      'uds.dtc': '读故障码',
      'uds.clearDtc': '清除故障码',
      'uds.hardReset': '硬复位',
      'uds.softReset': '软复位',
      'uds.dtcOn': '打开 DTC 记录',
      'uds.dtcOff': '关闭 DTC 记录',
      'uds.tester': 'Tester Present',
      'uds.empty': '点击常用 UDS 服务即可发送，响应会显示在这里。',
      'uds.waiting': '等待响应…',
      'uds.error': '错误',
      'uds.nrc': 'NRC',
      'uds.unknownNrc': '未知 NRC',
      'nrc.10': '一般拒绝',
      'nrc.11': '服务不支持',
      'nrc.12': '子功能不支持',
      'nrc.13': '报文长度或格式错误',
      'nrc.21': '忙，请重试',
      'nrc.22': '条件不满足',
      'nrc.24': '请求顺序错误',
      'nrc.25': '子网组件无响应',
      'nrc.26': '故障妨碍执行',
      'nrc.31': '请求超出范围',
      'nrc.33': '安全访问拒绝',
      'nrc.35': '密钥无效',
      'nrc.36': '尝试次数超限',
      'nrc.37': '所需延迟未到',
      'nrc.70': '上传/下载不接受',
      'nrc.71': '传输数据暂停',
      'nrc.72': '编程失败',
      'nrc.73': '块序号错误',
      'nrc.78': '响应待处理',
      'nrc.7E': '当前会话不支持子功能',
      'nrc.7F': '当前会话不支持该服务',
      'settings.title': '运行设置',
      'settings.subtitle': '这些值由本插件保存在自己的设置文件里，保存后下一次打开设备生效，不需要重启 DSH。',
      'settings.env': '运行环境',
      'settings.serialDefaults': '串口默认值',
      'settings.canDefaults': 'CAN 默认值',
      'settings.python': 'Python',
      'settings.pythonHint': 'PATH 上的名字或绝对路径；真实串口需要 pyserial。',
      'settings.recordDir': '录制目录',
      'settings.recordDirHint': '留空写到桌面的 embedded-workbench 目录。',
      'settings.device': '设备',
      'settings.deviceSerial': '真实串口',
      'settings.deviceVirtual': '虚拟回环（演练）',
      'settings.deviceZlg': 'zlgcan',
      'settings.deviceCxcan': 'CXCAN',
      'settings.encoding': '编码',
      'settings.encodingHint': '文本收发使用的编码，如 utf-8 或 gbk。',
      'settings.dataBits': '数据位',
      'settings.parity': '校验',
      'settings.stopBits': '停止位',
      'settings.flow': '流控',
      'settings.pollSeconds': '轮询间隔（秒）',
      'settings.pollSecondsHint': '子进程主动读取设备缓冲的间隔，默认 0.1。',
      'settings.canBitrate': 'CAN 波特率',
      'settings.canDataBitrate': 'CAN FD 数据波特率',
      'settings.canBitrateHint': '重新连接 CAN 后生效。仲裁段默认 500 kbit/s，FD 数据段默认 2 Mbit/s。',
      'settings.saved': '已保存。',
      'settings.failed': '保存失败',
      'settings.unsaved': '有未保存的修改',
      'notice.ports': '端口列表读取失败，可直接输入端口名。',
    }

    const EN = {
      'panel.title': 'Embedded Workbench',
      'panel.subtitle': 'Serial terminal and ZLG USBCANFD CAN: live traffic and CSV capture; the agent reads the same state through embedded_workbench_get.',
      'panel.short': 'Serial, CAN and UDS diagnostics',
      'tab.serial': 'Serial',
      'tab.can': 'CAN',
      'tab.uds': 'UDS',
      'tab.settings': 'Settings',
      'state.closed': 'Disconnected',
      'state.connecting': 'Connecting',
      'state.ready': 'Connected',
      'state.error': 'Error',
      'action.connect': 'Connect',
      'action.disconnect': 'Disconnect',
      'action.refresh': 'Refresh',
      'action.clear': 'Clear',
      'action.pause': 'Pause',
      'action.resume': 'Resume',
      'action.send': 'Send',
      'action.save': 'Save',
      'action.reload': 'Reload',
      'action.startRecord': 'Start capture',
      'action.stopRecord': 'Stop capture',
      'serial.port': 'Port',
      'serial.device': 'Device',
      'serial.baud': 'Baud',
      'serial.empty': 'No data yet. Bytes appear here once connected.',
      'serial.sendPlaceholder': 'Text to send, Enter submits',
      'serial.mode.text': 'Text',
      'serial.mode.hex': 'HEX',
      'serial.newline': 'Line ending',
      'serial.newline.none': 'None',
      'serial.newline.lf': 'LF',
      'serial.newline.crlf': 'CRLF',
      'serial.newline.cr': 'CR',
      'serial.view': 'View',
      'serial.view.hex': 'Show hex',
      'serial.view.text': 'Show text',
      'serial.filter.all': 'Both',
      'serial.filter.rx': 'RX only',
      'serial.filter.tx': 'TX only',
      'serial.bytesIn': 'RX bytes',
      'serial.bytesOut': 'TX bytes',
      'serial.lines': 'Lines',
      'serial.rate': 'Bytes/s',
      'serial.virtual': 'Virtual loopback',
      'serial.virtualHint': 'Virtual loopback is selected: no real port is opened. Switch Device to Real port.',
      'can.title': 'CAN frames',
      'can.channel': 'Channel',
      'can.sendChannel': 'Send channel',
      'can.dir': 'Dir',
      'can.type': 'Type',
      'can.len': 'Length',
      'can.id': 'CAN ID',
      'can.data': 'Data',
      'can.filter': 'ID filter',
      'can.view.frame': 'Per frame',
      'can.view.group': 'Grouped',
      'can.period': 'Period',
      'can.count': 'Count',
      'can.time': 'Time',
      'can.time.abs': 'Absolute',
      'can.time.rel': 'Relative',
      'can.filterPlaceholder': 'e.g. 0x7B2, 0x30?, 0x3* (blank = all)',
      'can.empty': 'No frames yet. Frames appear here once connected.',
      'can.sendTitle': 'Send frame',
      'can.sendType': 'Frame type',
      'can.sendLength': 'Data length',
      'can.typeCan': 'Classic CAN',
      'can.typeFd': 'CAN FD',
      'can.frames': 'Frames',
      'can.rate': 'Frames/s',
      'can.ring': 'Buffered',
      'can.recording': 'Capture',
      'rec.none': 'Not capturing',
      'rec.rows': 'rows',
      'uds.title': 'UDS diagnostics',
      'uds.reqId': 'Request ID',
      'uds.resId': 'Response ID',
      'uds.quick': 'Common UDS services',
      'uds.group.session': 'Session and keep-alive',
      'uds.group.reset': 'Reset',
      'uds.group.dtc': 'Fault codes',
      'uds.group.data': 'DID read/write',
      'uds.didPlaceholder': 'DID, e.g. F190',
      'uds.dataPlaceholder': 'Write data, e.g. 01 02',
      'uds.readDid': 'Read DID',
      'uds.writeDid': 'Write DID',
      'uds.badDid': 'DID must be 1-4 hex digits',
      'uds.badData': 'Write data must be an even number of hex bytes',
      'uds.defaultSession': 'Default session',
      'uds.programSession': 'Programming session',
      'uds.extendedSession': 'Extended session',
      'uds.dtc': 'Read DTCs',
      'uds.clearDtc': 'Clear DTCs',
      'uds.hardReset': 'Hard reset',
      'uds.softReset': 'Soft reset',
      'uds.dtcOn': 'Enable DTC setting',
      'uds.dtcOff': 'Disable DTC setting',
      'uds.tester': 'Tester Present',
      'uds.empty': 'Click a UDS service to send it; responses appear here.',
      'uds.waiting': 'Waiting for a response…',
      'uds.error': 'Error',
      'uds.nrc': 'NRC',
      'uds.unknownNrc': 'Unknown NRC',
      'nrc.10': 'General reject',
      'nrc.11': 'Service not supported',
      'nrc.12': 'Sub-function not supported',
      'nrc.13': 'Incorrect length or format',
      'nrc.21': 'Busy, repeat request',
      'nrc.22': 'Conditions not correct',
      'nrc.24': 'Request sequence error',
      'nrc.25': 'No response from subnet component',
      'nrc.26': 'Failure prevents execution',
      'nrc.31': 'Request out of range',
      'nrc.33': 'Security access denied',
      'nrc.35': 'Invalid key',
      'nrc.36': 'Exceeded number of attempts',
      'nrc.37': 'Required time delay not expired',
      'nrc.70': 'Upload/download not accepted',
      'nrc.71': 'Transfer data suspended',
      'nrc.72': 'General programming failure',
      'nrc.73': 'Wrong block sequence counter',
      'nrc.78': 'Response pending',
      'nrc.7E': 'Sub-function not supported in active session',
      'nrc.7F': 'Service not supported in active session',
      'settings.title': 'Runtime settings',
      'settings.subtitle': 'Saved by this plugin in its own settings file. The next device open uses them; no DSH restart needed.',
      'settings.env': 'Runtime',
      'settings.serialDefaults': 'Serial defaults',
      'settings.canDefaults': 'CAN defaults',
      'settings.python': 'Python',
      'settings.pythonHint': 'A PATH name or absolute path; a real port needs pyserial.',
      'settings.recordDir': 'Capture folder',
      'settings.recordDirHint': 'Blank writes to Desktop/embedded-workbench.',
      'settings.device': 'Device',
      'settings.deviceSerial': 'Real port',
      'settings.deviceVirtual': 'Virtual loopback (dry run)',
      'settings.deviceZlg': 'zlgcan',
      'settings.deviceCxcan': 'CXCAN',
      'settings.encoding': 'Encoding',
      'settings.encodingHint': 'Text encoding for UART traffic, e.g. utf-8 or gbk.',
      'settings.dataBits': 'Data bits',
      'settings.parity': 'Parity',
      'settings.stopBits': 'Stop bits',
      'settings.flow': 'Flow control',
      'settings.pollSeconds': 'Poll interval (s)',
      'settings.pollSecondsHint': 'How often the child drains the device buffer; 0.1 by default.',
      'settings.canBitrate': 'CAN bitrate',
      'settings.canDataBitrate': 'CAN FD data bitrate',
      'settings.canBitrateHint': 'Applies after reconnecting CAN. Arbitration defaults to 500 kbit/s; FD data phase to 2 Mbit/s.',
      'settings.saved': 'Saved.',
      'settings.failed': 'Save failed',
      'settings.unsaved': 'Unsaved changes',
      'notice.ports': 'Port list failed; type the port name directly.',
    }

    const CSS = [
      '.ewb-root{display:flex;flex-direction:column;height:100%;min-height:0;background:var(--dsw-alias-bg-base,#fff);color:var(--dsw-alias-label-primary,#111);font:13px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif;container-type:inline-size}',
      '.ewb-head{display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:16px 20px 10px;border-bottom:1px solid var(--dsw-alias-border-subtle,#e6e8ec)}',
      '.ewb-title{margin:0;font-size:16px;font-weight:600}',
      '.ewb-sub{margin:0;flex-basis:100%;font-size:12px;color:var(--dsw-alias-label-tertiary,#8a8f98)}',
      '.ewb-spacer{flex:1}',
      '.ewb-tabs{display:flex;gap:2px;padding:0 16px;border-bottom:1px solid var(--dsw-alias-border-subtle,#e6e8ec)}',
      '.ewb-tab{font:inherit;font-size:13px;padding:8px 12px;border:0;background:transparent;color:var(--dsw-alias-label-secondary,#555);cursor:pointer;border-bottom:2px solid transparent;margin-bottom:-1px}',
      '.ewb-tab:hover{color:var(--dsw-alias-label-primary,#111)}',
      '.ewb-tab.active{color:var(--dsw-alias-brand-primary,#3370ff);border-bottom-color:var(--dsw-alias-brand-primary,#3370ff);font-weight:600}',
      '.ewb-body{display:flex;flex:1;min-height:0}',
      '.ewb-main{display:flex;flex-direction:column;flex:1;min-width:0;min-height:0}',
      '.ewb-side{display:flex;flex-direction:column;gap:10px;width:330px;flex:none;padding:12px;overflow:auto;border-left:1px solid var(--dsw-alias-border-subtle,#e6e8ec)}',
      '.ewb-card{border:1px solid var(--dsw-alias-border-subtle,#e6e8ec);border-radius:8px;padding:10px;display:flex;flex-direction:column;gap:7px}',
      '.ewb-card h3{margin:0;font-size:13px;font-weight:600}',
      '.ewb-row{display:flex;gap:6px;align-items:center;flex-wrap:wrap}',
      '.ewb-label{font-size:11px;color:var(--dsw-alias-label-tertiary,#8a8f98)}',
      '.ewb-btn{font:inherit;font-size:12px;line-height:1.4;padding:4px 10px;border-radius:6px;cursor:pointer;border:1px solid var(--dsw-alias-border-subtle,#d9dde3);background:var(--dsw-alias-bg-layer-1,#f7f8fa);color:var(--dsw-alias-label-primary,#111)}',
      '.ewb-btn:hover:not(:disabled){border-color:var(--dsw-alias-border-strong,#b9c0ca)}',
      '.ewb-btn:disabled{opacity:.45;cursor:default}',
      '.ewb-btn.primary{background:var(--dsw-alias-brand-primary,#3370ff);border-color:transparent;color:#fff}',
      '.ewb-input,.ewb-select{font:inherit;font-size:12px;padding:4px 8px;border-radius:6px;border:1px solid var(--dsw-alias-border-subtle,#d9dde3);background:var(--dsw-alias-bg-base,#fff);color:var(--dsw-alias-label-primary,#111);min-width:0}',
      '.ewb-input{flex:1}',
      '.ewb-tag{font-size:11px;padding:2px 8px;border-radius:999px;background:var(--dsw-alias-bg-layer-2,#eef0f3);color:var(--dsw-alias-label-secondary,#555)}',
      '.ewb-tag.ok{background:rgba(52,199,36,.14);color:var(--dsw-alias-state-success-primary,#2e7d32)}',
      '.ewb-tag.bad{background:rgba(245,74,69,.14);color:var(--dsw-alias-state-error-primary,#d9534f)}',
      '.ewb-tools{display:flex;align-items:center;gap:6px;padding:8px 12px;border-bottom:1px solid var(--dsw-alias-border-subtle,#e6e8ec);flex-wrap:wrap}',
      '.ewb-log{flex:1;min-height:0;overflow:auto;font:12px/1.5 ui-monospace,SFMono-Regular,Consolas,monospace;border-top:1px solid var(--dsw-alias-border-subtle,#e6e8ec)}',
      '.ewb-line{display:flex;align-items:flex-start;gap:8px;padding:1px 10px}',
      '.ewb-line:hover{background:var(--dsw-alias-bg-layer-1,#f7f8fa)}',
      '.ewb-time{color:var(--dsw-alias-label-tertiary,#8a8f98);flex:none}',
      '.ewb-dir{flex:none;width:24px;font-weight:600}',
      '.ewb-dir.rx{color:var(--dsw-alias-state-success-primary,#2e7d32)}',
      '.ewb-dir.tx{color:var(--dsw-alias-brand-primary,#3370ff)}',
      '.ewb-dir.err{color:var(--dsw-alias-state-error-primary,#d9534f)}',
      '.ewb-nrc{flex:none;color:var(--dsw-alias-state-error-primary,#d9534f);font-weight:600}',
      '.ewb-hex{color:var(--dsw-alias-label-secondary,#555);flex:1 1 auto;min-width:0;white-space:pre-wrap;word-break:break-all}',
      '.ewb-text{color:var(--dsw-alias-label-primary,#111);flex:1 1 auto;min-width:0;white-space:pre-wrap;overflow-wrap:anywhere}',
      '.ewb-table{flex:1;min-height:0;overflow:auto;font:12px/1.45 ui-monospace,Consolas,monospace}',
      '.ewb-table table{width:100%;border-collapse:collapse}',
      '.ewb-table th{position:sticky;top:0;background:var(--dsw-alias-bg-base,#fff);text-align:left;font-weight:500;color:var(--dsw-alias-label-tertiary,#8a8f98);padding:5px 8px;border-bottom:1px solid var(--dsw-alias-border-subtle,#e6e8ec)}',
      '.ewb-table td{padding:2px 8px;white-space:nowrap}',
      '.ewb-table td.id{color:var(--dsw-alias-brand-primary,#3370ff)}',
      '.ewb-table td.dir.rx{color:var(--dsw-alias-state-success-primary,#2e7d32)}',
      '.ewb-table td.dir.tx{color:var(--dsw-alias-brand-primary,#3370ff)}',
      '.ewb-table td.dir.mix{color:var(--dsw-alias-label-secondary,#555)}',
      '.ewb-empty{padding:18px;color:var(--dsw-alias-label-tertiary,#8a8f98);font-size:12px}',
      '.ewb-out{margin:0;max-height:180px;overflow:auto;white-space:pre-wrap;word-break:break-all;font:12px/1.45 ui-monospace,Consolas,monospace;color:var(--dsw-alias-label-secondary,#444)}',
      '.ewb-warn{color:var(--dsw-alias-state-error-primary,#d9534f);font-size:12px;margin:0}',
      '.ewb-stat{display:flex;flex-direction:column;align-items:flex-end;font-size:11px;color:var(--dsw-alias-label-tertiary,#8a8f98);line-height:1.3}',
      '.ewb-stat b{font-size:13px;color:var(--dsw-alias-label-primary,#111)}',
      '.ewb-form{display:flex;flex-direction:column;gap:6px;max-width:720px;padding:16px 20px;overflow:auto}',
      '.ewb-form h3{margin:12px 0 0;font-size:13px}',
      '.ewb-form .hint{margin:0;font-size:11px;color:var(--dsw-alias-label-tertiary,#8a8f98)}',
      '.ewb-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:8px}',
      '.ewb-field{display:flex;flex-direction:column;gap:3px;font-size:12px}',
      '.ewb-field span{color:var(--dsw-alias-label-secondary,#555)}',
      '.ewb-inline{display:flex;flex-wrap:nowrap;align-items:flex-end;gap:8px;min-width:0}',
      '.ewb-inline>.ewb-field{flex:1 1 0;min-width:0}',
      '.ewb-inline>.ewb-field.grow{flex:1.7 1 0}',
      '.ewb-inline>.ewb-field.narrow{flex:0 0 78px}',
      '.ewb-inline>.ewb-field.ewb-uniform{flex:0 0 160px;width:160px}',
      '.ewb-uniform{flex:0 0 160px;width:160px;min-width:0}',
      '.ewb-uniform .ewb-input,.ewb-uniform .ewb-select{width:100%;box-sizing:border-box}',
      '.ewb-uniform .ewb-row{min-width:0}',
      '.ewb-uniform .ewb-row .ewb-input,.ewb-uniform .ewb-row .ewb-select{flex:1 1 auto;width:0;min-width:0}',
      '.ewb-align{display:grid;grid-template-columns:52px 160px;align-items:center;gap:8px;min-width:0}',
      '.ewb-align .ewb-input{width:100%;box-sizing:border-box}',
      '.ewb-inline .ewb-input,.ewb-inline .ewb-select{width:100%;box-sizing:border-box}',
      '.ewb-inline>.ewb-btn{flex:none}',
      '.ewb-service-group{display:flex;flex-direction:column;gap:5px}',
      '.ewb-service-group+.ewb-service-group{margin-top:4px}',
      '.ewb-did-row{align-items:center;flex-wrap:nowrap}',
      '.ewb-did-row .ewb-did{flex:0 0 92px;min-width:92px}',
      '.ewb-did-row .ewb-did-data{flex:1 1 110px;min-width:90px}',
      '.ewb-did-row .ewb-btn{flex:none;padding-left:8px;padding-right:8px}',
      '.ewb-uds-side .ewb-row{gap:3px}',
      '.ewb-uds-side .ewb-btn{padding-left:5px;padding-right:5px}',
      '.ewb-mini{flex:none;padding:4px 7px;line-height:1.2}',
      '@container (max-width: 760px){.ewb-body{flex-direction:column;overflow:auto}.ewb-main{flex:0 0 auto;height:58%}.ewb-main.ewb-uds-main{height:auto;flex:1 1 auto}.ewb-side{width:auto;max-width:none;border-left:0;border-top:1px solid var(--dsw-alias-border-subtle,#e6e8ec)}.ewb-uds-side{gap:6px;padding:6px 8px}.ewb-uds-side .ewb-card{padding:8px 10px;gap:5px}.ewb-uds-side .ewb-service-group+.ewb-service-group{margin-top:2px}.ewb-head{padding:10px 12px 8px}.ewb-sub{display:none}.ewb-tabs{padding:0 8px}.ewb-tools{padding:6px 8px}}',
    ].join(String.fromCharCode(10))

    /**
     * Relative on purpose: the browser tab reaches the Host at the same
     * origin, and the Desktop page is `dsh-app://app/` where the protocol
     * handler forwards `/api/*` to the Host with its cookie. An absolute
     * `http://127.0.0.1:...` URL from that page is a cross-origin request and
     * fails before it reaches the route.
     */
    function endpoint(query) {
      return `${ENDPOINT}${query ?? ''}`
    }

    /** One JSON command. */
    async function call(body) {
      try {
        const response = await fetch(endpoint(''), {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        })
        if (!response.ok) return { ok: false, error: `HTTP ${response.status}` }
        const value = await response.json()
        return value && typeof value === 'object' ? value : { ok: false, error: 'bad response' }
      } catch (error) {
        return { ok: false, error: String(error?.message ?? error) }
      }
    }

    function clone(value) {
      return value === undefined ? undefined : JSON.parse(JSON.stringify(value))
    }

    function clockOf(ts) {
      const seconds = typeof ts === 'number' ? ts : Date.now() / 1000
      const date = new Date(seconds * 1000)
      const pad = (value, width) => String(value).padStart(width, '0')
      return `${pad(date.getHours(), 2)}:${pad(date.getMinutes(), 2)}:${pad(date.getSeconds(), 2)}.${pad(date.getMilliseconds(), 3)}`
    }

    function idOf(canId) {
      return `0x${Number(canId).toString(16).toUpperCase().padStart(3, '0')}`
    }

    function canIdMatcher(raw) {
      const text = String(raw ?? '')
        .trim()
        .replace(/^0x/i, '')
        .replace(/\uFF1F/g, '?')
        .replace(/\uFF0A/g, '*')
      if (text.length === 0) return undefined
      if (text.includes('*') || text.includes('?')) {
        if (!/^[0-9a-f*?]+$/i.test(text)) return undefined
        const source = text.split('').map((char) => {
          if (char === '*') return '[0-9a-f]*'
          if (char === '?') return '[0-9a-f]'
          return char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        }).join('')
        const pattern = new RegExp(`^${source}$`, 'i')
        return (canId) => pattern.test(Number(canId).toString(16))
      }
      if (!/^[0-9a-f]+$/i.test(text)) return undefined
      const wanted = Number.parseInt(text, 16)
      return (canId) => Number(canId) === wanted
    }

    function displayText(text) {
      return String(text ?? '').replace(/\r/g, '').replace(/\n+$/, '')
    }

    /** Normalize a hex string into uppercase byte pairs separated by spaces. */
    function spacedHex(value) {
      const clean = String(value ?? '').replace(/[^0-9a-fA-F]/g, '')
      const pairs = clean.match(/../g)
      return pairs ? pairs.join(' ').toUpperCase() : ''
    }

    /** Extract the NRC from a `7F <sid> <nrc>` negative response. */
    function nrcOf(data) {
      const bytes = String(data ?? '').split(' ')
      if (bytes.length < 3 || bytes[0] !== '7F') return undefined
      const code = Number.parseInt(bytes[2], 16)
      return Number.isFinite(code) ? code : undefined
    }

    function nrcText(t, code) {
      const key = `nrc.${code.toString(16).toUpperCase().padStart(2, '0')}`
      const text = t(key)
      return text === key ? t('uds.unknownNrc') : text
    }

    /** Normalize a user-entered DID to two uppercase hex bytes. */
    function didBytes(value) {
      const clean = String(value ?? '').replace(/^0x/i, '').replace(/\s/g, '')
      if (!/^[0-9a-fA-F]{1,4}$/.test(clean)) return undefined
      return clean.toUpperCase().padStart(4, '0').match(/../g).join(' ')
    }

    const Button = (props) => h('button', {
      type: 'button',
      className: 'ewb-btn' + (props.variant === 'primary' ? ' primary' : ''),
      disabled: props.disabled,
      onClick: props.onClick,
      title: props.title,
    }, props.children)

    const Input = (props) => h('input', {
      className: 'ewb-input' + (props.className ? ` ${props.className}` : ''),
      type: props.type,
      value: props.value,
      placeholder: props.placeholder,
      onChange: props.onChange,
      onKeyDown: props.onKeyDown,
      'aria-label': props.placeholder,
      spellCheck: false,
    })

    const Select = (props) => h('select', {
      className: 'ewb-select',
      value: props.value,
      onChange: props.onChange,
    }, props.options.map((option) => h('option', { key: option.value, value: option.value }, option.label)))

    const Tag = (props) => h('span', { className: 'ewb-tag' + (props.tone ? ` ${props.tone}` : '') }, props.children)

    function stateLabel(t, state) {
      return t(`state.${state === 'ready' || state === 'connecting' || state === 'error' ? state : 'closed'}`)
    }

    /** better-sidebar tab glyph. */
    function WorkbenchIcon(size = 18) {
      return h('svg', {
        width: size,
        height: size,
        viewBox: '0 0 24 24',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.7,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
      }, [
        h('rect', { key: 'screen', x: '3', y: '4.5', width: '18', height: '15', rx: '2' }),
        h('path', { key: 'prompt', d: 'M6.5 9.5l2 2-2 2M11 13.5h4.5M6.5 17h11' }),
      ])
    }

    /** The panel. */
    function Workbench(props) {
      const { t } = props
      const [status, setStatus] = useState({
        serial: { state: 'closed', error: '', config: {}, recording: null, bytesIn: 0, bytesOut: 0, lines: 0, rate: 0, ring: 0 },
        can: { state: 'closed', error: '', config: {}, recording: null, frames: 0, rate: 0, ring: 0 },
      })
      const [tab, setTab] = useState('serial')
      const [busy, setBusy] = useState('')
      const [notice, setNotice] = useState('')

      const [serialRows, setSerialRows] = useState([])
      const [canRows, setCanRows] = useState([])
      const [serialPaused, setSerialPaused] = useState(false)
      const [canPaused, setCanPaused] = useState(false)
      const serialPausedRef = useRef(false)
      const canPausedRef = useRef(false)

      const [ports, setPorts] = useState([])
      const [port, setPort] = useState('')
      const [baud, setBaud] = useState('115200')
      const [serialMode, setSerialMode] = useState('text')
      const [serialView, setSerialView] = useState('text')
      const [newline, setNewline] = useState('crlf')
      const [dirFilter, setDirFilter] = useState('all')
      const [txDraft, setTxDraft] = useState('')

      const [canSendId, setCanSendId] = useState('0x123')
      const [canSendData, setCanSendData] = useState('01 02 03 04')
      const [canSendFd, setCanSendFd] = useState(0)
      const [canSendLength, setCanSendLength] = useState(8)
      const [canFilter, setCanFilter] = useState('')
      const [canViewMode, setCanViewMode] = useState('frame')
      const [canTimeMode, setCanTimeMode] = useState('abs')

      const [udsRows, setUdsRows] = useState([])
      const [udsReqId, setUdsReqId] = useState('')
      const [udsResId, setUdsResId] = useState('')
      const [udsDid, setUdsDid] = useState('F190')
      const [udsDidData, setUdsDidData] = useState('')
      const [udsPending, setUdsPending] = useState(false)

      const [draft, setDraft] = useState(undefined)
      const [settingsMessage, setSettingsMessage] = useState('')

      const serialLogRef = useRef(null)
      const canLogRef = useRef(null)
      const udsLogRef = useRef(null)
      const initializedRef = useRef(false)
      const serialCursorRef = useRef(0)
      const canCursorRef = useRef(0)
      const udsSeqRef = useRef(0)

      useEffect(() => {
        serialPausedRef.current = serialPaused
      }, [serialPaused])
      useEffect(() => {
        canPausedRef.current = canPaused
      }, [canPaused])

      // Counters and connection state; rows arrive on the cursor poll below.
      useEffect(() => {
        let alive = true
        const tick = async () => {
          const next = await call({ op: 'status' })
          if (!alive || !next?.ok) return
          setStatus(next)
          setDraft((previous) => previous ?? clone(next.settings))
          if (!initializedRef.current && next.serial?.config) {
            initializedRef.current = true
            setPort(next.serial.config.port || '')
            setBaud(String(next.serial.config.baud ?? 115200))
          }
        }
        tick()
        const timer = setInterval(tick, 1500)
        return () => {
          alive = false
          clearInterval(timer)
        }
      }, [])

      // Incremental polling: a browser tab reaches the Host at the same origin,
      // and the Desktop page's dsh-app protocol forwards `/api/*` there. Paused
      // sides keep their cursor, so the Host ring buffers and resume replays.
      useEffect(() => {
        let alive = true
        const tick = async () => {
          if (!serialPausedRef.current) {
            const result = await call({ op: 'serialRecent', since: serialCursorRef.current, limit: 400 })
            if (alive && result?.ok && Array.isArray(result.rows) && result.rows.length > 0) {
              serialCursorRef.current = result.rows[result.rows.length - 1].seq
              setSerialRows((previous) => {
                const next = previous.concat(result.rows)
                return next.length > MAX_SERIAL_ROWS ? next.slice(next.length - MAX_SERIAL_ROWS) : next
              })
            }
          }
          if (!canPausedRef.current) {
            const result = await call({ op: 'canRecent', since: canCursorRef.current, limit: 400 })
            if (alive && result?.ok && Array.isArray(result.rows) && result.rows.length > 0) {
              canCursorRef.current = result.rows[result.rows.length - 1].seq
              setCanRows((previous) => {
                const next = previous.concat(result.rows)
                return next.length > MAX_CAN_ROWS ? next.slice(next.length - MAX_CAN_ROWS) : next
              })
            }
          }
        }
        tick()
        const timer = setInterval(tick, 300)
        return () => {
          alive = false
          clearInterval(timer)
        }
      }, [])

      // Port list: refresh on demand and once on mount.
      const loadPorts = useCallback(async () => {
        const result = await call({ op: 'serialPorts' })
        if (result?.ok && Array.isArray(result.ports)) {
          setPorts(result.ports)
          setNotice(result.warning ? t('notice.ports') : '')
          setPort((previous) => previous || result.ports[0]?.device || '')
        } else {
          setNotice(result?.error ?? t('notice.ports'))
        }
      }, [t])

      useEffect(() => {
        loadPorts()
      }, [loadPorts])

      useEffect(() => {
        const element = serialLogRef.current
        if (element) element.scrollTop = element.scrollHeight
      }, [serialRows.length, tab])

      useEffect(() => {
        const element = canLogRef.current
        if (element) element.scrollTop = element.scrollHeight
      }, [canRows.length, tab])

      useEffect(() => {
        const element = udsLogRef.current
        if (element) element.scrollTop = element.scrollHeight
      }, [udsRows.length, tab])

      const serialState = status.serial?.state ?? 'closed'
      const canState = status.can?.state ?? 'closed'
      const serialReady = serialState === 'ready'
      const canReady = canState === 'ready'
      const serialConfig = status.serial?.config ?? {}
      const canConfig = status.can?.config ?? {}
      const canDevices = Array.isArray(status.can?.devices) && status.can.devices.length
        ? status.can.devices
        : [
          { id: 'zlg', label: 'zlgcan' },
          { id: 'cxcan', label: 'CXCAN' },
          { id: 'virtual', label: 'Virtual loopback' },
        ]
      const canDeviceOptions = canDevices.map((item) => ({
        value: item.id,
        label: item.id === 'zlg' ? t('settings.deviceZlg')
          : item.id === 'cxcan' ? t('settings.deviceCxcan')
            : item.id === 'virtual' ? t('settings.deviceVirtual')
              : (item.label || item.id),
      }))

      useEffect(() => {
        if (!udsReqId && canConfig.reqId !== undefined) setUdsReqId(idOf(canConfig.reqId))
        if (!udsResId && canConfig.resId !== undefined) setUdsResId(idOf(canConfig.resId))
      }, [canConfig.reqId, canConfig.resId])

      const openSerial = async () => {
        setBusy('serial-open')
        setNotice('')
        const settings = clone(draft ?? status.settings)
        if (settings) {
          settings.serial = { ...(settings.serial ?? {}), port, baud: Number(baud) || 115200 }
        }
        const result = await call({ op: 'serialOpen', settings })
        setBusy('')
        if (!result.ok) setNotice(result.error ?? 'connect failed')
        else if ((settings?.serial?.device ?? 'serial') === 'virtual' && port && port !== 'VIRTUAL') {
          setNotice(t('serial.virtualHint'))
        }
      }

      const closeSerial = async () => {
        setBusy('serial-close')
        await call({ op: 'serialClose' })
        setBusy('')
        setStatus((previous) => ({ ...previous, serial: { ...previous.serial, state: 'closed' } }))
      }

      const writeSerial = async () => {
        if (txDraft.length === 0) return
        setBusy('serial-write')
        const payload = serialMode === 'hex'
          ? { op: 'serialWrite', hex: txDraft, newline }
          : { op: 'serialWrite', text: txDraft, newline }
        const result = await call(payload)
        setBusy('')
        if (!result.ok) setNotice(result.error ?? 'send failed')
        else setNotice('')
      }

      const toggleSerialRecord = async () => {
        setBusy('serial-record')
        const enabled = Boolean(status.serial?.recording?.enabled)
        const result = await call({ op: enabled ? 'recordStop' : 'recordStart', source: 'serial' })
        setBusy('')
        if (!result.ok) setNotice(result.error ?? '')
        else setNotice('')
      }

      const openCan = async () => {
        setBusy('can-open')
        setNotice('')
        const result = await call({ op: 'canOpen', settings: clone(draft) })
        setBusy('')
        if (!result.ok) setNotice(result.error ?? 'connect failed')
        else {
          setCanRows([])
          canCursorRef.current = 0
          setNotice('')
        }
      }

      const closeCan = async () => {
        setBusy('can-close')
        await call({ op: 'canClose' })
        setBusy('')
        setStatus((previous) => ({ ...previous, can: { ...previous.can, state: 'closed' } }))
      }

      const hexPairs = (text) => String(text ?? '')
        .replace(/[^0-9a-fA-F]/g, '')
        .toUpperCase()
        .replace(/(.{2})/g, '$1 ')
        .trim()

      const hexBytesOf = (text) => {
        const digits = String(text ?? '').replace(/[^0-9a-fA-F]/g, '')
        const bytes = []
        for (let index = 0; index < digits.length; index += 2) {
          bytes.push(digits.slice(index, index + 2).padEnd(2, '0').toUpperCase())
        }
        return bytes
      }

      const sendCan = async () => {
        setBusy('can-send')
        const channel = Number(draft?.can?.channel ?? status.can?.config?.channel ?? 0) === 1 ? 1 : 0
        const fd = canSendFd === 1 ? 1 : 0
        const bytes = hexBytesOf(canSendData).slice(0, canSendLength)
        while (bytes.length < canSendLength) bytes.push('00')
        const data = bytes.join(' ')
        setCanSendData(data)
        const result = await call({ op: 'canSend', canId: canSendId, data, fd, channel })
        setBusy('')
        if (!result.ok) setNotice(result.error ?? 'send failed')
        else setNotice('')
      }

      const toggleCanRecord = async () => {
        setBusy('can-record')
        const enabled = Boolean(status.can?.recording?.enabled)
        const result = await call({ op: enabled ? 'recordStop' : 'recordStart', source: 'can' })
        setBusy('')
        if (!result.ok) setNotice(result.error ?? '')
        else setNotice('')
      }

      const pushUdsError = (message) => {
        udsSeqRef.current += 1
        setUdsRows((previous) => previous.concat({
          seq: udsSeqRef.current,
          ts: Date.now() / 1000,
          dir: 'err',
          data: message,
        }).slice(-800))
      }

      const sendUds = async (request) => {
        if (!canReady || udsPending) return
        const text = String(request)
        setUdsPending(true)
        udsSeqRef.current += 1
        const started = Date.now()
        const push = (row) => setUdsRows((previous) => previous.concat(row).slice(-800))
        push({ seq: udsSeqRef.current, ts: started / 1000, dir: 'tx', data: spacedHex(text) })
        const result = await call({
          op: 'uds',
          hex: spacedHex(text),
          reqId: udsReqId,
          resId: udsResId,
          channel: Number(draft?.can?.channel ?? canConfig.channel ?? 0) === 1 ? 1 : 0,
          fd: canSendFd === 1 ? 1 : 0,
        })
        setUdsPending(false)
        udsSeqRef.current += 1
        if (result.ok) {
          const response = spacedHex(result.response) || '—'
          push({ seq: udsSeqRef.current, ts: Date.now() / 1000, dir: 'rx', data: response, nrc: nrcOf(response), ms: Date.now() - started })
        } else {
          push({ seq: udsSeqRef.current, ts: Date.now() / 1000, dir: 'err', data: `${t('uds.error')}: ${result.error ?? ''}`, ms: Date.now() - started })
        }
      }

      const sendDid = (writeMode) => {
        const did = didBytes(udsDid)
        if (!did) {
          pushUdsError(t('uds.badDid'))
          return
        }
        if (!writeMode) {
          sendUds(`22 ${did}`)
          return
        }
        const digits = String(udsDidData ?? '').replace(/[^0-9a-fA-F]/g, '')
        if (!digits || digits.length % 2 !== 0) {
          pushUdsError(t('uds.badData'))
          return
        }
        sendUds(`2E ${did} ${hexPairs(digits)}`)
      }

      const saveSettings = async () => {
        if (!draft) return
        setBusy('settings')
        const result = await call({ op: 'saveSettings', settings: draft })
        setBusy('')
        if (result.ok) {
          setSettingsMessage(t('settings.saved'))
          setStatus((previous) => ({ ...previous, settings: result.settings }))
        } else {
          setSettingsMessage(`${t('settings.failed')}: ${result.error ?? ''}`)
        }
      }

      const setSerialField = (field, value) => {
        setDraft((previous) => {
          const next = clone(previous) ?? {}
          next.serial = { ...(next.serial ?? {}), [field]: value }
          return next
        })
        setSettingsMessage('')
      }

      const setCanField = (field, value) => {
        setDraft((previous) => {
          const next = clone(previous) ?? {}
          next.can = { ...(next.can ?? {}), [field]: value }
          return next
        })
        setSettingsMessage('')
      }

      const setTopField = (field, value) => {
        setDraft((previous) => ({ ...(clone(previous) ?? {}), [field]: value }))
        setSettingsMessage('')
      }

      const visibleSerial = serialRows.filter((row) => dirFilter === 'all' || row.dir === dirFilter)
      const canMatches = canIdMatcher(canFilter)
      const visibleCan = canRows.filter((row) => canMatches === undefined || canMatches(row.canId))
      const canDeltas = new Map()
      let previousCanTs
      for (const row of canRows) {
        if (previousCanTs !== undefined) canDeltas.set(row.seq, row.ts - previousCanTs)
        previousCanTs = row.ts
      }
      const canOrigin = Number(status.can?.startedAt) || 0
      const canTimeOf = (row) => {
        if (canTimeMode === 'rel') {
          const delta = canDeltas.get(row.seq)
          return delta === undefined ? '—' : `+${delta.toFixed(4)}s`
        }
        return canOrigin > 0 ? `${Math.max(0, row.ts - canOrigin).toFixed(3)}s` : '—'
      }
      const canGroups = (() => {
        const map = new Map()
        for (const row of visibleCan) {
          const key = `${row.channel ?? 0}:${row.canId}`
          const group = map.get(key)
          if (group === undefined) {
            map.set(key, {
              key,
              canId: row.canId,
              channel: row.channel ?? 0,
              fd: row.fd,
              data: row.data,
              len: row.len,
              count: row.count ?? 1,
              period: row.period,
              firstTs: row.ts,
              lastTs: row.ts,
              dirs: new Set([row.dir ?? 'rx']),
            })
            continue
          }
          group.count = row.count ?? group.count + 1
          group.period = row.period ?? group.period
          group.lastTs = row.ts
          group.data = row.data
          group.len = row.len
          group.fd = row.fd
          group.dirs.add(row.dir ?? 'rx')
        }
        return Array.from(map.values())
          .sort((left, right) => left.canId - right.canId || left.channel - right.channel)
          .map((group) => ({
            ...group,
            period: group.period ?? (group.count > 1 ? (group.lastTs - group.firstTs) / (group.count - 1) : undefined),
            dir: group.dirs.size > 1 ? 'MIX' : Array.from(group.dirs)[0].toUpperCase(),
          }))
      })()

      const head = h('div', { className: 'ewb-head', key: 'head' }, [
        h('h1', { key: 'title', className: 'ewb-title' }, t('panel.title')),
        h(Tag, { key: 'serial-tag', tone: serialReady ? 'ok' : serialState === 'error' ? 'bad' : '' }, `${t('tab.serial')} · ${stateLabel(t, serialState)}`),
        h(Tag, { key: 'can-tag', tone: canReady ? 'ok' : canState === 'error' ? 'bad' : '' }, `${t('tab.can')} · ${stateLabel(t, canState)}`),
        h('div', { key: 'spacer', className: 'ewb-spacer' }),
        serialReady
          ? h(Button, { key: 'serial-close', disabled: busy !== '', onClick: closeSerial }, t('action.disconnect'))
          : null,
        h('p', { key: 'sub', className: 'ewb-sub' }, t('panel.subtitle')),
      ])

      const tabs = h('div', { className: 'ewb-tabs', key: 'tabs' }, [
        ['serial', 'tab.serial'],
        ['can', 'tab.can'],
        ['uds', 'tab.uds'],
        ['settings', 'tab.settings'],
      ].map(([id, key]) => h('button', {
        key: id,
        type: 'button',
        className: 'ewb-tab' + (tab === id ? ' active' : ''),
        onClick: () => setTab(id),
      }, t(key))))

      const serialView_ = h('div', { className: 'ewb-main', key: 'serial' }, [
        h('div', { className: 'ewb-tools', key: 'tools' }, [
          h('span', { className: 'ewb-label' }, t('serial.view')),
          h(Select, {
            value: serialView,
            options: [
              { value: 'hex', label: t('serial.view.hex') },
              { value: 'text', label: t('serial.view.text') },
            ],
            onChange: (event) => setSerialView(event.target.value),
          }),
          h(Select, {
            value: dirFilter,
            options: [
              { value: 'all', label: t('serial.filter.all') },
              { value: 'rx', label: t('serial.filter.rx') },
              { value: 'tx', label: t('serial.filter.tx') },
            ],
            onChange: (event) => setDirFilter(event.target.value),
          }),
          h(Button, { onClick: () => setSerialPaused(!serialPaused) }, serialPaused ? t('action.resume') : t('action.pause')),
          h(Button, {
            onClick: async () => {
              await call({ op: 'serialClear' })
              setSerialRows([])
            },
          }, t('action.clear')),
          h('div', { className: 'ewb-spacer' }),
          h('div', { className: 'ewb-stat' }, [h('b', { key: 'b' }, String(status.serial?.lines ?? 0)), h('span', { key: 's' }, t('serial.lines'))]),
          h('div', { className: 'ewb-stat' }, [h('b', { key: 'b' }, String(status.serial?.bytesIn ?? 0)), h('span', { key: 's' }, t('serial.bytesIn'))]),
          h('div', { className: 'ewb-stat' }, [h('b', { key: 'b' }, String(status.serial?.bytesOut ?? 0)), h('span', { key: 's' }, t('serial.bytesOut'))]),
        ]),
        h('div', { className: 'ewb-log', key: 'log', ref: serialLogRef },
          visibleSerial.length === 0
            ? h('div', { className: 'ewb-empty' }, t('serial.empty'))
            : visibleSerial.map((row) => h('div', { key: row.seq, className: 'ewb-line' }, [
              h('span', { key: 't', className: 'ewb-time' }, clockOf(row.ts)),
              h('span', { key: 'd', className: 'ewb-dir ' + row.dir }, row.dir.toUpperCase()),
              serialView === 'hex'
                ? h('span', { key: 'h', className: 'ewb-hex' }, row.data || '—')
                : h('span', { key: 'x', className: 'ewb-text' }, displayText(row.text)),
            ]))),
      ])

      const serialSide = h('div', { className: 'ewb-side', key: 'side' }, [
        notice ? h('p', { key: 'notice', className: 'ewb-warn' }, notice) : null,
        h('div', { className: 'ewb-card', key: 'conn' }, [
          h('h3', { key: 'title' }, t('tab.serial')),
          h('div', { key: 'setup', className: 'ewb-inline' }, [
            h('div', { key: 'device', className: 'ewb-field ewb-uniform' }, [
              h('span', { key: 'l' }, t('serial.device')),
              h(Select, {
                key: 'v',
                value: draft?.serial?.device ?? serialConfig.device ?? 'serial',
                options: [
                  { value: 'serial', label: t('settings.deviceSerial') },
                  { value: 'virtual', label: t('settings.deviceVirtual') },
                ],
                onChange: (event) => setSerialField('device', event.target.value),
              }),
            ]),
            h('div', { key: 'port', className: 'ewb-field ewb-uniform' }, [
              h('span', { key: 'l' }, t('serial.port')),
              h('div', { key: 'ctl', className: 'ewb-row', style: { flexWrap: 'nowrap' } }, [
                ports.length > 0
                  ? h(Select, {
                    key: 'v',
                    value: port,
                    options: (port && !ports.some((item) => item.device === port)
                      ? [{ device: port, description: '' }, ...ports]
                      : ports
                    ).map((item) => ({ value: item.device, label: item.description ? `${item.device} · ${item.description}` : item.device })),
                    onChange: (event) => setPort(event.target.value),
                  })
                  : h(Input, { key: 'v', value: port, placeholder: 'COM7', onChange: (event) => setPort(event.target.value) }),
                h('button', {
                  key: 'r',
                  type: 'button',
                  className: 'ewb-btn ewb-mini',
                  title: t('action.refresh'),
                  'aria-label': t('action.refresh'),
                  disabled: busy !== '',
                  onClick: loadPorts,
                }, '↻'),
              ]),
            ]),
            h('div', { key: 'baud', className: 'ewb-field narrow' }, [
              h('span', { key: 'l' }, t('serial.baud')),
              h(Input, { key: 'v', value: baud, onChange: (event) => setBaud(event.target.value) }),
            ]),
          ]),
          (draft?.serial?.device ?? serialConfig.device) === 'virtual'
            ? h('p', { key: 'virtual-hint', className: 'ewb-warn' }, t('serial.virtualHint'))
            : null,
          h('div', { key: 'state', className: 'ewb-label' },
            serialState === 'ready'
              ? `${serialConfig.device === 'virtual' ? t('serial.virtual') : serialConfig.port || ''} · ${serialConfig.baud ?? ''} · ${serialConfig.dataBits ?? 8}${serialConfig.parity ?? 'N'}${serialConfig.stopBits ?? 1}`
              : status.serial?.error || ''),
          h('div', { key: 'row', className: 'ewb-row' }, [
            serialReady
              ? h(Button, { key: 'close', disabled: busy !== '', onClick: closeSerial }, t('action.disconnect'))
              : h(Button, { key: 'open', variant: 'primary', disabled: busy !== '', onClick: openSerial }, t('action.connect')),
            h(Button, { key: 'rec', disabled: busy !== '', onClick: toggleSerialRecord },
              status.serial?.recording?.enabled ? t('action.stopRecord') : t('action.startRecord')),
          ]),
          status.serial?.recording?.enabled
            ? h('span', { key: 'file', className: 'ewb-label' }, `${status.serial.recording.file} · ${status.serial.recording.rows} ${t('rec.rows')}`)
            : null,
        ]),
        h('div', { className: 'ewb-card', key: 'send' }, [
          h('h3', { key: 'title' }, t('action.send')),
          h('div', { key: 'mode', className: 'ewb-row' }, [
            h(Select, {
              value: serialMode,
              options: [{ value: 'text', label: t('serial.mode.text') }, { value: 'hex', label: t('serial.mode.hex') }],
              onChange: (event) => setSerialMode(event.target.value),
            }),
            h(Select, {
              value: newline,
              options: [
                { value: 'none', label: `${t('serial.newline')}: ${t('serial.newline.none')}` },
                { value: 'lf', label: `${t('serial.newline')}: LF` },
                { value: 'crlf', label: `${t('serial.newline')}: CRLF` },
                { value: 'cr', label: `${t('serial.newline')}: CR` },
              ],
              onChange: (event) => setNewline(event.target.value),
            }),
          ]),
          h(Input, {
            key: 'draft',
            value: txDraft,
            placeholder: t('serial.sendPlaceholder'),
            onChange: (event) => setTxDraft(event.target.value),
            onKeyDown: (event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                writeSerial()
              }
            },
          }),
          h('div', { key: 'row', className: 'ewb-row' }, [
            h(Button, { disabled: !serialReady || busy !== '', onClick: writeSerial }, t('action.send')),
          ]),
        ]),
      ])

      const canTable = h('div', { key: 'table', className: 'ewb-table', ref: canLogRef }, [
        h('table', { key: 'table' }, [
          h('thead', { key: 'h' }, canViewMode === 'group'
            ? h('tr', {}, [
              h('th', { key: 'ch' }, t('can.channel')),
              h('th', { key: 'dir' }, t('can.dir')),
              h('th', { key: 'i' }, t('can.id')),
              h('th', { key: 'ty' }, t('can.type')),
              h('th', { key: 'dl' }, t('can.len')),
              h('th', { key: 'p' }, t('can.period')),
              h('th', { key: 'c' }, t('can.count')),
              h('th', { key: 'd' }, t('can.data')),
            ])
            : h('tr', {}, [
              h('th', { key: 't' }, t('can.time')),
              h('th', { key: 'ch' }, t('can.channel')),
              h('th', { key: 'dir' }, t('can.dir')),
              h('th', { key: 'i' }, t('can.id')),
              h('th', { key: 'ty' }, t('can.type')),
              h('th', { key: 'dl' }, t('can.len')),
              h('th', { key: 'd' }, t('can.data')),
            ])),
          h('tbody', { key: 'b' }, canViewMode === 'group'
            ? canGroups.map((group) => h('tr', { key: group.key }, [
              h('td', { key: 'ch' }, `CAN${group.channel}`),
              h('td', { key: 'dir', className: 'dir ' + group.dir.toLowerCase() }, group.dir),
              h('td', { key: 'i', className: 'id' }, idOf(group.canId)),
              h('td', { key: 'ty' }, group.fd ? 'CANFD' : 'CAN'),
              h('td', { key: 'dl' }, String(group.len ?? 0)),
              h('td', { key: 'p' }, group.period === undefined ? '—' : `${group.period.toFixed(4)}s`),
              h('td', { key: 'c' }, String(group.count)),
              h('td', { key: 'd' }, group.data || '—'),
            ]))
            : visibleCan.map((row) => h('tr', { key: row.seq }, [
              h('td', { key: 't' }, canTimeOf(row)),
              h('td', { key: 'ch' }, `CAN${row.channel ?? 0}`),
              h('td', { key: 'dir', className: 'dir ' + (row.dir === 'tx' ? 'tx' : 'rx') }, (row.dir ?? 'rx').toUpperCase()),
              h('td', { key: 'i', className: 'id' }, idOf(row.canId)),
              h('td', { key: 'ty' }, row.fd ? 'CANFD' : 'CAN'),
              h('td', { key: 'dl' }, String(row.len ?? 0)),
              h('td', { key: 'd' }, row.data || '—'),
            ]))),
        ]),
      ])

      const canView = h('div', { className: 'ewb-main', key: 'can' }, [
        h('div', { className: 'ewb-tools', key: 'tools' }, [
          h('span', { key: 'l', className: 'ewb-label' }, t('can.filter')),
          h(Select, {
            key: 'view-mode',
            value: canViewMode,
            options: [
              { value: 'frame', label: t('can.view.frame') },
              { value: 'group', label: t('can.view.group') },
            ],
            onChange: (event) => setCanViewMode(event.target.value),
          }),
          h(Input, {
            key: 'filter',
            value: canFilter,
            placeholder: t('can.filterPlaceholder'),
            onChange: (event) => setCanFilter(event.target.value),
          }),
          canViewMode === 'frame'
            ? h(Select, {
              key: 'time-mode',
              value: canTimeMode,
              options: [
                { value: 'abs', label: t('can.time.abs') },
                { value: 'rel', label: t('can.time.rel') },
              ],
              onChange: (event) => setCanTimeMode(event.target.value),
            })
            : null,
          h(Button, { key: 'pause', onClick: () => setCanPaused(!canPaused) }, canPaused ? t('action.resume') : t('action.pause')),
          h(Button, {
            key: 'clear',
            onClick: async () => {
              await call({ op: 'canClear' })
              setCanRows([])
              setStatus((previous) => ({ ...previous, can: { ...previous.can, frames: 0, rate: 0, ring: 0 } }))
            },
          }, t('action.clear')),
          h('div', { key: 'spacer', className: 'ewb-spacer' }),
          h('div', { key: 'f', className: 'ewb-stat' }, [h('b', { key: 'b' }, String(status.can?.frames ?? 0)), h('span', { key: 's' }, t('can.frames'))]),
          h('div', { key: 'r', className: 'ewb-stat' }, [h('b', { key: 'b' }, String(status.can?.rate ?? 0)), h('span', { key: 's' }, t('can.rate'))]),
          h('div', { key: 'g', className: 'ewb-stat' }, [h('b', { key: 'b' }, String(status.can?.ring ?? 0)), h('span', { key: 's' }, t('can.ring'))]),
        ]),
        visibleCan.length === 0
          ? h('div', { key: 'empty', className: 'ewb-empty' }, t('can.empty'))
          : canTable,
      ])

      const canSide = h('div', { className: 'ewb-side', key: 'side' }, [
        notice ? h('p', { key: 'notice', className: 'ewb-warn' }, notice) : null,
        h('div', { className: 'ewb-card', key: 'conn' }, [
          h('h3', { key: 'title' }, t('tab.can')),
          h('div', { key: 'row', className: 'ewb-inline' }, [
            canReady
              ? h(Button, { key: 'close', disabled: busy !== '', onClick: closeCan }, t('action.disconnect'))
              : h(Button, { key: 'open', variant: 'primary', disabled: busy !== '', onClick: openCan }, t('action.connect')),
            h(Button, { key: 'rec', disabled: busy !== '', onClick: toggleCanRecord },
              status.can?.recording?.enabled ? t('action.stopRecord') : t('action.startRecord')),
            h('div', { key: 'device', className: 'ewb-field ewb-uniform' }, [
              h('span', { key: 'l' }, t('settings.device')),
              h(Select, {
                key: 'v',
                value: draft?.can?.device ?? canConfig.device ?? 'zlg',
                options: canDeviceOptions,
                onChange: (event) => setCanField('device', event.target.value),
              }),
            ]),
          ]),
          canState === 'error' && status.can?.error
            ? h('p', { key: 'state', className: 'ewb-warn' }, status.can.error)
            : null,
          status.can?.recording?.enabled
            ? h('span', { key: 'file', className: 'ewb-label' }, `${status.can.recording.file} · ${status.can.recording.rows} ${t('rec.rows')}`)
            : null,

        ]),
        h('div', { className: 'ewb-card', key: 'send' }, [
          h('h3', { key: 'title' }, t('can.sendTitle')),
          h('div', { key: 'framing', className: 'ewb-inline' }, [
            h('div', { key: 'channel', className: 'ewb-field ewb-uniform' }, [
              h('span', { key: 'l' }, t('can.sendChannel')),
              h(Select, {
                key: 'v',
                value: String(draft?.can?.channel ?? canConfig.channel ?? 0),
                options: [
                  { value: '0', label: 'CAN0' },
                  { value: '1', label: 'CAN1' },
                ],
                onChange: (event) => setCanField('channel', Number(event.target.value)),
              }),
            ]),
            h('div', { key: 'fd', className: 'ewb-field ewb-uniform' }, [
              h('span', { key: 'l' }, t('can.sendType')),
              h(Select, {
                key: 'v',
                value: String(canSendFd),
                options: [
                  { value: '0', label: t('can.typeCan') },
                  { value: '1', label: t('can.typeFd') },
                ],
                onChange: (event) => {
                  const next = Number(event.target.value)
                  setCanSendFd(next)
                  if (next === 0 && canSendLength > 8) setCanSendLength(8)
                },
              }),
            ]),
            h('div', { key: 'length', className: 'ewb-field narrow' }, [
              h('span', { key: 'l' }, t('can.sendLength')),
              h(Select, {
                key: 'v',
                value: String(canSendLength),
                options: (canSendFd
                  ? [0, 1, 2, 3, 4, 5, 6, 7, 8, 12, 16, 20, 24, 32, 48, 64]
                  : [0, 1, 2, 3, 4, 5, 6, 7, 8]
                ).map((value) => ({ value: String(value), label: String(value) })),
                onChange: (event) => setCanSendLength(Number(event.target.value)),
              }),
            ]),
          ]),
          h('div', { key: 'id', className: 'ewb-align' }, [
            h('span', { key: 'l', className: 'ewb-label' }, t('can.id')),
            h(Input, { key: 'v', value: canSendId, onChange: (event) => setCanSendId(event.target.value) }),
          ]),
          h('div', { key: 'data', className: 'ewb-align' }, [
            h('span', { key: 'l', className: 'ewb-label' }, t('can.data')),
            h(Input, { key: 'v', value: canSendData, onChange: (event) => setCanSendData(hexPairs(event.target.value)) }),
          ]),
          h('div', { key: 'row', className: 'ewb-row' }, [
            h(Button, { disabled: !canReady || busy !== '', onClick: sendCan }, t('action.send')),
          ]),
        ]),
      ])

      const udsView = h('div', { className: 'ewb-main ewb-uds-main', key: 'uds' }, [
        h('div', { className: 'ewb-tools', key: 'tools' }, [
          h(Tag, { key: 'state', tone: canReady ? 'ok' : canState === 'error' ? 'bad' : '' },
            `${t('tab.can')} · ${stateLabel(t, canState)}`),
          h('div', { key: 'spacer', className: 'ewb-spacer' }),
          h('span', { key: 'ids', className: 'ewb-label' }, `${udsReqId || '—'} → ${udsResId || '—'}`),
          udsPending ? h('span', { key: 'wait', className: 'ewb-label' }, t('uds.waiting')) : null,
          h(Button, {
            key: 'clear',
            onClick: () => setUdsRows([]),
          }, t('action.clear')),
        ]),
        udsRows.length === 0
          ? h('div', { key: 'empty', className: 'ewb-empty' }, t('uds.empty'))
          : h('div', { key: 'log', className: 'ewb-log', ref: udsLogRef }, udsRows.map((row) => h('div', { key: row.seq, className: 'ewb-line' }, [
            h('span', { key: 't', className: 'ewb-time' }, clockOf(row.ts)),
            h('span', { key: 'd', className: 'ewb-dir ' + row.dir }, row.dir === 'tx' ? 'TX' : row.dir === 'rx' ? 'RX' : 'ERR'),
            h('span', { key: 'h', className: 'ewb-hex' }, row.data),
            row.nrc === undefined ? null : h('span', { key: 'nrc', className: 'ewb-nrc' },
              `${t('uds.nrc')} 0x${row.nrc.toString(16).toUpperCase().padStart(2, '0')} · ${nrcText(t, row.nrc)}`),
            row.ms === undefined ? null : h('span', { key: 'ms', className: 'ewb-time' }, `${row.ms} ms`),
          ]))),
      ])

      const udsSide = h('div', { className: 'ewb-side ewb-uds-side', key: 'side' }, [
        h('div', { className: 'ewb-card', key: 'quick' }, [
          h('h3', { key: 'title' }, t('uds.quick')),
          h('div', { key: 'ids', className: 'ewb-inline' }, [
            h('div', { key: 'req', className: 'ewb-field ewb-uniform' }, [
              h('span', { key: 'l' }, t('uds.reqId')),
              h(Input, { key: 'v', value: udsReqId, onChange: (event) => setUdsReqId(event.target.value) }),
            ]),
            h('div', { key: 'res', className: 'ewb-field ewb-uniform' }, [
              h('span', { key: 'l' }, t('uds.resId')),
              h(Input, { key: 'v', value: udsResId, onChange: (event) => setUdsResId(event.target.value) }),
            ]),
          ]),
          [
            ['uds.group.session', [
              ['10 01', 'uds.defaultSession'],
              ['10 02', 'uds.programSession'],
              ['10 03', 'uds.extendedSession'],
              ['3E 00', 'uds.tester'],
            ]],
            ['uds.group.reset', [
              ['11 01', 'uds.hardReset'],
              ['11 03', 'uds.softReset'],
            ]],
            ['uds.group.dtc', [
              ['19 02 FF', 'uds.dtc'],
              ['14 FF FF FF', 'uds.clearDtc'],
              ['85 01', 'uds.dtcOn'],
              ['85 02', 'uds.dtcOff'],
            ]],
          ].map(([group, services]) => h('div', { key: group, className: 'ewb-service-group' }, [
            h('span', { key: 'label', className: 'ewb-label' }, t(group)),
            h('div', { key: 'row', className: 'ewb-row' }, services.map(([request, key]) => h(Button, {
              key: request,
              title: request,
              disabled: !canReady || udsPending,
              onClick: () => sendUds(request),
            }, t(key)))),
          ])),
          h('div', { key: 'did', className: 'ewb-service-group ewb-did-group' }, [
            h('span', { key: 'label', className: 'ewb-label' }, t('uds.group.data')),
            h('div', { key: 'row', className: 'ewb-row ewb-did-row' }, [
              h(Input, {
                key: 'did',
                className: 'ewb-did',
                value: udsDid,
                placeholder: t('uds.didPlaceholder'),
                onChange: (event) => setUdsDid(event.target.value),
              }),
              h(Input, {
                key: 'data',
                className: 'ewb-did-data',
                value: udsDidData,
                placeholder: t('uds.dataPlaceholder'),
                onChange: (event) => setUdsDidData(hexPairs(event.target.value)),
              }),
              h(Button, {
                key: 'read',
                title: '22 <DID>',
                disabled: !canReady || udsPending,
                onClick: () => sendDid(false),
              }, t('uds.readDid')),
              h(Button, {
                key: 'write',
                title: '2E <DID> <data>',
                disabled: !canReady || udsPending,
                onClick: () => sendDid(true),
              }, t('uds.writeDid')),
            ]),
          ]),
        ]),
      ])

      const settingsView = h('div', { className: 'ewb-form', key: 'settings' }, draft
        ? [
          h('h2', { key: 'title', style: { margin: 0, fontSize: '15px' } }, t('settings.title')),
          h('p', { key: 'sub', className: 'hint' }, t('settings.subtitle')),

          h('h3', { key: 'env' }, t('settings.env')),
          h('div', { key: 'env-grid', className: 'ewb-grid' }, [
            h('label', { key: 'python', className: 'ewb-field' }, [
              h('span', { key: 'l' }, t('settings.python')),
              h(Input, { key: 'v', value: draft.python ?? 'python', onChange: (event) => setTopField('python', event.target.value) }),
            ]),
            h('label', { key: 'rec', className: 'ewb-field' }, [
              h('span', { key: 'l' }, t('settings.recordDir')),
              h(Input, { key: 'v', value: draft.recordDir ?? '', placeholder: '', onChange: (event) => setTopField('recordDir', event.target.value) }),
            ]),
          ]),
          h('p', { key: 'env-hint', className: 'hint' }, `${t('settings.pythonHint')} ${t('settings.recordDirHint')}`),

          h('h3', { key: 'serial' }, t('settings.serialDefaults')),
          h('div', { key: 'serial-grid', className: 'ewb-grid' }, [
            h('label', { key: 'bits', className: 'ewb-field' }, [
              h('span', { key: 'l' }, t('settings.dataBits')),
              h(Select, {
                value: String(draft.serial?.dataBits ?? 8),
                options: ['5', '6', '7', '8'].map((value) => ({ value, label: value })),
                onChange: (event) => setSerialField('dataBits', Number(event.target.value)),
              }),
            ]),
            h('label', { key: 'parity', className: 'ewb-field' }, [
              h('span', { key: 'l' }, t('settings.parity')),
              h(Select, {
                value: draft.serial?.parity ?? 'N',
                options: [['N', 'None'], ['E', 'Even'], ['O', 'Odd'], ['M', 'Mark'], ['S', 'Space']].map(([value, label]) => ({ value, label })),
                onChange: (event) => setSerialField('parity', event.target.value),
              }),
            ]),
            h('label', { key: 'stop', className: 'ewb-field' }, [
              h('span', { key: 'l' }, t('settings.stopBits')),
              h(Select, {
                value: String(draft.serial?.stopBits ?? 1),
                options: ['1', '1.5', '2'].map((value) => ({ value, label: value })),
                onChange: (event) => setSerialField('stopBits', Number(event.target.value)),
              }),
            ]),
            h('label', { key: 'flow', className: 'ewb-field' }, [
              h('span', { key: 'l' }, t('settings.flow')),
              h(Select, {
                value: draft.serial?.flow ?? 'none',
                options: [['none', 'None'], ['rtscts', 'RTS/CTS'], ['xonxoff', 'XON/XOFF']].map(([value, label]) => ({ value, label })),
                onChange: (event) => setSerialField('flow', event.target.value),
              }),
            ]),
            h('label', { key: 'encoding', className: 'ewb-field' }, [
              h('span', { key: 'l' }, t('settings.encoding')),
              h(Input, { value: draft.serial?.encoding ?? 'utf-8', onChange: (event) => setSerialField('encoding', event.target.value) }),
            ]),
          ]),
          h('p', { key: 'serial-hint', className: 'hint' }, t('settings.encodingHint')),

          h('h3', { key: 'can' }, t('settings.canDefaults')),
          h('div', { key: 'can-grid', className: 'ewb-grid' }, [
            h('label', { key: 'bitrate', className: 'ewb-field' }, [
              h('span', { key: 'l' }, t('settings.canBitrate')),
              h(Select, {
                value: String(draft.can?.bitrate ?? 500000),
                options: [125000, 250000, 500000, 800000, 1000000].map((value) => ({ value: String(value), label: `${value / 1000} kbit/s` })),
                onChange: (event) => setCanField('bitrate', Number(event.target.value)),
              }),
            ]),
            h('label', { key: 'data-bitrate', className: 'ewb-field' }, [
              h('span', { key: 'l' }, t('settings.canDataBitrate')),
              h(Select, {
                value: String(draft.can?.dataBitrate ?? 2000000),
                options: [1000000, 2000000, 4000000, 5000000].map((value) => ({ value: String(value), label: `${value / 1000000} Mbit/s` })),
                onChange: (event) => setCanField('dataBitrate', Number(event.target.value)),
              }),
            ]),
            h('label', { key: 'poll', className: 'ewb-field' }, [
              h('span', { key: 'l' }, t('settings.pollSeconds')),
              h(Input, { value: String(draft.can?.pollSeconds ?? 0.1), onChange: (event) => setCanField('pollSeconds', Number(event.target.value) || 0.1) }),
            ]),
          ]),
          h('p', { key: 'can-hint', className: 'hint' }, t('settings.canBitrateHint')),

          h('div', { key: 'actions', className: 'ewb-row', style: { marginTop: '12px' } }, [
            h(Button, { key: 'save', variant: 'primary', disabled: busy !== '', onClick: saveSettings }, t('action.save')),
            h(Button, {
              key: 'reload',
              disabled: busy !== '',
              onClick: () => {
                setDraft(clone(status.settings))
                setSettingsMessage('')
              },
            }, t('action.reload')),
          ]),
          settingsMessage ? h('p', { key: 'msg', className: 'hint' }, settingsMessage) : null,
        ]
        : [h('p', { key: 'wait', className: 'hint' }, '…')])

      let body
      if (tab === 'serial') body = [serialView_, serialSide]
      else if (tab === 'can') body = [canView, canSide]
      else if (tab === 'uds') body = [udsView, udsSide]
      else body = [settingsView]

      return h('div', { className: 'ewb-root' }, [
        h('style', { key: 'style' }, CSS),
        head,
        tabs,
        h('div', { className: 'ewb-body', key: 'body' }, body),
      ])
    }

    function apply(ctx) {
      const dict = ctx.locale && typeof ctx.locale.bind === 'function' ? ctx.locale.bind(NS) : undefined
      const t = dict ? (key) => dict(key) : (key) => key
      if (ctx.locale && typeof ctx.locale.register === 'function') {
        ctx.effect(() => ctx.locale.register(NS, { zh: ZH, en: EN }), 'embedded-workbench: dictionaries')
      }

      ctx.effect(() => ctx.betterSidebar.registerTab({
        id: PANEL,
        title: () => t('panel.title'),
        description: () => t('panel.short'),
        icon: WorkbenchIcon,
        order: 60,
        single: true,
        component: (ownerProps) => h(Workbench, Object.assign({}, ownerProps, { t })),
      }), 'embedded-workbench: better-sidebar tab')
    }

    return {
      inject: ['locale', 'betterSidebar'],
      apply,
    }
  },
})
