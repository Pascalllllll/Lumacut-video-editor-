import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import type { AxeResults } from 'axe-core'
import type { Page } from '@playwright/test'
import { test, expect } from './fixtures'
import { addToEnd, haveFfmpeg, importFiles, makeMedia, setWindow } from './helpers'

test.skip(!haveFfmpeg, 'FFmpeg not fetched; run pnpm fetch:binaries')

const axeSource = readFileSync(
  createRequire(import.meta.url).resolve('axe-core/axe.min.js'),
  'utf8',
)

/**
 * Critical and serious axe findings, with where they are. axe is injected into
 * the window directly: Electron can't open the extra page AxeBuilder needs.
 */
async function audit(page: Page) {
  // Colours caught halfway through a sheet's fade-in would fail contrast for no real reason.
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running'))
  const result = await page.evaluate(async (src) => {
    const w = window as unknown as { axe?: { run: (ctx: Document, o: object) => Promise<unknown> } }
    if (!w.axe) (0, eval)(src)
    return w.axe!.run(document, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] },
    })
  }, axeSource)
  return (result as AxeResults).violations
    .filter((v) => v.impact === 'critical' || v.impact === 'serious')
    .map(
      (v) =>
        `${v.id} (${v.impact}): ${v.nodes
          .slice(0, 3)
          .map((n) => n.target.join(' '))
          .join(' | ')}`,
    )
}

test('no serious accessibility problems in any workspace, light or dark', async ({ app, page }) => {
  const media = makeMedia()
  await setWindow(app)
  await importFiles(app, page, [media.a])
  await addToEnd(page, 'alpha.mp4')
  const found: string[] = []
  for (const theme of ['Light', 'Dark']) {
    await page.getByRole('button', { name: 'Settings' }).click()
    await page.getByRole('radio', { name: theme }).click()
    found.push(...(await audit(page)).map((v) => `settings/${theme}: ${v}`))
    await page.keyboard.press('Escape')
    for (const ws of ['Edit', 'Color', 'Audio', 'Captions', 'Export']) {
      await page.getByRole('tab', { name: ws, exact: true }).first().click()
      await page.waitForTimeout(300)
      found.push(...(await audit(page)).map((v) => `${ws}/${theme}: ${v}`))
    }
  }
  expect(found, found.join('\n')).toEqual([])
})
