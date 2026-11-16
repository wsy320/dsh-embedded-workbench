/**
 * Offline smoke test: no DSH, no hardware.
 *
 * Exercises the exact Host surface the panel uses: `createWorkbench` over a
 * real child process (virtual UART and virtual CAN), the HTTP handler,
 * settings persistence and the agent snapshot.
 *
 *   node test/smoke.mjs [zlg-can directory]
 */
import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createWorkbench } from '../lib/workbench.js'
import { canIdFilter } from '../lib/util.js'
import { defineSnapshotTool } from '../index.js'

const NL = String.fromCharCode(10)
const temp = mkdtempSync(join(tmpdir(), 'ewb-'))
process.env.DSH_HOME = join(temp, 'home')

/** Minimal `ctx.subprocess` over child_process. */
const subprocess = {
  spawn(request) {
    const child = spawn(request.argv[0], request.argv.slice(1), {
      cwd: request.cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    const done = new Promise((resolve) => {
      child.on('close', (exitCode, signal) => resolve({ exitCode, signal }))
    })
    return {
      child,
      stdin: child.stdin,
      stdout: child.stdout,
      stderr: child.stderr,
      done,
      terminate: () => child.kill(),
    }
  },
}

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok: Boolean(ok), detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || detail === '' ? '' : ` — ${detail}`}`)
}

const bench = createWorkbench({ get: (name) => (name === 'subprocess' ? subprocess : undefined) }, {
  python: process.env.EWB_PYTHON ?? 'python',
  recordDir: join(temp, 'records'),
  serial: { device: 'virtual', port: 'VIRTUAL', baud: 115200 },
  can: { device: 'virtual', channel: 0, fd: 0, reqId: 0x772, resId: 0x7b2, pollSeconds: 0.05 },
})

const server = createServer((req, res) => bench.handler(req, res))
const port = await new Promise((resolve) => {
  server.listen(0, '127.0.0.1', () => resolve(server.address().port))
})
const base = `http://127.0.0.1:${port}/api/embedded-workbench`

const post = async (body) => {
  const response = await fetch(base, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  return response.json()
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

try {
  const status = await post({ op: 'status' })
  check('status answers with both sides', status.ok && status.serial && status.can)
  check('CAN registry exposes built-in devices', ['zlg', 'cxcan', 'virtual'].every((id) => status.can.devices?.some((device) => device.id === id)), JSON.stringify(status.can.devices))
  check('CAN prefix wildcard matches', canIdFilter('0x3*')?.(0x302) === true && canIdFilter('0x3*')?.(0x402) === false)
  check('CAN single-digit wildcard matches', canIdFilter('30?')?.(0x30F) === true && canIdFilter('30?')?.(0x360) === false)
  check('CAN full-width wildcard matches', canIdFilter('30\uFF1F')?.(0x30F) === true && canIdFilter('30\uFF1F')?.(0x360) === false)
  check('CAN suffix wildcard matches', canIdFilter('0x*2')?.(0x302) === true && canIdFilter('0x*2')?.(0x303) === false)
  check('CAN bare hex filter matches', canIdFilter('302')?.(0x302) === true)

  const ports = await post({ op: 'serialPorts' })
  check('virtual port is listed', ports.ok && ports.ports.some((item) => item.device === 'VIRTUAL'), JSON.stringify(ports))

  const opened = await post({ op: 'serialOpen' })
  check('serial opens virtual', opened.ok && opened.state === 'ready', JSON.stringify(opened))

  const write = await post({ op: 'serialWrite', text: 'AT', newline: 'lf' })
  check('serial write answers', write.ok, JSON.stringify(write))

  await sleep(150)
  const recent = await post({ op: 'serialRecent', limit: 20 })
  const serialRows = recent.rows ?? []
  check('serial ring has TX and RX', serialRows.some((row) => row.dir === 'tx') && serialRows.some((row) => row.dir === 'rx'))
  check('echo carries the sent text', serialRows.some((row) => row.text.includes('AT')))

  const started = await post({ op: 'recordStart', source: 'serial' })
  check('serial recording starts', started.ok, JSON.stringify(started))
  await post({ op: 'serialWrite', text: 'REC' })
  await sleep(200)
  const stopped = await post({ op: 'recordStop', source: 'serial' })
  check('serial recording stops', stopped.ok && stopped.results[0].rows >= 2, JSON.stringify(stopped))
  const csv = stopped.results[0].file ? readFileSync(stopped.results[0].file, 'utf8') : ''
  check('CSV contains the payload', csv.includes('REC'), csv.slice(0, 120))

  const canOpened = await post({ op: 'canOpen' })
  check('CAN opens virtual', canOpened.ok && canOpened.state === 'ready', JSON.stringify(canOpened))

  const sent = await post({ op: 'canSend', canId: '0x123', data: '01 02 03' })
  check('CAN send answers', sent.ok, JSON.stringify(sent))

  const uds = await post({ op: 'uds', hex: '10 03' })
  check('UDS session answers', uds.ok && typeof uds.response === 'string' && uds.response.length > 0, JSON.stringify(uds))

  const dtc = await post({ op: 'dtc' })
  check('DTC read answers', dtc.ok && typeof dtc.response === 'string', JSON.stringify(dtc))

  const ran = await post({ op: 'run', commands: 'set_ids 0x772 0x7B2; uds_read_did 0xF195' })
  check('tool.py console runs', ran.ok, JSON.stringify(ran))

  const snapshot = await bench.snapshot({ limit: 10 })
  check('agent snapshot has serial rows', Array.isArray(snapshot.serial?.rows) && snapshot.serial.rows.length > 0)
  check('agent snapshot has CAN state', snapshot.can && snapshot.can.state === 'ready')

  const tool = defineSnapshotTool(bench)
  const SUPPORTED = new Set(['type', 'oneOf', 'properties', 'required', 'additionalProperties', 'items', 'enum', 'const', 'description'])
  const walk = (node, path) => {
    if (!node || typeof node !== 'object') return []
    const bad = Object.keys(node).filter((key) => !SUPPORTED.has(key)).map((key) => `${path}.${key}`)
    if (node.properties) for (const [key, child] of Object.entries(node.properties)) bad.push(...walk(child, `${path}.properties.${key}`))
    if (node.items) bad.push(...walk(node.items, `${path}.items`))
    return bad
  }
  const badKeys = walk(tool.parameters, 'parameters')
  check('tool parameter schema stays in the supported subset', badKeys.length === 0, badKeys.join(', '))

  const toolValue = await tool.execute({ source: 'all', limit: 5 })
  check('tool returns a snapshot', Boolean(toolValue.serial) && Boolean(toolValue.can))
  const rendered = tool.output.render({}, toolValue)
  check('tool renders text content', rendered?.[0]?.type === 'text' && rendered[0].text.includes('"serial"'))

  const saved = await post({
    op: 'saveSettings',
    settings: {
      python: 'python',
      recordDir: join(temp, 'records'),
      serial: { device: 'virtual', port: 'VIRTUAL', baud: 9600 },
      can: { device: 'virtual', reqId: '0x700', resId: '0x708' },
    },
  })
  check('settings save answers', saved.ok && saved.settings.serial.baud === 9600, JSON.stringify(saved))
  const persisted = JSON.parse(readFileSync(join(temp, 'home', 'embedded-workbench', 'settings.json'), 'utf8'))
  check('settings file persists the value', persisted.serial.baud === 9600 && persisted.can.reqId === 0x700)

  check('serial closes', (await post({ op: 'serialClose' })).ok)
  check('CAN closes', (await post({ op: 'canClose' })).ok)
} finally {
  await bench.dispose()
  await new Promise((resolve) => server.close(resolve))
  rmSync(temp, { recursive: true, force: true })
}

const failed = results.filter((result) => !result.ok)
console.log(`${NL}${results.length - failed.length}/${results.length} checks passed`)
process.exit(failed.length === 0 ? 0 : 1)
