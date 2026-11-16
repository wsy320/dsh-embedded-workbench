/**
 * UART transport for the Embedded Workbench.
 *
 * The Host never touches a COM port itself: one supervised Python child owns
 * the port through pyserial, speaks a line-delimited JSON protocol on stdio,
 * and pushes every received chunk as an event. That keeps the Node side free
 * of native modules and lets the same code serve Windows, Linux and macOS.
 *
 *   -> {"id":"…","op":"write","hex":"41 54","newline":"crlf"}
 *   -> {"id":"…","op":"line","dtr":true}
 *   -> {"id":"…","op":"close"}
 *   <- {"ev":"serial","dir":"rx","ts":…,"data":"41 54","text":"AT","n":2}
 *   <- {"ev":"ready","port":"COM7","baud":115200}
 *   <- {"id":"…","ok":true}
 *
 * `device: "virtual"` needs no pyserial and no hardware: every write is echoed
 * back as an RX chunk, which is what the offline smoke test exercises.
 *
 * @module dsh-embedded-workbench/serial
 */
import { randomUUID } from 'node:crypto'

/** Driver source. `String.raw` keeps Python escapes verbatim. */
export const PY_SERIAL = String.raw`
import codecs, json, sys, threading, time

NL = chr(10)
opts = json.loads(sys.argv[1])
device = str(opts.get('device') or 'serial')
encoding = str(opts.get('encoding') or 'utf-8')
stop = threading.Event()
out_lock = threading.Lock()

def emit(obj):
    with out_lock:
        sys.stdout.write(json.dumps(obj, ensure_ascii=False, separators=(',', ':')) + NL)
        sys.stdout.flush()

def now():
    return time.time()

def hexlify(data):
    return ' '.join('%02X' % int(byte) for byte in data)

def decode(data):
    try:
        return data.decode(encoding, 'replace')
    except LookupError:
        return data.decode('utf-8', 'replace')

def answer(rid, payload):
    payload['id'] = rid
    emit(payload)

def newline_bytes(kind):
    if kind == 'crlf':
        return b'\r\n'
    if kind == 'cr':
        return b'\r'
    if kind == 'lf':
        return b'\n'
    return b''

def handle_virtual(msg):
    op = msg.get('op')
    rid = msg.get('id')
    if op == 'close':
        answer(rid, {'ok': True})
        return False
    if op == 'write':
        if 'hex' in msg and msg.get('hex') is not None:
            data = bytes.fromhex(str(msg.get('hex') or ''))
        else:
            data = str(msg.get('text') or '').encode(encoding, 'replace')
        data += newline_bytes(msg.get('newline'))
        if data:
            emit({'ev': 'serial', 'dir': 'tx', 'ts': now(), 'data': hexlify(data), 'text': decode(data), 'n': len(data)})
            emit({'ev': 'serial', 'dir': 'rx', 'ts': now(), 'data': hexlify(data), 'text': decode(data), 'n': len(data)})
        answer(rid, {'ok': True, 'n': len(data)})
        return True
    if op == 'line':
        answer(rid, {'ok': True})
        return True
    answer(rid, {'ok': False, 'error': 'unknown op ' + str(op)})
    return True

if device == 'virtual':
    emit({'ev': 'ready', 'port': opts.get('port') or 'VIRTUAL', 'baud': int(opts.get('baud') or 115200), 'virtual': True})
    for raw in sys.stdin.buffer:
        line = raw.decode('utf-8', 'replace').strip()
        if not line:
            continue
        try:
            message = json.loads(line)
        except Exception:
            continue
        if not handle_virtual(message):
            break
    sys.exit(0)

try:
    import serial
except Exception:
    sys.stderr.write('pyserial is required for a real port: pip install pyserial' + NL)
    emit({'ev': 'error', 'message': 'pyserial 未安装（pip install pyserial）'})
    sys.exit(3)

ser = serial.Serial()
ser.port = opts.get('port') or ''
try:
    ser.baudrate = int(opts.get('baud') or 115200)
    ser.bytesize = int(opts.get('dataBits') or 8)
    ser.parity = str(opts.get('parity') or 'N')[:1]
    ser.stopbits = float(opts.get('stopBits') or 1)
except Exception:
    sys.stderr.write('invalid serial parameters' + NL)
    emit({'ev': 'error', 'message': '串口参数无效'})
    sys.exit(5)
flow = str(opts.get('flow') or 'none')
ser.rtscts = flow == 'rtscts'
ser.xonxoff = flow == 'xonxoff'
ser.timeout = 0.2
# XCOM leaves both lines unchecked. They MUST be applied before open():
# pyserial programs the DCB from these flags during open. Asserting them for
# the first time and then clearing them after open stops this board's UART
# from delivering anything.
ser.dtr = bool(opts.get('dtr'))
ser.rts = bool(opts.get('rts'))

try:
    ser.open()
except Exception as exc:
    emit({'ev': 'error', 'message': '打开 %s 失败：%s' % (ser.port, exc)})
    sys.stderr.write('open failed: %r' % (exc,) + NL)
    sys.exit(4)

decoder = codecs.getincrementaldecoder(encoding)(errors='replace')

def reader():
    while not stop.is_set():
        try:
            chunk = ser.read(4096)
        except Exception as exc:
            if not stop.is_set():
                emit({'ev': 'error', 'message': '读取失败：%s' % (exc,)})
                stop.set()
            return
        if chunk:
            emit({'ev': 'serial', 'dir': 'rx', 'ts': now(), 'data': hexlify(chunk), 'text': decoder.decode(chunk), 'n': len(chunk)})

threading.Thread(target=reader, name='uart-reader', daemon=True).start()
emit({'ev': 'ready', 'port': ser.port, 'baud': ser.baudrate, 'virtual': False})

for raw in sys.stdin.buffer:
    line = raw.decode('utf-8', 'replace').strip()
    if not line:
        continue
    try:
        message = json.loads(line)
    except Exception:
        continue
    op = message.get('op')
    rid = message.get('id')
    if op == 'close':
        answer(rid, {'ok': True})
        break
    try:
        if op == 'write':
            if 'hex' in message and message.get('hex') is not None:
                data = bytes.fromhex(str(message.get('hex') or ''))
            else:
                data = str(message.get('text') or '').encode(encoding, 'replace')
            data += newline_bytes(message.get('newline'))
            written = ser.write(data)
            ser.flush()
            if data:
                emit({'ev': 'serial', 'dir': 'tx', 'ts': now(), 'data': hexlify(data), 'text': decode(data), 'n': len(data)})
            answer(rid, {'ok': True, 'n': int(written or 0)})
        elif op == 'line':
            if 'dtr' in message:
                ser.dtr = bool(message.get('dtr'))
            if 'rts' in message:
                ser.rts = bool(message.get('rts'))
            answer(rid, {'ok': True})
        else:
            answer(rid, {'ok': False, 'error': 'unknown op ' + str(op)})
    except Exception as exc:
        answer(rid, {'ok': False, 'error': '%s: %s' % (type(exc).__name__, exc)})

stop.set()
try:
    ser.close()
except Exception:
    pass
`

/** One-shot port enumeration; prints a single JSON line. */
export const PY_PORTS = String.raw`
import json
try:
    from serial.tools import list_ports
    ports = [
        {'device': item.device, 'description': item.description or '', 'hwid': item.hwid or ''}
        for item in list_ports.comports()
    ]
    print(json.dumps({'ok': True, 'ports': ports}))
except Exception as exc:
    print(json.dumps({'ok': False, 'error': str(exc), 'ports': []}))
`

/** State machine for the UART child. */
export class SerialBridge {
  /**
   * @param options.subprocess - the resolved `ctx.subprocess` service.
   * @param options.config - `{ python, device, port, baud, dataBits, parity, stopBits, flow, encoding }`.
   * @param options.onEvent - one RX/TX chunk.
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
    this.bytesIn = 0
    this.bytesOut = 0
    this.lines = 0
    this.ready = undefined
  }

  /** Spawn the child and wait for `ready` or a terminal error. */
  async open() {
    if (this.state === 'ready') return { ok: true, state: this.state }
    await this.close()
    const config = this.options.config
    const opts = {
      device: config.device,
      port: config.port,
      baud: config.baud,
      dataBits: config.dataBits,
      parity: config.parity,
      stopBits: config.stopBits,
      flow: config.flow,
      encoding: config.encoding,
      dtr: config.dtr,
      rts: config.rts,
    }
    this.state = 'connecting'
    this.error = ''
    this.options.onState?.({ state: this.state, error: '' })
    try {
      this.handle = this.options.subprocess.spawn({
        argv: [config.python, '-u', '-c', PY_SERIAL, JSON.stringify(opts)],
        cwd: process.cwd(),
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
      () => this.finalize('设备进程已退出'),
      () => this.finalize('设备进程启动失败'),
    )

    const ready = new Promise((resolve) => {
      this.ready = resolve
    })
    const timeout = new Promise((resolve) => {
      const timer = setTimeout(() => resolve('timeout'), 12000)
      if (typeof timer.unref === 'function') timer.unref()
    })
    const settled = await Promise.race([ready, timeout])
    if (settled === 'timeout' || this.state !== 'ready') {
      this.state = 'error'
      this.error = this.error || '串口打开超时'
      this.options.onState?.({ state: this.state, error: this.error })
      return { ok: false, error: this.error }
    }
    return { ok: true, state: this.state }
  }

  /** Split the child's stdout into JSON lines. */
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
    if (message.ev === 'serial') {
      const n = Number(message.n) || 0
      if (message.dir === 'rx') this.bytesIn += n
      else this.bytesOut += n
      this.lines += 1
      this.options.onEvent?.({
        dir: message.dir === 'tx' ? 'tx' : 'rx',
        ts: typeof message.ts === 'number' ? message.ts : Date.now() / 1000,
        data: String(message.data ?? ''),
        text: String(message.text ?? ''),
        n,
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
      this.error = String(message.message ?? '串口错误')
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
  call(op, payload = {}, timeoutMs = 6000) {
    if (this.state !== 'ready') return Promise.resolve({ ok: false, error: this.error || '串口未连接' })
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
    const timer = setTimeout(() => handle.terminate(), 1500)
    if (typeof timer.unref === 'function') timer.unref()
    try {
      await Promise.race([handle.done, new Promise((resolve) => setTimeout(resolve, 2000))])
    } finally {
      clearTimeout(timer)
      handle.terminate()
    }
  }
}

/** Parse the one-shot port listing. */
export function parsePorts(stdout) {
  const lines = String(stdout ?? '').split(String.fromCharCode(10)).map((line) => line.trim()).filter(Boolean)
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      const value = JSON.parse(lines[index])
      if (value && Array.isArray(value.ports)) return value
    } catch {
      // Not the JSON line.
    }
  }
  return { ok: false, error: '端口列表解析失败', ports: [] }
}
