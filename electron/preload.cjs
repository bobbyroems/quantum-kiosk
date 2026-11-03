'use strict'

const { contextBridge, ipcRenderer } = require('electron')
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const documentId = value => typeof value === 'string' && /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(value)
const freeze = value => {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child)
    Object.freeze(value)
  }
  return value
}

function approvedRuntime() {
  const argumentsFound = process.argv.filter(value => value.startsWith('--quantum-runtime='))
  if (argumentsFound.length !== 1 || argumentsFound[0].length > 1048576) return null
  try {
    const runtime = JSON.parse(decodeURIComponent(argumentsFound[0].slice('--quantum-runtime='.length)))
    if (!record(runtime) || runtime.bridgeVersion !== 1 || typeof runtime.platform !== 'string' ||
        typeof runtime.appVersion !== 'string' || typeof runtime.isKiosk !== 'boolean' ||
        typeof runtime.isDevelopment !== 'boolean' || runtime.isKiosk === runtime.isDevelopment ||
        !Array.isArray(runtime.documents)) return null
    const ids = new Set()
    for (const metadata of runtime.documents) {
      if (!record(metadata) || !documentId(metadata.id) || ids.has(metadata.id) || !record(metadata.config)) return null
      if (metadata.cursorPolicy !== undefined && (!record(metadata.cursorPolicy) ||
          typeof metadata.cursorPolicy.hideClass !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(metadata.cursorPolicy.hideClass))) return null
      if (metadata.returnControl !== undefined && (metadata.id === 'launcher' || !record(metadata.returnControl) ||
          !['magne', 'iqm'].includes(metadata.returnControl.theme) ||
          metadata.returnControl.selector !== (metadata.returnControl.theme === 'magne' ? '#attract-screen' : '[data-screen="attract"]') ||
          metadata.returnControl.activeClass !== (metadata.returnControl.theme === 'magne' ? 'active' : 'is-active'))) return null
      ids.add(metadata.id)
    }
    if (!ids.has('launcher')) return null
    return freeze(runtime)
  } catch { return null }
}

const runtime = approvedRuntime()
const metadata = runtime?.documents.find(value => value.id === location.hostname)
if (process.isMainFrame && location.protocol === 'quantum-app:' && !location.username && !location.password &&
    !location.port && ['/', '/index.html'].includes(location.pathname) && metadata) {
  contextBridge.exposeInMainWorld('kiosk', freeze({
    bridgeVersion: 1,
    capabilities: { navigation: true, experienceList: metadata.id === 'launcher', returnToLauncher: metadata.id !== 'launcher' },
    platform: runtime.platform,
    appVersion: runtime.appVersion,
    isDevelopment: runtime.isDevelopment,
    isKiosk: runtime.isKiosk,
    config: metadata.config
  }))
  contextBridge.exposeInMainWorld('launcher', freeze({
    bridgeVersion: 1,
    capabilities: { experienceList: metadata.id === 'launcher', returnToLauncher: metadata.id !== 'launcher' },
    getState: () => ipcRenderer.invoke('quantum:get-state'),
    getExperiences: () => ipcRenderer.invoke('quantum:get-experiences'),
    launchExperience: id => ipcRenderer.invoke('quantum:launch-experience', id),
    returnToLauncher: () => ipcRenderer.invoke('quantum:return-to-launcher'),
    onStateChanged(callback) {
      if (typeof callback !== 'function') throw new TypeError('callback must be a function')
      const listener = (_event, state) => callback(freeze(state))
      ipcRenderer.on('quantum:state-changed', listener)
      return () => ipcRenderer.removeListener('quantum:state-changed', listener)
    }
  }))

  if (metadata.returnControl) {
    const owner = document
    const host = location.hostname
    const { selector, activeClass, theme } = metadata.returnControl
    let active = true
    let busy = false
    let observer = null
    let panel = null
    let control = null
    let button = null
    let status = null
    const ownsDocument = () => active && document === owner && location.protocol === 'quantum-app:' &&
      location.hostname === host && !location.username && !location.password && !location.port &&
      ['/', '/index.html'].includes(location.pathname)
    const welcomeVisible = () => ownsDocument() && panel?.isConnected && panel.classList.contains(activeClass) &&
      !panel.classList.contains('is-leaving') && panel.getAttribute('aria-hidden') !== 'true' && panel.style.pointerEvents !== 'none'
    const sync = () => {
      if (!ownsDocument() || !control) return
      const visible = welcomeVisible()
      control.hidden = !visible
      button.disabled = busy || !visible
      button.tabIndex = visible ? 0 : -1
      if (!visible && owner.activeElement === button) button.blur()
    }
    const activate = async event => {
      event.preventDefault()
      event.stopPropagation()
      if (busy || !welcomeVisible()) return
      busy = true
      status.hidden = true
      button.textContent = 'Returning…'
      button.setAttribute('aria-busy', 'true')
      sync()
      try {
        // Invoke from the isolated world; the main-world bridge is not visible here.
        const result = await ipcRenderer.invoke('quantum:return-to-launcher')
        if (!result?.ok) throw new Error('Return navigation failed')
      } catch {
        if (!ownsDocument()) return
        busy = false
        button.textContent = 'Exit to main menu'
        button.removeAttribute('aria-busy')
        status.textContent = 'Could not return. Please try again.'
        status.hidden = false
        sync()
      }
    }
    const loaded = () => {
      if (!ownsDocument() || control) return
      panel = owner.querySelector(selector)
      if (!panel) return
      control = owner.createElement('div')
      control.setAttribute('data-quantum-return', theme)
      control.hidden = true
      button = owner.createElement('button')
      button.type = 'button'
      button.textContent = 'Exit to main menu'
      button.disabled = true
      button.tabIndex = -1
      status = owner.createElement('p')
      status.setAttribute('role', 'alert')
      status.hidden = true
      control.append(button, status)
      panel.append(control)
      button.addEventListener('click', activate)
      observer = new MutationObserver(sync)
      observer.observe(panel, { attributes: true, attributeFilter: ['class', 'aria-hidden', 'style'] })
      sync()
    }
    const dispose = () => {
      active = false
      observer?.disconnect()
      button?.removeEventListener('click', activate)
      control?.remove()
      window.removeEventListener('load', loaded)
    }
    window.addEventListener('load', loaded, { once: true })
    window.addEventListener('pagehide', dispose, { once: true })
    if (owner.readyState === 'complete') loaded()
  }

  if (metadata.cursorPolicy) {
    // Isolated-world DOM changes belong to this document, never to a later navigation callback.
    const owner = document
    const host = location.hostname
    let active = true
    let observer = null
    const ownsDocument = () => active && document === owner && location.protocol === 'quantum-app:' &&
      location.hostname === host && !location.username && !location.password && !location.port &&
      ['/', '/index.html'].includes(location.pathname) && owner.body
    const apply = () => {
      if (!ownsDocument()) return
      const hideClass = metadata.cursorPolicy.hideClass
      if (runtime.isKiosk && !owner.body.classList.contains(hideClass)) owner.body.classList.add(hideClass)
      if (!runtime.isKiosk && owner.body.classList.contains(hideClass)) owner.body.classList.remove(hideClass)
    }
    const loaded = () => {
      if (observer || !ownsDocument()) return
      apply()
      observer = new MutationObserver(apply)
      observer.observe(owner.body, { attributes: true, attributeFilter: ['class'] })
    }
    window.addEventListener('load', loaded, { once: true })
    window.addEventListener('pagehide', () => { active = false; observer?.disconnect() }, { once: true })
    if (owner.readyState === 'complete') loaded()
  }
}
