import { describe, expect, it } from 'vitest'
// @ts-expect-error plain .mjs helper without type declarations
import { bumpVersion, changelogSection, promoteUnreleased } from '../../scripts/release-lib.mjs'

describe('bumpVersion', () => {
  it('bumps patch, minor and major', () => {
    expect(bumpVersion('0.1.0', 'patch')).toBe('0.1.1')
    expect(bumpVersion('0.1.3', 'minor')).toBe('0.2.0')
    expect(bumpVersion('0.9.3', 'major')).toBe('1.0.0')
  })
  it('accepts an exact version', () => {
    expect(bumpVersion('0.1.0', '1.0.0')).toBe('1.0.0')
  })
  it('rejects anything else', () => {
    expect(() => bumpVersion('0.1.0', 'huge')).toThrow(/Unknown bump/)
  })
})

describe('promoteUnreleased', () => {
  const log =
    '# Changelog\n\n## [Unreleased]\n\n### Added\n\n- Thing\n\n## [0.1.0] - 2026-01-01\n\n- Old\n'

  it('moves unreleased entries under the new version and leaves an empty Unreleased', () => {
    const out = promoteUnreleased(log, '0.2.0', '2026-10-24')
    expect(out).toContain('## [Unreleased]\n\n## [0.2.0] - 2026-10-24\n\n### Added\n\n- Thing\n')
    expect(out).toContain('## [0.1.0] - 2026-01-01')
  })
  it('refuses an empty Unreleased section', () => {
    expect(() => promoteUnreleased('## [Unreleased]\n\n## [0.1.0]\n', '0.2.0', 'x')).toThrow(
      /empty/,
    )
  })
})

describe('changelogSection', () => {
  const log =
    '# Changelog\n\n## [Unreleased]\n\n## [0.2.0] - 2026-10-24\n\n### Added\n\n- Thing\n\n## [0.1.0] - 2026-01-01\n\n- Old\n'

  it('returns one version, without its heading or the next version', () => {
    expect(changelogSection(log, '0.2.0')).toBe('### Added\n\n- Thing')
    expect(changelogSection(log, '0.1.0')).toBe('- Old')
  })
  it('fails for a version that is not there', () => {
    expect(() => changelogSection(log, '9.0.0')).toThrow(/no "## \[9.0.0\]"/)
  })
})
