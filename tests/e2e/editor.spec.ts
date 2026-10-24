import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ElectronApplication, Page } from '@playwright/test'
import { test, expect } from './fixtures'

const bin = join('resources', 'bin', `${process.platform}-${process.arch}`)
const ffmpeg = join(bin, 'ffmpeg')
const ffprobe = join(bin, 'ffprobe')

test.skip(!existsSync(ffmpeg), 'FFmpeg not fetched; run pnpm fetch:binaries')

const dir = mkdtempSync(join(tmpdir(), 'lumacut-editor-'))
const source = join(dir, 'beach 4k.mp4')

test.beforeAll(() => {
  execFileSync(ffmpeg, [
    '-v',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    'testsrc2=size=3840x2160:rate=30:duration=6',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=330:sample_rate=48000:duration=6',
    '-c:v',
    'libx264',
    '-preset',
    'ultrafast',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-shortest',
    source,
  ])
})

async function stubDialogs(app: ElectronApplication, open: string[], save: string) {
  await app.evaluate(
    ({ dialog }, { open, save }) => {
      dialog.showOpenDialog = (async () => ({
        canceled: false,
        filePaths: open,
      })) as typeof dialog.showOpenDialog
      dialog.showSaveDialog = (async () => ({
        canceled: false,
        filePath: save,
      })) as typeof dialog.showSaveDialog
    },
    { open, save },
  )
}

async function addToEnd(page: Page, name: string) {
  await page.getByRole('listitem', { name }).click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Add to end of timeline' }).click()
}

function v1Clips(page: Page) {
  return page.getByRole('list', { name: 'Track V1' }).getByRole('listitem')
}

async function dragClip(page: Page, index: number, toX: number) {
  const box = (await v1Clips(page).nth(index).boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2 + (toX - box.x) / 2, box.y + box.height / 2, {
    steps: 4,
  })
  await page.mouse.move(toX + box.width / 2, box.y + box.height / 2, { steps: 4 })
  await page.mouse.up()
}

test('import a 4K clip, cut it in three, reorder, export, save and reopen', async ({
  app,
  page,
}) => {
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(1440, 900))
  await stubDialogs(app, [source], join(dir, 'unused'))

  await page.getByRole('button', { name: 'Import media' }).first().click()
  const card = page.getByRole('listitem', { name: 'beach 4k.mp4' })
  await expect(card).toBeVisible()
  await addToEnd(page, 'beach 4k.mp4')

  await expect(v1Clips(page)).toHaveCount(1)
  await expect(page.getByText('3840×2160, 30 fps')).toBeVisible()
  await expect(page.getByLabel('Sequence length')).toHaveText('00:00:06:00')

  // Cut at 2 s and 4 s.
  await page.locator('body').click({ position: { x: 5, y: 300 } })
  await page.keyboard.press('Shift+ArrowRight')
  await page.keyboard.press('Shift+ArrowRight')
  await page.keyboard.press('s')
  await page.keyboard.press('Shift+ArrowRight')
  await page.keyboard.press('Shift+ArrowRight')
  await page.keyboard.press('s')
  await expect(v1Clips(page)).toHaveCount(3)

  // Reorder: first part to the end, last part to the start, first part into the gap.
  const first = (await v1Clips(page).nth(0).boundingBox())!
  const width = first.width
  const x0 = first.x
  await page.keyboard.press('Home')
  await dragClip(page, 0, x0 + width * 3)
  await dragClip(page, 2, x0)
  await expect(
    page.getByRole('list', { name: 'Track V1' }).getByLabel(/beach 4k.mp4, starts 00:00:00:00/),
  ).toBeVisible()
  const labels = async () =>
    await v1Clips(page).evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')))
  await dragClip(page, 0, x0 + width * 2)
  await expect
    .poll(async () => (await labels()).filter((l) => l?.includes('starts 00:00:04:00')).length)
    .toBe(1)
  await expect(page.getByLabel('Sequence length')).toHaveText('00:00:06:00')

  await page.screenshot({ path: 'test-results/screens/edit-with-clips.png' })

  // Undo the last move, then redo it.
  await page.keyboard.press('Control+z')
  await expect(page.getByLabel('Sequence length')).toHaveText('00:00:08:00')
  await page.keyboard.press('Control+Shift+z')
  await expect(page.getByLabel('Sequence length')).toHaveText('00:00:06:00')

  // Export.
  const output = join(dir, 'export.mp4')
  await stubDialogs(app, [source], output)
  await page.getByRole('button', { name: 'Export', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Export finished' })).toBeVisible({
    timeout: 90_000,
  })
  await page.getByRole('button', { name: 'Close' }).click()
  const probe = JSON.parse(
    execFileSync(
      ffprobe,
      ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', output],
      { encoding: 'utf8' },
    ),
  ) as {
    format: { duration: string }
    streams: { codec_type: string; codec_name: string; width?: number }[]
  }
  expect(Number(probe.format.duration)).toBeCloseTo(6, 1)
  expect(probe.streams.find((s) => s.codec_type === 'video')).toMatchObject({
    codec_name: 'h264',
    width: 3840,
  })

  // Save, start a new project, and open the saved one again.
  const projectPath = join(dir, 'Beach cut.lumacut')
  await stubDialogs(app, [projectPath], projectPath)
  await page.keyboard.press('Control+s')
  await expect(page.getByText('Saved Beach cut.lumacut')).toBeVisible()
  await expect(page.getByText('Edited')).toBeHidden()
  await page.keyboard.press('Control+n')
  await expect(v1Clips(page)).toHaveCount(0)
  await page.keyboard.press('Control+o')
  await expect(v1Clips(page)).toHaveCount(3)
  await expect(page.locator('header').getByText('Beach cut')).toBeVisible()
})

test('asks before throwing away unsaved changes', async ({ app, page }) => {
  await stubDialogs(app, [source], join(dir, 'unused'))
  await page.getByRole('button', { name: 'Import media' }).first().click()
  await expect(page.getByRole('listitem', { name: 'beach 4k.mp4' })).toBeVisible()
  await page.keyboard.press('Control+n')
  const dialog = page.getByRole('dialog', { name: 'Save changes to "Untitled project"?' })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: 'Cancel' }).click()
  await expect(page.getByRole('listitem', { name: 'beach 4k.mp4' })).toBeVisible()
  await page.keyboard.press('Control+n')
  await page.getByRole('button', { name: "Don't save" }).click()
  await expect(page.getByRole('listitem', { name: 'beach 4k.mp4' })).toBeHidden()
})

test('plays the timeline and stops at the end', async ({ app, page }) => {
  await stubDialogs(app, [source], join(dir, 'unused'))
  await page.getByRole('button', { name: 'Import media' }).first().click()
  await addToEnd(page, 'beach 4k.mp4')
  await expect(v1Clips(page)).toHaveCount(1)

  await page.getByRole('button', { name: 'Play', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible()
  await page.waitForTimeout(1500)
  const state = await page.evaluate(() => {
    const video = document.querySelector('video')!
    return { time: video.currentTime, paused: video.paused }
  })
  expect(state.paused).toBe(false)
  expect(state.time).toBeGreaterThan(0.8)
  // The canvas shows the picture, not black.
  const lit = await page.getByTestId('program-canvas').evaluate((c: HTMLCanvasElement) => {
    const probe = document.createElement('canvas')
    probe.width = 32
    probe.height = 18
    const ctx = probe.getContext('2d')!
    ctx.drawImage(c, 0, 0, 32, 18)
    const px = ctx.getImageData(0, 0, 32, 18).data
    let sum = 0
    for (let i = 0; i < px.length; i += 4) sum += px[i]! + px[i + 1]! + px[i + 2]!
    return sum / (px.length / 4) / 3
  })
  expect(lit).toBeGreaterThan(20)
  const playhead = await page.getByLabel('Playhead position').first().textContent()
  expect(playhead).not.toBe('00:00:00:00')

  await page.keyboard.press('End')
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible({
    timeout: 8000,
  })
})
