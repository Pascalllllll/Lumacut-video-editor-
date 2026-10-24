import { test, expect } from './fixtures'
import { addToEnd, haveFfmpeg, importFiles, makeMedia } from './helpers'

test.skip(!haveFfmpeg, 'FFmpeg not fetched; run pnpm fetch:binaries')
// Computers without a working GPU driver, and CI machines, have no hardware WebGL.
test.use({ launchArgs: ['--disable-gpu'] })

test('without a GPU the editor still loads and the viewer still draws', async ({ app, page }) => {
  const media = makeMedia()
  await importFiles(app, page, [media.a])
  await addToEnd(page, 'alpha.mp4')
  const viewer = page.getByRole('region', { name: 'Viewer' })
  await expect(viewer.getByRole('alert')).toHaveCount(0)
  await expect(viewer.getByRole('button', { name: 'Play' })).toBeEnabled()
})
