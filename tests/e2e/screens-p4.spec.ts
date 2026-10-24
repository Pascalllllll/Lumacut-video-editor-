import { test } from './fixtures'
import { addToEnd, box, haveFfmpeg, importFiles, makeMedia, track } from './helpers'

test.skip(!haveFfmpeg, 'FFmpeg not fetched')

test('screenshot: color workspace', async ({ app, page }) => {
  const media = makeMedia()
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(1440, 900))
  await page.getByRole('button', { name: 'Settings' }).click()
  await page.getByRole('radio', { name: 'Dark' }).click()
  await page.keyboard.press('Escape')
  await importFiles(app, page, [media.a, media.b])
  await addToEnd(page, 'alpha.mp4')
  await addToEnd(page, 'bravo.mp4')
  await page.keyboard.press('Home')
  await page.keyboard.press('Shift+ArrowRight')
  const a = await box(track(page, 'V1').nth(0))
  await page.mouse.click(a.x + a.width / 3, a.y + a.height / 2)
  await page.getByRole('tab', { name: 'Color', exact: true }).first().click()
  const grade = page.getByRole('region', { name: /^Grade/ })
  await grade.getByRole('button', { name: 'Add grade layer' }).click()
  await page.getByRole('menuitem', { name: 'Primary' }).click()
  const wheel = await box(grade.getByRole('slider', { name: 'Gain color' }))
  await page.mouse.click(wheel.x + wheel.width * 0.62, wheel.y + wheel.height * 0.45)
  await page.waitForTimeout(600)
  await page.screenshot({ path: 'test-results/screens/p4-dark.png' })
})
