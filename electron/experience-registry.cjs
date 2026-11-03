'use strict'

const fs = require('node:fs')
const path = require('node:path')

const ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/
const ENTRY_FIELDS = Object.freeze(['id', 'label', 'directory', 'defaultSource', 'importProfile', 'adapter', 'runtimeConfig'])
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const validId = value => typeof value === 'string' && ID_PATTERN.test(value) && value !== 'launcher'

function relativeParts(value, name) {
  if (typeof value !== 'string' || !value || value !== value.trim() || /[\u0000-\u001f<>:"|?*]/.test(value) ||
      path.win32.isAbsolute(value) || path.posix.isAbsolute(value)) throw new TypeError(`${name} must be a safe relative path`)
  const parts = value.split(/[\\/]/)
  if (parts.some(part => !part || part === '.' || part === '..' || /[. ]$/.test(part) ||
      /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) throw new TypeError(`${name} contains an unsafe path segment`)
  return parts
}

function assertNoSymlinks(root, parts, name, fileLeaf = false) {
  let current = root
  const segments = ['', ...parts]
  for (const [index, part] of segments.entries()) {
    current = part ? path.join(current, part) : current
    try {
      const stats = fs.lstatSync(current)
      if (stats.isSymbolicLink()) throw new TypeError(`${name} must not traverse a symlink or junction`)
      const expectedFile = fileLeaf && index === segments.length - 1
      if (expectedFile ? !stats.isFile() : !stats.isDirectory()) throw new TypeError(`${name} has an invalid file or directory component`)
    } catch (error) {
      if (error.code === 'ENOENT') continue
      throw error
    }
  }
}

function resolveExperiencePath(projectRoot, entry, relative = '') {
  const parts = relativeParts(entry.directory, 'directory')
  return path.join(projectRoot, ...parts, ...(relative ? relativeParts(relative, 'relative path') : []))
}

function loadExperienceRegistry(projectRoot = path.resolve(__dirname, '..')) {
  projectRoot = path.resolve(projectRoot)
  const data = JSON.parse(fs.readFileSync(path.join(projectRoot, 'experiences.json'), 'utf8'))
  if (!record(data) || data.version !== 1 || !Array.isArray(data.experiences) ||
      Object.keys(data).some(key => !['version', 'experiences'].includes(key))) throw new TypeError('Invalid experience registry schema (expected version 1)')
  const ids = new Set()
  const directories = []
  const entries = data.experiences.map(entry => {
    if (!record(entry) || ENTRY_FIELDS.some(key => !Object.hasOwn(entry, key)) ||
        Object.keys(entry).some(key => !ENTRY_FIELDS.includes(key))) throw new TypeError('Invalid experience entry schema')
    if (!validId(entry.id) || ids.has(entry.id)) throw new TypeError('Experience IDs must be unique DNS-safe names other than launcher')
    ids.add(entry.id)
    if (typeof entry.label !== 'string' || !entry.label || entry.label !== entry.label.trim() || entry.label.length > 100 ||
        /[<>\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/.test(entry.label)) throw new TypeError(`Unsafe label for ${entry.id}`)
    const parts = relativeParts(entry.directory, 'directory')
    if (parts.length < 2 || parts[0].toLowerCase() !== 'experiences') throw new TypeError('Experience directory must be within the experiences subtree')
    const key = parts.join('\\').toLowerCase()
    if (directories.some(other => key === other || key.startsWith(`${other}\\`) || other.startsWith(`${key}\\`))) throw new TypeError('Experience directories must not duplicate or overlap')
    directories.push(key)
    assertNoSymlinks(projectRoot, [...parts, 'dist'], 'Experience directory')
    if (typeof entry.defaultSource !== 'string' || !entry.defaultSource.trim() || /[\u0000-\u001f]/.test(entry.defaultSource)) throw new TypeError('defaultSource must be a source path string')
    const validName = value => typeof value === 'string' && ID_PATTERN.test(value)
    if (!validName(entry.importProfile) || (entry.adapter !== null && !validName(entry.adapter))) throw new TypeError('importProfile and adapter must be valid names')
    if (entry.runtimeConfig !== null) {
      const configParts = relativeParts(entry.runtimeConfig, 'runtimeConfig')
      assertNoSymlinks(projectRoot, [...parts, ...configParts], 'runtimeConfig', true)
    }
    return Object.freeze({ ...entry })
  })
  return Object.freeze(entries)
}

module.exports = { loadExperienceRegistry, resolveExperiencePath, validId }
