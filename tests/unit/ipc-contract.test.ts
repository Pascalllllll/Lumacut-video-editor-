import { describe, expect, it } from 'vitest'
import { ipcContract } from '@shared/ipc'
import { defaultSettings, settingsSchema } from '@shared/settings'

describe('settings schema', () => {
  it('fills defaults for a blank file', () => {
    expect(settingsSchema.parse({})).toEqual(defaultSettings)
  })
  it('rejects an interface size outside 90 to 150 percent', () => {
    expect(settingsSchema.safeParse({ uiScale: 3 }).success).toBe(false)
  })
  it('rejects unknown themes', () => {
    expect(settingsSchema.safeParse({ theme: 'sepia' }).success).toBe(false)
  })
})

describe('ipc contract', () => {
  it('settings:set accepts a partial patch but not wrong types', () => {
    const spec = ipcContract['settings:set']
    expect(spec.request.safeParse({ accent: 'blue' }).success).toBe(true)
    expect(spec.request.safeParse({ accent: 'pink' }).success).toBe(false)
  })
  it('void requests reject payloads', () => {
    expect(ipcContract['app:info'].request.safeParse({ path: '/etc' }).success).toBe(false)
  })
})

describe('settings patches', () => {
  it('carry only the fields that changed', async () => {
    const { settingsPatchSchema } = await import('@shared/settings')
    expect(settingsPatchSchema.parse({ theme: 'light' })).toEqual({ theme: 'light' })
  })
})
