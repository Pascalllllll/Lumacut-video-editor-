import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { test, expect } from './fixtures'
import { addToEnd, haveFfmpeg, importFiles, makeMedia } from './helpers'

const models = join(homedir(), '.local', 'share', 'Lumacut', 'models', 'onnx-community')
test.skip(!haveFfmpeg || !existsSync(models), 'Needs FFmpeg and the speech model')

test('screenshot: captions workspace', async ({ app, page }) => {
  const media = makeMedia()
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(1440, 900))
  await importFiles(app, page, [media.a, join(process.cwd(), 'tests', 'fixtures', 'jfk.wav')])
  await addToEnd(page, 'alpha.mp4')
  await page.getByRole('button', { name: 'Target A1 for source edits' }).click()
  await page.getByRole('button', { name: 'Add audio track' }).first().click()
  await page.getByRole('button', { name: 'Target A2 for source edits' }).click()
  await page.keyboard.press('Home')
  await page.getByRole('listitem', { name: 'jfk.wav', exact: true }).dblclick()
  await page.keyboard.press('Period')
  await page.keyboard.press('Shift+Z')
  await page.getByRole('tab', { name: 'Captions', exact: true }).first().click()
  await page.getByRole('tab', { name: 'Timeline', exact: true }).first().click()
  const panel = page.getByRole('region', { name: 'Captions' })
  await panel.getByRole('button', { name: 'Transcribe' }).click()
  await expect(page.getByText(/^Made \d+ captions/)).toBeVisible({ timeout: 120_000 })
  await panel.getByRole('tab', { name: 'Style' }).click()
  await panel.getByRole('radio', { name: 'Karaoke' }).click()
  await panel.getByRole('tab', { name: 'Captions', exact: true }).click()
  await panel
    .getByRole('button', { name: /^Go to / })
    .first()
    .click()
  await page.keyboard.press('Shift+ArrowRight')
  await page.keyboard.press('Shift+ArrowRight')
  await page.waitForTimeout(800)
  await page.screenshot({ path: 'test-results/screens/p6.png' })
})
