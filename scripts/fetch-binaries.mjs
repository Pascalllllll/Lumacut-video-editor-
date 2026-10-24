#!/usr/bin/env node
// Downloads the FFmpeg and FFprobe builds pinned in scripts/binaries.json into
// resources/bin/<os>-<arch>/ and refuses any file whose SHA-256 doesn't match.
//
//   pnpm fetch:binaries                       current OS and arch
//   pnpm fetch:binaries -- --target linux-arm64
//   pnpm fetch:binaries -- --repin            pin the newest build of the same branch
//
// Linux and Windows builds come from BtbN as one archive. macOS builds come
// from martin-riedl.de as one zip per program; --repin doesn't touch those.
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createWriteStream, existsSync } from 'node:fs'
import { chmod, copyFile, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const manifestPath = join(root, 'scripts', 'binaries.json')
const args = process.argv.slice(2)
const flag = (name) => {
  const i = args.indexOf(name)
  return i === -1 ? undefined : (args[i + 1] ?? true)
}

const BTBN_NAMES = {
  'linux-x64': 'linux64',
  'linux-arm64': 'linuxarm64',
  'win32-x64': 'win64',
  'win32-arm64': 'winarm64',
}

async function repin(manifest) {
  const { branch } = manifest.ffmpeg
  const res = await fetch('https://api.github.com/repos/BtbN/FFmpeg-Builds/releases?per_page=5', {
    headers: { 'User-Agent': 'lumacut-fetch-binaries' },
  })
  if (!res.ok) throw new Error(`GitHub API answered ${res.status}`)
  const release = (await res.json()).find((r) => r.tag_name.startsWith('autobuild-'))
  if (!release) throw new Error('No autobuild release found')
  const sums = await (
    await fetch(
      `https://github.com/BtbN/FFmpeg-Builds/releases/download/${release.tag_name}/checksums.sha256`,
    )
  ).text()
  const builds = {}
  for (const [key, name] of Object.entries(BTBN_NAMES)) {
    const re = new RegExp(
      `^([0-9a-f]{64})\\s+(ffmpeg-${branch.replace('.', '\\.')}[^\\s]*-${name}-gpl-[^\\s]+\\.(?:tar\\.xz|zip))$`,
      'm',
    )
    const match = re.exec(sums)
    if (!match) throw new Error(`No ${branch} build for ${key} in ${release.tag_name}`)
    builds[key] = { file: match[2], sha256: match[1] }
  }
  manifest.ffmpeg.tag = release.tag_name
  manifest.ffmpeg.builds = builds
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
  console.log(
    `Pinned ${release.tag_name}. Review the change to scripts/binaries.json before committing.`,
  )
}

async function download(url, dest) {
  const res = await fetch(url, { redirect: 'follow' })
  if (res.status === 404) {
    throw new Error(
      `${url} is gone (404). Upstream removes old builds; run "pnpm fetch:binaries -- --repin".`,
    )
  }
  if (!res.ok || !res.body) throw new Error(`Download failed with HTTP ${res.status}: ${url}`)
  const total = Number(res.headers.get('content-length') ?? 0)
  const hash = createHash('sha256')
  let received = 0
  let lastShown = -1
  const body = Readable.fromWeb(res.body)
  body.on('data', (chunk) => {
    hash.update(chunk)
    received += chunk.length
    const pct = total ? Math.floor((received / total) * 100) : -1
    if (process.stdout.isTTY && pct !== lastShown && pct % 5 === 0) {
      lastShown = pct
      process.stdout.write(`\r  ${pct}% of ${(total / 1e6).toFixed(0)} MB`)
    }
  })
  await pipeline(body, createWriteStream(dest))
  if (process.stdout.isTTY) process.stdout.write('\n')
  return hash.digest('hex')
}

async function findFile(dir, name) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      const hit = await findFile(full, name)
      if (hit) return hit
    } else if (entry.name === name) return full
  }
  return null
}

function extract(archive, dir) {
  // GNU tar can't read zip files, so try unzip first where it exists.
  if (archive.endsWith('.zip') && process.platform !== 'win32') {
    const unzip = spawnSync('unzip', ['-q', '-o', archive, '-d', dir], { stdio: 'ignore' })
    if (unzip.status === 0) return
  }
  const tar = spawnSync('tar', ['-xf', archive, '-C', dir], { stdio: 'inherit' })
  if (tar.status === 0) return
  throw new Error('Extracting the archive failed. Is "tar" (or "unzip" for zip files) installed?')
}

async function main() {
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  if (flag('--repin')) return repin(manifest)

  const target =
    typeof flag('--target') === 'string' ? flag('--target') : `${process.platform}-${process.arch}`
  const pinned = { ...manifest.ffmpeg.builds, ...manifest.macos.builds }
  const fromBtbN = target in manifest.ffmpeg.builds
  const build = pinned[target]
  if (!build) {
    const known = Object.keys(pinned).join(', ')
    throw new Error(`No pinned FFmpeg build for ${target}. Pinned targets: ${known}.`)
  }
  const parts = fromBtbN
    ? [
        {
          url: `${manifest.ffmpeg.source}/releases/download/${manifest.ffmpeg.tag}/${build.file}`,
          sha256: build.sha256,
        },
      ]
    : build.parts
  const fingerprint = parts.map((p) => p.sha256).join(' ')
  const label = fromBtbN ? build.file : `FFmpeg ${manifest.macos.version}`

  const outDir = join(root, 'resources', 'bin', target)
  const exe = target.startsWith('win32') ? '.exe' : ''
  const stamp = join(outDir, '.sha256')
  if (
    existsSync(stamp) &&
    (await readFile(stamp, 'utf8')).trim() === fingerprint &&
    existsSync(join(outDir, `ffmpeg${exe}`))
  ) {
    console.log(`FFmpeg for ${target} is already in place (${label}).`)
    return
  }

  const work = await mkdtemp(join(tmpdir(), 'lumacut-bin-'))
  try {
    const extractDir = join(work, 'x')
    await mkdir(extractDir)
    for (const [i, part] of parts.entries()) {
      const name = part.url.split('/').pop()
      const archive = join(work, `${i}-${name}`)
      console.log(`Downloading ${part.url}`)
      const actual = await download(part.url, archive)
      if (actual !== part.sha256) {
        throw new Error(
          `Checksum mismatch for ${name}\n  expected ${part.sha256}\n  got      ${actual}\nThe file was deleted. Nothing was installed.`,
        )
      }
      console.log('  SHA-256 verified')
      extract(archive, extractDir)
    }

    await mkdir(outDir, { recursive: true })
    for (const name of ['ffmpeg', 'ffprobe']) {
      const src = await findFile(extractDir, `${name}${exe}`)
      if (!src) throw new Error(`${name}${exe} is missing from ${label}`)
      await copyFile(src, join(outDir, `${name}${exe}`))
      if (!exe) await chmod(join(outDir, name), 0o755)
    }
    const license = await findFile(extractDir, 'LICENSE.txt')
    if (license) await copyFile(license, join(outDir, 'FFMPEG_LICENSE.txt'))
    else
      await writeFile(
        join(outDir, 'FFMPEG_LICENSE.txt'),
        `FFmpeg ${manifest.macos.version}, built by ${manifest.macos.source} with --enable-gpl --enable-version3.\nLicensed under the GNU General Public License, version 3 or later: https://www.gnu.org/licenses/gpl-3.0.txt\nSource code: https://ffmpeg.org/releases/ffmpeg-${manifest.macos.version}.tar.xz\n`,
      )
    await writeFile(stamp, `${fingerprint}\n`)
    console.log(`Installed ffmpeg and ffprobe into resources/bin/${target}`)
  } finally {
    await rm(work, { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error(`\n${error.message}`)
  process.exit(1)
})
