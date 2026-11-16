/**
 * Small helpers shared by the Host half of the Embedded Workbench.
 *
 * Everything here is string/JSON arithmetic; no Harness imports, so the module
 * also runs under a plain `node` in the offline smoke test.
 *
 * @module dsh-embedded-workbench/util
 */
import { homedir } from 'node:os'
import { join } from 'node:path'

/** Path form handed to a child process: forward slashes only. */
export function toPosix(path) {
  const text = String(path)
  return text.split(String.fromCharCode(92)).join('/')
}

/** Parse `0x772`, `772`, or a number; undefined for anything unusable. */
export function parseId(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value)
  if (typeof value !== 'string') return undefined
  const text = value.trim()
  if (text.length === 0) return undefined
  const parsed = Number.parseInt(text, text.toLowerCase().startsWith('0x') ? 16 : 10)
  return Number.isFinite(parsed) ? parsed : undefined
}

/** One CAN identifier as `0x7B2`. */
export function hexId(canId) {
  return `0x${Number(canId).toString(16).toUpperCase().padStart(3, '0')}`
}

/**
 * Build a predicate for a CAN ID filter. Accepts `0x302`, bare hex `302`,
 * `?` (one hex digit) and `*` (any hex run), e.g. `0x30?`, `0x3*`, `0x*2`.
 * Returns undefined when the filter is empty or unusable (show everything).
 */
export function canIdFilter(raw) {
  const text = String(raw ?? '')
    .trim()
    .replace(/^0x/i, '')
    .replace(/\uFF1F/g, '?')
    .replace(/\uFF0A/g, '*')
  if (text.length === 0) return undefined
  if (text.includes('*') || text.includes('?')) {
    if (!/^[0-9a-f*?]+$/i.test(text)) return undefined
    const source = text
      .split('')
      .map((char) => {
        if (char === '*') return '[0-9a-f]*'
        if (char === '?') return '[0-9a-f]'
        return char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      })
      .join('')
    const pattern = new RegExp(`^${source}$`, 'i')
    return (canId) => pattern.test(Number(canId).toString(16))
  }
  if (!/^[0-9a-f]+$/i.test(text)) return undefined
  const wanted = Number.parseInt(text, 16)
  return (canId) => Number(canId) === wanted
}

/** `01 02 0A` from a byte array. */
export function hexBytes(bytes) {
  return Array.from(bytes, (byte) => Number(byte).toString(16).toUpperCase().padStart(2, '0')).join(' ')
}

/** Clamp a number into `[low, high]`, falling back when it is not finite. */
export function clamp(value, low, high, fallback) {
  const number = typeof value === 'number' && Number.isFinite(value) ? value : fallback
  return Math.min(high, Math.max(low, number))
}

/** One CSV field, quoted only when it has to be. */
export function csvField(value) {
  const text = String(value ?? '')
  if (!/[",\r\n]/.test(text)) return text
  return `"${text.replaceAll('"', '""')}"`
}

/** The directory this plugin owns for its runtime settings. */
export function settingsFile() {
  const home = (process.env.DSH_HOME ?? '').trim() || join(homedir(), '.dsh')
  return join(home, 'embedded-workbench', 'settings.json')
}

/** The default place for recordings: the desktop when the platform has one. */
export function defaultRecordDir() {
  const home = (process.env.USERPROFILE ?? process.env.HOME ?? process.cwd()).replace(/[\\/]+$/, '')
  return `${home}/Desktop/embedded-workbench`
}
