import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { test, expect } from './fixtures'
import { haveFfmpeg, importFiles, makeMedia, stubDialogs } from './helpers'

test('the page runs only its own scripts and stays on its own page', async ({ app, page }) => {
  const start = page.url()
  // An injected inline script is blocked by the Content Security Policy.
  const inline = await page.evaluate(async () => {
    const s = document.createElement('script')
    s.textContent = 'window.__inline = 1'
    document.head.appendChild(s)
    await new Promise((r) => setTimeout(r, 100))
    return (window as unknown as { __inline?: number }).__inline ?? null
  })
  expect(inline).toBeNull()

  // Another local file can't replace Lumacut's page (it would get the app's API).
  await page.evaluate(() => {
    location.href = 'file:///etc/hostname'
  })
  await page.waitForTimeout(500)
  expect(page.url()).toBe(start)

  // New windows never open; web links go to the system browser.
  const opened: string[] = []
  await app.evaluate(({ shell }) => {
    ;(globalThis as unknown as { opened: string[] }).opened = []
    shell.openExternal = async (url: string) => {
      ;(globalThis as unknown as { opened: string[] }).opened.push(url)
    }
  })
  const handle = await page.evaluate(() => window.open('https://example.com/') === null)
  expect(handle).toBe(true)
  await page.evaluate(() => window.open('file:///etc/passwd'))
  opened.push(...(await app.evaluate(() => (globalThis as unknown as { opened: string[] }).opened)))
  expect(opened).toEqual(['https://example.com/'])
  expect(app.windows()).toHaveLength(1)
})

test('only imported files can be read through the media protocol', async ({ page }) => {
  const status = await page.evaluate(async () => {
    const res = await fetch(`lumacut-media://file/${encodeURIComponent('/etc/passwd')}`)
    return res.status
  })
  expect(status).toBe(403)
})

test('a project whose media points at the internet is refused', async ({ app, page }) => {
  test.skip(!haveFfmpeg, 'FFmpeg not fetched; run pnpm fetch:binaries')
  const media = makeMedia()
  const file = join(media.dir, 'shared.lumacut')
  await importFiles(app, page, [media.a])
  await stubDialogs(app, [], file)
  await page.keyboard.press('Control+s')
  await expect(page.getByText('Saved shared.lumacut')).toBeVisible()

  const files = unzipSync(new Uint8Array(readFileSync(file)))
  const open = (path: string) =>
    page.evaluate(
      (p) =>
        window.lumacut.invoke('project:open', { path: p }).then(
          () => 'opened',
          (e: Error) => e.message,
        ),
      path,
    )
  const withMediaPath = (to: string) => {
    const project = JSON.parse(strFromU8(files['project.json']!)) as {
      media: Record<string, { path: string }>
    }
    for (const m of Object.values(project.media)) if (m.path) m.path = to
    writeFileSync(file, zipSync({ ...files, 'project.json': strToU8(JSON.stringify(project)) }))
  }

  withMediaPath(media.a)
  expect(await open(file)).toBe('opened')
  withMediaPath('http://attacker.example/evil.mp4')
  expect(await open(file)).toMatch(/damaged/)
})
