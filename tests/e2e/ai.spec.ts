import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ElectronApplication, Page } from '@playwright/test'
import { test, expect } from './fixtures'
import {
  addToEnd,
  box,
  ffmpeg,
  ffprobe,
  haveFfmpeg,
  importFiles,
  setWindow,
  stubDialogs,
  track,
} from './helpers'

const models =
  process.env['LUMACUT_MODELS'] ?? join(homedir(), '.local', 'share', 'Lumacut', 'models')
const haveModels =
  existsSync(join(models, 'onnx-community', 'whisper-base_timestamped', 'onnx')) &&
  existsSync(join(models, 'Xenova', 'modnet', 'onnx')) &&
  existsSync(join(models, 'rnnoise', 'sh.rnnn'))

test.skip(
  !haveFfmpeg || !haveModels,
  'Needs FFmpeg and the local models (pnpm fetch:models whisper-base modnet rnnoise-speech)',
)

const speech = join('tests', 'fixtures', 'jfk.wav')
const dir = mkdtempSync(join(tmpdir(), 'lumacut-ai-e2e-'))
const make = (name: string, args: string[]) => {
  const path = join(dir, name)
  execFileSync(ffmpeg, ['-v', 'error', '-y', ...args, path])
  return path
}

/** Cuts the app off from the network: the renderer is offline and main-process fetches fail. */
async function goOffline(app: ElectronApplication) {
  await app.evaluate(async ({ session }) => {
    session.defaultSession.enableNetworkEmulation({ offline: true })
    globalThis.fetch = (() => Promise.reject(new Error('offline'))) as typeof fetch
  })
}

async function speechOnTimeline(app: ElectronApplication, page: Page) {
  await setWindow(app)
  await importFiles(app, page, [join(process.cwd(), speech)])
  await addToEnd(page, 'jfk.wav')
}

test('captions from speech with no network, then edit the video by its words', async ({
  app,
  page,
}) => {
  await goOffline(app)
  await speechOnTimeline(app, page)
  await page.getByRole('tab', { name: 'Captions', exact: true }).first().click()
  const panel = page.getByRole('region', { name: 'Captions' })
  await panel.getByRole('button', { name: 'Transcribe' }).click()
  await expect(page.getByText(/^Made \d+ captions from the speech\.$/)).toBeVisible({
    timeout: 120_000,
  })
  const all = (
    await panel
      .getByRole('list', { name: 'Captions' })
      .locator('textarea')
      .evaluateAll((els) => els.map((e) => (e as HTMLTextAreaElement).value).join(' '))
  ).toLowerCase()
  expect(all).toContain('ask not what your country can do for you')

  const before = await page.getByLabel('Sequence length').textContent()
  await panel.getByRole('tab', { name: 'Transcript' }).click()
  await panel.getByRole('button', { name: 'And', exact: true }).click()
  await panel
    .getByRole('button', { name: 'Americans', exact: true })
    .click({ modifiers: ['Shift'] })
  await panel.getByRole('button', { name: /^Remove “And so my fellow Americans”$/ }).click()
  await expect(page.getByLabel('Sequence length')).not.toHaveText(before ?? '')
  await expect(panel.getByRole('button', { name: 'Americans', exact: true })).toHaveCount(0)

  const srt = join(dir, 'captions.srt')
  await stubDialogs(app, [], srt)
  await panel.getByRole('tab', { name: 'Captions' }).click()
  await panel.getByRole('button', { name: 'Export SRT' }).click()
  await expect(page.getByText('Saved captions.srt.')).toBeVisible()
  const text = readFileSync(srt, 'utf8')
  expect(text).toMatch(/^1\n00:00:00,\d{3} --> /)
  expect(text.toLowerCase()).not.toContain('fellow')
})

test('silences come out of the edit after review', async ({ app, page }) => {
  const bursts = make('bursts.wav', [
    '-f',
    'lavfi',
    '-i',
    "aevalsrc=exprs='0.4*sin(2*PI*300*t)*lt(mod(t\\,3)\\,1.5)':s=48000:d=9",
  ])
  await setWindow(app)
  await importFiles(app, page, [bursts])
  await addToEnd(page, 'bursts.wav')
  await page.getByRole('tab', { name: 'Captions', exact: true }).first().click()
  const panel = page.getByRole('region', { name: 'Captions' })
  await panel.getByRole('tab', { name: 'Transcript' }).click()
  await panel.getByRole('button', { name: 'Find silences' }).click()
  const review = panel.getByRole('list', { name: 'Found stretches' })
  await expect(review.getByRole('checkbox')).toHaveCount(3, { timeout: 30_000 })
  await panel.getByRole('button', { name: 'Remove 3 checked' }).click()
  await expect(page.getByText('Removed 3 stretches from the edit.')).toBeVisible()
  expect(await track(page, 'A1').count()).toBe(3)
})

test('scene changes split a clip', async ({ app, page }) => {
  const shots = make('shots.mp4', [
    '-f',
    'lavfi',
    '-i',
    'testsrc2=s=320x180:r=30:d=2',
    '-f',
    'lavfi',
    '-i',
    'smptebars=s=320x180:r=30:d=2',
    '-filter_complex',
    '[0:v][1:v]concat=n=2:v=1[v]',
    '-map',
    '[v]',
    '-c:v',
    'libx264',
    '-preset',
    'ultrafast',
    '-pix_fmt',
    'yuv420p',
  ])
  await setWindow(app)
  await importFiles(app, page, [shots])
  await addToEnd(page, 'shots.mp4')
  await page.keyboard.press('Shift+Z')
  const clip = await box(track(page, 'V1').nth(0))
  await page.mouse.click(clip.x + clip.width / 2, clip.y + clip.height / 2)
  await page
    .getByRole('region', { name: 'Inspector' })
    .getByRole('button', { name: 'Cut at scene changes' })
    .click()
  await expect(page.getByText('Cut the clip into 2 shots.')).toBeVisible({ timeout: 30_000 })
  await expect(track(page, 'V1')).toHaveCount(2)
})

test('voice cleanup and background removal put processed copies on the clips', async ({
  app,
  page,
}) => {
  await goOffline(app)
  const person = make('person.mp4', [
    '-f',
    'lavfi',
    '-i',
    'testsrc2=s=320x180:r=10:d=1',
    '-f',
    'lavfi',
    '-i',
    'anoisesrc=c=pink:a=0.05:d=1',
    '-c:v',
    'libx264',
    '-preset',
    'ultrafast',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-shortest',
  ])
  await setWindow(app)
  await importFiles(app, page, [person])
  await addToEnd(page, 'person.mp4')
  await page.keyboard.press('Shift+Z')
  const inspector = page.getByRole('region', { name: 'Inspector' })

  const audio = await box(track(page, 'A1').nth(0))
  await page.mouse.click(audio.x + audio.width / 2, audio.y + audio.height - 6)
  await inspector.getByRole('tab', { name: 'Sound' }).click()
  await inspector.getByRole('button', { name: 'Clean up voice' }).click()
  await expect(page.getByText('Voice cleaned. Undo to go back to the original.')).toBeVisible({
    timeout: 60_000,
  })
  await expect(track(page, 'A1').nth(0)).toHaveAttribute(
    'aria-label',
    /^person \(voice cleaned\)\.wav/,
  )

  const video = await box(track(page, 'V1').nth(0))
  await page.mouse.click(video.x + video.width / 2, video.y + video.height / 2)
  await inspector.getByRole('tab', { name: 'Clip' }).click()
  await inspector.getByRole('button', { name: 'Remove background' }).click()
  await expect(page.getByText('Background removed. Undo to go back to the original.')).toBeVisible({
    timeout: 120_000,
  })
  await expect(track(page, 'V1').nth(0)).toHaveAttribute('aria-label', /^person \(cutout\)\.webm/)
  const cutout = execFileSync(
    ffprobe,
    [
      '-v',
      'error',
      '-show_entries',
      'stream_tags=alpha_mode',
      '-of',
      'csv=p=0',
      join(
        app ? await app.evaluate(({ app }) => app.getPath('userData')) : '',
        'processed',
        'person (cutout).webm',
      ),
    ],
    { encoding: 'utf8' },
  )
  expect(cutout.trim()).toBe('1')
})

test('the models list shows what is downloaded', async ({ page }) => {
  await page.getByRole('button', { name: 'Settings' }).click()
  const row = page.getByRole('group', { name: 'Whisper base' })
  await expect(row.getByText('Downloaded')).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Download Whisper small (more accurate)' }),
  ).toBeVisible()
})
