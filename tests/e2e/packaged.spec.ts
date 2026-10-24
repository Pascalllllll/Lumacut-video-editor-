import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium, expect, test } from '@playwright/test'
import { appVersion, settledSettings } from '../settled'

// Runs only when LUMACUT_EXECUTABLE points at an unpacked build, e.g.
// ~/.cache/lumacut-dist/0.1.0/linux-unpacked/lumacut
const executable = process.env['LUMACUT_EXECUTABLE']

test.skip(!executable, 'LUMACUT_EXECUTABLE is not set')

test('the package refuses Node debugging switches', () => {
  // The fuses are on: an inspector argument or NODE_OPTIONS can't open the main process.
  const run = spawnSync(executable!, ['--inspect=0', '--version'], {
    env: {
      ...process.env,
      NODE_OPTIONS: '--require /nonexistent.js',
      LUMACUT_USER_DATA: mkdtempSync(join(tmpdir(), 'lumacut-fuse-')),
    },
    encoding: 'utf8',
    timeout: 8_000,
  })
  expect(`${run.stdout}${run.stderr}`).not.toMatch(/Debugger listening|nonexistent\.js/)
})

test('packaged app starts and finds its bundled FFmpeg', async () => {
  const userData = mkdtempSync(join(tmpdir(), 'lumacut-pkg-'))
  writeFileSync(join(userData, 'settings.json'), settledSettings)
  // Playwright's Electron launcher needs Node's inspector, which the fuses turn off,
  // so the window is reached through Chromium's own debugging port instead.
  const port = 9300 + Math.floor(Math.random() * 500)
  const child = spawn(executable!, [`--remote-debugging-port=${port}`], {
    env: { ...process.env, LUMACUT_USER_DATA: userData, LUMACUT_NO_UPDATES: '1' },
    stdio: 'ignore',
  })
  let browser: Awaited<ReturnType<typeof chromium.connectOverCDP>> | null = null
  for (let i = 0; i < 60 && !browser; i++) {
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`).catch(() => null)
    if (!browser) await new Promise((r) => setTimeout(r, 500))
  }
  expect(browser).not.toBeNull()
  let page = browser!.contexts()[0]?.pages()[0]
  for (let i = 0; i < 40 && !page; i++) {
    await new Promise((r) => setTimeout(r, 250))
    page = browser!.contexts()[0]?.pages()[0]
  }
  await page!.waitForSelector('[data-loaded="true"]')
  const info = await page!.evaluate(() => window.lumacut.invoke('app:info'))
  expect(info.ffmpeg.found).toBe(true)
  expect(info.ffmpeg.version).toMatch(/^n?8\.1/)
  // CHANGELOG.md ships with the app for the What's new sheet.
  const notes = await page!.evaluate(() => window.lumacut.invoke('app:release-notes'))
  expect(notes.version).toBe(appVersion)
  expect(await page!.evaluate(() => window.lumacut.invoke('update:status'))).toEqual({
    state: 'disabled',
  })
  // The AI worker and its native runtime load from the package (with the models present).
  const models = join(homedir(), '.local', 'share', 'Lumacut', 'models', 'onnx-community')
  if (existsSync(models)) {
    const speech = join(process.cwd(), 'tests', 'fixtures', 'jfk.wav')
    const words = await page!.evaluate(async (path) => {
      await window.lumacut.invoke('media:import', { paths: [path] })
      return window.lumacut.invoke('ai:transcribe', { path, model: 'whisper-base', language: 'en' })
    }, speech)
    expect(
      words
        .map((w) => w.text)
        .join(' ')
        .toLowerCase(),
    ).toContain('country')
  }
  await browser!.close()
  child.kill()
})
