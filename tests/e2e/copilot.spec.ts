import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdtempSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ElectronApplication, Page } from '@playwright/test'
import { fakeModel } from './fake-model'
import { test, expect } from './fixtures'
import { addToEnd, ffmpeg, haveFfmpeg, importFiles, setWindow } from './helpers'

const models = join(homedir(), '.local', 'share', 'Lumacut', 'models', 'onnx-community')
test.skip(!haveFfmpeg || !existsSync(models), 'Needs FFmpeg and the speech model')

const dir = mkdtempSync(join(tmpdir(), 'lumacut-copilot-e2e-'))
const speech = join(dir, 'talk.wav')
// Speech, two seconds of silence, speech again.
execFileSync(ffmpeg, [
  '-v',
  'error',
  '-y',
  '-i',
  join('tests', 'fixtures', 'jfk.wav'),
  '-i',
  join('tests', 'fixtures', 'jfk.wav'),
  '-filter_complex',
  '[0:a]apad=pad_dur=2[a];[a][1:a]concat=n=2:v=0:a=1',
  speech,
])

async function configure(page: Page, url: string) {
  await page.getByRole('button', { name: 'Settings' }).click()
  const dialog = page.getByRole('dialog', { name: 'Settings' })
  await dialog.getByLabel('Provider').selectOption('custom')
  await dialog.getByLabel('Address').fill(url)
  await dialog.getByLabel('Address').blur()
  await dialog.getByRole('button', { name: 'Check connection' }).click()
  await expect(page.getByText('Connected. 1 models available.')).toBeVisible()
  await expect(dialog.getByLabel('Model', { exact: true })).toHaveValue('fake-editor')
  await dialog.getByRole('checkbox', { name: /^Local only/ }).check()
  await page.keyboard.press('Escape')
}

async function talkOnTimeline(app: ElectronApplication, page: Page) {
  await setWindow(app)
  await importFiles(app, page, [speech])
  await addToEnd(page, 'talk.wav')
}

test('a plain request becomes a reviewed change that undoes in one step', async ({ app, page }) => {
  const model = await fakeModel()
  try {
    await talkOnTimeline(app, page)
    await configure(page, model.url)
    const before = await page.getByLabel('Sequence length').textContent()

    await page.getByRole('button', { name: 'Copilot' }).click()
    const panel = page.getByRole('region', { name: 'Copilot' })
    await panel
      .getByRole('button', { name: 'Remove silences longer than 0.7 s and add captions' })
      .click()
    const review = panel.getByRole('region', { name: 'Review the change' })
    await expect(review).toBeVisible({ timeout: 120_000 })
    await expect(review.getByText(/^Captions: 0 to \d+$/)).toBeVisible()
    await expect(review.getByText(/^Length /)).toBeVisible()
    await expect(
      panel.getByText('Removed the silence in the middle and added captions.'),
    ).toBeVisible()
    // Nothing has changed yet.
    await expect(page.getByLabel('Sequence length')).toHaveText(before ?? '')

    // The model saw the tools and a summary of the project, and nothing else.
    expect(model.requests[0]!.tools.map((t) => t.function.name)).toContain('get_timeline')
    expect(JSON.stringify(model.requests[0]!.messages[1])).toContain('open_sequence')

    await review.getByRole('button', { name: 'Apply' }).click()
    await expect(page.getByLabel('Sequence length')).not.toHaveText(before ?? '')
    const applied = await page.getByLabel('Sequence length').textContent()
    await page.getByRole('region', { name: 'Timeline' }).click({ position: { x: 5, y: 5 } })
    await page.keyboard.press('Control+z')
    await expect(page.getByLabel('Sequence length')).toHaveText(before ?? '')
    await page.keyboard.press('Control+Shift+z')
    await expect(page.getByLabel('Sequence length')).toHaveText(applied ?? '')
  } finally {
    model.close()
  }
})

test('local-only mode refuses a provider on the internet', async ({ page }) => {
  await page.getByRole('button', { name: 'Settings' }).click()
  const dialog = page.getByRole('dialog', { name: 'Settings' })
  await dialog.getByLabel('Provider').selectOption('anthropic')
  await dialog.getByRole('checkbox', { name: /^Local only/ }).check()
  await expect(
    dialog.getByText(/^Local-only mode is on and this provider is on the internet/),
  ).toBeVisible()
  await dialog.getByRole('button', { name: 'Check connection' }).click()
  await expect(page.getByText(/only talks to models on this computer/)).toBeVisible()
})

test('other AI tools read the timeline over MCP and edits wait for review', async ({
  app,
  page,
}) => {
  await talkOnTimeline(app, page)
  await page.getByRole('button', { name: 'Settings' }).click()
  await page.getByRole('checkbox', { name: /^Let other AI tools edit this project/ }).check()
  await expect(page.getByText(/^Listening at http:\/\/127\.0\.0\.1:\d+\/mcp$/)).toBeVisible()
  await page.keyboard.press('Escape')
  const status = await page.evaluate(() => window.lumacut.invoke('mcp:status'))
  const rpc = async (method: string, params: object, token = status.token) => {
    const res = await fetch(status.url!, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    })
    return {
      status: res.status,
      body:
        res.status === 200 ? ((await res.json()) as { result?: Record<string, unknown> }) : null,
    }
  }
  expect((await rpc('tools/list', {}, 'wrong')).status).toBe(401)
  const init = await rpc('initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'test', version: '1' },
  })
  expect(init.body?.result?.['serverInfo']).toMatchObject({ name: 'lumacut' })
  const list = await rpc('tools/list', {})
  expect((list.body?.result?.['tools'] as { name: string }[]).map((t) => t.name)).toContain(
    'get_timeline',
  )
  const timeline = await rpc('tools/call', { name: 'get_timeline', arguments: {} })
  const text = (timeline.body?.result?.['content'] as { text: string }[])[0]!.text
  expect(
    JSON.parse(text).tracks.find((t: { name: string }) => t.name === 'A1').clips[0].media,
  ).toBe('talk.wav')

  // An edit shows up for review in Lumacut; the call returns once it is applied.
  const pending = rpc('tools/call', {
    name: 'add_marker',
    arguments: { time: 2, name: 'From MCP' },
  })
  const dialog = page.getByRole('dialog', { name: 'An AI tool wants to edit the project' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByText('Markers added: 1')).toBeVisible()
  await dialog.getByRole('button', { name: 'Apply' }).click()
  expect((await pending).body?.result?.['isError']).toBe(false)
  await expect(page.getByRole('button', { name: /^Marker From MCP at/ })).toBeVisible()

  // The stdio bridge for clients that launch a command.
  const bridge = spawn(status.stdio.command, status.stdio.args, {
    env: { ...process.env, ...status.stdio.env },
  })
  const out: string[] = []
  bridge.stdout.on('data', (c: Buffer) => out.push(c.toString()))
  bridge.stdin.write(
    `${JSON.stringify({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'get_project_summary', arguments: {} } })}\n`,
  )
  await expect.poll(() => out.join(''), { timeout: 15_000 }).toContain('"id":7')
  bridge.stdin.end()
  expect(out.join('')).toContain('open_sequence')
})
