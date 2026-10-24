import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import type { ElectronApplication, Page } from '@playwright/test'
import { test, expect } from './fixtures'
import {
  addToEnd,
  ffprobe,
  haveFfmpeg,
  importFiles,
  makeMedia,
  setWindow,
  stubDialogs,
  track,
} from './helpers'

test.skip(!haveFfmpeg, 'FFmpeg not fetched; run pnpm fetch:binaries')

let media: ReturnType<typeof makeMedia>
test.beforeAll(() => {
  media = makeMedia()
})

async function twoClips(app: ElectronApplication, page: Page) {
  await setWindow(app)
  await importFiles(app, page, [media.a, media.b])
  await addToEnd(page, 'alpha.mp4')
  await addToEnd(page, 'bravo.mp4')
}

const probe = (file: string) =>
  JSON.parse(
    execFileSync(ffprobe, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file], {
      encoding: 'utf8',
    }),
  ) as { streams: { codec_name: string; width?: number }[]; format: { duration: string } }

test('the Export workspace queues exports from presets and runs them in turn', async ({
  app,
  page,
}) => {
  await twoClips(app, page)
  await page.getByRole('tab', { name: 'Export', exact: true }).click()
  const panel = page.getByRole('region', { name: 'Export', exact: true })
  const queue = page.getByRole('region', { name: 'Exports' })

  await panel.getByRole('radio', { name: /^Animated GIF/ }).click()
  const gif = join(media.dir, 'clip.gif')
  await stubDialogs(app, [], gif)
  await panel.getByRole('button', { name: 'Export…' }).click()

  await panel.getByRole('radio', { name: /^Audio only/ }).click()
  const wav = join(media.dir, 'sound.wav')
  await stubDialogs(app, [], wav)
  await panel.getByRole('button', { name: 'Export…' }).click()

  await expect(queue.getByText(/· Done$/)).toHaveCount(2, { timeout: 120_000 })
  expect(probe(gif).streams[0]).toMatchObject({ codec_name: 'gif', width: 480 })
  expect(probe(wav).streams[0]!.codec_name).toBe('pcm_s24le')
})

test('an in-to-out export covers only that range', async ({ app, page }) => {
  await twoClips(app, page)
  await page.keyboard.press('Home')
  for (let i = 0; i < 2; i++) await page.keyboard.press('Shift+ArrowRight')
  await page.keyboard.press('I')
  for (let i = 0; i < 3; i++) await page.keyboard.press('Shift+ArrowRight')
  await page.keyboard.press('O')
  await page.getByRole('tab', { name: 'Export', exact: true }).click()
  const panel = page.getByRole('region', { name: 'Export', exact: true })
  await panel.getByLabel('Range').selectOption('inout')
  const out = join(media.dir, 'range.mp4')
  await stubDialogs(app, [], out)
  await panel.getByRole('button', { name: 'Export…' }).click()
  await expect(page.getByRole('region', { name: 'Exports' }).getByText(/· Done$/)).toBeVisible({
    timeout: 120_000,
  })
  expect(Math.abs(Number(probe(out).format.duration) - 3)).toBeLessThan(0.15)
})

test('the command palette finds and runs commands by name', async ({ app, page }) => {
  await twoClips(app, page)
  const snapping = page.getByRole('button', { name: 'Snapping (Shift+S)' })
  const before = await snapping.getAttribute('aria-pressed')
  await page.keyboard.press('Control+k')
  const palette = page.getByRole('combobox', { name: 'Run a command' })
  await expect(palette).toBeFocused()
  await palette.fill('snapp')
  await page.keyboard.press('Enter')
  await expect(palette).toBeHidden()
  await expect(snapping).not.toHaveAttribute('aria-pressed', before ?? '')
})

test('shortcut presets and changed keys take effect', async ({ app, page }) => {
  await twoClips(app, page)
  await page.getByRole('button', { name: 'Settings' }).click()
  const dialog = page.getByRole('dialog', { name: 'Settings' })
  await dialog.getByLabel('Shortcuts like').selectOption('finalcut')
  await dialog.getByRole('button', { name: 'Change: Add marker' }).click()
  await page.keyboard.press('Shift+K')
  await expect(dialog.getByRole('button', { name: 'Reset: Add marker' })).toBeVisible()
  await page.keyboard.press('Escape')

  await page.getByRole('region', { name: 'Timeline' }).click({ position: { x: 5, y: 5 } })
  await page.keyboard.press('B')
  await expect(page.getByRole('radio', { name: /^Blade/ })).toHaveAttribute('aria-checked', 'true')
  await page.keyboard.press('Shift+K')
  await expect(page.getByRole('button', { name: /^Marker .* at/ })).toHaveCount(1)
  await page.keyboard.press('M')
  await expect(page.getByRole('button', { name: /^Marker .* at/ })).toHaveCount(1)
  expect(await track(page, 'V1').count()).toBe(2)
})

test.describe('first start', () => {
  test.use({ firstRun: true })

  test('the welcome sheet sets familiar shortcuts and stays away after', async ({ page }) => {
    const sheet = page.getByRole('dialog', { name: 'Welcome to Lumacut' })
    await expect(sheet).toBeVisible()
    await sheet.getByRole('radio', { name: 'Premiere Pro' }).click()
    await sheet.getByRole('button', { name: 'Skip the tour' }).click()
    await expect(sheet).toBeHidden()
    const settings = await page.evaluate(() => window.lumacut.invoke('settings:get'))
    expect(settings).toMatchObject({ onboarded: true, keymap: { preset: 'premiere' } })
  })
})

test('media can be rated, filtered, shown as a list, and relinked after it moves', async ({
  app,
  page,
}) => {
  const { copyFileSync, renameSync } = await import('node:fs')
  const moved = join(media.dir, 'moved')
  const { mkdirSync } = await import('node:fs')
  mkdirSync(moved, { recursive: true })
  const original = join(media.dir, 'charlie.mp4')
  copyFileSync(media.b, original)
  await setWindow(app)
  await importFiles(app, page, [media.a, original])

  const item = page.getByRole('listitem', { name: 'charlie.mp4', exact: true })
  await item.click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Rating' }).click()
  await page.getByRole('menuitemradio', { name: '4 stars' }).click()
  await page.getByRole('button', { name: 'Rated', exact: true }).click()
  await expect(page.getByRole('listitem', { name: 'alpha.mp4', exact: true })).toBeHidden()
  await expect(item.getByLabel('4 stars')).toBeVisible()
  await page.getByRole('button', { name: 'All', exact: true }).click()

  await page.getByRole('button', { name: 'More media options' }).click()
  await page.getByRole('menuitemradio', { name: 'Show as a list' }).click()
  await expect(page.getByRole('list', { name: 'Media' })).toHaveAttribute('data-view', 'list')

  // The file moves away; the project notices and finds it again in a folder.
  renameSync(original, join(moved, 'charlie.mp4'))
  // Coming back to the window checks the files again.
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(item.getByText('Missing')).toBeVisible()
  await app.evaluate(({ dialog }, folder) => {
    dialog.showOpenDialog = (async () => ({
      canceled: false,
      filePaths: [folder],
    })) as typeof dialog.showOpenDialog
  }, moved)
  await page.getByRole('button', { name: 'More media options' }).click()
  await page.getByRole('menuitem', { name: 'Find missing media in a folder…' }).click()
  await expect(page.getByText('Found 1 of 1 missing files.')).toBeVisible()
  await expect(item.getByText('Missing')).toBeHidden()
})

test('a grade can be saved as a LUT file', async ({ app, page }) => {
  await twoClips(app, page)
  await page.keyboard.press('Home')
  await page.keyboard.press('ArrowRight')
  await page.getByRole('tab', { name: 'Color', exact: true }).first().click()
  const grade = page.getByRole('region', { name: /^Grade/ })
  await grade.getByRole('button', { name: 'Add grade layer' }).click()
  await page.getByRole('menuitem', { name: 'LUT' }).click()
  await grade.getByLabel('Look').selectOption({ label: 'Black and white' })
  const out = join(media.dir, 'look.cube')
  await stubDialogs(app, [], out)
  await grade.getByRole('button', { name: 'Export as LUT…' }).click()
  await expect(page.getByText('Saved look.cube.')).toBeVisible()
  const { readFileSync } = await import('node:fs')
  const text = readFileSync(out, 'utf8')
  expect(text).toContain('LUT_3D_SIZE 33')
  // Black and white: every entry is grey.
  const row = text
    .split('\n')
    .find((l) => /^0\.\d+ 0\.\d+ 0\.\d+$/.test(l) && !l.startsWith('0.000000 0.000000'))!
  const [r, g, b] = row.split(' ').map(Number)
  expect(Math.abs(r! - g!) + Math.abs(g! - b!)).toBeLessThan(1e-4)
})
