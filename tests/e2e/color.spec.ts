import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import type { Page } from '@playwright/test'
import { test, expect } from './fixtures'
import {
  addToEnd,
  box,
  ffprobe,
  haveFfmpeg,
  importFiles,
  makeMedia,
  setWindow,
  stubDialogs,
  track,
} from './helpers'

test.skip(!haveFfmpeg, 'FFmpeg not fetched; run pnpm fetch:binaries')

type Pixels = { width: number; height: number; data: number[] }

/** Pixels of the scope canvas. */
async function scope(page: Page, kind: 'Waveform' | 'Parade' | 'Vectorscope'): Promise<Pixels> {
  await page.getByRole('region', { name: 'Scopes' }).getByRole('tab', { name: kind }).click()
  await page.waitForTimeout(300)
  return page.getByTestId('scope-canvas').evaluate((c: HTMLCanvasElement) => {
    const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height)
    return { width: d.width, height: d.height, data: Array.from(d.data) }
  })
}

const brightness = (p: Pixels, x: number, y: number) => {
  const i = (y * p.width + x) * 4
  return p.data[i]! + p.data[i + 1]! + p.data[i + 2]!
}

/** Row with the most light, summed across the scope. */
function brightestRow(p: Pixels, x0 = 0, x1 = p.width): number {
  let best = 0
  let bestY = -1
  for (let y = 0; y < p.height; y++) {
    let sum = 0
    for (let x = x0; x < x1; x++) sum += brightness(p, x, y)
    if (sum > best) {
      best = sum
      bestY = y
    }
  }
  return bestY
}

function brightestPoint(p: Pixels): { x: number; y: number } {
  let best = -1
  let at = { x: -1, y: -1 }
  for (let y = 0; y < p.height; y++)
    for (let x = 0; x < p.width; x++) {
      const b = brightness(p, x, y)
      if (b > best) {
        best = b
        at = { x, y }
      }
    }
  return at
}

/** A solid color clip on V1, set to `hex`, then the Color workspace. */
async function colorClip(
  app: Parameters<Parameters<typeof test>[2]>[0]['app'],
  page: Page,
  hex: string,
) {
  await setWindow(app)
  await page.getByRole('tab', { name: 'Titles' }).click()
  await page.getByRole('listitem', { name: 'Black', exact: true }).dblclick()
  const clip = await box(track(page, 'V1').nth(0))
  await page.mouse.click(clip.x + clip.width / 2, clip.y + clip.height / 2)
  const inspector = page.getByRole('region', { name: 'Inspector' })
  await inspector.getByRole('tab', { name: 'Color' }).click()
  await inspector.locator('input[type=color]').fill(hex)
  await page.keyboard.press('Home')
  await page.keyboard.press('ArrowRight')
  await page.getByRole('tab', { name: 'Color', exact: true }).first().click()
}

test('scopes read 50% gray at 50% and a 75% red on its target', async ({ app, page }) => {
  await colorClip(app, page, '#808080')
  await expect(page.getByRole('region', { name: 'Scopes' })).toBeVisible()
  const wave = await scope(page, 'Waveform')
  expect(
    Math.abs(brightestRow(wave) - (wave.height - 1 - Math.round((128 / 255) * (wave.height - 1)))),
  ).toBeLessThanOrEqual(2)
  const parade = await scope(page, 'Parade')
  for (const third of [0, 1, 2]) {
    const row = brightestRow(
      parade,
      Math.floor((third * parade.width) / 3) + 2,
      Math.floor(((third + 1) * parade.width) / 3) - 2,
    )
    expect(
      Math.abs(row - (parade.height - 1 - Math.round((128 / 255) * (parade.height - 1)))),
    ).toBeLessThanOrEqual(2)
  }
  const vec = await scope(page, 'Vectorscope')
  const center = brightestPoint(vec)
  expect(Math.abs(center.x - vec.width / 2)).toBeLessThanOrEqual(2)
  expect(Math.abs(center.y - vec.height / 2)).toBeLessThanOrEqual(2)

  // 75% red sits on the R target: Cb = -0.1146 × 0.75, Cr = 0.5 × 0.75.
  await page.getByRole('tab', { name: 'Edit', exact: true }).click()
  const clip = await box(track(page, 'V1').nth(0))
  await page.mouse.click(clip.x + clip.width / 2, clip.y + clip.height / 2)
  await page.getByRole('region', { name: 'Inspector' }).getByRole('tab', { name: 'Color' }).click()
  await page.getByRole('region', { name: 'Inspector' }).locator('input[type=color]').fill('#bf0000')
  await page.getByRole('tab', { name: 'Color', exact: true }).first().click()
  const red = brightestPoint(await scope(page, 'Vectorscope'))
  const v = 191 / 255
  expect(Math.abs(red.x - (0.5 - 0.1146 * v) * vec.width)).toBeLessThanOrEqual(3)
  expect(Math.abs(red.y - (0.5 - 0.5 * v) * vec.height)).toBeLessThanOrEqual(3)
})

test('a primary grade moves the waveform; a black-and-white look empties the vectorscope', async ({
  app,
  page,
}) => {
  await colorClip(app, page, '#808080')
  const grade = page.getByRole('region', { name: /^Grade/ })
  await grade.getByRole('button', { name: 'Add grade layer' }).click()
  await page.getByRole('menuitem', { name: 'Primary' }).click()
  const gain = grade.getByRole('spinbutton', { name: 'Gain, all channels' })
  await gain.focus()
  await page.keyboard.press('Shift+ArrowUp')
  await page.keyboard.press('Shift+ArrowUp')
  const wave = await scope(page, 'Waveform')
  // Brighter means higher on the scope, so a smaller row number.
  expect(brightestRow(wave)).toBeLessThan(
    wave.height - 1 - Math.round((128 / 255) * (wave.height - 1)) - 5,
  )

  await page.getByRole('tab', { name: 'Edit', exact: true }).click()
  const clip = await box(track(page, 'V1').nth(0))
  await page.mouse.click(clip.x + clip.width / 2, clip.y + clip.height / 2)
  await page.getByRole('region', { name: 'Inspector' }).getByRole('tab', { name: 'Color' }).click()
  await page.getByRole('region', { name: 'Inspector' }).locator('input[type=color]').fill('#bf0000')
  await page.getByRole('tab', { name: 'Color', exact: true }).first().click()
  await grade.getByRole('button', { name: 'Add grade layer' }).click()
  await page.getByRole('menuitem', { name: 'LUT' }).click()
  await grade.getByLabel('Look').selectOption({ label: 'Black and white' })
  const vec = await scope(page, 'Vectorscope')
  const p = brightestPoint(vec)
  expect(Math.abs(p.x - vec.width / 2)).toBeLessThanOrEqual(2)
  expect(Math.abs(p.y - vec.height / 2)).toBeLessThanOrEqual(2)
})

test('the qualifier can show what it selects', async ({ app, page }) => {
  await colorClip(app, page, '#cc8040')
  const grade = page.getByRole('region', { name: /^Grade/ })
  await grade.getByRole('button', { name: 'Add grade layer' }).click()
  await page.getByRole('menuitem', { name: 'Primary' }).click()
  await grade.getByRole('checkbox', { name: 'Limit to a range of colors' }).check()
  await grade.getByRole('checkbox', { name: 'Show the selection' }).check()
  // The default range picks skin tones; this orange sits inside it, so the picture turns white.
  const wave = await scope(page, 'Waveform')
  expect(brightestRow(wave)).toBeLessThanOrEqual(3)
})

test('HDR sequences export 10-bit HEVC tagged for PQ', async ({ app, page }) => {
  const media = makeMedia()
  await setWindow(app)
  await importFiles(app, page, [media.a])
  await addToEnd(page, 'alpha.mp4')
  // Click the empty track just after the clip: nothing selected shows the sequence settings.
  await page.keyboard.press('Shift+Z')
  const clip = await box(track(page, 'V1').nth(0))
  await page.mouse.click(clip.x + clip.width + 20, clip.y + clip.height / 2)
  const inspector = page.getByRole('region', { name: 'Inspector' })
  await inspector.getByLabel('Dynamic range').selectOption('pq')
  await expect(inspector.getByLabel('Color space')).toHaveValue('rec2020')
  const output = join(media.dir, 'hdr.mp4')
  await stubDialogs(app, [], output)
  await page.getByRole('button', { name: 'Export', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Export finished' })).toBeVisible({
    timeout: 120_000,
  })
  const info = JSON.parse(
    execFileSync(
      ffprobe,
      ['-v', 'error', '-select_streams', 'v:0', '-show_streams', '-of', 'json', output],
      { encoding: 'utf8' },
    ),
  ) as {
    streams: {
      codec_name: string
      pix_fmt: string
      color_transfer: string
      color_primaries: string
    }[]
  }
  expect(info.streams[0]).toMatchObject({
    codec_name: 'hevc',
    pix_fmt: 'yuv420p10le',
    color_transfer: 'smpte2084',
    color_primaries: 'bt2020',
  })
})
