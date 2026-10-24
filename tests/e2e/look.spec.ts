import type { Page } from '@playwright/test'
import { test, expect } from './fixtures'
import { addToEnd, box, haveFfmpeg, importFiles, makeMedia, setWindow, track } from './helpers'

test.skip(!haveFfmpeg, 'FFmpeg not fetched; run pnpm fetch:binaries')

let media: ReturnType<typeof makeMedia>
test.beforeAll(() => {
  media = makeMedia()
})

const inspector = (page: Page) => page.getByRole('region', { name: 'Inspector' })

async function oneClip(app: Parameters<Parameters<typeof test>[2]>[0]['app'], page: Page) {
  await setWindow(app)
  await importFiles(app, page, [media.a, media.b])
  await addToEnd(page, 'alpha.mp4')
  await addToEnd(page, 'bravo.mp4')
  await page.keyboard.press('Shift+Z')
  const a = await box(track(page, 'V1').nth(0))
  await page.mouse.click(a.x + a.width / 2, a.y + a.height / 2)
}

async function openLook(page: Page) {
  await inspector(page).getByRole('tab', { name: 'Look' }).click()
}

test('effects from the browser show in the Look tab and can be turned off', async ({
  app,
  page,
}) => {
  await oneClip(app, page)
  await page.getByRole('tab', { name: 'Effects' }).click()
  await page.getByRole('listitem', { name: 'Blur', exact: true }).dblclick()
  await openLook(page)
  await expect(inspector(page).getByText('Blur', { exact: true })).toBeVisible()
  await inspector(page).getByRole('button', { name: 'Turn off Blur' }).click()
  await expect(inspector(page).getByRole('button', { name: 'Turn on Blur' })).toBeVisible()
  await page.keyboard.press('Control+z')
  await expect(inspector(page).getByRole('button', { name: 'Turn off Blur' })).toBeVisible()
})

test('keyframes: animate a value, see it on the curve and on the clip', async ({ app, page }) => {
  await oneClip(app, page)
  await openLook(page)
  await inspector(page).getByRole('button', { name: 'Animate Position X' }).click()
  await page.keyboard.press('Shift+ArrowRight')
  await page.keyboard.press('Shift+ArrowRight')
  const field = inspector(page).getByRole('spinbutton', { name: 'Position X' })
  await field.focus()
  await page.keyboard.press('Shift+ArrowUp')
  await expect(field).toHaveAttribute('aria-valuenow', '10')
  await expect(inspector(page).getByRole('region', { name: 'Curve: Position X' })).toBeVisible()
  await expect(inspector(page).getByRole('button', { name: /Keyframe at/ })).toHaveCount(2)
  await page.keyboard.press('Shift+ArrowLeft')
  await expect(field).toHaveAttribute('aria-valuenow', '5')
})

test('transitions: Ctrl+D adds one at the cut, it can be changed and removed', async ({
  app,
  page,
}) => {
  await oneClip(app, page)
  await page.keyboard.press('Home')
  for (let i = 0; i < 4; i++) await page.keyboard.press('Shift+ArrowRight')
  await page.keyboard.press('Control+d')
  const block = page.getByRole('button', { name: /^Cross dissolve transition/ })
  await expect(block).toBeVisible()
  await block.click()
  await inspector(page).getByLabel('Type').selectOption('wipe-left')
  await expect(page.getByRole('button', { name: /^Wipe left transition/ })).toBeVisible()
  await page.keyboard.press('Delete')
  await expect(page.getByRole('button', { name: /transition, / })).toHaveCount(0)
})

test('titles: add a headline above the footage and change its text', async ({ app, page }) => {
  await oneClip(app, page)
  await page.keyboard.press('Home')
  await page.getByRole('tab', { name: 'Titles' }).click()
  await page.getByRole('listitem', { name: 'Headline', exact: true }).dblclick()
  await expect(track(page, 'V2')).toHaveCount(1)
  const title = await box(track(page, 'V2').nth(0))
  await page.mouse.click(title.x + title.width / 2, title.y + title.height / 2)
  await inspector(page).getByRole('tab', { name: 'Title' }).click()
  const text = inspector(page).getByRole('textbox', { name: 'Text' })
  await text.fill('Summer trip')
  await text.blur()
  await expect(text).toHaveValue('Summer trip')
})

test('masks: draw a rectangle on the picture', async ({ app, page }) => {
  await oneClip(app, page)
  await page.keyboard.press('Home')
  await page.keyboard.press('ArrowRight')
  await openLook(page)
  await inspector(page).getByRole('button', { name: 'Add mask' }).click()
  await page.getByRole('menuitem', { name: 'Draw a rectangle on the picture' }).click()
  const canvas = await box(page.getByTestId('program-canvas'))
  await page.mouse.move(canvas.x + canvas.width * 0.3, canvas.y + canvas.height * 0.3)
  await page.mouse.down()
  await page.mouse.move(canvas.x + canvas.width * 0.6, canvas.y + canvas.height * 0.6, { steps: 5 })
  await page.mouse.up()
  await expect(inspector(page).getByText('Mask 1 (Rectangle)')).toBeVisible()
  await expect(
    page.getByRole('img', { name: 'Mask point 1' }).or(page.getByLabel('Mask point 1')),
  ).toBeVisible()
})

test('dragging the picture in the viewer moves the clip', async ({ app, page }) => {
  await oneClip(app, page)
  await page.keyboard.press('Home')
  await page.keyboard.press('ArrowRight')
  await openLook(page)
  const canvas = await box(page.getByTestId('program-canvas'))
  const cx = canvas.x + canvas.width / 2
  const cy = canvas.y + canvas.height / 2
  await page.mouse.move(cx, cy)
  await page.mouse.down()
  await page.mouse.move(cx + canvas.width * 0.1, cy, { steps: 5 })
  await page.mouse.up()
  const x = Number(
    await inspector(page)
      .getByRole('spinbutton', { name: 'Position X' })
      .getAttribute('aria-valuenow'),
  )
  expect(x).toBeGreaterThan(30)
  await page.keyboard.press('Control+z')
  await expect(inspector(page).getByRole('spinbutton', { name: 'Position X' })).toHaveAttribute(
    'aria-valuenow',
    '0',
  )
})

test('stabilize and tracking analyze the clip', async ({ app, page }) => {
  await oneClip(app, page)
  await page.keyboard.press('Home')
  await openLook(page)
  await inspector(page).getByRole('button', { name: 'Add effect' }).click()
  await page.getByRole('menuitem', { name: 'Stabilize' }).click()
  await inspector(page).getByRole('button', { name: 'Analyze shake' }).click()
  await expect(page.getByText('Shake measured. The clip is now steadied.')).toBeVisible({
    timeout: 30_000,
  })

  await inspector(page).getByRole('button', { name: 'Add mask' }).click()
  await page.getByRole('menuitem', { name: 'Ellipse', exact: true }).click()
  await inspector(page).getByRole('button', { name: 'Track forward from the playhead' }).click()
  await expect(page.getByText(/^Tracked /)).toBeVisible({ timeout: 30_000 })
})

test('effect presets save and load', async ({ app, page }) => {
  const { join } = await import('node:path')
  const preset = join(media.dir, 'warm.lumacut-fx')
  await oneClip(app, page)
  await openLook(page)
  await inspector(page).getByRole('button', { name: 'Add effect' }).click()
  await page.getByRole('menuitem', { name: 'Vignette' }).click()
  await expect(inspector(page).getByText('Vignette', { exact: true })).toHaveCount(1)
  await app.evaluate(({ dialog }, path) => {
    dialog.showSaveDialog = (async () => ({
      canceled: false,
      filePath: path,
    })) as typeof dialog.showSaveDialog
    dialog.showOpenDialog = (async () => ({
      canceled: false,
      filePaths: [path],
    })) as typeof dialog.showOpenDialog
  }, preset)
  await inspector(page).getByRole('button', { name: 'Save as preset…' }).click()
  await expect(page.getByText('Saved the effect preset.')).toBeVisible()
  await inspector(page).getByRole('button', { name: 'Load preset…' }).click()
  await expect(inspector(page).getByText('Vignette', { exact: true })).toHaveCount(2)
})
