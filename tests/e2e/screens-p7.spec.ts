import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { fakeModel } from './fake-model'
import { test, expect } from './fixtures'
import { addToEnd, ffmpeg, haveFfmpeg, importFiles, makeMedia } from './helpers'

const models = join(homedir(), '.local', 'share', 'Lumacut', 'models', 'onnx-community')
test.skip(!haveFfmpeg || !existsSync(models), 'Needs FFmpeg and the speech model')

test('screenshot: copilot with a change to review', async ({ app, page }) => {
  const media = makeMedia()
  const dir = mkdtempSync(join(tmpdir(), 'lumacut-p7-'))
  const talk = join(dir, 'talk.wav')
  const jfk = join('tests', 'fixtures', 'jfk.wav')
  execFileSync(ffmpeg, [
    '-v',
    'error',
    '-y',
    '-i',
    jfk,
    '-i',
    jfk,
    '-filter_complex',
    '[0:a]apad=pad_dur=2[a];[a][1:a]concat=n=2:v=0:a=1',
    talk,
  ])
  const model = await fakeModel()
  try {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(1440, 900))
    await importFiles(app, page, [media.a, talk])
    await addToEnd(page, 'alpha.mp4')
    await addToEnd(page, 'talk.wav')
    await page.keyboard.press('Shift+Z')
    await page.getByRole('button', { name: 'Settings' }).click()
    const dialog = page.getByRole('dialog', { name: 'Settings' })
    await dialog.getByLabel('Provider').selectOption('custom')
    await dialog.getByLabel('Address').fill(model.url)
    await dialog.getByLabel('Address').blur()
    await dialog.getByRole('button', { name: 'Check connection' }).click()
    await expect(page.getByText('Connected. 1 models available.')).toBeVisible()
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: 'Copilot' }).click()
    const panel = page.getByRole('region', { name: 'Copilot' })
    await page.screenshot({ path: 'test-results/screens/p7-empty.png' })
    await panel
      .getByRole('button', { name: 'Remove silences longer than 0.7 s and add captions' })
      .click()
    await expect(panel.getByRole('region', { name: 'Review the change' })).toBeVisible({
      timeout: 120_000,
    })
    await page.waitForTimeout(400)
    await page.screenshot({ path: 'test-results/screens/p7.png' })
  } finally {
    model.close()
  }
})
