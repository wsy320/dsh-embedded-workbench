/**
 * Embedded Workbench for DeepSeek Harness.
 *
 * Host half: owns the UART and CAN device children, exposes one JSON route
 * on the Web server, and registers a read-only snapshot tool for the agent.
 * The browser half lives in `client.js` and is mounted through `dsh.client`.
 *
 * All harness services are optional: a profile without a web server still
 * mounts the plugin (the tool keeps working), and a profile without the tools
 * service still serves the panel.
 *
 * @module dsh-embedded-workbench
 */
import { createWorkbench } from './lib/workbench.js'

/** Stable Loader identity. */
export const name = 'embedded-workbench'

/** Route owned by this plugin. */
export const ENDPOINT = '/api/embedded-workbench'

/**
 * Read-only view of the bench for the agent.
 *
 * A plain tool definition (schema + execute + render) is enough for
 * `ctx.tools.register`; no first-party package import is required, so the
 * bundle keeps working when only the profile's own dependencies exist.
 *
 * @param hub - the composed workbench.
 * @returns registry-ready definition.
 */
export function defineSnapshotTool(hub) {
  return {
    name: 'embedded_workbench_get',
    description: [
      '读取嵌入式工作台当前状态：串口（端口、波特率、累计字节、最近收发）与 CAN（设备、通道、帧数、',
      '最近帧、UDS ID、录制文件）。面板在 Web UI 的「嵌入式工作台」；本工具只读，不发送数据。',
      '用户问「串口刚才回了什么」「总线有没有 0x7B2」「录制写到哪了」时先用它看数据，不要让用户截图。',
    ].join(''),
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        source: {
          type: 'string',
          enum: ['all', 'serial', 'can'],
          description: '只取一侧；默认 all。',
        },
        limit: {
          type: 'integer',
          description: '每侧返回最近多少行，默认 50（1-120）。',
        },
        since: {
          type: 'integer',
          description: '只返回序号大于该值的行；序号来自上一次结果里的 seq。',
        },
        filter: {
          type: 'string',
          description: '只看这个 CAN ID，十六进制如 0x7B2；不影响串口。',
        },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: true,
      },
      render(_args, value) {
        return [{ type: 'text', text: JSON.stringify(value, null, 2) }]
      },
    },
    async execute(args) {
      return hub.snapshot({
        source: args?.source === 'serial' || args?.source === 'can' ? args.source : 'all',
        limit: args?.limit,
        since: args?.since,
        filter: args?.filter,
      })
    },
  }
}

/**
 * Mount the HTTP route, the agent tool and cleanup.
 *
 * @param ctx - plugin context.
 * @param config - row config from `cordis.patch.yml` (plain JSON).
 */
export function apply(ctx, config) {
  const hub = createWorkbench({ get: (service) => ctx.get(service) }, config)

  ctx.inject(['webServer'], (webCtx) => {
    webCtx.effect(
      () => webCtx.webServer.register({ kind: 'prefix', path: ENDPOINT, handler: hub.handler }),
      'embedded-workbench: http route',
    )
  })

  ctx.inject(['tools'], (toolCtx) => {
    toolCtx.effect(
      () => toolCtx.tools.register(defineSnapshotTool(hub)),
      'embedded-workbench: embedded_workbench_get',
    )
  })

  ctx.effect(
    () => () => {
      hub.dispose().catch(() => {})
    },
    'embedded-workbench: dispose',
  )
}
