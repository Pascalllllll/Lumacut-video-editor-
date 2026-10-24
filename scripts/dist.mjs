#!/usr/bin/env node
// Builds installable packages: fetches the FFmpeg builds each target needs,
// bundles the app, then runs electron-builder.
//
// When the project sits on a drive without Unix permissions (NTFS here), the
// packages are staged under ~/.cache/lumacut-dist and the finished files are
// copied back to release/<version>/.
//
//   node scripts/dist.mjs linux [--x64] [--arm64] [deb rpm AppImage tar.gz]
import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, statSync, writeFileSync, rmSync } from 'node:fs'
import { copyFile, mkdir, readdir, readFile, rm } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const [platform, ...rest] = process.argv.slice(2).filter((a) => a !== '--')
const PLATFORM_FLAG = { linux: '--linux', win: '--win', mac: '--mac' }
const NODE_PLATFORM = { linux: 'linux', win: 'win32', mac: 'darwin' }
if (!PLATFORM_FLAG[platform]) {
  console.error('Usage: node scripts/dist.mjs <linux|win|mac> [electron-builder args]')
  process.exit(1)
}

function run(cmd, args) {
  // Only node itself is run, so no shell: on Windows one would split its path at the space.
  const result = spawnSync(cmd, args, { cwd: root, stdio: 'inherit' })
  if (result.status !== 0) process.exit(result.status ?? 1)
}

function supportsPermissions(dir) {
  const probe = join(dir, `.perm-probe-${process.pid}`)
  writeFileSync(probe, '')
  try {
    chmodSync(probe, 0o644)
    return (statSync(probe).mode & 0o777) === 0o644
  } finally {
    rmSync(probe, { force: true })
  }
}

const explicitArchs = ['x64', 'arm64'].filter((a) => rest.includes(`--${a}`))
const archs = explicitArchs.length ? explicitArchs : ['x64', 'arm64']
for (const arch of archs)
  run(process.execPath, [
    'scripts/fetch-binaries.mjs',
    '--target',
    `${NODE_PLATFORM[platform]}-${arch}`,
  ])

run(process.execPath, [
  join(root, 'node_modules', 'electron-vite', 'bin', 'electron-vite.js'),
  'build',
])

const { version } = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
const finalDir = join(root, 'release', version)
const needsStaging = process.platform !== 'win32' && !supportsPermissions(root)
const outDir = needsStaging ? join(homedir(), '.cache', 'lumacut-dist', version) : finalDir
if (needsStaging) {
  console.log(`This drive ignores file permissions; staging the build in ${outDir}`)
  await rm(outDir, { recursive: true, force: true })
}

const extra = []
if (needsStaging && platform === 'linux') {
  // Icons are copied into the package as-is, so give them proper modes first.
  const iconDir = join(dirname(outDir), 'icons')
  await rm(iconDir, { recursive: true, force: true })
  await mkdir(iconDir, { recursive: true })
  for (const name of await readdir(join(root, 'resources', 'icons', 'linux'))) {
    await copyFile(join(root, 'resources', 'icons', 'linux', name), join(iconDir, name))
    chmodSync(join(iconDir, name), 0o644)
  }
  extra.push(`-c.linux.icon=${iconDir}`)
}

const builder = join(root, 'node_modules', 'electron-builder', 'cli.js')
// electron-builder wants target names right after the platform flag.
const targets = rest.filter((a) => !a.startsWith('-'))
const flags = rest.filter((a) => a.startsWith('-'))
run(process.execPath, [
  builder,
  PLATFORM_FLAG[platform],
  ...targets,
  ...flags,
  ...extra,
  `-c.directories.output=${outDir}`,
])

if (needsStaging) {
  await mkdir(finalDir, { recursive: true })
  for (const entry of await readdir(outDir, { withFileTypes: true })) {
    if (entry.isFile() && !entry.name.startsWith('builder-')) {
      await copyFile(join(outDir, entry.name), join(finalDir, entry.name))
      console.log(`  release/${version}/${entry.name}`)
    }
  }
}
if (!existsSync(finalDir)) process.exit(1)
