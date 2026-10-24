import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from './fixtures'
import { addToEnd, box, ffmpeg, haveFfmpeg, importFiles, makeMedia, track } from './helpers'

test.skip(!haveFfmpeg, 'FFmpeg not fetched')

test('screenshot: audio workspace', async ({ app, page }) => {
  const media = makeMedia()
  const dir = mkdtempSync(join(tmpdir(), 'lumacut-p5-'))
  const music = join(dir, 'music.wav')
  execFileSync(ffmpeg, [
    '-v',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    'anoisesrc=c=pink:a=0.1:r=48000:d=8',
    music,
  ])
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(1440, 900))
  await page.getByRole('button', { name: 'Settings' }).click()
  await page.getByRole('radio', { name: 'Dark' }).click()
  await page.keyboard.press('Escape')
  await importFiles(app, page, [media.a, media.b, music])
  await addToEnd(page, 'alpha.mp4')
  await addToEnd(page, 'bravo.mp4')
  await page.getByRole('button', { name: 'Add audio track' }).first().click()
  await page.getByRole('button', { name: 'Target A2 for source edits' }).click()
  await page.keyboard.press('Home')
  await page.getByRole('listitem', { name: 'music.wav', exact: true }).dblclick()
  await page.keyboard.press('Period')
  await page.keyboard.press('Shift+Z')
  await page.getByRole('tab', { name: 'Audio', exact: true }).click()
  const mixer = page.getByRole('region', { name: 'Mixer' })
  await mixer.getByRole('combobox', { name: 'Role of A1' }).selectOption('dialogue')
  await mixer.getByRole('combobox', { name: 'Role of A2' }).selectOption('music')
  await mixer.getByRole('button', { name: 'Duck music' }).click()
  const a = await box(track(page, 'A1').nth(0))
  await page.mouse.click(a.x + a.width / 2, a.y + a.height - 6)
  await page.getByRole('region', { name: 'Inspector' }).getByRole('tab', { name: 'Sound' }).click()
  await page.getByRole('slider', { name: 'Fade in for alpha.mp4' }).focus()
  for (let i = 0; i < 12; i++) await page.keyboard.press('ArrowRight')
  await page.waitForTimeout(500)
  await page.getByRole('tab', { name: 'Timeline', exact: true }).first().click()
  await page.getByRole('button', { name: 'Go to start' }).click()
  await page.getByRole('button', { name: 'Play', exact: true }).click()
  await page.waitForTimeout(1600)
  await page.screenshot({ path: 'test-results/screens/p5-dark.png' })
  await page.getByRole('button', { name: 'Pause', exact: true }).click()
})
