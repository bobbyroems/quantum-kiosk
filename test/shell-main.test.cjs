'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { EventEmitter } = require('node:events')
const source = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.cjs'), 'utf8')
const flush = () => new Promise(resolve => setImmediate(resolve))
const laptop = { id: 1, label: 'Laptop', bounds: { x: 0, y: 0, width: 1920, height: 1080 } }
const elo = { id: 2, label: 'Elo Touch', bounds: { x: 1920, y: 0, width: 2160, height: 3840 }, touchSupport: 'available' }

const registryFixture = Object.freeze([
  Object.freeze({ id: 'magne', label: 'MAGNE', directory: 'experiences\\magne', defaultSource: '..\\magne-kiosk', importProfile: 'magne', adapter: 'magne', runtimeConfig: null }),
  Object.freeze({ id: 'iqm', label: 'IQM', directory: 'experiences\\iqm', defaultSource: '..\\makeshift-iqm-kiosk', importProfile: 'iqm', adapter: 'iqm', runtimeConfig: 'config\\kiosk.config.json' })
])

async function harness({ argv = [], env = {}, lock = true, registry = registryFixture,
  workspaceFailure = null, registryFailure = null, startupFailure = null } = {}) {
  const windows = []
  const paths = []
  const writes = []
  const handlers = new Map()
  const timers = new Set()
  const registrations = []
  const blockers = []
  const workspaceLocks = []
  let released = 0
  let hostedRoots
  const app = new EventEmitter()
  app.commandLine = { appendSwitch() {} }
  app.getVersion = () => '1.0.0'
  app.requestSingleInstanceLock = () => lock
  app.whenReady = async () => {}
  app.setPath = (name, value) => paths.push([name, value])
  app.setAppLogsPath = value => paths.push(['logs', value])
  app.quit = () => { app.quitCount = (app.quitCount || 0) + 1; app.emit('before-quit'); app.emit('will-quit') }
  const screen = new EventEmitter()
  screen.displays = [laptop, elo]
  screen.getPrimaryDisplay = () => laptop
  screen.getAllDisplays = () => screen.displays
  const appSession = new EventEmitter()
  appSession.setPermissionRequestHandler = callback => { appSession.permissionRequest = callback }
  appSession.setPermissionCheckHandler = callback => { appSession.permissionCheck = callback }
  appSession.webRequest = { onBeforeRequest: (_filter, callback) => { appSession.beforeRequest = callback } }
  class Window extends EventEmitter {
    constructor(options) {
      super()
      this.options = options
      this.fullscreen = false
      this.kiosk = false
      this.webContents = new EventEmitter()
      const contents = this.webContents
      contents.urls = []
      contents.styles = []
      contents.insertCSS = async (css, options) => { contents.styles.push({ css, options, url: contents.getURL() }); return 'style-key' }
      contents.mainFrame = { url: '' }
      contents.getURL = () => contents.mainFrame.url
      contents.isDestroyed = () => false
      contents.isCrashed = () => Boolean(contents.crashed)
      contents.sends = []
      contents.send = (channel, state) => contents.sends.push({ channel, state, crashed: Boolean(contents.crashed) })
      contents.loadURL = async url => { contents.urls.push(url); contents.mainFrame.url = url; contents.crashed = false }
      contents.setWindowOpenHandler = callback => { contents.openHandler = callback }
      contents.forcefullyCrashRenderer = () => { contents.crashed = true; contents.crashCount = (contents.crashCount || 0) + 1; contents.emit('render-process-gone', {}, { reason: 'crashed' }) }
      windows.push(this)
    }
    isDestroyed() { return false }
    isMinimized() { return false }
    restore() { this.restored = true }
    focus() { this.focused = true }
    setMenu(menu) { this.menu = menu }
    setAspectRatio(value) { this.ratio = value }
    show() { this.shown = true }
    isKiosk() { return this.kiosk }
    isFullScreen() { return this.fullscreen }
    setKiosk(value) { this.kiosk = value }
    setFullScreen(value) { this.fullscreen = value }
    setBounds(value) { this.bounds = value }
    setAlwaysOnTop(value) { this.top = value }
  }
  const electron = { app, BrowserWindow: Window, ipcMain: { handle: (channel, callback) => handlers.set(channel, callback) },
    Menu: { setApplicationMenu() {} }, screen, session: { defaultSession: appSession },
    protocol: { registerSchemesAsPrivileged: value => registrations.push(value), handle() { if (startupFailure) throw startupFailure } },
    powerSaveBlocker: { start: type => { blockers.push(type); return 1 }, isStarted: () => true, stop: id => blockers.push(id) } }
  const context = {
    module: { exports: {} },
    __dirname: path.join(__dirname, '..', 'electron'),
    process: { argv, env, platform: 'win32' },
    console: { error() {}, warn() {} },
    setTimeout: (callback, delay) => { const timer = { callback, delay }; timers.add(timer); return timer },
    clearTimeout: timer => timers.delete(timer),
    require: name => {
      if (name === 'electron') return electron
      if (name === '../scripts/experience-import/workspace-lock.cjs') return {
        acquireWorkspaceLock(root, kind) {
          workspaceLocks.push({ root, kind })
          if (workspaceFailure) throw workspaceFailure
          let active = true
          return () => { if (active) { active = false; released++ } }
        }
      }
      if (name === './experience-registry.cjs') return {
        ...require('../electron/experience-registry.cjs'),
        loadExperienceRegistry() { if (registryFailure) throw registryFailure; return registry }
      }
      if (name === './content-protocol.cjs') return {
        ...require('../electron/content-protocol.cjs'),
        createAppProtocolHandler(options) { hostedRoots = options.roots; return () => {} }
      }
      if (name === 'node:fs') return { mkdirSync: directory => writes.push(directory), readFileSync: () => '{"kiosk":{"idleReturnToHomeMs":120000}}' }
      if (name === 'node:fs/promises') return { stat: async () => ({ isFile: () => true }) }
      if (name.startsWith('./')) return require(path.join(__dirname, '..', 'electron', name))
      return require(name)
    }
  }
  vm.runInNewContext(source, context)
  await flush()
  async function runTimers(delay) {
    for (let attempt = 0; attempt < 10; attempt++) {
      const next = [...timers].find(timer => timer.delay === delay)
      if (!next) break
      timers.delete(next)
      next.callback()
      await flush()
    }
  }
  const ipc = (channel, ...args) => {
    const contents = windows[0].webContents
    return handlers.get(channel)({ sender: contents, senderFrame: contents.mainFrame }, ...args)
  }
  return { app, appSession, blockers, handlers, ipc, paths, registrations, runTimers, screen, timers, windows, writes,
    workspaceLocks, getReleased: () => released, hostedRoots }
}

test('main starts one sandboxed window and full-document switching never constructs inactive windows', async () => {
  const shell = await harness()
  assert.equal(shell.windows.length, 1)
  const window = shell.windows[0]
  assert.equal(window.options.frame, false)
  assert.equal(window.options.x, elo.bounds.x)
  assert.equal(window.options.webPreferences.sandbox, true)
  assert.equal(window.options.webPreferences.contextIsolation, true)
  assert.equal(window.options.webPreferences.nodeIntegration, false)
  assert.equal(window.options.webPreferences.webSecurity, true)
  assert.equal(window.options.webPreferences.devTools, false)
  assert.equal(window.menu, null)
  assert.deepEqual(window.webContents.urls, ['quantum-app://launcher/index.html'])
  const state = await shell.ipc('quantum:get-state')
  assert.equal(state.isLoading, false)
  await shell.ipc('quantum:launch-experience', 'iqm')
  assert.throws(() => shell.ipc('quantum:launch-experience', 'magne'), /cannot perform/)
  await shell.ipc('quantum:return-to-launcher')
  assert.equal(shell.windows.length, 1)
  assert.deepEqual(window.webContents.urls, ['quantum-app://launcher/index.html', 'quantum-app://iqm/index.html', 'quantum-app://launcher/index.html'])
  assert.deepEqual(shell.writes, [])
  assert.deepEqual(shell.paths, [])
  assert.equal(shell.registrations[0][0].scheme, 'quantum-app')
  assert.deepEqual(shell.blockers, ['prevent-display-sleep'])
})
test('return CSS is inserted only after a trusted adapted document loads, never into launcher or a stale successor', async () => {
  const shell = await harness()
  const contents = shell.windows[0].webContents
  assert.equal(contents.styles.length, 0)
  for (const id of ['magne', 'iqm']) {
    await shell.ipc('quantum:launch-experience', id)
    const style = contents.styles.at(-1)
    assert.equal(style.url, `quantum-app://${id}/index.html`)
    assert.equal(style.options.cssOrigin, 'user')
    assert.match(style.css, /\[data-quantum-return\]\[hidden\]/)
    await shell.ipc('quantum:return-to-launcher')
  }
  assert.equal(contents.styles.length, 2)
  contents.loadURL = async () => { contents.mainFrame.url = 'quantum-app://launcher/index.html' }
  await shell.ipc('quantum:launch-experience', 'magne')
  assert.equal(contents.styles.length, 2, 'Stale load callbacks must not insert CSS into a successor')
})
test('both return buttons share the reference outline, close icon, and stage-correct sizing', () => {
  const { RETURN_CONTROL_CSS: css } = require('../electron/return-control-styles.cjs')
  const rule = selector => css.slice(css.indexOf(`${selector} {`) + selector.length + 2).split('}')[0]
  const control = rule('[data-quantum-return]')
  assert.match(control, /--return-unit: clamp\(1px, 0\.1302083333vw, 2\.8125px\)/)
  assert.match(control, /top: calc\(12 \* var\(--return-unit\)\)/)
  assert.match(control, /right: calc\(36 \* var\(--return-unit\)\)/)
  const button = rule('[data-quantum-return] button')
  for (const declaration of ['min-height: calc(26 * var(--return-unit))',
    'border: calc(1 * var(--return-unit)) solid #ff5a36', 'border-radius: calc(3 * var(--return-unit))',
    'background: #fff', 'color: #ff5a36', 'font-weight: 400']) {
    assert.ok(button.includes(declaration), declaration)
  }
  assert.match(rule('[data-quantum-return] button::after'), /linear-gradient\(45deg/)
  assert.match(rule('[data-quantum-return] button::after'), /linear-gradient\(-45deg/)
  assert.match(rule('[data-quantum-return] button:focus-visible'), /outline:.*solid #0055d4/)
  assert.match(rule('[data-quantum-return="iqm"]'), /--return-unit: 2\.8125px/)
  assert.doesNotMatch(css, /\[data-quantum-return="(?:magne|iqm)"\] button/)
})
test('return styling failures restore the launcher rather than leave an unstyled experience control', async () => {
  const shell = await harness()
  const contents = shell.windows[0].webContents
  contents.insertCSS = async () => { throw new Error('Styles unavailable') }
  const result = await shell.ipc('quantum:launch-experience', 'magne')
  assert.equal(result.ok, false)
  assert.equal(result.state.document, 'launcher')
  assert.match(result.state.error, /Styles unavailable/)
})
test('navigation, new windows, downloads and external requests are blocked', async () => {
  const shell = await harness()
  const contents = shell.windows[0].webContents
  assert.equal(contents.openHandler({ url: 'https://example.com' }).action, 'deny')
  for (const eventName of ['will-navigate', 'will-frame-navigate', 'will-redirect', 'will-attach-webview']) {
    let prevented = false
    contents.emit(eventName, { preventDefault: () => { prevented = true } })
    assert.equal(prevented, true, eventName)
  }
  let permission
  shell.appSession.permissionRequest(null, 'media', value => { permission = value })
  assert.equal(permission, false)
  assert.equal(shell.appSession.permissionCheck(), false)
  let blocked
  shell.appSession.beforeRequest({ url: 'https://example.com' }, value => { blocked = value.cancel })
  assert.equal(blocked, true)
  let downloadPrevented = false
  shell.appSession.emit('will-download', { preventDefault: () => { downloadPrevented = true } })
  assert.equal(downloadPrevented, true)
})
test('kiosk guards accidental closing and Ctrl+Shift+Q intentionally quits while showing an experience', async () => {
  const shell = await harness()
  const window = shell.windows[0]
  let prevented = false
  window.emit('close', { preventDefault: () => { prevented = true } })
  assert.equal(prevented, true)
  await shell.ipc('quantum:launch-experience', 'magne')
  window.webContents.emit('before-input-event', { preventDefault() {} }, { type: 'keyDown', control: true, shift: false, key: 'Q' })
  assert.equal(shell.app.quitCount, undefined)
  window.webContents.emit('before-input-event', { preventDefault() {} }, { type: 'keyDown', control: true, shift: true, key: 'Q' })
  assert.equal(shell.app.quitCount, 1)
  assert.equal(shell.blockers.at(-1), 1)
  prevented = false
  window.emit('close', { preventDefault: () => { prevented = true } })
  assert.equal(prevented, false)
})
test('windowed mode uses the primary display, allows normal close, and exposes safe development runtime', async () => {
  const shell = await harness({ argv: ['electron', '.', '--windowed'] })
  const window = shell.windows[0]
  assert.equal(window.options.frame, true)
  assert.equal(window.options.resizable, true)
  assert.equal(window.options.webPreferences.devTools, true)
  window.emit('ready-to-show')
  assert.equal(window.shown, true)
  assert.equal(window.fullscreen, false)
  let prevented = false
  window.emit('close', { preventDefault: () => { prevented = true } })
  assert.equal(prevented, false)
  const argument = window.options.webPreferences.additionalArguments[0]
  const runtime = JSON.parse(decodeURIComponent(argument.slice('--quantum-runtime='.length)))
  assert.equal(runtime.isDevelopment, true)
  assert.equal(runtime.isKiosk, false)
  assert.equal(runtime.bridgeVersion, 1)
  assert.equal(runtime.documents.find(document => document.id === 'iqm').config.kiosk.idleReturnToHomeMs, 120000)
  assert.equal(runtime.documents.find(document => document.id === 'magne').cursorPolicy.hideClass, 'kiosk-mode')
  assert.deepEqual(runtime.documents.find(document => document.id === 'launcher').config, {})
})
test('fullscreen placement follows the selected display across hotplug and metric changes', async () => {
  const shell = await harness()
  const window = shell.windows[0]
  window.emit('ready-to-show')
  await shell.runTimers(500)
  assert.equal(window.fullscreen, true)
  assert.equal(window.kiosk, true)
  assert.equal(window.top, true)
  assert.equal(window.bounds, elo.bounds)
  shell.screen.displays = [laptop]
  shell.screen.emit('display-removed')
  await shell.runTimers(500)
  assert.equal(window.bounds, laptop.bounds)
  assert.equal(window.fullscreen, true)
  shell.screen.displays = [laptop, elo]
  shell.screen.emit('display-added')
  await shell.runTimers(500)
  assert.equal(window.bounds, elo.bounds)
})
test('renderer crash and unresponsive timeout restore launcher without restarting the main process', async () => {
  const shell = await harness()
  const contents = shell.windows[0].webContents
  await shell.ipc('quantum:launch-experience', 'iqm')
  contents.sends.length = 0
  contents.forcefullyCrashRenderer()
  await shell.runTimers(1000)
  assert.equal(contents.sends.length, 1)
  assert.equal(contents.sends[0].state.isLoading, false)
  assert.ok(contents.sends.every(message => !message.crashed))
  assert.equal((await shell.ipc('quantum:get-state')).document, 'launcher')
  assert.match((await shell.ipc('quantum:get-state')).error, /unexpectedly/)
  await shell.ipc('quantum:launch-experience', 'magne')
  contents.emit('unresponsive')
  await shell.runTimers(5000)
  await shell.runTimers(1000)
  assert.equal(contents.crashCount, 2)
  assert.equal(contents.isCrashed(), false)
  assert.ok(contents.sends.every(message => !message.crashed))
  assert.equal(contents.urls.at(-1), 'quantum-app://launcher/index.html')
  assert.equal(shell.windows.length, 1)
  assert.equal(shell.app.quitCount, undefined)
})
test('single-instance rejection creates no window or blocker; second-instance focuses the existing window', async () => {
  const rejected = await harness({ lock: false })
  assert.equal(rejected.windows.length, 0)
  assert.equal(rejected.blockers.length, 0)
  assert.equal(rejected.app.quitCount, 1)
  assert.deepEqual(rejected.workspaceLocks, [])
  const shell = await harness()
  shell.app.emit('second-instance')
  assert.equal(shell.windows[0].focused, true)
  assert.equal(shell.windows.length, 1)
})
test('optional user-data override contains all requested runtime output paths without real filesystem writes', async () => {
  const root = path.resolve(__dirname, 'runtime-not-written')
  const shell = await harness({ env: { QUANTUM_KIOSK_USER_DATA_DIR: root } })
  assert.deepEqual(shell.paths, [['userData', root], ['sessionData', path.join(root, 'session')],
    ['crashDumps', path.join(root, 'crashDumps')], ['logs', path.join(root, 'logs')]])
  assert.deepEqual(shell.writes, [root, path.join(root, 'session'), path.join(root, 'logs'), path.join(root, 'crashDumps')])
})
test('registry-driven hosting and launcher-only read-only list support additional experiences without paths or privileged config', async () => {
  const registry = [...registryFixture, { id: 'third', label: 'Third experience', directory: 'experiences\\nested\\third',
    defaultSource: '..\\third-source', importProfile: 'custom', adapter: null, runtimeConfig: null }]
  const shell = await harness({ registry })
  const list = await shell.ipc('quantum:get-experiences')
  assert.equal(list.length, 3)
  assert.equal(list[2].label, 'Third experience')
  assert.deepEqual(Object.keys(list[2]), ['id', 'label'])
  list[2].label = 'changed'
  assert.equal((await shell.ipc('quantum:get-experiences'))[2].label, 'Third experience')
  assert.equal(shell.hostedRoots.third, path.join(__dirname, '..', 'experiences', 'nested', 'third', 'dist'))
  await shell.ipc('quantum:launch-experience', 'third')
  assert.equal(shell.windows[0].webContents.urls.at(-1), 'quantum-app://third/index.html')
  assert.throws(() => shell.ipc('quantum:get-experiences'), /cannot perform/)
  await shell.ipc('quantum:return-to-launcher')
  assert.equal((await shell.ipc('quantum:get-state')).document, 'launcher')
})
test('workspace lifecycle lock is acquired only after Electron lock and released exactly once on normal quit', async () => {
  const shell = await harness()
  assert.equal(shell.workspaceLocks.length, 1)
  assert.equal(shell.workspaceLocks[0].kind, 'launcher')
  assert.equal(shell.getReleased(), 0)
  shell.app.quit()
  shell.app.emit('will-quit')
  assert.equal(shell.getReleased(), 1)
})
test('active import blocks startup and registry or asynchronous startup failures release acquired workspace locks', async () => {
  const blocked = await harness({ workspaceFailure: new Error('Import is active') })
  assert.equal(blocked.windows.length, 0)
  assert.equal(blocked.app.quitCount, 1)
  assert.equal(blocked.getReleased(), 0)
  for (const options of [{ registryFailure: new Error('Invalid registry') }, { startupFailure: new Error('Protocol registration failed') }]) {
    const shell = await harness(options)
    assert.equal(shell.windows.length, 0)
    assert.equal(shell.app.quitCount, 1)
    assert.equal(shell.getReleased(), 1)
  }
})
