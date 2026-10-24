import { test } from './fixtures'

for (const theme of ['dark', 'light'] as const) {
  test(`screenshot: edit workspace, ${theme}`, async ({ app, page }) => {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(1440, 900))
    await page.evaluate((t) => window.lumacut.invoke('settings:set', { theme: t }), theme)
    await page.reload()
    await page.waitForSelector('[data-loaded="true"]')
    await page.waitForTimeout(1000)
    await page.screenshot({ path: `test-results/screens/edit-${theme}.png` })
    await page.getByRole('button', { name: 'Settings' }).click()
    await page.waitForTimeout(400)
    await page.screenshot({ path: `test-results/screens/settings-${theme}.png` })
  })
}
