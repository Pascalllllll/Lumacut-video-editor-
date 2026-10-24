import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ElectronApplication, Page } from '@playwright/test'
import { test, expect } from './fixtures'
import {
  addToEnd,
  box,
  ffmpeg,
  haveFfmpeg,
  importFiles,
  setWindow,
  stubDialogs,
  track,
} from './helpers'

test.skip(!haveFfmpeg, 'FFmpeg not fetched; run pnpm fetch:binaries')

const dir = mkdtempSync(join(tmpdir(), 'lumacut-audio-e2e-'))
const make = (name: string, source: string, seconds: number) => {
  const path = join(dir, name)
  execFileSync(ffmpeg, [
    '-v',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    `${source}:d=${seconds}`,
    '-ar',
    '48000',
    path,
  ])
  return path
}
// Speech-like bursts: on for 1.5 s, off for 1.5 s.
const voice = make(
  'voice.wav',
  "aevalsrc=exprs='0.4*sin(2*PI*220*t)*lt(mod(t\\,3)\\,1.5)':s=48000",
  9,
)
const music = make('music.wav', 'anoisesrc=c=pink:a=0.08:r=48000', 9)
const clicks = make(
  'clicks.wav',
  "aevalsrc=exprs='0.9*sin(2*PI*1500*t)*exp(-60*mod(t\\,0.5))':s=48000",
  10,
)

const inspector = (page: Page) => page.getByRole('region', { name: 'Inspector' })

async function oneSound(app: ElectronApplication, page: Page, path: string) {
  await setWindow(app)
  await importFiles(app, page, [path])
  await addToEnd(page, path.split('/').pop()!)
  await page.keyboard.press('Shift+Z')
  const clip = await box(track(page, 'A1').nth(0))
  await page.mouse.click(clip.x + clip.width / 2, clip.y + clip.height - 6)
}

test('the Sound tab sets level and effects, and fades follow the keyboard', async ({
  app,
  page,
}) => {
  await oneSound(app, page, voice)
  await inspector(page).getByRole('tab', { name: 'Sound' }).click()
  await inspector(page).getByRole('button', { name: 'Add sound effect' }).click()
  await page.getByRole('menuitem', { name: 'Compressor' }).click()
  await expect(inspector(page).getByText('Compressor', { exact: true })).toBeVisible()

  const fadeIn = page.getByRole('slider', { name: 'Fade in for voice.wav' })
  await fadeIn.focus()
  for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowRight')
  await expect(fadeIn).toHaveAttribute('aria-valuenow', '5')
  // The nudges land as one change.
  await page.waitForTimeout(600)
  await page.keyboard.press('Control+z')
  await expect(fadeIn).toHaveAttribute('aria-valuenow', '0')
})

test('playback is routed through the mixer and shows on the meters', async ({ app, page }) => {
  await oneSound(app, page, voice)
  await page.getByRole('tab', { name: 'Audio', exact: true }).click()
  const mixer = page.getByRole('region', { name: 'Mixer' })
  await expect(mixer.getByRole('group', { name: 'A1' })).toBeVisible()
  await page.getByRole('button', { name: 'Go to start' }).click()
  await page.getByRole('button', { name: 'Play', exact: true }).click()
  await page.waitForTimeout(900)
  const lit = await mixer
    .getByRole('img', { name: 'Master meter' })
    .evaluate((c: HTMLCanvasElement) => {
      const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data
      let n = 0
      // The meter bed is near black; lit segments are green or brighter.
      for (let i = 0; i < d.length; i += 4) if (d[i + 1]! > 120) n++
      return n
    })
  await page.getByRole('button', { name: 'Pause', exact: true }).click()
  expect(lit).toBeGreaterThan(20)
})

test('a track fader is one undoable change', async ({ app, page }) => {
  await oneSound(app, page, voice)
  await page.getByRole('tab', { name: 'Audio', exact: true }).click()
  const level = page
    .getByRole('region', { name: 'Mixer' })
    .getByRole('spinbutton', { name: 'A1 level' })
  const fader = page.getByRole('slider', { name: 'A1 level' })
  await fader.focus()
  for (let i = 0; i < 6; i++) await page.keyboard.press('ArrowDown')
  await expect(level).toHaveAttribute('aria-valuenow', '-3')
  await page.keyboard.press('Control+z')
  await expect(level).toHaveAttribute('aria-valuenow', '0')
})

test('exports reach the loudness target within 0.5 LU', async ({ app, page }) => {
  await oneSound(app, page, voice)
  await page.getByRole('tab', { name: 'Audio', exact: true }).click()
  await page
    .getByRole('combobox', { name: 'Loudness on export' })
    .selectOption({ label: '-14 LUFS, streaming' })
  const output = join(dir, 'loud.mp4')
  await stubDialogs(app, [], output)
  await page.getByRole('button', { name: 'Export', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Export finished' })).toBeVisible({
    timeout: 120_000,
  })
  const res = spawnSync(
    ffmpeg,
    ['-hide_banner', '-nostats', '-i', output, '-af', 'ebur128=framelog=quiet', '-f', 'null', '-'],
    {
      encoding: 'utf8',
    },
  )
  const integrated = Number(/I:\s+(-?[\d.]+) LUFS/.exec(res.stderr)![1])
  expect(Math.abs(integrated + 14)).toBeLessThanOrEqual(0.5)
})

test('ducking lowers the music while the dialogue speaks', async ({ app, page }) => {
  await setWindow(app)
  await importFiles(app, page, [voice, music])
  await addToEnd(page, 'voice.wav')
  await page.getByRole('button', { name: 'Add audio track' }).first().click()
  await page.getByRole('button', { name: 'Target A2 for source edits' }).click()
  await page.keyboard.press('Home')
  await page.getByRole('listitem', { name: 'music.wav', exact: true }).dblclick()
  await page.keyboard.press('Period')
  await expect(track(page, 'A2')).toHaveCount(1)

  await page.getByRole('tab', { name: 'Audio', exact: true }).click()
  const mixer = page.getByRole('region', { name: 'Mixer' })
  await mixer.getByRole('combobox', { name: 'Role of A1' }).selectOption('dialogue')
  await mixer.getByRole('combobox', { name: 'Role of A2' }).selectOption('music')
  await mixer.getByRole('button', { name: 'Duck music' }).click()
  await expect(page.getByText('Ducked the music under the dialogue.')).toBeVisible()

  // The music clip's volume now has keyframes.
  await page.keyboard.press('Shift+Z')
  const clip = await box(track(page, 'A2').nth(0))
  await page.mouse.click(clip.x + clip.width / 2, clip.y + clip.height - 6)
  await inspector(page).getByRole('tab', { name: 'Sound' }).click()
  await expect(
    inspector(page).getByRole('button', { name: /^(Add|Remove) keyframe for Volume$/ }),
  ).toBeVisible()
})

test('beat markers land on a click track and the clip cuts at them', async ({ app, page }) => {
  await oneSound(app, page, clicks)
  await inspector(page).getByRole('tab', { name: 'Sound' }).click()
  await inspector(page).getByRole('button', { name: 'Add beat markers' }).click()
  await expect(page.getByText(/^Added \d+ beat markers at 120 BPM\.$/)).toBeVisible({
    timeout: 30_000,
  })
  await inspector(page).getByRole('button', { name: 'Cut at markers' }).click()
  await expect(page.getByText(/^Cut the clip into \d+ pieces\.$/)).toBeVisible()
  expect(await track(page, 'A1').count()).toBeGreaterThan(15)
})

test.describe('voiceover', () => {
  test.use({ launchArgs: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] })

  test('records from the microphone onto the target track', async ({ app, page }) => {
    await setWindow(app)
    await page.getByRole('tab', { name: 'Audio', exact: true }).click()
    await page.getByRole('button', { name: 'Record voiceover' }).click()
    await expect(page.getByRole('button', { name: /Stop recording/ })).toBeVisible()
    await page.waitForTimeout(1500)
    await page.getByRole('button', { name: /Stop recording/ }).click()
    await expect(page.getByText('Added the voiceover to A1.')).toBeVisible({ timeout: 20_000 })
    await expect(track(page, 'A1')).toHaveCount(1)
  })
})
