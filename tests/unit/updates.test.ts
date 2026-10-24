import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { compareVersions, installKind, releaseNotes } from '../../src/shared/updates'

const CHANGELOG = `# Changelog

## [Unreleased]

### Added

- Something not out yet.

## [1.2.0] - 2026-11-02

### Added

- Ripple trim.
- Faster scopes.

### Fixed

- Audio drift on long clips.

## [1.1.0] - 2026-10-01

- A line with no heading.
`

describe('compareVersions', () => {
  it('orders by major, minor and patch', () => {
    expect(compareVersions('1.0.0', '1.0.1')).toBeLessThan(0)
    expect(compareVersions('1.10.0', '1.9.9')).toBeGreaterThan(0)
    expect(compareVersions('v2.0.0', '2.0.0')).toBe(0)
  })

  it('puts a prerelease before its release', () => {
    expect(compareVersions('1.0.0-beta.1', '1.0.0')).toBeLessThan(0)
    expect(compareVersions('1.0.0', '1.0.0-rc.1')).toBeGreaterThan(0)
  })

  it('treats unreadable versions as equal, so nothing is offered', () => {
    expect(compareVersions('latest', '1.0.0')).toBe(0)
  })
})

describe('releaseNotes', () => {
  it('reads one version with its date and sections', () => {
    expect(releaseNotes(CHANGELOG, '1.2.0')).toEqual({
      version: '1.2.0',
      date: '2026-11-02',
      sections: [
        { heading: 'Added', items: ['Ripple trim.', 'Faster scopes.'] },
        { heading: 'Fixed', items: ['Audio drift on long clips.'] },
      ],
    })
  })

  it('gives items without a heading a generic one', () => {
    expect(releaseNotes(CHANGELOG, '1.1.0')?.sections).toEqual([
      { heading: 'Changes', items: ['A line with no heading.'] },
    ])
  })

  it('never returns Unreleased, and returns null for unknown versions', () => {
    expect(releaseNotes(CHANGELOG, '9.9.9')).toBeNull()
    expect(releaseNotes(CHANGELOG, 'Unreleased')).toBeNull()
  })

  it('reads the project changelog', () => {
    const text = readFileSync(join(import.meta.dirname, '../../CHANGELOG.md'), 'utf8')
    const version = (
      JSON.parse(readFileSync(join(import.meta.dirname, '../../package.json'), 'utf8')) as {
        version: string
      }
    ).version
    const notes = releaseNotes(text, version)
    // A development version has no section yet; a released one must have one.
    if (notes) expect(notes.sections.length).toBeGreaterThan(0)
    else expect(text).toMatch(/^## \[Unreleased\]/m)
  })
})

describe('installKind', () => {
  it('replaces itself only as an AppImage or from the Windows installer', () => {
    expect(installKind('linux', { APPIMAGE: '/home/a/Lumacut.AppImage' })).toBe('appimage')
    expect(installKind('linux', {})).toBe('other')
    expect(installKind('win32', {})).toBe('nsis')
    expect(installKind('win32', { PORTABLE_EXECUTABLE_DIR: 'D:\\' })).toBe('other')
    expect(installKind('darwin', {})).toBe('other')
  })
})
