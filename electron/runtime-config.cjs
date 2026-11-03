'use strict'

const fs = require('node:fs')
const { resolveExperiencePath } = require('./experience-registry.cjs')
const { getRuntimeAdapter } = require('./runtime-adapters.cjs')
const DEFAULTS = Object.freeze({
  design: { width: 2160, height: 3840 }, display: { preferredLabel: 'elo', preferredIndex: null },
  development: { windowWidth: 540, windowHeight: 960, openDevTools: false, showHud: false,
    idleReturnToMenuMs: 600000, idleReturnToHomeMs: 600000 },
  kiosk: { idleReturnToMenuMs: 120000, idleReturnToHomeMs: 120000, backgroundColor: '#090b1f' }
})
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value)

function loadRuntimeConfig(projectRoot, entry, logger = console) {
  if (entry.runtimeConfig === null) return {}
  let config = {}
  try {
    config = JSON.parse(fs.readFileSync(resolveExperiencePath(projectRoot, entry, entry.runtimeConfig), 'utf8'))
    if (!isRecord(config)) throw new TypeError('Configuration must be an object')
    for (const key of Object.keys(DEFAULTS)) {
      if (config[key] !== undefined && !isRecord(config[key])) throw new TypeError(`${key} configuration must be an object`)
    }
  } catch (error) {
    logger.warn(`[main] ${entry.label} configuration unavailable; using production-safe defaults: ${error.message}`)
    config = {}
  }
  return { ...config, ...Object.fromEntries(Object.entries(DEFAULTS).map(([key, value]) => [key, { ...value, ...config[key] }])) }
}

function createRuntimeEnvelope(projectRoot, experiences, { platform, appVersion, windowed }, logger = console) {
  return {
    bridgeVersion: 1, platform, appVersion, isDevelopment: windowed, isKiosk: !windowed,
    documents: [{ id: 'launcher', config: {} }, ...experiences.map(entry => ({ id: entry.id, config: loadRuntimeConfig(projectRoot, entry, logger), ...getRuntimeAdapter(entry.adapter) }))]
  }
}

module.exports = { createRuntimeEnvelope, loadRuntimeConfig }
