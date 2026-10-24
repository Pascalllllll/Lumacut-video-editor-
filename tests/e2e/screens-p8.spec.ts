import { join } from 'node:path'
import { test, expect } from './fixtures'
import { addToEnd, haveFfmpeg, importFiles, makeMedia, stubDialogs } from './helpers'

test.skip(!haveFfmpeg, 'FFmpeg not fetched')

test('screenshot: export workspace, palette and resized panels', async ({ app, page }) => {
  const media = makeMedia()
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(1440, 900))
  await importFiles(app, page, [media.a, media.b])
  await addToEnd(page, 'alpha.mp4')
  await addToEnd(page, 'bravo.mp4')
  await page.getByRole('tab', { name: 'Export', exact: true }).click()
  const panel = page.getByRole('region', { name: 'Export', exact: true })
  await panel.getByRole('radio', { name: /^YouTube Shorts/ }).click()
  await stubDialogs(app, [], join(media.dir, 'short.mp4'))
  await panel.getByRole('button', { name: 'Export…' }).click()
  await expect(page.getByRole('region', { name: 'Exports' }).getByText(/· Done$/)).toBeVisible({
    timeout: 60_000,
  })
  await panel.getByRole('radio', { name: /^Master file/ }).click()
  await page.waitForTimeout(300)
  await page.screenshot({ path: 'test-results/screens/p8-export.png' })

  await page.getByRole('tab', { name: 'Edit', exact: true }).click()
  const sep = page.getByRole('separator', { name: 'Resize the left panels' })
  await sep.focus()
  for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowRight')
  await page.getByRole('button', { name: 'More media options' }).click()
  await page.getByRole('menuitemradio', { name: 'Show as a list' }).click()
  await page.keyboard.press('Control+k')
  await page.getByRole('combobox', { name: 'Run a command' }).fill('mark')
  await page.waitForTimeout(300)
  await page.screenshot({ path: 'test-results/screens/p8-palette.png' })
})
