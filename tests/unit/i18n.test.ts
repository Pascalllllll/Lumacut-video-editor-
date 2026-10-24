import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import en from '../../src/renderer/src/i18n/en.json'
import { APP_NAME } from '@shared/constants'

function flatten(obj: object, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([k, v]) =>
    typeof v === 'string' ? [`${prefix}${k}`] : flatten(v as object, `${prefix}${k}.`),
  )
}

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name)
    return statSync(full).isDirectory() ? files(full) : full.endsWith('.tsx') ? [full] : []
  })
}

const BANNED =
  /seamless|unleash|elevate|empower|revolutionary|game-changer|cutting-edge|next-level|effortless|supercharge|dive in|—/i

describe('en.json', () => {
  const values = flatten(en).map(
    (key) =>
      key.split('.').reduce<unknown>((n, k) => (n as Record<string, unknown>)[k], en) as string,
  )

  it('uses the product name constant', () => {
    expect(en.app.name).toBe(APP_NAME)
  })
  it('has no banned words, em dashes or exclamation marks', () => {
    for (const value of values) {
      expect(value, value).not.toMatch(BANNED)
      expect(value, value).not.toContain('!')
    }
  })
  it('every static t() key used in components exists', () => {
    const keys = new Set(flatten(en))
    for (const file of files('src/renderer/src')) {
      for (const match of readFileSync(file, 'utf8').matchAll(/\bt\('([\w.]+)'/g)) {
        expect(keys.has(match[1]!), `${file}: ${match[1]}`).toBe(true)
      }
    }
  })
})
