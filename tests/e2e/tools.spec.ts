import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, type Page } from '@playwright/test'
import { settledSettings } from '../settled'
import { test, expect } from './fixtures'
import {
  addToEnd,
  box,
  dragBy,
  haveFfmpeg,
  importFiles,
  inspectorValue,
  labels,
  makeMedia,
  sequenceLength,
  setWindow,
  track,
} from './helpers'

test.skip(!haveFfmpeg, 'FFmpeg not fetched; run pnpm fetch:binaries')

let media: ReturnType<typeof makeMedia>
test.beforeAll(() => {
  media = makeMedia()
})

/** Two 4-second clips on V1/A1: alpha (0-4 s) then bravo (4-8 s). */
async function twoClips(app: Parameters<Parameters<typeof test>[2]>[0]['app'], page: Page) {
  await setWindow(app)
  await importFiles(app, page, [media.a, media.b])
  await addToEnd(page, 'alpha.mp4')
  await addToEnd(page, 'bravo.mp4')
  await expect(track(page, 'V1')).toHaveCount(2)
  await expect(track(page, 'A1')).toHaveCount(2)
  await expect(sequenceLength(page)).toHaveText('00:00:08:00')
}

const clipBox = async (page: Page, trackName: string, index: number) =>
  box(track(page, trackName).nth(index))

/** Splits V1 (and its linked sound) at each fraction of the first clip's width with the blade tool. */
async function blade(page: Page, ...fractions: number[]) {
  await page.keyboard.press('c')
  const first = await clipBox(page, 'V1', 0)
  for (const f of fractions)
    await page.mouse.click(first.x + first.width * f, first.y + first.height / 2)
  await page.keyboard.press('v')
}

const startsOf = async (page: Page, name: string) =>
  (await labels(page, name))
    .map((l) => /starts (\S+), lasts (\S+)/.exec(l)!.slice(1).join(' '))
    .sort()

test('blade tool cuts a clip and its linked sound', async ({ app, page }) => {
  await twoClips(app, page)
  await blade(page, 0.5)
  await expect(track(page, 'V1')).toHaveCount(3)
  await expect(track(page, 'A1')).toHaveCount(3)
})

test('ripple delete closes the gap', async ({ app, page }) => {
  await twoClips(app, page)
  const a = await clipBox(page, 'V1', 0)
  await page.mouse.click(a.x + a.width / 2, a.y + a.height / 2)
  await page.keyboard.press('Shift+Delete')
  await expect(sequenceLength(page)).toHaveText('00:00:04:00')
  await expect(track(page, 'V1')).toHaveCount(1)
  expect(await startsOf(page, 'V1')).toEqual(['00:00:00:00 00:00:04:00'])
})

test('ripple tool trims and pulls later clips along', async ({ app, page }) => {
  await twoClips(app, page)
  await page.keyboard.press('b')
  const a = await clipBox(page, 'V1', 0)
  await dragBy(page, { x: a.x + a.width - 2, y: a.y + a.height / 2 }, -a.width / 4)
  const starts = await startsOf(page, 'V1')
  const [first, second] = starts.map((s) => s.split(' '))
  expect(second![0]).toBe(first![1])
  await expect(sequenceLength(page)).not.toHaveText('00:00:08:00')
})

test('roll tool moves an edit point without changing the length', async ({ app, page }) => {
  await twoClips(app, page)
  await blade(page, 0.5)
  await page.keyboard.press('n')
  const left = await clipBox(page, 'V1', 0)
  await dragBy(page, { x: left.x + left.width - 2, y: left.y + left.height / 2 }, left.width / 2)
  await expect(sequenceLength(page)).toHaveText('00:00:08:00')
  const durations = (await startsOf(page, 'V1')).map((s) => s.split(' ')[1])
  expect(durations).toContain('00:00:03:00')
  expect(durations).toContain('00:00:01:00')
})

test('slip tool changes which frames a clip shows, not where it sits', async ({ app, page }) => {
  await twoClips(app, page)
  await blade(page, 0.5)
  await page.keyboard.press('y')
  const left = await clipBox(page, 'V1', 0)
  await dragBy(page, { x: left.x + left.width / 2, y: left.y + left.height / 2 }, -left.width / 2)
  await page.keyboard.press('v')
  await page.mouse.click(left.x + left.width / 2, left.y + left.height / 2)
  await expect(inspectorValue(page, 'Source in')).not.toHaveText('00:00:00:00')
  await expect(inspectorValue(page, 'Start')).toHaveText('00:00:00:00')
})

test('slide tool moves a clip between its neighbours', async ({ app, page }) => {
  await twoClips(app, page)
  await blade(page, 1 / 3, 2 / 3)
  await expect(track(page, 'V1')).toHaveCount(4)
  await page.keyboard.press('u')
  const middle = (
    await track(page, 'V1').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().x))
  ).sort((x, y) => x - y)[1]!
  const boxes = await Promise.all([0, 1, 2, 3].map((i) => clipBox(page, 'V1', i)))
  const mid = boxes.find((b) => Math.abs(b.x - middle) < 1)!
  await dragBy(page, { x: mid.x + mid.width / 2, y: mid.y + mid.height / 2 }, mid.width / 4)
  await expect(sequenceLength(page)).toHaveText('00:00:08:00')
  expect((await startsOf(page, 'V1')).some((s) => s.startsWith('00:00:01:10'))).toBe(false)
  const starts = (await startsOf(page, 'V1')).map((s) => s.split(' ')[0])
  expect(starts).not.toContain('00:00:01:10')
})

test('rate stretch changes speed to fill the new length', async ({ app, page }) => {
  await twoClips(app, page)
  await page.keyboard.press('Shift+Z')
  await page.keyboard.press('r')
  const b = await clipBox(page, 'V1', 1)
  await dragBy(page, { x: b.x + b.width - 2, y: b.y + b.height / 2 }, -b.width / 2)
  await expect(track(page, 'V1').filter({ hasText: /\d+%/ })).toHaveCount(1)
  await expect(sequenceLength(page)).not.toHaveText('00:00:08:00')
})

test('more tracks: add, place on, hide and lock', async ({ app, page }) => {
  await twoClips(app, page)
  await page.getByRole('button', { name: 'Add video track' }).click()
  await expect(page.getByRole('list', { name: 'Track V2' })).toBeVisible()
  await page
    .getByRole('listitem', { name: 'bravo.mp4', exact: true })
    .dragTo(page.getByRole('list', { name: 'Track V2' }), { targetPosition: { x: 20, y: 20 } })
  await expect(track(page, 'V2')).toHaveCount(1)
  await page.getByRole('button', { name: 'Hide V2' }).click()
  await expect(page.getByRole('button', { name: 'Show V2' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await page.getByRole('button', { name: 'Lock V1' }).click()
  await page.keyboard.press('c')
  const a = await clipBox(page, 'V1', 0)
  await page.mouse.click(a.x + a.width / 2, a.y + a.height / 2)
  await expect(track(page, 'V1')).toHaveCount(2)
})

test('magnetic timeline closes gaps when a clip goes', async ({ app, page }) => {
  await twoClips(app, page)
  await page.keyboard.press('Shift+M')
  await expect(page.getByRole('button', { name: /Magnetic timeline/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  const a = await clipBox(page, 'V1', 0)
  await page.mouse.click(a.x + a.width / 2, a.y + a.height / 2)
  await page.keyboard.press('Delete')
  await expect(track(page, 'V1')).toHaveCount(1)
  expect(await labels(page, 'V1')).toEqual([
    expect.stringContaining('bravo.mp4, starts 00:00:00:00'),
  ])
})

test('markers: add, rename, delete', async ({ app, page }) => {
  await twoClips(app, page)
  await page.keyboard.press('Shift+ArrowRight')
  await page.keyboard.press('m')
  const marker = page.getByRole('button', { name: /^Marker Marker 1 at 00:00:01:00/ })
  await expect(marker).toBeVisible()
  await marker.click()
  const name = page.getByRole('region', { name: 'Inspector' }).getByRole('textbox').first()
  await name.fill('Drop')
  await name.blur()
  await expect(page.getByRole('button', { name: /^Marker Drop at/ })).toBeVisible()
  await page.getByRole('button', { name: 'Delete marker' }).click()
  await expect(page.getByRole('button', { name: /^Marker Drop at/ })).toHaveCount(0)
})

test('J, K and L shuttle playback', async ({ app, page }) => {
  await twoClips(app, page)
  await page.keyboard.press('l')
  await page.keyboard.press('l')
  await expect(page.getByText('2×')).toBeVisible()
  await page.keyboard.press('k')
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible()
  await page.keyboard.press('j')
  await expect(page.getByText('−1×')).toBeVisible()
  await page.keyboard.press('k')
})

test('three-point edits from the source viewer, fit to fill, and extract', async ({
  app,
  page,
}) => {
  await twoClips(app, page)
  await page.getByRole('listitem', { name: 'bravo.mp4', exact: true }).dblclick()
  await expect(page.getByRole('tab', { name: 'Source' })).toHaveAttribute('aria-selected', 'true')
  await page.getByRole('button', { name: 'In', exact: true }).click()
  const bar = await box(page.getByRole('slider', { name: 'Position in source clip' }))
  await page.mouse.click(bar.x + bar.width / 2, bar.y + bar.height / 2)
  await page.getByRole('button', { name: 'Out', exact: true }).click()

  // Insert the 2-second source range at the start.
  await page.getByRole('button', { name: 'Insert into timeline (,)' }).click()
  await expect(sequenceLength(page)).toHaveText('00:00:10:00')

  // Fit to fill: the same 2 seconds into a 1-second timeline range doubles the speed.
  await page.getByRole('tab', { name: 'Timeline' }).click()
  await page.keyboard.press('End')
  await page.keyboard.press('o')
  await page.keyboard.press('Shift+ArrowLeft')
  await page.keyboard.press('i')
  await page.keyboard.press('Shift+F')
  await expect(track(page, 'V1').filter({ hasText: '200%' })).toHaveCount(1)
  await expect(sequenceLength(page)).toHaveText('00:00:10:00')

  // Extract the first second.
  await page.keyboard.press('Home')
  await page.keyboard.press('i')
  await page.keyboard.press('Shift+ArrowRight')
  await page.keyboard.press('o')
  await page.keyboard.press("'")
  await expect(sequenceLength(page)).toHaveText('00:00:09:00')
})

test('compound clip replaces selected clips with one nested sequence', async ({ app, page }) => {
  await twoClips(app, page)
  const a = await clipBox(page, 'V1', 0)
  const b = await clipBox(page, 'V1', 1)
  await page.mouse.click(a.x + a.width / 2, a.y + a.height / 2)
  void b
  await track(page, 'V1')
    .nth(1)
    .click({ modifiers: ['Shift'] })
  await page.keyboard.press('Alt+g')
  await expect(track(page, 'V1')).toHaveCount(1)
  await expect(sequenceLength(page)).toHaveText('00:00:08:00')
  const item = page.getByRole('listitem', { name: 'Compound 1', exact: true })
  await expect(item).toBeVisible()
  await item.dblclick()
  await expect(page.getByRole('tab', { name: 'Compound 1' })).toHaveAttribute(
    'aria-selected',
    'true',
  )
  await expect(track(page, 'V1')).toHaveCount(2)
})

test('multicam: syncs angles by sound and cuts between them', async ({ app, page }) => {
  await setWindow(app)
  await importFiles(app, page, [media.camA, media.camB])
  await page.getByRole('listitem', { name: 'cam-a.mp4', exact: true }).click()
  await page
    .getByRole('listitem', { name: 'cam-b.mp4', exact: true })
    .click({ modifiers: ['Control'] })
  await page.getByRole('listitem', { name: 'cam-b.mp4', exact: true }).click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Create multicam clip from 2 videos' }).click()
  const item = page.getByRole('listitem', { name: 'Multicam 1', exact: true })
  await expect(item).toBeVisible()

  // Camera B started a second later, so it sits 1 s (30 frames) in.
  await item.dblclick()
  const angle2 = await labels(page, 'Angle 2')
  const start = /starts 00:00:(\d\d):(\d\d)/.exec(angle2[0]!)!
  expect(Math.abs(Number(start[1]) * 30 + Number(start[2]) - 30)).toBeLessThanOrEqual(2)

  await page.getByRole('tab', { name: 'Sequence 1' }).click()
  await addToEnd(page, 'Multicam 1')
  await expect(track(page, 'V1').filter({ hasText: 'Angle 1' })).toHaveCount(1)
  await page.keyboard.press('Shift+ArrowRight')
  await page.keyboard.press('2')
  await expect(track(page, 'V1')).toHaveCount(2)
  await expect(track(page, 'V1').filter({ hasText: 'Angle 2' })).toHaveCount(1)
})

test('proxies: create one and see it marked', async ({ app, page }) => {
  await setWindow(app)
  await importFiles(app, page, [media.a])
  await page.getByRole('listitem', { name: 'alpha.mp4', exact: true }).click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Create proxy' }).click()
  await expect(
    page
      .getByRole('listitem', { name: 'alpha.mp4', exact: true })
      .getByText('Proxy', { exact: true }),
  ).toBeVisible({ timeout: 30_000 })
})

test('speed, reverse and ramps from the inspector', async ({ app, page }) => {
  await twoClips(app, page)
  const a = await clipBox(page, 'V1', 0)
  await page.mouse.click(a.x + a.width / 2, a.y + a.height / 2)
  const speed = page.getByRole('spinbutton', { name: 'Speed (%)' })
  await speed.fill('200')
  await speed.press('Enter')
  await expect(sequenceLength(page)).toHaveText('00:00:06:00')
  await expect(track(page, 'V1').filter({ hasText: '200%' })).toHaveCount(1)
  await page.getByRole('checkbox', { name: 'Play backwards' }).check()
  await expect(track(page, 'V1').filter({ hasText: 'Reverse' })).toHaveCount(1)
  await page.getByRole('checkbox', { name: 'Speed ramp' }).check()
  await expect(page.getByRole('group', { name: 'Speed over the length of the clip' })).toBeVisible()
  await page.getByRole('button', { name: 'Slow in the middle' }).click()
  await expect(track(page, 'V1').filter({ hasText: 'Ramp' })).toHaveCount(1)
})

test('offers to restore unsaved work after a crash', async () => {
  const userData = mkdtempSync(join(tmpdir(), 'lumacut-crash-'))
  writeFileSync(join(userData, 'settings.json'), settledSettings)
  const env = { ...process.env, LUMACUT_USER_DATA: userData, ELECTRON_RENDERER_URL: '' }

  const first = await electron.launch({ args: ['.'], env })
  const page1 = await first.firstWindow()
  await page1.waitForSelector('[data-loaded="true"]')
  await importFiles(first, page1, [media.a])
  await page1.evaluate(() => window.dispatchEvent(new Event('lumacut:autosave-now')))
  await expect
    .poll(() => page1.evaluate(async () => (await window.lumacut.invoke('autosave:list')).length))
    .toBe(1)
  // Exit without a clean quit, as a crash would.
  await first.evaluate(({ app }) => app.exit(0)).catch(() => undefined)

  const second = await electron.launch({ args: ['.'], env })
  const page2 = await second.firstWindow()
  await page2.waitForSelector('[data-loaded="true"]')
  const dialog = page2.getByRole('dialog', { name: 'Restore unsaved work?' })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: 'Restore' }).click()
  await expect(page2.getByRole('listitem', { name: 'alpha.mp4', exact: true })).toBeVisible()
  await expect(page2.getByText('Edited')).toBeVisible()
  await second.evaluate(({ app }) => app.exit(0)).catch(() => undefined)
})
