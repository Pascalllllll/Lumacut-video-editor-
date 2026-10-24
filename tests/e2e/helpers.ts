import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ElectronApplication, Locator, Page } from '@playwright/test'
import { expect } from '@playwright/test'

export const bin = join('resources', 'bin', `${process.platform}-${process.arch}`)
export const ffmpeg = join(bin, 'ffmpeg')
export const ffprobe = join(bin, 'ffprobe')
export const haveFfmpeg = existsSync(ffmpeg)

/** Small test clips: two plain ones and two "cameras" recording the same sound one second apart. */
export function makeMedia() {
  const dir = mkdtempSync(join(tmpdir(), 'lumacut-tools-'))
  const clip = (name: string, pattern: string, freq: number, seconds = 4) => {
    const path = join(dir, name)
    execFileSync(ffmpeg, [
      '-v',
      'error',
      '-y',
      '-f',
      'lavfi',
      '-i',
      `${pattern}=size=640x360:rate=30:duration=${seconds}`,
      '-f',
      'lavfi',
      '-i',
      `sine=frequency=${freq}:sample_rate=48000:duration=${seconds}`,
      '-c:v',
      'libx264',
      '-preset',
      'ultrafast',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-shortest',
      path,
    ])
    return path
  }
  const camera = (name: string, skip: number) => {
    const path = join(dir, name)
    execFileSync(ffmpeg, [
      '-v',
      'error',
      '-y',
      '-f',
      'lavfi',
      '-i',
      'testsrc2=size=640x360:rate=30:duration=6',
      '-f',
      'lavfi',
      '-i',
      'anoisesrc=d=8:c=pink:r=48000:seed=7',
      // Noise that pulses on and off, so the loudness has a shape to line up.
      '-filter_complex',
      `[1:a]atrim=start=${skip}:duration=6,asetpts=PTS-STARTPTS,volume='0.2+0.8*gt(sin(2*PI*1.3*(t+${skip})),0.6)':eval=frame[a]`,
      '-map',
      '0:v',
      '-map',
      '[a]',
      '-c:v',
      'libx264',
      '-preset',
      'ultrafast',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      path,
    ])
    return path
  }
  return {
    dir,
    a: clip('alpha.mp4', 'testsrc2', 330),
    b: clip('bravo.mp4', 'smptebars', 550),
    camA: camera('cam-a.mp4', 0),
    camB: camera('cam-b.mp4', 1),
  }
}

export async function stubDialogs(app: ElectronApplication, open: string[], save: string) {
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

export async function importFiles(app: ElectronApplication, page: Page, paths: string[]) {
  await stubDialogs(app, paths, join(tmpdir(), 'unused.lumacut'))
  await page.getByRole('button', { name: 'Import media' }).first().click()
  for (const p of paths)
    await expect(
      page.getByRole('listitem', { name: p.split('/').pop()!, exact: true }),
    ).toBeVisible()
}

export async function addToEnd(page: Page, name: string) {
  await page.getByRole('listitem', { name }).click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Add to end of timeline' }).click()
}

export function track(page: Page, name: string): Locator {
  return page.getByRole('list', { name: `Track ${name}` }).getByRole('listitem')
}

export async function labels(page: Page, name: string): Promise<string[]> {
  return track(page, name).evaluateAll((els) =>
    els.map((e) => e.getAttribute('aria-label') ?? '').sort(),
  )
}

export async function box(locator: Locator) {
  const b = await locator.boundingBox()
  if (!b) throw new Error('Element has no box')
  return b
}

export async function dragBy(page: Page, from: { x: number; y: number }, dx: number, dy = 0) {
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(from.x + dx / 2, from.y + dy / 2, { steps: 5 })
  await page.mouse.move(from.x + dx, from.y + dy, { steps: 5 })
  await page.mouse.up()
}

export function inspectorValue(page: Page, label: string): Locator {
  return page
    .getByRole('region', { name: 'Inspector' })
    .getByText(label, { exact: true })
    .locator('xpath=following-sibling::span[1]')
}

export function sequenceLength(page: Page): Locator {
  return page.getByLabel('Sequence length')
}

export async function setWindow(app: ElectronApplication) {
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(1600, 1000))
}
