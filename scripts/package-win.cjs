'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { loadExperienceRegistry, resolveExperiencePath } = require('../electron/experience-registry.cjs')

function listFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(directory, entry.name)
    if (entry.isSymbolicLink()) throw new Error(`Packaging does not accept links: ${file}`)
    if (entry.isDirectory()) return listFiles(file)
    if (!entry.isFile()) throw new Error(`Packaging requires a regular file: ${file}`)
    return [file]
  })
}

function requireFile(file) {
  if (!fs.statSync(file, { throwIfNoEntry: false })?.isFile()) {
    throw new Error(`Required kiosk content is missing: ${file}. Run npm.cmd run build before packaging.`)
  }
}

function createPackagingConfig(root) {
  const experiences = loadExperienceRegistry(root)
  requireFile(path.join(root, 'launcher', 'index.html'))
  const mappings = [
    { from: 'experiences.json', to: 'app-content/experiences.json' },
    { from: 'launcher', to: 'app-content/launcher', filter: ['**/*'] }
  ]
  for (const experience of experiences) {
    const directory = experience.directory.replaceAll('\\', '/')
    requireFile(resolveExperiencePath(root, experience, 'dist\\index.html'))
    mappings.push({ from: `${directory}/dist`, to: `app-content/${directory}/dist`, filter: ['**/*', '**/*.obj'] })
    if (experience.runtimeConfig !== null) {
      const config = resolveExperiencePath(root, experience, experience.runtimeConfig)
      requireFile(config)
      const value = JSON.parse(fs.readFileSync(config, 'utf8'))
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Invalid runtime configuration: ${config}`)
      const relative = `${directory}/${experience.runtimeConfig.replaceAll('\\', '/')}`
      mappings.push({ from: relative, to: `app-content/${relative}` })
    }
  }
  // Capture the complete payload before electron-builder applies its default filters.
  const payload = mappings.flatMap(mapping => {
    const source = path.join(root, mapping.from)
    return fs.statSync(source).isDirectory()
      ? listFiles(source).map(file => ({ source: file, destination: path.join(mapping.to, path.relative(source, file)) }))
      : [{ source, destination: mapping.to }]
  }).map(file => ({ ...file, size: fs.statSync(file.source).size }))

  return {
    appId: 'com.quantum.experience-launcher',
    productName: 'Quantum Kiosk',
    electronVersion: require('../package.json').devDependencies.electron,
    asar: true,
    compression: 'store',
    directories: { output: 'release' },
    files: ['electron/**/*', 'package.json'],
    extraResources: mappings,
    win: { target: [{ target: 'portable', arch: ['x64'] }] },
    portable: {
      artifactName: 'Quantum-Kiosk-${version}-${arch}-portable.${ext}',
      useZip: true,
      requestExecutionLevel: 'user'
    },
    async afterPack({ appOutDir }) {
      const resources = path.join(appOutDir, 'resources')
      for (const file of payload) {
        const destination = path.join(resources, file.destination)
        requireFile(destination)
        if (fs.statSync(destination).size !== file.size || fs.statSync(file.source).size !== file.size) {
          throw new Error(`Packaged content size mismatch: ${file.destination}`)
        }
      }
      console.log(`Verified ${payload.length} bundled content files, including media, models, fonts and runtime configuration.`)
    }
  }
}

async function packageWindows() {
  if (process.platform !== 'win32') throw new Error('Build and validate the portable Windows executable on Windows.')
  const root = path.dirname(__dirname)
  const { build, Platform, Arch } = require('electron-builder')
  const artifacts = await build({
    projectDir: root,
    publish: 'never',
    targets: Platform.WINDOWS.createTarget(['portable'], Arch.x64),
    config: createPackagingConfig(root)
  })
  if (!artifacts.length) throw new Error('The Windows build did not produce a portable executable.')
  for (const artifact of artifacts) console.log(`Created ${artifact}`)
}

if (require.main === module) {
  packageWindows().catch(error => { console.error(error.stack || error.message); process.exitCode = 1 })
}

module.exports = { createPackagingConfig }
