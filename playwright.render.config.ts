import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: 'tests/render',
  timeout: 180_000,
  workers: 1,
  reporter: [['list']],
})
