import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'
import { strToU8, zipSync } from 'fflate'
import { settledSettings } from '../settled'
import { createEffect } from '../../src/engine/effects'
import { execute, type HistoryState } from '../../src/engine/history'
import {
  activeSequence,
  createClip,
  createProject,
  createTrack,
  generatorAsset,
  titleSchema,
  type MediaAsset,
} from '../../src/engine/model'
import { assetFromProbe, type ProbeOutput } from '../../src/media/probe'

const bin = join('resources', 'bin', `${process.platform}-${process.arch}`)
const ffmpeg = join(bin, 'ffmpeg')
const ffprobe = join(bin, 'ffprobe')
const GOLDEN = join('tests', 'render', 'golden')
const UPDATE = process.env['UPDATE_GOLDEN'] === '1'
const W = 640
const H = 360

test.skip(!existsSync(ffmpeg), 'FFmpeg not fetched; run pnpm fetch:binaries')

function probe(path: string): ProbeOutput {
  return JSON.parse(
    execFileSync(
      ffprobe,
      ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', path],
      { encoding: 'utf8' },
    ),
  ) as ProbeOutput
}

/** RGB bytes of one frame of a video (or a still image), at the test size. */
function rgb(path: string, frame?: number): Buffer {
  const select =
    frame === undefined ? [] : ['-vf', `select=eq(n\\,${frame}),scale=${W}:${H}`, '-vsync', '0']
  return execFileSync(
    ffmpeg,
    [
      '-v',
      'error',
      '-i',
      path,
      ...select,
      '-frames:v',
      '1',
      '-f',
      'rawvideo',
      '-pix_fmt',
      'rgb24',
      '-',
    ],
    {
      maxBuffer: 64 * 1024 * 1024,
    },
  )
}

function meanDiff(a: Buffer, b: Buffer): number {
  let sum = 0
  const n = Math.min(a.length, b.length)
  for (let i = 0; i < n; i++) sum += Math.abs(a[i]! - b[i]!)
  return sum / n
}

function makeMedia(dir: string) {
  const clip = (name: string, pattern: string) => {
    const path = join(dir, name)
    execFileSync(ffmpeg, [
      '-v',
      'error',
      '-y',
      '-f',
      'lavfi',
      '-i',
      `${pattern}=size=${W}x${H}:rate=30:duration=3`,
      '-c:v',
      'libx264',
      '-preset',
      'ultrafast',
      '-crf',
      '12',
      '-pix_fmt',
      'yuv420p',
      path,
    ])
    return path
  }
  return { a: clip('a.mp4', 'testsrc2'), b: clip('b.mp4', 'smptebars') }
}

/** A 2-second scene that touches blur, a transition, a keyframed title, blend modes and an adjustment layer. */
function buildProject(dir: string) {
  const media = makeMedia(dir)
  const asset = (path: string, id: string): MediaAsset =>
    assetFromProbe(probe(path), { id, path, size: statSync(path).size, now: 'now' })
  const title = { ...generatorAsset('title', 'Title'), id: 'gt' }
  const color = { ...generatorAsset('color', 'Color'), id: 'gc' }
  const adjust = { ...generatorAsset('adjustment', 'Adjustment'), id: 'ga' }
  let state: HistoryState = { project: createProject('Golden'), past: [], future: [] }
  const seq = activeSequence(state.project)
  const v1 = seq.tracks[0]!.id
  const v2 = createTrack('video', 'V2')
  const v3 = createTrack('video', 'V3')
  const v4 = createTrack('video', 'V4')
  state = execute(state, {
    type: 'media.add',
    assets: [asset(media.a, 'ma'), asset(media.b, 'mb'), title, color, adjust],
  })
  state = execute(state, {
    type: 'sequence.settings',
    sequenceId: seq.id,
    width: W,
    height: H,
    fps: { num: 30, den: 1 },
  })
  for (const tr of [v2, v3, v4])
    state = execute(state, { type: 'track.add', sequenceId: seq.id, track: tr })
  const blur = createEffect('gaussian-blur')
  blur.params['radius'] = { value: 6, keys: [] }
  const vignette = createEffect('vignette')
  vignette.params['amount'] = { value: 0.8, keys: [] }
  state = execute(state, {
    type: 'clip.add',
    sequenceId: seq.id,
    clips: [
      createClip({
        id: 'ca',
        mediaId: 'ma',
        trackId: v1,
        start: 0,
        duration: 30,
        sourceIn: 15,
        effects: [blur],
      }),
      createClip({ id: 'cb', mediaId: 'mb', trackId: v1, start: 30, duration: 30, sourceIn: 15 }),
      createClip({
        id: 'ct',
        mediaId: 'gt',
        trackId: v2.id,
        start: 0,
        duration: 60,
        sourceIn: 0,
        title: titleSchema.parse({
          text: 'Lumacut',
          size: 140,
          stroke: { width: 6, color: '#101010' },
        }),
        transform: {
          ...createClip({ mediaId: 'x', trackId: 'x', start: 0, duration: 1, sourceIn: 0 })
            .transform,
          x: {
            value: 0,
            keys: [
              { frame: 0, value: -120, ease: 'linear' },
              { frame: 59, value: 120, ease: 'linear' },
            ],
          },
        },
      }),
      createClip({
        id: 'cc',
        mediaId: 'gc',
        trackId: v3.id,
        start: 40,
        duration: 20,
        sourceIn: 0,
        color: '#ff8800',
        blend: 'multiply',
        transform: {
          ...createClip({ mediaId: 'x', trackId: 'x', start: 0, duration: 1, sourceIn: 0 })
            .transform,
          opacity: { value: 0.6, keys: [] },
        },
      }),
      createClip({
        id: 'cv',
        mediaId: 'ga',
        trackId: v4.id,
        start: 0,
        duration: 60,
        sourceIn: 0,
        effects: [vignette],
      }),
    ],
  })
  state = execute(state, {
    type: 'transition.add',
    sequenceId: seq.id,
    transition: {
      id: 'tx',
      trackId: v1,
      leftClipId: 'ca',
      rightClipId: 'cb',
      type: 'cross-dissolve',
      duration: 10,
      ease: 'linear',
    },
  })
  const file = join(dir, 'golden.lumacut')
  writeFileSync(
    file,
    zipSync({ 'project.json': strToU8(JSON.stringify(state.project)), 'meta.json': strToU8('{}') }),
  )
  return { file, media }
}

test('compositor export matches golden frames and the viewer', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'lumacut-golden-'))
  const { file } = buildProject(dir)
  const output = join(dir, 'golden.mp4')
  // Past the first-start sheet.
  const userData = mkdtempSync(join(tmpdir(), 'lumacut-gd-'))
  writeFileSync(join(userData, 'settings.json'), settledSettings)
  const app = await electron.launch({
    args: ['.'],
    env: {
      ...process.env,
      LUMACUT_USER_DATA: userData,
      ELECTRON_RENDERER_URL: '',
    },
  })
  try {
    const page = await app.firstWindow()
    await page.waitForSelector('[data-loaded="true"]')
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(1400, 900))
    await app.evaluate(
      ({ dialog }, { open, save }) => {
        dialog.showOpenDialog = (async () => ({
          canceled: false,
          filePaths: [open],
        })) as typeof dialog.showOpenDialog
        dialog.showSaveDialog = (async () => ({
          canceled: false,
          filePath: save,
        })) as typeof dialog.showSaveDialog
      },
      { open: file, save: output },
    )
    // Opening needs the files allowed, which the open handler does.
    await page.keyboard.press('Control+o')
    await expect(page.getByRole('list', { name: 'Track V1' }).getByRole('listitem')).toHaveCount(2)

    // The viewer's picture at frame 30 (middle of the dissolve), full size.
    for (let i = 0; i < 30; i++) await page.keyboard.press('ArrowRight')
    await page.waitForTimeout(800)
    const viewerPng = await page
      .getByTestId('program-canvas')
      .evaluate((c: HTMLCanvasElement) => c.toDataURL('image/png'))
    const viewerFile = join(dir, 'viewer-30.png')
    writeFileSync(viewerFile, Buffer.from(viewerPng.split(',')[1]!, 'base64'))

    await page.getByRole('button', { name: 'Export', exact: true }).click()
    await expect(page.getByRole('dialog', { name: 'Export finished' })).toBeVisible({
      timeout: 150_000,
    })
  } finally {
    await app.evaluate(({ app }) => app.exit(0)).catch(() => undefined)
  }

  expect(Number(probe(output).format!.duration)).toBeCloseTo(2, 1)

  for (const frame of [10, 30, 50]) {
    const actual = rgb(output, frame)
    const golden = join(GOLDEN, `frame-${frame}.png`)
    if (UPDATE || !existsSync(golden)) {
      execFileSync(
        ffmpeg,
        [
          '-v',
          'error',
          '-y',
          '-f',
          'rawvideo',
          '-pix_fmt',
          'rgb24',
          '-s',
          `${W}x${H}`,
          '-i',
          '-',
          golden,
        ],
        { input: actual },
      )
      test.info().annotations.push({ type: 'golden', description: `wrote ${golden}` })
      continue
    }
    const diff = meanDiff(actual, rgb(golden))
    expect(diff, `frame ${frame} differs from ${golden} by ${diff.toFixed(2)}`).toBeLessThan(2.5)
  }

  // What the viewer showed is what got exported (within encoding error).
  const parity = meanDiff(rgb(join(dir, 'viewer-30.png')), rgb(output, 30))
  expect(parity, `viewer and export differ by ${parity.toFixed(2)}`).toBeLessThan(6)
})
