/**
 * CAN transport for the Embedded Workbench.
 *
 * The ZLG USBCANFD is driven by Python modules bundled under
 * `lib/can-driver` (`tool.py` plus `agent.tp.IsoTp` and the vendor DLLs).
 * This file owns the child process and a line-delimited JSON protocol.
 *
 * Unlike a request/response driver that only drains the device when a command
 * arrives, the child reads stdin on a thread and pumps the receive buffer on a
 * fixed interval, so an idle panel still sees traffic and the device queue
 * cannot fill up during a quiet minute.
 *
 * @module dsh-embedded-workbench/can
 */
import { randomUUID } from 'node:crypto'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { toPosix } from './util.js'

/** Bundled ZLG driver (`tool.py`, `agent/`, `zlgcan/`); no external tool dir. */
const DRIVER_DIR = join(dirname(fileURLToPath(import.meta.url)), 'can-driver')

/** Driver source. */
export const PY_CAN = String.raw`
import json, os, queue, sys, threading, time, traceback

NL = chr(10)
here, opts = sys.argv[1], json.loads(sys.argv[2])
sys.path.insert(0, here)

# A DLL directory set in the panel overrides the EWB_<VENDOR>_DLL_DIR env var,
# so the setting works without restarting DSH. Must run before the driver
# imports, because vendor_dll reads os.environ at load time.
_dll_dir = (opts.get('dllDir') or '').strip()
if _dll_dir:
    _vendor = (opts.get('device') or 'zlg').upper()
    os.environ['EWB_%s_DLL_DIR' % _vendor] = _dll_dir

try:
    import tool as zlgtool
    from agent.tp import IsoTp
except Exception:
    sys.stderr.write(traceback.format_exc())
    sys.exit(3)

FD = int(opts.get('fd') or 0)
BITRATE = int(opts.get('bitrate') or 500000)
DATA_BITRATE = int(opts.get('dataBitrate') or 2000000)
POLL_SECONDS = max(0.02, float(opts.get('pollSeconds') or 0.1))
out_lock = threading.Lock()

def emit(obj):
    with out_lock:
        sys.stdout.write(json.dumps(obj, ensure_ascii=False, separators=(',', ':')) + NL)
        sys.stdout.flush()

def hexlify(data):
    return ' '.join('%02X' % int(byte) for byte in data)

CHANNEL = int(opts.get('channel') or 0)
CLOCK = {'hw0': None, 'wall0': None}

def frame_time(timestamp):
    if timestamp is None:
        return time.time()
    stamp = int(timestamp)
    if CLOCK['hw0'] is None:
        CLOCK['hw0'] = stamp
        CLOCK['wall0'] = time.time()
    return CLOCK['wall0'] + (stamp - CLOCK['hw0']) / 1e6

def emit_frame(direction, can_id, data, fd, channel=None, timestamp=None):
    payload = list(data)
    emit({
        'ev': 'frame',
        'dir': direction,
        'channel': CHANNEL if channel is None else int(channel),
        'canId': int(can_id),
        'data': hexlify(payload),
        'fd': int(fd or 0),
        'len': len(payload),
        'ts': frame_time(timestamp),
    })

def as_id(value):
    return int(value, 0) if isinstance(value, str) else int(value)

def log(text):
    sys.stderr.write(str(text) + NL)
    sys.stderr.flush()

bus = zlgtool.make_bus(opts.get('device') or 'zlg', BITRATE, DATA_BITRATE)
ret = bus.open()
if ret != 0:
    emit({'ev': 'error', 'message': 'CAN 设备打开失败(ret=%r)：设备未连接、驱动缺失或已被其他程序占用' % (ret,)})
    sys.exit(4)
try:
    bus.select_channel(int(opts.get('channel') or 0))
except Exception:
    pass

state = {'tp': None}

def link_for(req_id, res_id, fd=FD):
    current = state['tp']
    if (current is None or current.req_id != req_id
            or current.res_id != res_id or current.fd != fd):
        state['tp'] = IsoTp(bus, req_id, res_id, fd=fd)
    return state['tp']

def pump():
    frames = []
    try:
        for mode in (0, 1):
            if hasattr(bus, 'receive_all'):
                frames.extend(bus.receive_all(mode) or [])
            else:
                frames.extend(bus.receive(mode) or [])
    except Exception:
        log('receive failed: %r' % (sys.exc_info()[1],))
        return
    frames.sort(key=lambda frame: getattr(frame, 'timestamp', 0) or 0)
    for frame in frames:
        emit_frame(
            'rx',
            frame.can_id,
            frame.data or [],
            getattr(frame, 'fd', 0),
            getattr(frame, 'channel', 0),
            getattr(frame, 'timestamp', None),
        )

def run_command(command):
    runner = zlgtool.Runner(opts.get('device') or 'zlg', None, None, 0, fd=FD)
    runner.bus = bus
    return runner.run_one(command)

for segment in opts.get('startup') or []:
    try:
        run_command(segment)
    except Exception as exc:
        log('startup %r failed: %r' % (segment, exc))

lines = queue.Queue()

def read_stdin():
    for raw in sys.stdin.buffer:
        lines.put(raw)
    lines.put(None)

threading.Thread(target=read_stdin, name='can-stdin', daemon=True).start()
emit({'ev': 'ready', 'device': opts.get('device'), 'fd': FD})

while True:
    try:
        raw = lines.get(timeout=POLL_SECONDS)
    except queue.Empty:
        pump()
        continue
    if raw is None:
        break
    text = raw.decode('utf-8', 'replace').strip()
    if not text:
        continue
    try:
        message = json.loads(text)
    except Exception:
        continue
    op = message.get('op')
    rid = message.get('id')
    if op == 'close':
        emit({'id': rid, 'ok': True})
        break
    try:
        if op == 'send':
            can_id = as_id(message.get('canId'))
            data = [int(token, 16) for token in str(message.get('data') or '').split()]
            fd = int(message.get('fd', FD))
            channel = int(message.get('channel', CHANNEL))
            if hasattr(bus, 'send_channel'):
                sent = bus.send_channel(can_id, data, fd, channel)
            else:
                sent = bus.send(can_id, data, fd)
            if sent > 0:
                emit_frame('tx', can_id, data, fd, channel)
            pump()
            emit({'id': rid, 'ok': sent > 0, 'detail': 'id=0x%X n=%d' % (can_id, len(data))})
        elif op in ('uds', 'dtc'):
            req_id = as_id(message.get('reqId'))
            res_id = as_id(message.get('resId'))
            channel = int(message.get('channel', CHANNEL))
            uds_fd = int(message.get('fd', FD))
            if hasattr(bus, 'select_channel'):
                bus.select_channel(channel)
            link = link_for(req_id, res_id, uds_fd)
            request = [0x19, 0x02, 0xFF] if op == 'dtc' else [int(token, 16) for token in str(message.get('hex') or '').split()]
            p2 = float(message.get('p2') or 0.1)
            p2_star = float(message.get('p2Star') or 5.0)
            response = link.request(request, p2=p2, p2_star=p2_star, fc_timeout=1.0)
            pump()
            if response is None:
                emit({'id': rid, 'ok': False, 'error': 'timeout', 'response': ''})
            else:
                emit({'id': rid, 'ok': True, 'response': hexlify(response), 'len': len(response)})
        elif op == 'run':
            runner = zlgtool.Runner(
                opts.get('device') or 'zlg',
                int(opts.get('reqId') or 0),
                int(opts.get('resId') or 0),
                0,
                fd=FD,
            )
            runner.bus = bus
            results = [runner.run_one(command) for command in (message.get('commands') or [])]
            pump()
            emit({'id': rid, 'ok': all(bool(item and item.get('ok')) for item in results), 'results': results})
        else:
            emit({'id': rid, 'ok': False, 'error': 'unknown op ' + str(op)})
    except Exception as exc:
        emit({'id': rid, 'ok': False, 'error': '%s: %s' % (type(exc).__name__, exc)})

try:
    bus.close()
except Exception:
    pass
`

/** State machine for the CAN child. */
export class CanBridge {
  /**
   * @param options.subprocess - the resolved `ctx.subprocess` service.
   * @param options.config - `{ python, device, channel, fd, bitrate, dataBitrate, reqId, resId, pollSeconds, startup }`.
   * @param options.onFrame - one received frame.
   * @param options.onState - `{ state, error }`.
   * @param options.onStderr - one stderr chunk.
   */
  constructor(options) {
    this.options = options
    this.handle = undefined
    this.state = 'closed'
    this.error = ''
    this.buffer = ''
    this.pending = new Map()
    this.frames = 0
    this.ready = undefined
  }

  /** Spawn the child and wait for `ready`. */
  async open() {
    if (this.state === 'ready') return { ok: true, state: this.state }
    await this.close()
    const config = this.options.config
    const here = DRIVER_DIR
    const opts = {
      device: config.device,
      channel: config.channel,
      fd: config.fd,
      bitrate: config.bitrate,
      dataBitrate: config.dataBitrate,
      reqId: config.reqId,
      resId: config.resId,
      pollSeconds: config.pollSeconds,
      startup: config.startup,
      dllDir: config.dllDir ?? '',
    }
    this.state = 'connecting'
    this.error = ''
    this.options.onState?.({ state: this.state, error: '' })
    try {
      this.handle = this.options.subprocess.spawn({
        argv: [config.python, '-u', '-c', PY_CAN, toPosix(here), JSON.stringify(opts)],
        cwd: here,
        stdio: { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' },
        graceMs: 3000,
      })
    } catch (error) {
      this.state = 'error'
      this.error = String(error?.message ?? error)
      this.options.onState?.({ state: this.state, error: this.error })
      return { ok: false, error: this.error }
    }
    this.handle.stdout?.setEncoding('utf8')
    this.handle.stderr?.setEncoding('utf8')
    this.handle.stdout?.on('data', (chunk) => this.consume(String(chunk)))
    this.handle.stderr?.on('data', (chunk) => this.options.onStderr?.(String(chunk)))
    this.handle.done.then(
      () => this.finalize('CAN 设备进程已退出'),
      () => this.finalize('CAN 设备进程启动失败'),
    )

    const ready = new Promise((resolve) => {
      this.ready = resolve
    })
    const timeout = new Promise((resolve) => {
      const timer = setTimeout(() => resolve('timeout'), 15000)
      if (typeof timer.unref === 'function') timer.unref()
    })
    const settled = await Promise.race([ready, timeout])
    if (settled === 'timeout' || this.state !== 'ready') {
      this.state = 'error'
      this.error = this.error || 'CAN 设备打开超时'
      this.options.onState?.({ state: this.state, error: this.error })
      return { ok: false, error: this.error }
    }
    return { ok: true, state: this.state }
  }

  /** Split stdout into JSON lines. */
  consume(chunk) {
    this.buffer += chunk
    let index = this.buffer.indexOf(String.fromCharCode(10))
    while (index >= 0) {
      const line = this.buffer.slice(0, index).trim()
      this.buffer = this.buffer.slice(index + 1)
      if (line.length > 0) this.onLine(line)
      index = this.buffer.indexOf(String.fromCharCode(10))
    }
  }

  /** Dispatch one protocol line. */
  onLine(line) {
    let message
    try {
      message = JSON.parse(line)
    } catch {
      return
    }
    if (message.ev === 'frame') {
      this.frames += 1
      this.options.onFrame?.({
        canId: Number(message.canId) || 0,
        data: String(message.data ?? ''),
        fd: Number(message.fd) || 0,
        dir: message.dir === 'tx' ? 'tx' : 'rx',
        channel: Number(message.channel) || 0,
        len: Number.isFinite(Number(message.len)) ? Number(message.len) : undefined,
        ts: typeof message.ts === 'number' ? message.ts : Date.now() / 1000,
      })
      return
    }
    if (message.ev === 'ready') {
      this.state = 'ready'
      this.error = ''
      this.options.onState?.({ state: this.state, error: '' })
      this.ready?.('ready')
      return
    }
    if (message.ev === 'error') {
      this.state = 'error'
      this.error = String(message.message ?? 'CAN 设备错误')
      this.options.onState?.({ state: this.state, error: this.error })
      this.ready?.('error')
      return
    }
    const waiter = this.pending.get(message.id)
    if (!waiter) return
    this.pending.delete(message.id)
    clearTimeout(waiter.timer)
    waiter.resolve(message)
  }

  /** Fail every waiter once the child is gone. */
  finalize(reason) {
    if (this.state === 'closed') return
    this.state = 'error'
    this.error = this.error || reason
    for (const [, waiter] of this.pending) {
      clearTimeout(waiter.timer)
      waiter.resolve({ ok: false, error: this.error })
    }
    this.pending.clear()
    this.options.onState?.({ state: this.state, error: this.error })
    this.ready?.('error')
  }

  /** One command, one answer. */
  call(op, payload = {}, timeoutMs = 20000) {
    if (this.state !== 'ready') return Promise.resolve({ ok: false, error: this.error || 'CAN 未连接' })
    const id = randomUUID()
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        resolve({ ok: false, error: 'timeout' })
      }, timeoutMs)
      if (typeof timer.unref === 'function') timer.unref()
      this.pending.set(id, { resolve, timer })
      try {
        this.handle.stdin.write(JSON.stringify({ id, op, ...payload }) + String.fromCharCode(10))
      } catch (error) {
        clearTimeout(timer)
        this.pending.delete(id)
        resolve({ ok: false, error: String(error) })
      }
    })
  }

  /** Ask the child to close, then terminate it. */
  async close() {
    const handle = this.handle
    this.handle = undefined
    this.state = 'closed'
    if (!handle) return
    try {
      handle.stdin.write(JSON.stringify({ op: 'close' }) + String.fromCharCode(10))
    } catch {
      // The pipe is already gone.
    }
    const timer = setTimeout(() => handle.terminate(), 2000)
    if (typeof timer.unref === 'function') timer.unref()
    try {
      await Promise.race([handle.done, new Promise((resolve) => setTimeout(resolve, 2500))])
    } finally {
      clearTimeout(timer)
      handle.terminate()
    }
  }
}
