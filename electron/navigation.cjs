'use strict'

const { loadExperienceRegistry } = require('./experience-registry.cjs')
const defaultIds = () => loadExperienceRegistry().map(entry => entry.id)
const defaultDocuments = () => ['launcher', ...defaultIds()]
const CHANNELS = Object.freeze({
  getState: 'quantum:get-state',
  getExperiences: 'quantum:get-experiences',
  launchExperience: 'quantum:launch-experience',
  returnToLauncher: 'quantum:return-to-launcher',
  stateChanged: 'quantum:state-changed'
})

function documentForUrl(value, documents = defaultDocuments()) {
  try {
    const url = new URL(value)
    return url.protocol === 'quantum-app:' && !url.username && !url.password && !url.port &&
      documents.includes(url.hostname) && ['/', '/index.html'].includes(url.pathname)
      ? url.hostname : null
  } catch {
    return null
  }
}

function isTrustedSender(event, webContents, operation, documents = defaultDocuments()) {
  if (!webContents || webContents.isDestroyed() || event.sender !== webContents ||
      !event.senderFrame || event.senderFrame !== webContents.mainFrame) return false
  const document = documentForUrl(event.senderFrame.url, documents)
  if (!document || document !== documentForUrl(webContents.getURL(), documents)) return false
  if (operation === 'launchExperience' || operation === 'getExperiences') return document === 'launcher'
  return ['getState', 'returnToLauncher'].includes(operation)
}

function plainError(value) {
  return String(value || 'The document could not be loaded.').replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 500)
}

function createNavigationController({ loadDocument, checkDocument = async () => {}, experienceIds = defaultIds() }) {
  const allowedIds = new Set(experienceIds)
  if (typeof loadDocument !== 'function') throw new TypeError('loadDocument is required')
  let state = Object.freeze({ document: 'launcher', isLoading: false, experienceId: null, error: null })
  let generation = 0
  const listeners = new Set()
  const getState = () => ({ ...state })
  const result = ok => ({ ok, state: getState() })
  function publish(patch) {
    state = Object.freeze({ ...state, ...patch })
    for (const listener of listeners) {
      try { listener(getState()) } catch { /* A subscriber cannot interrupt a navigation. */ }
    }
  }
  async function navigate(document, { force = false, error = null } = {}) {
    if (state.isLoading && !force) return result(false)
    const token = ++generation
    publish({ isLoading: true, error })
    try {
      await checkDocument(document)
      if (token !== generation) return result(false)
      await loadDocument(document)
      if (token !== generation) return result(false)
      publish({ document, experienceId: document === 'launcher' ? null : document, isLoading: false })
      return result(error === null)
    } catch (failure) {
      if (token !== generation) return result(false)
      const message = error || plainError(failure.message)
      publish({ error: message })
      if (document !== 'launcher') {
        try {
          await loadDocument('launcher')
          if (token !== generation) return result(false)
        } catch (launcherFailure) {
          if (token !== generation) return result(false)
          publish({ error: `${message} Launcher recovery failed: ${plainError(launcherFailure.message)}` })
        }
      }
      publish({ document: 'launcher', experienceId: null, isLoading: false })
      return result(false)
    }
  }
  return Object.freeze({
    getState,
    onStateChanged(callback) {
      if (typeof callback !== 'function') throw new TypeError('callback must be a function')
      listeners.add(callback)
      return () => listeners.delete(callback)
    },
    start: () => navigate('launcher'),
    launchExperience(id) {
      if (state.isLoading) return Promise.resolve(result(false))
      if (state.document !== 'launcher') return Promise.resolve(result(false))
      if (!allowedIds.has(id)) {
        publish({ error: 'Choose an experience from the welcome screen; the requested experience is not available.' })
        return Promise.resolve(result(false))
      }
      return navigate(id)
    },
    returnToLauncher() {
      if (!state.isLoading && state.document === 'launcher') {
        publish({ error: null })
        return Promise.resolve(result(true))
      }
      return navigate('launcher')
    },
    recover: message => navigate('launcher', { force: true, error: plainError(message) })
  })
}

module.exports = { CHANNELS, createNavigationController, documentForUrl, isTrustedSender }
