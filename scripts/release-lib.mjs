export function bumpVersion(current, kind) {
  if (/^\d+\.\d+\.\d+$/.test(kind)) return kind
  const [major, minor, patch] = current.split('.').map(Number)
  if (kind === 'major') return `${major + 1}.0.0`
  if (kind === 'minor') return `${major}.${minor + 1}.0`
  if (kind === 'patch') return `${major}.${minor}.${patch + 1}`
  throw new Error(`Unknown bump "${kind}". Use patch, minor, major or an exact version like 1.0.0.`)
}

export function promoteUnreleased(changelog, version, date) {
  const heading = '## [Unreleased]'
  const start = changelog.indexOf(heading)
  if (start === -1) throw new Error('CHANGELOG.md has no "## [Unreleased]" section.')
  const bodyStart = start + heading.length
  const nextSection = changelog.indexOf('\n## [', bodyStart)
  const body = changelog.slice(bodyStart, nextSection === -1 ? undefined : nextSection).trim()
  if (!body) throw new Error('The [Unreleased] section is empty. Add the changes first.')
  const rest = nextSection === -1 ? '' : changelog.slice(nextSection)
  return `${changelog.slice(0, start)}${heading}\n\n## [${version}] - ${date}\n\n${body}\n${rest}`
}

/** The body of one version's section, as written, for the GitHub Release notes. */
export function changelogSection(changelog, version) {
  const heading = `## [${version}]`
  const start = changelog.indexOf(`\n${heading}`)
  if (start === -1) throw new Error(`CHANGELOG.md has no "${heading}" section.`)
  const bodyStart = changelog.indexOf('\n', start + 1)
  const next = changelog.indexOf('\n## [', bodyStart)
  return changelog.slice(bodyStart, next === -1 ? undefined : next).trim()
}
