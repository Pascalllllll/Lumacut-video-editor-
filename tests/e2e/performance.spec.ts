import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, expect } from './fixtures'
import { addToEnd, ffmpeg, haveFfmpeg, importFiles, setWindow } from './helpers'

test.skip(!haveFfmpeg, 'FFmpeg not fetched; run pnpm fetch:binaries')
test.setTimeout(240_000)

test('a 4K timeline scrubs smoothly with proxies', async ({ app, page }) => {
  const dir = mkdtempSync(join(tmpdir(), 'lumacut-perf-'))
  const uhd = join(dir, 'uhd.mp4')
  execFileSync(ffmpeg, [
    '-v',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    'testsrc2=s=3840x2160:r=30:d=6',
    '-c:v',
    'libx264',
    '-preset',
    'ultrafast',
    '-g',
    '60',
    '-pix_fmt',
    'yuv420p',
    uhd,
  ])
  await setWindow(app)
  await page.evaluate(() =>
    window.lumacut.invoke('settings:set', { autoProxy: 'large', useProxies: true }),
  )
  await page.reload()
  await page.waitForSelector('[data-loaded="true"]')
  await importFiles(app, page, [uhd])
  // The proxy is made in the background on import.
  await expect(
    page.getByRole('listitem', { name: 'uhd.mp4', exact: true }).getByText('Proxy'),
  ).toBeVisible({ timeout: 180_000 })
  await addToEnd(page, 'uhd.mp4')
  const canvas = page.getByTestId('program-canvas')
  await page.getByRole('region', { name: 'Timeline' }).click({ position: { x: 5, y: 5 } })
  await page.keyboard.press('Home')
  await expect(canvas).toHaveAttribute('data-settled', '0')

  // Step one frame at a time and time how long each takes to show the right picture.
  const times: number[] = []
  for (let f = 1; f <= 45; f++) {
    const t0 = Date.now()
    await page.keyboard.press('ArrowRight')
    await expect(canvas).toHaveAttribute('data-settled', String(f), { timeout: 5_000 })
    times.push(Date.now() - t0)
  }
  times.sort((a, b) => a - b)
  const median = times[Math.floor(times.length / 2)]!
  const p90 = times[Math.floor(times.length * 0.9)]!
  console.log(`scrub step: median ${median} ms, 90th percentile ${p90} ms`)
  expect(median).toBeLessThan(80)
  expect(p90).toBeLessThan(160)
})
