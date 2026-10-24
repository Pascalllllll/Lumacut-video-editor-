// Packages built from a drive without Unix permissions (NTFS, exFAT) would carry
// world-writable files. Reset modes on the staged app before it is packed.
const { chmod, readdir, rm, stat } = require('node:fs/promises')
const { join } = require('node:path')

const EXECUTABLE = /^(lumacut|chrome_crashpad_handler|chrome-sandbox|ffmpeg|ffprobe)$|\.so(\.\d+)*$/

async function walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      await chmod(full, 0o755)
      await walk(full)
    } else if (entry.isFile()) {
      await chmod(full, EXECUTABLE.test(entry.name) ? 0o755 : 0o644)
    }
  }
}

/** onnxruntime-node ships binaries for every platform; keep only the one being packaged. */
async function pruneOnnxRuntime(context) {
  const { Arch } = require('electron-builder')
  const arch = Arch[context.arch]
  const resources =
    context.electronPlatformName === 'darwin'
      ? join(
          context.appOutDir,
          `${context.packager.appInfo.productFilename}.app`,
          'Contents',
          'Resources',
        )
      : join(context.appOutDir, 'resources')
  const bin = join(resources, 'app.asar.unpacked', 'node_modules', 'onnxruntime-node', 'bin')
  let napi
  try {
    napi = await readdir(bin)
  } catch {
    return
  }
  for (const version of napi) {
    for (const platform of await readdir(join(bin, version))) {
      if (platform !== context.electronPlatformName) {
        await rm(join(bin, version, platform), { recursive: true, force: true })
        continue
      }
      // Universal mac builds keep both architectures.
      if (arch === 'universal') continue
      for (const a of await readdir(join(bin, version, platform)))
        if (a !== arch) await rm(join(bin, version, platform, a), { recursive: true, force: true })
    }
  }
}

exports.default = async function afterPack(context) {
  await pruneOnnxRuntime(context)
  if (context.electronPlatformName !== 'linux') return
  await walk(context.appOutDir)
  const check = await stat(join(context.appOutDir, 'resources', 'app.asar'))
  if ((check.mode & 0o002) !== 0) {
    throw new Error(
      'The build folder ignores file permissions, so packages would contain world-writable files. ' +
        'Run the build through "pnpm dist:linux", which stages it on a Linux file system.',
    )
  }
}
