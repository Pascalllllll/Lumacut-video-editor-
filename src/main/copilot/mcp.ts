import { randomBytes, timingSafeEqual } from 'node:crypto'
import { existsSync } from 'node:fs'
import { readFile, rename, writeFile } from 'node:fs/promises'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'
import { app } from 'electron'
import type { Command } from '@engine/commands'
import type { Project } from '@engine/model'
import { isEditTool, runTool, toolSpecs, type ToolSession } from '../../ai/tools'
import { mainServices } from './agent'

/**
 * A local MCP server so other AI tools can read and edit the open project.
 * It speaks JSON-RPC over the Streamable HTTP transport (JSON responses only)
 * on 127.0.0.1, behind a bearer token. Edits go to the editor, which shows
 * them for review or applies them, depending on the user's setting.
 */

export type McpHost = {
  snapshot(): Promise<{ project: Project; sequenceId: string }>
  /** Resolves true once the edit is applied, false if the user declined it. */
  apply(commands: Command[], label: string): Promise<boolean>
  exportTo(project: Project, sequenceId: string, path: string): Promise<string>
}

export type McpConfig = { port: number; token: string }

const PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05']
const configFile = () => join(app.getPath('userData'), 'mcp.json')

export async function loadMcpConfig(): Promise<McpConfig> {
  if (existsSync(configFile())) {
    try {
      const c = JSON.parse(await readFile(configFile(), 'utf8')) as McpConfig
      if (typeof c.port === 'number' && typeof c.token === 'string' && c.token.length >= 32)
        return c
    } catch {
      // Rewritten below.
    }
  }
  return saveMcpConfig({ port: 0, token: randomBytes(24).toString('hex') })
}

async function saveMcpConfig(c: McpConfig): Promise<McpConfig> {
  const tmp = `${configFile()}.${process.pid}.tmp`
  await writeFile(tmp, JSON.stringify(c), { mode: 0o600 })
  await rename(tmp, configFile())
  return c
}

export async function newMcpToken(): Promise<McpConfig> {
  const c = await loadMcpConfig()
  return saveMcpConfig({ ...c, token: randomBytes(24).toString('hex') })
}

let server: Server | null = null
let current: McpConfig | null = null

export function mcpAddress(): McpConfig | null {
  return server ? current : null
}

export async function startMcp(host: McpHost): Promise<McpConfig> {
  if (server && current) return current
  const config = await loadMcpConfig()
  const srv = createServer((req, res) => void handle(req, res, host))
  const listen = (port: number) =>
    new Promise<number>((resolve, reject) => {
      srv.once('error', reject)
      srv.listen(port, '127.0.0.1', () => resolve((srv.address() as AddressInfo).port))
    })
  let port: number
  try {
    port = await listen(config.port)
  } catch {
    // The saved port is taken; take any free one and remember it.
    port = await listen(0)
  }
  server = srv
  current = port === config.port ? config : await saveMcpConfig({ ...config, port })
  return current
}

export async function stopMcp() {
  const srv = server
  server = null
  if (srv) await new Promise<void>((r) => srv.close(() => r()))
}

function send(res: ServerResponse, status: number, body?: unknown) {
  res.writeHead(status, body === undefined ? {} : { 'content-type': 'application/json' })
  res.end(body === undefined ? undefined : JSON.stringify(body))
}

function authorized(req: IncomingMessage): boolean {
  const header = req.headers.authorization ?? ''
  const given = Buffer.from(header.startsWith('Bearer ') ? header.slice(7) : '')
  const expected = Buffer.from(current?.token ?? '')
  return given.length === expected.length && expected.length > 0 && timingSafeEqual(given, expected)
}

/** Browsers send an Origin; only local pages may call (guards against DNS rebinding). */
function originAllowed(req: IncomingMessage): boolean {
  const origin = req.headers.origin
  if (!origin) return true
  try {
    const host = new URL(origin).hostname
    return host === '127.0.0.1' || host === 'localhost'
  } catch {
    return false
  }
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const c of req as AsyncIterable<Buffer>) {
    size += c.length
    if (size > 8 * 1024 * 1024) throw new Error('too large')
    chunks.push(c)
  }
  return Buffer.concat(chunks).toString('utf8')
}

type RpcRequest = {
  jsonrpc: '2.0'
  id?: string | number
  method: string
  params?: Record<string, unknown>
}

async function handle(req: IncomingMessage, res: ServerResponse, host: McpHost) {
  if (!originAllowed(req)) return send(res, 403)
  if (req.url !== '/mcp') return send(res, 404)
  if (req.method !== 'POST') {
    res.setHeader('allow', 'POST')
    return send(res, 405)
  }
  if (!authorized(req)) return send(res, 401, { error: 'unauthorized' })
  let msg: RpcRequest
  try {
    msg = JSON.parse(await readBody(req)) as RpcRequest
  } catch {
    return send(res, 400, {
      jsonrpc: '2.0',
      id: null,
      error: { code: -32700, message: 'Parse error' },
    })
  }
  // Notifications and responses get no reply body.
  if (msg.id === undefined || msg.id === null) return send(res, 202)
  try {
    const result = await dispatch(msg, host)
    send(res, 200, { jsonrpc: '2.0', id: msg.id, result })
  } catch (error) {
    const rpc = error as { code?: number }
    send(res, 200, {
      jsonrpc: '2.0',
      id: msg.id,
      error: {
        code: rpc.code ?? -32603,
        message: error instanceof Error ? error.message : String(error),
      },
    })
  }
}

function rpcError(code: number, message: string) {
  return Object.assign(new Error(message), { code })
}

async function dispatch(msg: RpcRequest, host: McpHost): Promise<unknown> {
  switch (msg.method) {
    case 'initialize': {
      const asked = String(msg.params?.['protocolVersion'] ?? '')
      return {
        protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'lumacut', version: app.getVersion() },
        instructions:
          'Lumacut edits the project open in the editor. Call get_timeline first for clip ids. Times are seconds. Edits may wait for the user to approve them in Lumacut.',
      }
    }
    case 'ping':
      return {}
    case 'tools/list':
      return {
        tools: toolSpecs().map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.parameters,
          annotations: { readOnlyHint: !isEditTool(t.name) },
        })),
      }
    case 'tools/call': {
      const name = String(msg.params?.['name'] ?? '')
      const args = msg.params?.['arguments'] ?? {}
      const { project, sequenceId } = await host.snapshot()
      const session: ToolSession = {
        project,
        sequenceId,
        commands: [],
        services: { ...mainServices(), exportTo: (p, s, path) => host.exportTo(p, s, path) },
        exportAfterApply: false,
      }
      const r = await runTool(session, name, args)
      let text = r.text
      let isError = r.error ?? false
      if (!isError && session.commands.length) {
        const applied = await host.apply(session.commands, name.replace(/_/g, ' '))
        if (!applied) {
          text = 'The user declined this change in Lumacut. Nothing was changed.'
          isError = true
        }
      }
      return {
        content: [
          { type: 'text', text },
          ...(r.images ?? []).map((data) => ({ type: 'image', data, mimeType: 'image/jpeg' })),
        ],
        isError,
      }
    }
    default:
      throw rpcError(-32601, `Method not found: ${msg.method}`)
  }
}
