#!/usr/bin/env node
// Prints the CHANGELOG.md section for a version, for the GitHub Release.
// Fails if the version doesn't match package.json, so a mistyped tag stops
// the release instead of publishing the wrong notes.
//
//   node scripts/release-notes.mjs 1.0.0
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { changelogSection } from './release-lib.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const version = (process.argv[2] ?? '').replace(/^v/, '')
const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
if (version !== pkg.version) {
  console.error(`The tag says ${version || 'nothing'}, but package.json says ${pkg.version}.`)
  process.exit(1)
}
console.log(changelogSection(await readFile(join(root, 'CHANGELOG.md'), 'utf8'), version))
