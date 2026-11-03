import { open, readdir, stat } from 'node:fs/promises'
import { basename, extname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { NANOSCALE_RUNTIME_IMAGE_PATHS } from '../src/js/modules/nanoscale/nanoscale-assets.js'

const LFS_POINTER_PREFIX = 'version https://git-lfs.github.com/spec/v1'
const LFS_EXTENSIONS = new Set(['.glb', '.hdr', '.mp4', '.ogg', '.wav', '.webm'])

const BASE_MODULE_ASSETS = Object.freeze([
  /* Nanoscale uses camera-ready WebP plates. The three deepest views are
     rebuilt from their source layers so the removed drafting grid cannot be
     baked back into the experience unnoticed. */
  { path: 'assets/modules/nanoscale/splash-room.webp', type: 'webp', minimumBytes: 200_000 },
  { path: 'assets/modules/nanoscale/cryostat.webp', type: 'webp', minimumBytes: 100_000 },
  /* The arm's tip as its own close-up, for the Module 06 finale's pull-out. */
  { path: 'assets/modules/nanoscale/coldfinger.webp', type: 'webp', minimumBytes: 100_000 },
  { path: 'assets/modules/nanoscale/majorana-2.webp', type: 'webp', minimumBytes: 100_000 },
  { path: 'assets/modules/nanoscale/qpu-chip-clean.webp', type: 'webp', minimumBytes: 100_000 },
  { path: 'assets/modules/nanoscale/qubit-array-clean.webp', type: 'webp', minimumBytes: 100_000 },
  { path: 'assets/modules/nanoscale/nanowire-clean.webp', type: 'webp', minimumBytes: 100_000 },
  { path: 'assets/modules/nanoscale/qpu-chip-focal.webp', type: 'webp', minimumBytes: 100_000 },
  { path: 'assets/modules/nanoscale/qubit-array-background.webp', type: 'webp', minimumBytes: 1_000_000 },
  { path: 'assets/modules/nanoscale/nanowire-background.webp', type: 'webp', minimumBytes: 1_000_000 },
  { path: 'assets/modules/nanoscale/nanowire-focal.webp', type: 'webp', minimumBytes: 100_000 },
  { path: 'assets/modules/states-of-matter/SoM_IceCube_4k_vertical.mp4', type: 'mp4', minimumBytes: 30_000_000 },
  { path: 'assets/modules/states-of-matter/Ice+Cube.glb', type: 'glb', minimumBytes: 7_000_000 },
  { path: 'assets/modules/states-of-matter/som-poster.jpg', type: 'jpg', minimumBytes: 40_000 },
  { path: 'assets/modules/protecting-information/module-selection-screen.mp4', type: 'mp4', minimumBytes: 1_000_000 },
  /* Module 07's six delivered beats, alternating build and reading frame:
     opening build, measurement-pair loop, sequence build, measurement-sequence
     loop, information-cloud build, and the final loop.

     VP9-alpha WebM, not MP4: the re-delivered masters carry a real alpha
     channel so the module's gradient shows through instead of the footage
     painting its own surface over the stage. The thresholds are far below the
     old opaque set's because dropping the baked background dropped 51 MB to
     13 MB -- the grey field outside the device is absent now rather than
     compressed -- and lower again since these were re-baked at 1440 x 2560 to
     get the decode inside frame budget, which took 13 MB to 7.7 MB. See
     docs/ASSET-PRODUCTION-NOTES.md. */
  { path: 'assets/modules/measurement-based/IQM_MultiQubit_VIDEO_split-001.webm', type: 'webm', minimumBytes: 240_000 },
  { path: 'assets/modules/measurement-based/IQM_MultiQubit_VIDEO_split-002.webm', type: 'webm', minimumBytes: 80_000 },
  { path: 'assets/modules/measurement-based/IQM_MultiQubit_VIDEO_split-003.webm', type: 'webm', minimumBytes: 1_030_000 },
  { path: 'assets/modules/measurement-based/IQM_MultiQubit_VIDEO_split-004.webm', type: 'webm', minimumBytes: 930_000 },
  { path: 'assets/modules/measurement-based/IQM_MultiQubit_VIDEO_split-005.webm', type: 'webm', minimumBytes: 1_180_000 },
  { path: 'assets/modules/measurement-based/IQM_MultiQubit_VIDEO_split-006.webm', type: 'webm', minimumBytes: 1_000_000 },
  /* Deterministic field textures are baked losslessly so module startup only
     decodes images instead of running millions of CPU noise samples. */
  { path: 'assets/modules/states-of-matter/frost/noise.png', type: 'png', minimumBytes: 100_000 },
  { path: 'assets/modules/states-of-matter/frost/frost-main.png', type: 'png', minimumBytes: 1_000_000 },
  { path: 'assets/modules/states-of-matter/frost/frost-fine.png', type: 'png', minimumBytes: 1_000_000 },
  { path: 'assets/modules/states-of-matter/frost/frost-film.png', type: 'png', minimumBytes: 100_000 },
  { path: 'assets/audio/som-ice-crackle.ogg', type: 'ogg', minimumBytes: 40_000 },
  { path: 'assets/audio/som-water-drip.ogg', type: 'ogg', minimumBytes: 40_000 },
  { path: 'assets/audio/som-steam-hiss.ogg', type: 'ogg', minimumBytes: 40_000 },
  { path: 'assets/audio/285555-Whoosh_-Low_gentle-slow_calm_and_deep.wav', type: 'wav', minimumBytes: 700_000 },
  /* Module 05's payoff when all three dials land in target. */
  { path: 'assets/audio/ESM_New_Bonus_2_Sound_FX_Arcade_Casino_Kids_Mobile_App.wav', type: 'wav', minimumBytes: 300_000 },
  { path: 'assets/modules/differences/Buoy.glb', type: 'glb', minimumBytes: 150_000 },
  { path: 'assets/modules/differences/coins/US Coins OBj.obj', type: 'obj', minimumBytes: 200_000 },
  { path: 'assets/modules/differences/coins/TwentyFive_Cent_Color.bmp', type: 'bmp', minimumBytes: 8_000_000 },
  { path: 'assets/modules/differences/coins/TwentyFive_Cent_Bump.bmp', type: 'bmp', minimumBytes: 8_000_000 },
  { path: 'assets/modules/differences/coins/TwentyFive_Cent_Color01.jpg', type: 'jpg', minimumBytes: 800_000 },
  { path: 'assets/modules/differences/coins/TwentyFive_Cent_Color02.jpg', type: 'jpg', minimumBytes: 800_000 },
  { path: 'assets/modules/differences/coins/TwentyFive_Cent_Color03.jpg', type: 'jpg', minimumBytes: 800_000 },
  { path: 'assets/modules/differences/coins/TwentyFive_Cent_Color04.jpg', type: 'jpg', minimumBytes: 800_000 },
  { path: 'assets/modules/differences/coins/reflection-map01.png', type: 'png', minimumBytes: 10_000 },
  { path: 'assets/modules/differences/coins/reflection-map02.png', type: 'png', minimumBytes: 10_000 },
  /* Alpha effect clips: VP9 in WebM with a real alpha channel, which the
     browser composites without a shader (see docs/ASSET-PRODUCTION-NOTES.md).
     Baked by scripts/pack-alpha-video.mjs from ProRes 4444 masters far too
     large to keep in the repository, so a missing one cannot simply be
     regenerated on the build box. */
  /* Material inset clips for the Superconductor and Semiconductor panels.
     Opaque, and looped by a circular crossfade rather than by luck -- see
     scripts/prepare-inset-video.mjs. */
  { path: 'assets/modules/qubit-explorer/superconductor-inset.mp4', type: 'mp4', minimumBytes: 1_500_000 },
  /* Animated interference diagrams. The constructive and destructive panels are
     two halves of one master, cut on the blank frame between them. */
  { path: 'assets/modules/differences/interference-tooltips/wave-probability.webm', type: 'webm', minimumBytes: 150_000 },
  { path: 'assets/modules/differences/interference-tooltips/constructive-interference.webm', type: 'webm', minimumBytes: 500_000 },
  { path: 'assets/modules/differences/interference-tooltips/destructive-interference.webm', type: 'webm', minimumBytes: 500_000 },
  { path: 'assets/modules/qubit-explorer/semiconductor-inset.mp4', type: 'mp4', minimumBytes: 3_000_000 },
  /* The nanowire inset that plays inside the loupe. */
  { path: 'assets/modules/protecting-information/nanowire-inset.mp4', type: 'mp4', minimumBytes: 200_000 },
  /* Still plates from the device stack: the base device, the plate over
     Particles A, and the H bar. The base one especially — without it the module
     has no device at all. */
  { path: 'assets/video-fx/tpt-base-layer.webp', type: 'webp', minimumBytes: 1_000_000 },
  { path: 'assets/video-fx/tpt-layer-over-particle-a.webp', type: 'webp', minimumBytes: 1_000_000 },
  { path: 'assets/video-fx/tpt-h-bar.webp', type: 'webp', minimumBytes: 50_000 },
  /* Re-cut with alpha. They were premultiplied over black, which needs
     plus-lighter to hide the black and so only composited correctly over
     something opaque; carrying their own alpha, they no longer do. */
  { path: 'assets/video-fx/electricity-shapes-loop.webm', type: 'webm', minimumBytes: 80_000 },
  { path: 'assets/video-fx/electricity-pulsing-p3-add.webm', type: 'webm', minimumBytes: 2_500_000 },
  { path: 'assets/video-fx/tpt-add-on-fx.webm', type: 'webm', minimumBytes: 5_000_000 },
  { path: 'assets/video-fx/tpt-device-fade-top.webm', type: 'webm', minimumBytes: 300_000 },
  { path: 'assets/video-fx/tpt-intro-reveal-short.webm', type: 'webm', minimumBytes: 800_000 },
  { path: 'assets/video-fx/tpt-outro-de-reveal-short.webm', type: 'webm', minimumBytes: 300_000 }
])

const RUNTIME_IMAGE_TYPES = Object.freeze({
  '.jpg': 'jpg',
  '.png': 'png',
  '.svg': 'svg',
  '.webp': 'webp'
})
const explicitlyValidatedPaths = new Set(BASE_MODULE_ASSETS.map(asset => asset.path))
const nanoscaleRuntimeAssets = NANOSCALE_RUNTIME_IMAGE_PATHS
  .filter(path => !explicitlyValidatedPaths.has(path))
  .map(path => {
    const extension = extname(path).toLowerCase()
    const type = RUNTIME_IMAGE_TYPES[extension]
    if (!type) throw new Error(`Unsupported Nanoscale runtime image type: ${path}`)
    return { path, type, minimumBytes: 1 }
  })

const MODULE_ASSETS = Object.freeze([
  ...BASE_MODULE_ASSETS,
  ...nanoscaleRuntimeAssets
])

async function collectFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const nested = await Promise.all(entries.map(entry => {
    const absolutePath = join(directory, entry.name)
    return entry.isDirectory() ? collectFiles(absolutePath) : [absolutePath]
  }))
  return nested.flat()
}

async function readHeader(filename, length = 512) {
  const handle = await open(filename, 'r')
  try {
    const buffer = Buffer.alloc(length)
    const { bytesRead } = await handle.read(buffer, 0, length, 0)
    return buffer.subarray(0, bytesRead)
  } finally {
    await handle.close()
  }
}

function assertSignature(buffer, type, filename) {
  const ascii = (start, end) => buffer.subarray(start, end).toString('ascii')
  const isPng = buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  const isJpeg = buffer[0] === 0xff && buffer[1] === 0xd8
  const isSvg = buffer.toString('utf8', 0, Math.min(buffer.length, 512)).match(/<svg\b/i)
  const isObj = buffer.toString('utf8', 0, Math.min(buffer.length, 512))
    .match(/^(?:#.*\n)*(?:\s*mtllib\s+|\s*[ogv]\s+)/m)
  const isWebp = ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP'

  /* WebM is Matroska, so it opens with the EBML magic rather than anything
     naming the container — a .webm that is really an .mkv passes this, but a
     truncated download or an unresolved LFS pointer does not. */
  const isWebm = buffer.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))

  /* Opus carries its encoder pre-skip in the OpusHead packet, which is what
     keeps decoded loops sample-accurate — so assert the codec, not just Ogg. */
  const isOggOpus = ascii(0, 4) === 'OggS' && buffer.includes('OpusHead')

  const valid = {
    bmp: ascii(0, 2) === 'BM',
    glb: ascii(0, 4) === 'glTF',
    jpg: isJpeg,
    mp4: ascii(4, 8) === 'ftyp',
    ogg: isOggOpus,
    obj: Boolean(isObj),
    png: isPng,
    svg: Boolean(isSvg),
    webm: isWebm,
    webp: isWebp,
    wav: ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WAVE'
  }[type]

  if (!valid) throw new Error(`${basename(filename)} does not have a valid ${type.toUpperCase()} signature`)
}

export async function validateMediaRoot(root, { requiredAssets = MODULE_ASSETS } = {}) {
  const absoluteRoot = resolve(root)
  const files = await collectFiles(absoluteRoot)
  const failures = []

  for (const filename of files) {
    if (!LFS_EXTENSIONS.has(extname(filename).toLowerCase())) continue
    const header = (await readHeader(filename, 256)).toString('utf8')
    if (header.startsWith(LFS_POINTER_PREFIX)) {
      failures.push(`${filename}: unresolved Git LFS pointer`)
    }
  }

  for (const asset of requiredAssets) {
    const filename = join(absoluteRoot, asset.path)
    try {
      const metadata = await stat(filename)
      if (metadata.size < asset.minimumBytes) {
        throw new Error(`expected at least ${asset.minimumBytes.toLocaleString('en-US')} bytes, received ${metadata.size.toLocaleString('en-US')}`)
      }
      const buffer = await readHeader(filename)
      assertSignature(buffer, asset.type, filename)
    } catch (error) {
      failures.push(`${filename}: ${error.message}`)
    }
  }

  if (failures.length) {
    throw new Error(`Media validation failed:\n${failures.map(failure => `- ${failure}`).join('\n')}`)
  }

  return { fileCount: files.length, requiredCount: requiredAssets.length, root: absoluteRoot }
}

async function main() {
  const projectRoot = resolve(import.meta.dirname, '..')
  const rootArgument = process.argv[2] || 'public'
  const result = await validateMediaRoot(resolve(projectRoot, rootArgument))
  console.log(`Media checked: ${result.requiredCount} required assets in ${result.root}`)
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch(error => {
    console.error(error.message)
    process.exitCode = 1
  })
}
