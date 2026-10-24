#!/usr/bin/env node
// Bumps the version in package.json and turns [Unreleased] in CHANGELOG.md into
// the new version with today's date. It never commits, tags or pushes.
//
//   pnpm release            patch bump
//   pnpm release -- minor   minor bump
//   pnpm release -- 1.0.0   exact version
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { bumpVersion, promoteUnreleased } from './release-lib.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const kind = process.argv.slice(2).find((a) => a !== '--') ?? 'patch'

const pkgPath = join(root, 'package.json')
const changelogPath = join(root, 'CHANGELOG.md')
const pkg = JSON.parse(await readFile(pkgPath, 'utf8'))
const next = bumpVersion(pkg.version, kind)
const today = new Date().toISOString().slice(0, 10)

const changelog = promoteUnreleased(await readFile(changelogPath, 'utf8'), next, today)
pkg.version = next
await writeFile(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`)
await writeFile(changelogPath, changelog)

console.log(`Version is now ${next}.`)
console.log(
  'Next: copy the new CHANGELOG entry into README.md, then commit, tag v' + next + ' and push.',
)
