/*
 * Bridges an MCP client that speaks stdio to Lumacut's local MCP server. The
 * client runs the Lumacut executable with ELECTRON_RUN_AS_NODE=1 and this
 * file; each JSON-RPC line on stdin is posted to the running app and its
 * reply written to stdout. LUMACUT_MCP_CONFIG points at the app's mcp.json.
 */
import { readFileSync } from 'node:fs'
import { createInterface } from 'node:readline'

type Config = { port: number; token: string }

function config(): Config | null {
  try {
    return JSON.parse(readFileSync(process.env['LUMACUT_MCP_CONFIG'] ?? '', 'utf8')) as Config
  } catch {
    return null
  }
}

function reply(id: unknown, message: string) {
  if (id === undefined || id === null) return
  process.stdout.write(
    `${JSON.stringify({ jsonrpc: '2.0', id, error: { code: -32000, message } })}\n`,
  )
}

const lines = createInterface({ input: process.stdin })
lines.on('line', (line) => {
  if (!line.trim()) return
  let id: unknown = null
  try {
    id = (JSON.parse(line) as { id?: unknown }).id
  } catch {
    return
  }
  const c = config()
  if (!c?.port) {
    reply(
      id,
      "Lumacut isn't running, or its MCP server is off. Open Lumacut and turn it on in Settings, under AI.",
    )
    return
  }
  void fetch(`http://127.0.0.1:${c.port}/mcp`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      authorization: `Bearer ${c.token}`,
    },
    body: line,
  })
    .then(async (res) => {
      if (res.status === 202) return
      const text = await res.text()
      if (res.ok) process.stdout.write(`${text.trim()}\n`)
      else
        reply(
          id,
          res.status === 401
            ? 'The MCP token changed; restart this client.'
            : `Lumacut answered ${res.status}.`,
        )
    })
    .catch(() =>
      reply(
        id,
        "Lumacut isn't running, or its MCP server is off. Open Lumacut and turn it on in Settings, under AI.",
      ),
    )
})
lines.on('close', () => process.exit(0))
