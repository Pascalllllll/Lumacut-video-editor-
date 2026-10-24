import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createConversation } from '../../src/main/copilot/providers'

type Captured = { url: string; headers: Record<string, unknown>; body: Record<string, unknown> }
const seen: Captured[] = []
let base = ''
const server = createServer((req, res) => {
  let data = ''
  req.on('data', (c: Buffer) => (data += c.toString()))
  req.on('end', () => {
    const body = JSON.parse(data || '{}') as Record<string, unknown>
    seen.push({ url: req.url ?? '', headers: req.headers, body })
    res.setHeader('content-type', 'application/json')
    const turn = (body['messages'] as unknown[]).length
    const content =
      turn === 1
        ? [
            { type: 'thinking', thinking: '', signature: 'sig' },
            { type: 'tool_use', id: 'tu1', name: 'get_timeline', input: {} },
            { type: 'tool_use', id: 'tu2', name: 'sample_frames', input: { times: [1] } },
          ]
        : [{ type: 'text', text: 'All done.' }]
    res.end(
      JSON.stringify({
        id: `msg_${turn}`,
        type: 'message',
        role: 'assistant',
        model: body['model'],
        content,
        stop_reason: turn === 1 ? 'tool_use' : 'end_turn',
        stop_sequence: null,
        usage: { input_tokens: 100, output_tokens: 20 },
      }),
    )
  })
})

beforeAll(
  () =>
    new Promise<void>((r) =>
      server.listen(0, '127.0.0.1', () => {
        base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
        r()
      }),
    ),
)
afterAll(() => new Promise<void>((r) => server.close(() => r())))

describe('Anthropic adapter', () => {
  it('sends tools, opts into refusal fallbacks, and returns results the way the API expects', async () => {
    const conv = createConversation(
      { provider: 'anthropic', model: 'claude-opus-5-5', baseUrl: base, apiKey: 'test-key' },
      'system text',
      [{ name: 'get_timeline', description: 'd', parameters: { type: 'object', properties: {} } }],
    )
    const signal = new AbortController().signal
    const first = await conv.send('hello', signal)
    expect(first.stop).toBe('tools')
    expect(first.toolCalls.map((c) => c.name)).toEqual(['get_timeline', 'sample_frames'])

    const req = seen[0]!
    expect(req.url.split('?')[0]).toBe('/v1/messages')
    expect(req.headers['x-api-key']).toBe('test-key')
    expect(String(req.headers['anthropic-beta'])).toContain('server-side-fallback-2026-07-01')
    expect(req.body['fallbacks']).toBe('default')
    expect(req.body['system']).toBe('system text')
    expect(req.body['tools']).toEqual([
      { name: 'get_timeline', description: 'd', input_schema: { type: 'object', properties: {} } },
    ])

    const second = await conv.results(
      [
        { id: 'tu1', text: '{"tracks":[]}' },
        { id: 'tu2', text: '1s: a.mp4', images: ['AAAA'] },
      ],
      signal,
    )
    expect(second).toMatchObject({ stop: 'end', text: 'All done.' })
    const messages = seen[1]!.body['messages'] as { role: string; content: { type: string }[] }[]
    // The assistant turn goes back whole, thinking block included.
    expect(messages[1]!.content.map((b) => b.type)).toEqual(['thinking', 'tool_use', 'tool_use'])
    // Every result of the turn in one user message, pictures inside their result.
    expect(messages[2]!.role).toBe('user')
    expect(messages[2]!.content.map((b) => b.type)).toEqual(['tool_result', 'tool_result'])
    expect(JSON.stringify(messages[2])).toContain('"type":"image"')
  })

  it("leaves the fallback out for models that don't take it", async () => {
    const conv = createConversation(
      { provider: 'anthropic', model: 'claude-haiku-4-5', baseUrl: base, apiKey: 'k' },
      's',
      [],
    )
    await conv.send('hi', new AbortController().signal)
    expect(seen.at(-1)!.body['fallbacks']).toBeUndefined()
  })
})
