import { join } from 'node:path'
import { test, expect } from './fixtures'
import { addToEnd, haveFfmpeg, importFiles, makeMedia, stubDialogs } from './helpers'

test.skip(!haveFfmpeg, 'FFmpeg not fetched')

test('screenshot: start screen, tour and account', async ({ app, page }) => {
  const media = makeMedia()
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(1440, 900))
  await importFiles(app, page, [media.a, media.b])
  await addToEnd(page, 'alpha.mp4')
  for (const name of ['Trailer draft', 'Interview cut', 'Holiday film']) {
    await stubDialogs(app, [], join(media.dir, `${name}.lumacut`))
    await page.keyboard.press('Control+Shift+s')
    await expect(page.getByText(`Saved ${name}.lumacut`)).toBeVisible()
  }
  await page.keyboard.press('Control+k')
  await page.getByRole('combobox', { name: 'Run a command' }).fill('start screen')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(400)
  await page.screenshot({ path: 'test-results/screens/start-home.png' })

  await page.getByRole('tab', { name: 'Edit', exact: true }).click()
  await page.keyboard.press('Control+k')
  await page.getByRole('combobox', { name: 'Run a command' }).fill('tour')
  await page.keyboard.press('Enter')
  await page.getByRole('dialog').last().getByRole('button', { name: 'Next' }).click()
  await page.getByRole('dialog').last().getByRole('button', { name: 'Next' }).click()
  await page.waitForTimeout(500)
  await page.screenshot({ path: 'test-results/screens/start-tour.png' })
})
