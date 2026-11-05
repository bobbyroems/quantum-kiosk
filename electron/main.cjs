'use strict'

const { app, BrowserWindow, dialog, ipcMain, Menu, powerSaveBlocker, protocol, screen, session } = require('electron')
const fs = require('node:fs')
const fsp = require('node:fs/promises')
const path = require('node:path')
const { APP_PROTOCOL_PRIVILEGES, APP_PROTOCOL_SCHEME, createAppProtocolHandler, createAppUrl } = require('./content-protocol.cjs')
const { getWindowedBounds, hasDisplayOverride, selectDisplay } = require('./display.cjs')
const { CHANNELS, createNavigationController, isTrustedSender } = require('./navigation.cjs')
const { loadExperienceRegistry, resolveExperiencePath } = require('./experience-registry.cjs')
const { createRuntimeEnvelope } = require('./runtime-config.cjs')
const { getRuntimeAdapter } = require('./runtime-adapters.cjs')
const { RETURN_CONTROL_CSS } = require('./return-control-styles.cjs')

protocol.registerSchemesAsPrivileged([{ scheme: APP_PROTOCOL_SCHEME, privileges: APP_PROTOCOL_PRIVILEGES }])

const windowed = process.argv.includes('--windowed')
// Stream media from ordinary files, not ASAR file handles.
const projectRoot = app.isPackaged ? path.join(process.resourcesPath, 'app-content') : path.resolve(__dirname, '..')
let experiences = null
let documents = null
let roots = null
let releaseWorkspaceLock = null
const isolatedUserData = process.env.QUANTUM_KIOSK_USER_DATA_DIR
if (isolatedUserData) {
  const root = path.resolve(isolatedUserData)
  for (const directory of [root, path.join(root, 'session'), path.join(root, 'logs'), path.join(root, 'crashDumps')]) {
    fs.mkdirSync(directory, { recursive: true })
  }
  app.setPath('userData', root)
  app.setPath('sessionData', path.join(root, 'session'))
  app.setPath('crashDumps', path.join(root, 'crashDumps'))
  app.setAppLogsPath(path.join(root, 'logs'))
}

app.commandLine.appendSwitch('disable-pinch')
app.commandLine.appendSwitch('overscroll-history-navigation', '0')

let mainWindow = null
let navigation = null
let quitting = false
let blocker = null
let displayTimer = null
let unresponsiveTimer = null
let recoveryTimer = null
let placementInFlight = false

function releaseWorkspace() {
  if (!releaseWorkspaceLock) return
  const release = releaseWorkspaceLock
  releaseWorkspaceLock = null
  release()
}

function startupFailed(error) {
  console.error(`[main] Startup failed: ${error.message}`)
  if (app.isPackaged) dialog.showErrorBox('Quantum Kiosk could not start', error.message)
  quitting = true
  releaseWorkspace()
  app.quit()
}

const windowUsable = () => mainWindow && !mainWindow.isDestroyed()
function clearTimer(name) {
  if (name === 'unresponsive') { clearTimeout(unresponsiveTimer); unresponsiveTimer = null }
  if (name === 'recovery') { clearTimeout(recoveryTimer); recoveryTimer = null }
  if (name === 'display') { clearTimeout(displayTimer); displayTimer = null }
}
function scheduleDisplayRefresh() {
  if (windowed || quitting) return
  clearTimer('display')
  displayTimer = setTimeout(() => { displayTimer = null; void refreshPlacement() }, 500)
}
async function refreshPlacement() {
  if (!windowUsable() || windowed || quitting) return
  if (placementInFlight) { scheduleDisplayRefresh(); return }
  placementInFlight = true
  try {
    const chosen = selectDisplay(screen.getAllDisplays(), screen.getPrimaryDisplay(), process.env)
    if (mainWindow.isKiosk()) mainWindow.setKiosk(false)
    if (mainWindow.isFullScreen()) mainWindow.setFullScreen(false)
    // Windows applies fullscreen transitions asynchronously; place only after exit settles.
    await new Promise(resolve => setTimeout(resolve, 500))
    if (!windowUsable() || quitting) return
    mainWindow.setBounds(chosen.bounds)
    mainWindow.setAlwaysOnTop(true, 'screen-saver')
    mainWindow.setKiosk(true)
    mainWindow.setFullScreen(true)
  } finally { placementInFlight = false }
}

function scheduleRecovery(message) {
  if (quitting || !windowUsable() || recoveryTimer !== null) return
  clearTimer('unresponsive')
  recoveryTimer = setTimeout(() => {
    recoveryTimer = null
    if (!quitting && windowUsable()) void navigation.recover(message)
  }, 1000)
}

function registerIpc() {
  for (const operation of ['getState', 'getExperiences', 'launchExperience', 'returnToLauncher']) {
    ipcMain.handle(CHANNELS[operation], (event, id) => {
      if (!isTrustedSender(event, mainWindow?.webContents, operation, documents)) throw new Error('This document cannot perform that operation.')
      if (operation === 'getExperiences') return experiences.map(({ id, label }) => ({ id, label }))
      if (operation === 'getState') return navigation.getState()
      if (operation === 'launchExperience') return navigation.launchExperience(id)
      return navigation.returnToLauncher()
    })
  }
}

function createWindow() {
  const primary = screen.getPrimaryDisplay()
  const display = windowed && !hasDisplayOverride(process.env) ? primary :
    selectDisplay(screen.getAllDisplays(), primary, process.env)
  const runtime = encodeURIComponent(JSON.stringify(createRuntimeEnvelope(projectRoot, experiences,
    { platform: process.platform, appVersion: app.getVersion(), windowed })))
  mainWindow = new BrowserWindow({
    ...(windowed ? getWindowedBounds(display) : display.bounds),
    frame: windowed, resizable: windowed, movable: windowed, minimizable: windowed, maximizable: windowed,
    fullscreenable: true, autoHideMenuBar: true, backgroundColor: '#fafaf8', show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), nodeIntegration: false,
      nodeIntegrationInSubFrames: false, contextIsolation: true, sandbox: true, webSecurity: true,
      allowRunningInsecureContent: false, webviewTag: false, navigateOnDragDrop: false,
      devTools: windowed, additionalArguments: [`--quantum-runtime=${runtime}`] }
  })
  mainWindow.setMenu(null)
  if (windowed) mainWindow.setAspectRatio(9 / 16)
  const contents = mainWindow.webContents
  navigation = createNavigationController({
    experienceIds: experiences.map(entry => entry.id),
    async checkDocument(document) {
      if (document === 'launcher') return // The protocol provides a safe fallback if launcher files are missing.
      try {
        const entry = await fsp.stat(path.join(roots[document], 'index.html'))
        if (!entry.isFile()) throw new Error('Missing entry document')
      } catch {
        const action = app.isPackaged ? 'Replace the executable with a freshly packaged copy, then try again.' :
          'Build that experience from the project root, then try again.'
        throw new Error(`${experiences.find(entry => entry.id === document).label} build unavailable. ${action}`)
      }
    },
    async loadDocument(document) {
      const url = createAppUrl(document, documents)
      await contents.loadURL(url)
      const adapter = getRuntimeAdapter(experiences.find(entry => entry.id === document)?.adapter)
      if (adapter.returnControl && !contents.isDestroyed() && contents.getURL() === url) {
        await contents.insertCSS(RETURN_CONTROL_CSS, { cssOrigin: 'user' })
      }
    }
  })
  navigation.onStateChanged(state => {
    if (windowUsable() && !contents.isDestroyed() && !contents.isCrashed()) contents.send(CHANNELS.stateChanged, state)
  })
  contents.setWindowOpenHandler(() => ({ action: 'deny' }))
  for (const eventName of ['will-navigate', 'will-frame-navigate', 'will-redirect', 'will-attach-webview']) {
    contents.on(eventName, event => event.preventDefault())
  }
  contents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return
    const key = input.key.toLowerCase()
    if (input.control && input.shift && key === 'q') {
      event.preventDefault()
      quitting = true
      app.quit()
    } else if (!windowed && (key === 'escape' || key === 'f11')) event.preventDefault()
  })
  contents.on('did-fail-load', (_event, code, _description, _url, isMainFrame) => {
    if (isMainFrame && code !== -3 && !navigation.getState().isLoading) {
      scheduleRecovery('The document could not be loaded. Try the experience again after checking its build.')
    }
  })
  contents.on('unresponsive', () => {
    if (unresponsiveTimer !== null) return
    unresponsiveTimer = setTimeout(() => {
      unresponsiveTimer = null
      if (!quitting && windowUsable()) {
        contents.forcefullyCrashRenderer()
        scheduleRecovery('The experience stopped responding. The welcome screen has been restored.')
      }
    }, 5000)
  })
  contents.on('responsive', () => clearTimer('unresponsive'))
  contents.on('render-process-gone', (_event, details) => {
    console.error(`[main] Renderer exited: ${details.reason}`)
    scheduleRecovery('The experience closed unexpectedly. The welcome screen has been restored; try again.')
  })
  mainWindow.once('ready-to-show', () => {
    if (!windowUsable()) return
    mainWindow.show()
    if (!windowed) void refreshPlacement()
  })
  mainWindow.on('leave-full-screen', () => { if (!placementInFlight) scheduleDisplayRefresh() })
  mainWindow.on('close', event => { if (!windowed && !quitting) event.preventDefault() })
  mainWindow.on('closed', () => {
    clearTimer('display'); clearTimer('unresponsive'); clearTimer('recovery')
    mainWindow = null
  })
  void navigation.start()
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!windowUsable()) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  })
  try {
    if (!app.isPackaged) {
      const { acquireWorkspaceLock } = require('../scripts/experience-import/workspace-lock.cjs')
      releaseWorkspaceLock = acquireWorkspaceLock(projectRoot, 'launcher')
    }
    experiences = loadExperienceRegistry(projectRoot)
    documents = Object.freeze(['launcher', ...experiences.map(entry => entry.id)])
    roots = Object.freeze({ launcher: path.join(projectRoot, 'launcher'),
      ...Object.fromEntries(experiences.map(entry => [entry.id, resolveExperiencePath(projectRoot, entry, 'dist')])) })
  } catch (error) {
    startupFailed(error)
  }
  if (!quitting) app.whenReady().then(() => {
    if (quitting) return
    Menu.setApplicationMenu(null)
    protocol.handle(APP_PROTOCOL_SCHEME, createAppProtocolHandler({ roots }))
    const appSession = session.defaultSession
    appSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
    appSession.setPermissionCheckHandler(() => false)
    appSession.on('will-download', event => event.preventDefault())
    appSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*', 'file://*/*', 'ftp://*/*'] },
      (_details, callback) => callback({ cancel: true }))
    blocker = powerSaveBlocker.start('prevent-display-sleep')
    registerIpc()
    screen.on('display-added', scheduleDisplayRefresh)
    screen.on('display-removed', scheduleDisplayRefresh)
    screen.on('display-metrics-changed', scheduleDisplayRefresh)
    createWindow()
    app.on('activate', () => { if (!quitting && !windowUsable()) createWindow() })
  }).catch(startupFailed)
}

app.on('before-quit', () => {
  quitting = true
  clearTimer('display'); clearTimer('unresponsive'); clearTimer('recovery')
  if (blocker !== null && powerSaveBlocker.isStarted(blocker)) powerSaveBlocker.stop(blocker)
})
app.on('will-quit', releaseWorkspace)
app.on('window-all-closed', () => app.quit())

module.exports = Object.freeze({
  getWindow: () => mainWindow,
  getNavigationState: () => navigation?.getState() ?? null
})
