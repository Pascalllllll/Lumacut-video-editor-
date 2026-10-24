import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'

type Body = {
  messages: { role: string; content: unknown }[]
  tools: { function: { name: string } }[]
}

/** A stand-in for a chat-completions server that edits like a model would. */
export function fakeModel() {
  const requests: Body[] = []
  const server: Server = createServer((req, res) => {
    let data = ''
    req.on('data', (c: Buffer) => (data += c.toString()))
    req.on('end', () => {
      res.setHeader('content-type', 'application/json')
      if (req.url === '/v1/models')
        return res.end(JSON.stringify({ data: [{ id: 'fake-editor' }] }))
      const body = JSON.parse(data) as Body
      requests.push(body)
      const toolsSeen = body.messages.filter((m) => m.role === 'tool').length
      const message =
        toolsSeen === 0
          ? {
              role: 'assistant',
              content: null,
              tool_calls: [
                {
                  id: 'c1',
                  type: 'function',
                  function: { name: 'remove_silences', arguments: '{"min_seconds":0.7}' },
                },
                {
                  id: 'c2',
                  type: 'function',
                  function: { name: 'generate_captions', arguments: '{}' },
                },
              ],
            }
          : { role: 'assistant', content: 'Removed the silence in the middle and added captions.' }
      res.end(
        JSON.stringify({
          choices: [{ message, finish_reason: toolsSeen ? 'stop' : 'tool_calls' }],
          usage: { prompt_tokens: 10, completion_tokens: 5 },
        }),
      )
    })
  })
  return new Promise<{ url: string; requests: Body[]; close: () => void }>((resolve) =>
    server.listen(0, '127.0.0.1', () =>
      resolve({
        url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`,
        requests,
        close: () => server.close(),
      }),
    ),
  )
}
