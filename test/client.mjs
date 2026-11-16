/**
 * Client-module contract check: no browser, no DSH.
 *
 * Verifies the lazy factory id, the injected services, and that the plugin
 * registers exactly one better-sidebar tab plus the zh/en dictionaries.
 *
 *   node test/client.mjs
 */
import { readFileSync } from 'node:fs'

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
let definition
globalThis.window = {
  __ModuleLoader__: {
    load(value) {
      definition = value
    },
  },
}

await import('../client.js')

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok: Boolean(ok), detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || detail === '' ? '' : ` — ${detail}`}`)
}

check('module registers a factory', definition && typeof definition.factory === 'function')
check('factory id equals the package name', definition?.id === pkg.name, `${definition?.id} vs ${pkg.name}`)

const React = { createElement: (type, props, ...children) => ({ type, props, children }) }
const registrations = []
const client = definition.factory((name) => {
  if (name === 'react') return React
  throw new Error(`unexpected module request: ${name}`)
})

check('client injects better-sidebar', Array.isArray(client.inject)
  && client.inject.includes('betterSidebar') && client.inject.includes('locale'), JSON.stringify(client.inject))

const ctx = {
  locale: {
    bind: () => (key) => key,
    register: (namespace, dictionaries) => {
      registrations.push({ kind: 'locale', namespace, dictionaries })
      return () => {}
    },
  },
  effect: (fn) => fn(),
  betterSidebar: {
    registerTab: (descriptor) => {
      registrations.push({ kind: 'better-tab', descriptor })
      return () => {}
    },
  },
}

client.apply(ctx)

const tab = registrations.find((item) => item.kind === 'better-tab')
const locale = registrations.find((item) => item.kind === 'locale')

check('registers one better-sidebar tab', tab?.descriptor.id === 'embedded-workbench', JSON.stringify(tab?.descriptor))
check('tab is single and has a component', tab?.descriptor.single === true && typeof tab?.descriptor.component === 'function')
check('registers zh and en dictionaries', Boolean(locale?.dictionaries?.zh) && Boolean(locale?.dictionaries?.en))

const zhKeys = Object.keys(locale?.dictionaries?.zh ?? {})
const enKeys = Object.keys(locale?.dictionaries?.en ?? {})
check('dictionaries have the same keys', zhKeys.length === enKeys.length && zhKeys.every((key) => enKeys.includes(key)), `${zhKeys.length} vs ${enKeys.length}`)
check('title is localized', zhKeys.includes('panel.title') && zhKeys.includes('tab.serial'))

const failed = results.filter((result) => !result.ok)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
process.exit(failed.length === 0 ? 0 : 1)
