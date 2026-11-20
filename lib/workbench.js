/**
 * The workbench Host: two device bridges, two frame rings, CSV recording and
 * one JSON endpoint consumed by the Web panel.
 *
 * Deliberately no `ctx.provide`: a function placed in a service namespace
 * leaks into shared scopes and the browser cannot structured-clone it. The
 * panel posts JSON to `/api/embedded-workbench` and polls incremental slices
 * with a `since` cursor; a relative route is served by the Web server and
 * forwarded to it by the Desktop page's `dsh-app://app/` protocol handler.
 *
 * @module dsh-embedded-workbench/workbench
 */
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { appendFile, mkdir, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

import { CanBridge } from './can.js'
import { PY_PORTS, SerialBridge, parsePorts } from './serial.js'
import {
  canIdFilter,
  clamp,
  csvField,
  defaultRecordDir,
  hexId,
  parseId,
  settingsFile,
} from './util.js'

/** Rows kept for reconnect/replay per side. */
const RING = 4000
/** Rows returned by one `recent` answer. */
const RECENT_LIMIT = 400
/** Rows an agent snapshot may include per side. */
const TOOL_LIMIT = 120

/** CAN registry shipped with the driver; shared by Host, UI and Python. */
const CAN_MANIFEST = JSON.parse(readFileSync(new URL('./can-driver/devices.json', import.meta.url), 'utf8'))
export const CAN_DEVICES = Array.isArray(CAN_MANIFEST.devices) ? CAN_MANIFEST.devices : []
const CAN_DEVICE_IDS = new Set(CAN_DEVICES.map((item) => item.id))
const CAN_DEVICES_SUPPORTED = CAN_DEVICES.filter((item) => !item.platforms || item.platforms.includes(process.platform))

/** Defaults, plain JSON so a missing row config is still a complete config. */
export const DEFAULTS = {
  python: 'python',
  recordDir: '',
  dllDir: '',
  serial: {
    device: 'serial',
    port: '',
    baud: 115200,
    dataBits: 8,
    parity: 'N',
    stopBits: 1,
    flow: 'none',
    encoding: 'utf-8',
    dtr: false,
    rts: false,
  },
  can: {
    device: 'zlg',
    channel: 0,
    fd: 0,
    bitrate: 500000,
    dataBitrate: 2000000,
    reqId: 0x76f,
    resId: 0x7af,
    pollSeconds: 0.1,
    startup: [],
  },
}

/** Unwrap one config field (a reactive cell arrives with `get()`). */
export function fieldOf(raw) {
  if (raw === null || raw === undefined) return undefined
  if (typeof raw === 'object' && typeof raw.get === 'function') {
    try {
      return raw.get()
    } catch {
      return undefined
    }
  }
  return raw
}

/** A trimmed string field. */
export function textOf(raw, fallback = '') {
  const value = fieldOf(raw)
  return typeof value === 'string' ? value.trim() : fallback
}

/** A finite number or the fallback. */
export function numberOf(raw, fallback) {
  const value = fieldOf(raw)
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

/** Split `a;b` into a trimmed list. */
function splitList(raw) {
  const value = fieldOf(raw)
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean)
  return textOf(raw).split(';').map((item) => item.trim()).filter(Boolean)
}

/** Normalize one full config document with `base` as the fallback layer. */
export function normalizeConfig(raw, base = DEFAULTS) {
  const value = fieldOf(raw) ?? {}
  const serialRaw = fieldOf(value.serial) ?? value
  const canRaw = fieldOf(value.can) ?? value
  const serialBase = base.serial ?? DEFAULTS.serial
  const canBase = base.can ?? DEFAULTS.can

  const reqId = parseId(fieldOf(canRaw.reqId)) ?? canBase.reqId
  const resId = parseId(fieldOf(canRaw.resId)) ?? reqId + 0x40
  const baud = Math.trunc(clamp(numberOf(serialRaw.baud, serialBase.baud), 50, 12_000_000, serialBase.baud))
  const dataBits = [5, 6, 7, 8].includes(numberOf(serialRaw.dataBits, serialBase.dataBits))
    ? Math.trunc(numberOf(serialRaw.dataBits, serialBase.dataBits))
    : serialBase.dataBits
  const parity = ['N', 'E', 'O', 'M', 'S'].includes(textOf(serialRaw.parity, serialBase.parity).toUpperCase())
    ? textOf(serialRaw.parity, serialBase.parity).toUpperCase()
    : serialBase.parity
  const stopBits = [1, 1.5, 2].includes(numberOf(serialRaw.stopBits, serialBase.stopBits))
    ? numberOf(serialRaw.stopBits, serialBase.stopBits)
    : serialBase.stopBits

  return {
    python: textOf(value.python, base.python) || 'python',
    recordDir: fieldOf(value.recordDir) === undefined ? base.recordDir : textOf(value.recordDir),
    dllDir: fieldOf(value.dllDir) === undefined ? base.dllDir : textOf(value.dllDir),
    serial: {
      device: textOf(serialRaw.device, serialBase.device) === 'virtual' ? 'virtual' : 'serial',
      port: textOf(serialRaw.port, serialBase.port),
      baud,
      dataBits,
      parity,
      stopBits,
      flow: ['none', 'rtscts', 'xonxoff'].includes(textOf(serialRaw.flow, serialBase.flow))
        ? textOf(serialRaw.flow, serialBase.flow)
        : serialBase.flow,
      encoding: textOf(serialRaw.encoding, serialBase.encoding) || 'utf-8',
      dtr: fieldOf(serialRaw.dtr) === true,
      rts: fieldOf(serialRaw.rts) === true,
    },
    can: {
      device: CAN_DEVICE_IDS.has(textOf(canRaw.device, canBase.device))
        ? textOf(canRaw.device, canBase.device)
        : (CAN_DEVICE_IDS.has(canBase.device) ? canBase.device : 'zlg'),
      channel: numberOf(canRaw.channel, canBase.channel) === 1 ? 1 : 0,
      fd: numberOf(canRaw.fd, canBase.fd) === 1 ? 1 : 0,
      bitrate: Math.trunc(clamp(numberOf(canRaw.bitrate, canBase.bitrate ?? 500000), 10_000, 12_000_000, 500000)),
      dataBitrate: Math.trunc(clamp(numberOf(canRaw.dataBitrate, canBase.dataBitrate ?? 2_000_000), 10_000, 12_000_000, 2_000_000)),
      reqId,
      resId,
      pollSeconds: clamp(numberOf(canRaw.pollSeconds, canBase.pollSeconds), 0.02, 5, canBase.pollSeconds),
      startup: splitList(canRaw.startup ?? canBase.startup),
    },
  }
}

/** Read the persisted settings document, ignoring a missing or malformed file. */
export function loadSettings(file = settingsFile()) {
  try {
    // Synchronous on purpose: `apply` stays synchronous and registration order stays simple.
    const parsed = JSON.parse(readFileSync(file, 'utf8'))
    return parsed && typeof parsed === 'object' ? parsed : undefined
  } catch {
    return undefined
  }
}

/** Persist the settings document atomically. */
export async function saveSettingsDocument(config, file = settingsFile()) {
  await mkdir(dirname(file), { recursive: true })
  const temporary = `${file}.${randomUUID()}.tmp`
  await writeFile(temporary, `${JSON.stringify(config, null, 2)}\n`, 'utf8')
  await rename(temporary, file)
}

/** Compose both bridges, the rings, recording and the HTTP handler. */
export function createWorkbench(ctx, rawConfig) {
  const subprocess = () => {
    const service = ctx.get?.('subprocess')
    return typeof service === 'function' ? service() : service
  }

  let config = normalizeConfig(rawConfig)
  const persisted = loadSettings()
  if (persisted) config = normalizeConfig(persisted, config)

  const serialRing = []
  const canRing = []
  const canStats = new Map()
  let serialSeq = 0
  let canSeq = 0
  let serialRateSample
  let serialRate = 0
  let canRateSample
  let canRate = 0
  let portsCache

  const recordings = {
    serial: undefined,
    can: undefined,
  }

  const recordSerial = (chunk) => {
    serialSeq += 1
    const row = { seq: serialSeq, ts: chunk.ts, dir: chunk.dir, data: chunk.data, text: chunk.text, n: chunk.n }
    serialRing.push(row)
    if (serialRing.length > RING) serialRing.splice(0, serialRing.length - RING)
    const target = recordings.serial
    if (target?.enabled) {
      const line = [
        row.ts.toFixed(6),
        row.dir,
        csvField(row.data),
        csvField(row.text),
      ].join(',') + String.fromCharCode(10)
      target.rows += 1
      target.chain = target.chain.then(() => appendFile(target.file, line)).catch((error) => {
        target.error = String(error)
        target.enabled = false
      })
    }
    const now = Date.now()
    if (!serialRateSample || now - serialRateSample.at >= 1000) {
      serialRate = serialRateSample
        ? Math.round((serialSeq - serialRateSample.total) * 1000 / Math.max(1, now - serialRateSample.at))
        : 0
      serialRateSample = { at: now, total: serialSeq }
    }
  }

  const recordCan = (frame) => {
    canSeq += 1
    const bytes = String(frame.data ?? '').split(/\s+/).filter(Boolean).length
    const row = {
      seq: canSeq,
      ts: frame.ts,
      canId: frame.canId,
      data: frame.data,
      fd: frame.fd,
      dir: frame.dir === 'tx' ? 'tx' : 'rx',
      channel: Number.isFinite(frame.channel) ? frame.channel : config.can.channel,
      len: Number.isFinite(frame.len) ? frame.len : bytes,
    }
    const key = `${row.channel}:${row.canId}`
    const stats = canStats.get(key)
    if (stats === undefined) {
      canStats.set(key, { count: 1, firstTs: row.ts, lastTs: row.ts })
      row.count = 1
    } else {
      stats.count += 1
      stats.lastTs = row.ts
      row.count = stats.count
      row.period = stats.count > 1 ? (stats.lastTs - stats.firstTs) / (stats.count - 1) : undefined
    }
    canRing.push(row)
    if (canRing.length > RING) canRing.splice(0, canRing.length - RING)
    const target = recordings.can
    if (target?.enabled) {
      const line = [
        row.ts.toFixed(6),
        row.channel,
        row.dir.toUpperCase(),
        csvField(hexId(row.canId)),
        row.fd ? 'CANFD' : 'CAN',
        row.len,
        csvField(row.data),
      ].join(',') + String.fromCharCode(10)
      target.rows += 1
      target.chain = target.chain.then(() => appendFile(target.file, line)).catch((error) => {
        target.error = String(error)
        target.enabled = false
      })
    }
    const now = Date.now()
    if (!canRateSample || now - canRateSample.at >= 1000) {
      canRate = canRateSample
        ? Math.round((canSeq - canRateSample.total) * 1000 / Math.max(1, now - canRateSample.at))
        : 0
      canRateSample = { at: now, total: canSeq }
    }
  }

  let serialBridge
  let canBridge
  let canStartedAt = 0

  const ensureSerial = () => {
    if (serialBridge) return serialBridge
    serialBridge = new SerialBridge({
      subprocess: subprocess(),
      config: { ...config.serial, python: config.python },
      onEvent: recordSerial,
    })
    return serialBridge
  }

  const ensureCan = () => {
    if (canBridge) return canBridge
    canBridge = new CanBridge({
      subprocess: subprocess(),
      config: { ...config.can, python: config.python, dllDir: config.dllDir },
      onFrame: recordCan,
    })
    return canBridge
  }

  const recordingView = (side) => {
    const current = recordings[side]
    return current
      ? { enabled: current.enabled, file: current.file, rows: current.rows, error: current.error }
      : null
  }

  const serialStatus = () => ({
    state: serialBridge?.state ?? 'closed',
    error: serialBridge?.error ?? '',
    lines: serialBridge?.lines ?? 0,
    bytesIn: serialBridge?.bytesIn ?? 0,
    bytesOut: serialBridge?.bytesOut ?? 0,
    rate: serialRateSample && Date.now() - serialRateSample.at < 2500 ? Math.max(0, serialRate) : 0,
    ring: serialRing.length,
    seq: serialSeq,
    recording: recordingView('serial'),
    config: { ...config.serial },
  })

  const canStatus = () => ({
    state: canBridge?.state ?? 'closed',
    error: canBridge?.error ?? '',
    frames: canBridge?.frames ?? 0,
    rate: canRateSample && Date.now() - canRateSample.at < 2500 ? Math.max(0, canRate) : 0,
    ring: canRing.length,
    seq: canSeq,
    startedAt: canStartedAt,
    recording: recordingView('can'),
    devices: CAN_DEVICES_SUPPORTED,
    config: { ...config.can },
  })

  const status = () => ({
    ok: true,
    python: config.python,
    recordDir: config.recordDir,
    dllDir: config.dllDir,
    serial: serialStatus(),
    can: canStatus(),
    settings: config,
  })

  /** One-shot Python child, used for port enumeration. */
  const runOnce = async (argv, timeoutMs = 10_000) => {
    const service = subprocess()
    if (!service) return { code: null, stdout: '', stderr: 'subprocess 服务不可用' }
    let handle
    try {
      handle = service.spawn({
        argv,
        cwd: process.cwd(),
        stdio: { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' },
        graceMs: 1000,
      })
    } catch (error) {
      return { code: null, stdout: '', stderr: String(error?.message ?? error) }
    }
    let stdout = ''
    let stderr = ''
    handle.stdout?.setEncoding('utf8')
    handle.stderr?.setEncoding('utf8')
    handle.stdout?.on('data', (chunk) => {
      stdout += String(chunk)
    })
    handle.stderr?.on('data', (chunk) => {
      stderr += String(chunk)
    })
    const timeout = new Promise((resolve) => {
      const timer = setTimeout(() => resolve('timeout'), timeoutMs)
      if (typeof timer.unref === 'function') timer.unref()
    })
    const outcome = await Promise.race([handle.done, timeout])
    if (outcome === 'timeout') {
      handle.terminate()
      return { code: null, stdout, stderr: stderr || 'timed out' }
    }
    return { code: outcome?.exitCode ?? null, stdout, stderr }
  }

  const serialPorts = async () => {
    const now = Date.now()
    if (portsCache && now - portsCache.at < 3000) return portsCache.value
    const result = await runOnce([config.python, '-u', '-c', PY_PORTS])
    const parsed = parsePorts(result.stdout)
    if (!parsed.ok && result.stderr) parsed.error = result.stderr.trim() || parsed.error
    if (config.serial.device === 'virtual') {
      parsed.ports = [{ device: 'VIRTUAL', description: '虚拟回环（演练，无硬件）', hwid: '' }, ...parsed.ports]
    }
    const value = { ok: true, ports: parsed.ports, warning: parsed.ok ? '' : parsed.error }
    portsCache = { at: now, value }
    return value
  }

  const startRecording = async (side, dir) => {
    const current = recordings[side]
    if (current?.enabled) return { ok: true, file: current.file, rows: current.rows }
    const base = typeof dir === 'string' && dir.trim().length > 0 ? dir.trim() : (config.recordDir || defaultRecordDir())
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19)
    const file = `${base.replace(/[\\/]+$/, '')}/${side}-${stamp}.csv`
    const header = side === 'serial'
      ? 'timestamp,direction,data,text'
      : 'timestamp,channel,direction,can_id,type,length,data'
    try {
      await mkdir(dirname(file), { recursive: true })
      await appendFile(file, header + String.fromCharCode(10), 'utf8')
    } catch (error) {
      return { ok: false, error: `无法写入 ${file}: ${String(error)}` }
    }
    recordings[side] = { enabled: true, file, rows: 0, error: '', chain: Promise.resolve() }
    return { ok: true, file, rows: 0 }
  }

  const stopRecording = async (side) => {
    const current = recordings[side]
    if (!current) return { ok: true, file: '', rows: 0 }
    recordings[side] = undefined
    await current.chain.catch(() => {})
    return { ok: true, file: current.file, rows: current.rows, error: current.error }
  }

  const startBothOrOne = async (source, dir) => {
    const targets = source === 'serial' || source === 'can' ? [source] : ['serial', 'can']
    const results = []
    for (const side of targets) results.push({ side, ...(await startRecording(side, dir)) })
    const failed = results.find((item) => !item.ok)
    return failed ? { ok: false, error: failed.error, results } : { ok: true, results }
  }

  const stopBothOrOne = async (source) => {
    const targets = source === 'serial' || source === 'can' ? [source] : ['serial', 'can']
    const results = []
    for (const side of targets) results.push({ side, ...(await stopRecording(side)) })
    return { ok: true, results }
  }

  const recentSerial = (body) => {
    const since = Number.isFinite(body.since) ? body.since : 0
    const limit = Math.min(RECENT_LIMIT, Math.max(1, Number.isFinite(body.limit) ? Math.trunc(body.limit) : 200))
    const dir = body.dir === 'rx' || body.dir === 'tx' ? body.dir : undefined
    const rows = serialRing.filter((row) => row.seq > since && (dir === undefined || row.dir === dir))
    return { ok: true, rows: rows.slice(-limit), seq: serialSeq, dropped: Math.max(0, rows.length - limit) }
  }

  const recentCan = (body) => {
    const since = Number.isFinite(body.since) ? body.since : 0
    const limit = Math.min(RECENT_LIMIT, Math.max(1, Number.isFinite(body.limit) ? Math.trunc(body.limit) : 200))
    const matches = canIdFilter(body.filter)
    const rows = canRing.filter((row) => row.seq > since && (matches === undefined || matches(row.canId)))
    return { ok: true, rows: rows.slice(-limit), seq: canSeq, dropped: Math.max(0, rows.length - limit) }
  }

  const applySettings = async (next) => {
    const merged = normalizeConfig(next, config)
    config = merged
    try {
      await saveSettingsDocument(merged)
    } catch (error) {
      return { ok: false, error: `保存设置失败: ${String(error)}`, settings: merged }
    }
    portsCache = undefined
    return { ok: true, settings: merged }
  }

  /** The JSON command surface shared by the panel and the agent tool. */
  const command = async (body) => {
    const op = String(body.op ?? '')
    try {
      switch (op) {
        case 'status':
          return status()
        case 'serialPorts':
          return serialPorts()
        case 'serialOpen': {
          if (body.settings) await applySettings(body.settings)
          else if (body.port || body.baud) {
            config = normalizeConfig({
              ...config,
              serial: {
                ...config.serial,
                ...(body.port ? { port: body.port } : {}),
                ...(body.baud ? { baud: body.baud } : {}),
              },
            }, config)
          }
          const bridge = ensureSerial()
          return bridge.open()
        }
        case 'serialClose': {
          await stopRecording('serial')
          await serialBridge?.close()
          serialBridge = undefined
          return { ok: true, state: 'closed' }
        }
        case 'serialWrite': {
          if (!serialBridge || serialBridge.state !== 'ready') {
            return { ok: false, error: serialBridge?.error || '串口未连接' }
          }
          const payload = {}
          if (typeof body.hex === 'string' && body.hex.trim().length > 0) payload.hex = body.hex.trim()
          else payload.text = String(body.text ?? '')
          if (typeof body.newline === 'string') payload.newline = body.newline
          if (payload.hex === undefined && payload.text === undefined) return { ok: false, error: '没有要发送的内容' }
          if (payload.hex !== undefined && !/^[0-9a-fA-F\s]+$/.test(payload.hex)) return { ok: false, error: 'HEX 含有非十六进制字符' }
          return serialBridge.call('write', payload)
        }
        case 'serialLine': {
          if (!serialBridge || serialBridge.state !== 'ready') return { ok: false, error: serialBridge?.error || '串口未连接' }
          return serialBridge.call('line', { dtr: body.dtr, rts: body.rts })
        }
        case 'serialRecent':
          return recentSerial(body)
        case 'serialClear':
          serialRing.length = 0
          return { ok: true }
        case 'canOpen': {
          if (body.settings) await applySettings(body.settings)
          const bridge = ensureCan()
          const result = await bridge.open()
          if (result.ok) {
            canStartedAt = Date.now() / 1000
            canRing.length = 0
            canStats.clear()
          }
          return result
        }
        case 'canClose': {
          await stopRecording('can')
          await canBridge?.close()
          canBridge = undefined
          canStartedAt = 0
          return { ok: true, state: 'closed' }
        }
        case 'canSend': {
          if (!canBridge || canBridge.state !== 'ready') return { ok: false, error: canBridge?.error || 'CAN 未连接' }
          const canId = parseId(body.canId)
          if (canId === undefined) return { ok: false, error: '无效的 CAN ID' }
          const data = String(body.data ?? '').trim()
          if (!/^[0-9a-fA-F\s]*$/.test(data)) return { ok: false, error: '数据含有非十六进制字符' }
          const channel = body.channel === 1 ? 1 : 0
          const fd = body.fd === 1 ? 1 : 0
          return canBridge.call('send', { canId, data, fd, channel })
        }
        case 'canRecent':
          return recentCan(body)
        case 'canClear':
          canRing.length = 0
          canStats.clear()
          if (canBridge) canBridge.frames = 0
          canRate = 0
          canRateSample = { at: Date.now(), total: canSeq }
          return { ok: true }
        case 'uds':
        case 'dtc': {
          if (!canBridge || canBridge.state !== 'ready') return { ok: false, error: canBridge?.error || 'CAN 未连接' }
          const hex = String(body.hex ?? '').trim()
          if (op === 'uds' && !/^[0-9a-fA-F\s]+$/.test(hex)) return { ok: false, error: 'UDS 请求含有非十六进制字符' }
          const reqId = parseId(body.reqId) ?? config.can.reqId
          const resId = parseId(body.resId) ?? config.can.resId
          return canBridge.call(op, {
            reqId,
            resId,
            hex,
            channel: body.channel === 1 ? 1 : 0,
          })
        }
        case 'run': {
          if (!canBridge || canBridge.state !== 'ready') return { ok: false, error: canBridge?.error || 'CAN 未连接' }
          const commands = Array.isArray(body.commands)
            ? body.commands.map((item) => String(item).trim()).filter(Boolean)
            : String(body.commands ?? '').split(';').map((item) => item.trim()).filter(Boolean)
          if (commands.length === 0) return { ok: false, error: '没有命令' }
          return canBridge.call('run', { commands })
        }
        case 'recordStart':
          return startBothOrOne(body.source, body.dir)
        case 'recordStop':
          return stopBothOrOne(body.source)
        case 'saveSettings':
          return applySettings(body.settings)
        default:
          return { ok: false, error: `unknown op ${op}` }
      }
    } catch (error) {
      return { ok: false, error: String(error?.message ?? error) }
    }
  }

  /** Reject a cross-site browser request; same-origin and native callers pass. */
  const trusted = (req) => {
    if (req.headers['sec-fetch-site'] === 'cross-site') return false
    const origin = req.headers.origin
    if (!origin || origin === 'null' || origin === 'file://') return true
    try {
      const parsed = new URL(origin)
      return parsed.host === req.headers.host && (parsed.protocol === 'http:' || parsed.protocol === 'https:')
    } catch {
      return false
    }
  }

  const handler = async (req, res) => {
    if (!trusted(req)) {
      res.writeHead(403, { 'content-type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ ok: false, error: 'forbidden origin' }))
      return
    }
    try {
      let body = ''
      for await (const chunk of req) {
        body += chunk
        if (body.length > 1_000_000) throw new Error('body too large')
      }
      const parsed = body.length > 0 ? JSON.parse(body) : {}
      const answer = await command(parsed)
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify(answer))
    } catch (error) {
      res.writeHead(400, { 'content-type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ ok: false, error: String(error?.message ?? error) }))
    }
  }

  /** The agent's read-only view of both sides. */
  const snapshot = ({ source = 'all', limit = 50, since = 0, filter } = {}) => {
    const bounded = Math.min(TOOL_LIMIT, Math.max(1, Number.isFinite(limit) ? Math.trunc(limit) : 50))
    const serialRows = serialRing.filter((row) => row.seq > since)
    const canMatches = canIdFilter(filter)
    const canRows = canRing.filter((row) => row.seq > since && (canMatches === undefined || canMatches(row.canId)))
    const result = { source }
    if (source !== 'can') {
      result.serial = {
        ...serialStatus(),
        rows: serialRows.slice(-bounded),
      }
    }
    if (source !== 'serial') {
      result.can = {
        ...canStatus(),
        rows: canRows.slice(-bounded),
      }
    }
    return result
  }

  const dispose = async () => {
    await stopRecording('serial')
    await stopRecording('can')
    await serialBridge?.close()
    await canBridge?.close()
    serialBridge = undefined
    canBridge = undefined
  }

  return {
    command,
    handler,
    snapshot,
    status,
    dispose,
    getConfig: () => config,
  }
}

/** Re-export the one-shot port driver so the smoke test can run it directly. */
export { PY_PORTS }
