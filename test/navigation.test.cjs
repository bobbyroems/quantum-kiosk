'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { createNavigationController, documentForUrl, isTrustedSender } = require('../electron/navigation.cjs')
const deferred = () => { let resolve; let reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }

test('initial state is ready and navigation only loads the selected full document', async () => {
  const loaded = []
  const navigation = createNavigationController({ loadDocument: async document => loaded.push(document) })
  assert.deepEqual(navigation.getState(), { document: 'launcher', isLoading: false, experienceId: null, error: null })
  assert.equal((await navigation.start()).ok, true)
  assert.equal((await navigation.launchExperience('magne')).ok, true)
  assert.deepEqual(navigation.getState(), { document: 'magne', isLoading: false, experienceId: 'magne', error: null })
  assert.equal((await navigation.returnToLauncher()).ok, true)
  assert.equal((await navigation.launchExperience('iqm')).ok, true)
  assert.deepEqual(loaded, ['launcher', 'magne', 'launcher', 'iqm'])
})
test('unknown IDs, paths, and launches from an experience are refused', async () => {
  const loaded = []
  const navigation = createNavigationController({ loadDocument: async document => loaded.push(document) })
  for (const id of ['IQM', '../iqm', 'https://example.com', '__proto__', {}, null]) {
    assert.equal((await navigation.launchExperience(id)).ok, false)
  }
  assert.equal(loaded.length, 0)
  await navigation.launchExperience('magne')
  assert.equal((await navigation.launchExperience('iqm')).ok, false)
  assert.deepEqual(loaded, ['magne'])
})
test('duplicate launches and returns are refused while loading without corrupting state', async () => {
  const pending = deferred()
  const loaded = []
  const navigation = createNavigationController({ loadDocument: document => { loaded.push(document); return pending.promise } })
  const launch = navigation.launchExperience('iqm')
  assert.equal(navigation.getState().isLoading, true)
  assert.equal((await navigation.launchExperience('magne')).ok, false)
  assert.equal((await navigation.returnToLauncher()).ok, false)
  pending.resolve()
  assert.equal((await launch).ok, true)
  assert.deepEqual(loaded, ['iqm'])
})
test('missing builds and failed document loads restore launcher with a plain error', async () => {
  for (const failDuringCheck of [true, false]) {
    const loaded = []
    const failure = new Error('Build unavailable\u0000; build the experience and retry.')
    const navigation = createNavigationController({
      checkDocument: async document => { if (document === 'iqm' && failDuringCheck) throw failure },
      loadDocument: async document => { loaded.push(document); if (document === 'iqm') throw failure }
    })
    const response = await navigation.launchExperience('iqm')
    assert.equal(response.ok, false)
    assert.equal(response.state.document, 'launcher')
    assert.equal(response.state.isLoading, false)
    assert.equal(response.state.experienceId, null)
    assert.equal(response.state.error, 'Build unavailable ; build the experience and retry.')
    assert.equal(loaded.at(-1), 'launcher')
  }
})
test('crash recovery supersedes a pending load; its late completion cannot overwrite launcher', async () => {
  const pending = deferred()
  const loaded = []
  const navigation = createNavigationController({ loadDocument: document => { loaded.push(document); return document === 'magne' ? pending.promise : Promise.resolve() } })
  const launch = navigation.launchExperience('magne')
  await Promise.resolve()
  await navigation.recover('Renderer crashed. Try again.')
  pending.resolve()
  assert.equal((await launch).ok, false)
  assert.deepEqual(loaded, ['magne', 'launcher'])
  assert.deepEqual(navigation.getState(), { document: 'launcher', isLoading: false, experienceId: null, error: 'Renderer crashed. Try again.' })
})
test('state subscribers unsubscribe, cannot mutate internal state, and cannot disrupt loading', async () => {
  const navigation = createNavigationController({ loadDocument: async () => {} })
  const states = []
  const unsubscribe = navigation.onStateChanged(state => { states.push(state); state.document = 'iqm' })
  navigation.onStateChanged(() => { throw new Error('subscriber error') })
  await navigation.launchExperience('magne')
  assert.equal(navigation.getState().document, 'magne')
  const count = states.length
  unsubscribe()
  await navigation.returnToLauncher()
  assert.equal(states.length, count)
})
test('IPC requires the owning main frame, exact document host, and launcher-only launch capability', () => {
  const frame = { url: 'quantum-app://launcher/index.html' }
  const contents = { mainFrame: frame, getURL: () => frame.url, isDestroyed: () => false }
  const event = { sender: contents, senderFrame: frame }
  assert.equal(isTrustedSender(event, contents, 'launchExperience'), true)
  assert.equal(isTrustedSender(event, contents, 'getExperiences'), true)
  assert.equal(isTrustedSender(event, contents, 'returnToLauncher'), true)
  assert.equal(isTrustedSender({ ...event, senderFrame: { url: frame.url } }, contents, 'getState'), false)
  assert.equal(isTrustedSender({ ...event, sender: {} }, contents, 'getState'), false)
  frame.url = 'quantum-app://iqm/index.html'
  assert.equal(isTrustedSender(event, contents, 'launchExperience'), false)
  assert.equal(isTrustedSender(event, contents, 'getExperiences'), false)
  assert.equal(isTrustedSender(event, contents, 'returnToLauncher'), true)
  for (const url of ['https://launcher/index.html', 'quantum-app://other/index.html', 'quantum-app://iqm/asset.html', 'quantum-app://iqm:443/index.html', 'quantum-app://user@iqm/index.html', 'data:text/html,test']) {
    assert.equal(documentForUrl(url), null)
    frame.url = url
    assert.equal(isTrustedSender(event, contents, 'getState'), false)
  }
  assert.equal(documentForUrl('quantum-app://magne/index.html?mode=1#home'), 'magne')
})
test('sandbox-compatible preload supplies immutable runtime before page code and never exposes IPC events', async () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'electron', 'preload.cjs'), 'utf8')
  for (const host of ['launcher', 'iqm', 'external']) {
    const exposed = {}
    const calls = []
    let subscribed
    const runtime = { bridgeVersion: 1, platform: 'win32', appVersion: '1.0.0', isDevelopment: false, isKiosk: true,
      documents: [{ id: 'launcher', config: {} }, { id: 'iqm', config: { kiosk: { idleReturnToHomeMs: 120000 } } }] }
    const context = {
      process: { isMainFrame: true, platform: 'win32', argv: [`--quantum-runtime=${encodeURIComponent(JSON.stringify(runtime))}`] },
      location: { protocol: 'quantum-app:', hostname: host, pathname: '/index.html' },
      require: name => {
        assert.equal(name, 'electron')
        return { contextBridge: { exposeInMainWorld: (name, value) => { exposed[name] = value } },
          ipcRenderer: { invoke: async (...args) => { calls.push(args); return { ok: true } },
            on: (_channel, callback) => { subscribed = callback }, removeListener: (_channel, callback) => assert.equal(callback, subscribed) } }
      }
    }
    vm.runInNewContext(source, context)
    if (host === 'external') { assert.deepEqual(exposed, {}); continue }
    assert.equal(exposed.kiosk.isKiosk, true)
    assert.equal(Object.isFrozen(exposed.kiosk), true)
    assert.equal(Object.isFrozen(exposed.kiosk.config), true)
    assert.equal(exposed.kiosk.config.kiosk?.idleReturnToHomeMs, host === 'iqm' ? 120000 : undefined)
    await exposed.launcher.getState()
    await exposed.launcher.launchExperience('magne')
    await exposed.launcher.returnToLauncher()
    assert.deepEqual(calls.map(call => call[0]), ['quantum:get-state', 'quantum:launch-experience', 'quantum:return-to-launcher'])
    let received
    const unsubscribe = exposed.launcher.onStateChanged(state => { received = state })
    const state = { document: 'launcher' }
    subscribed({ secret: 'Electron event' }, state)
    assert.equal(received, state)
    unsubscribe()
  }
})
test('explicit registry IDs drive navigation and authentication without a fixed experience allowlist', async () => {
  const loaded = []
  const navigation = createNavigationController({ experienceIds: ['custom'], loadDocument: async document => loaded.push(document) })
  assert.equal((await navigation.launchExperience('iqm')).ok, false)
  assert.equal((await navigation.launchExperience('custom')).ok, true)
  await navigation.returnToLauncher()
  assert.deepEqual(loaded, ['custom', 'launcher'])
  const frame = { url: 'quantum-app://custom/index.html' }
  const contents = { mainFrame: frame, getURL: () => frame.url, isDestroyed: () => false }
  const event = { sender: contents, senderFrame: frame }
  const documents = ['launcher', 'custom']
  assert.equal(documentForUrl(frame.url, documents), 'custom')
  assert.equal(isTrustedSender(event, contents, 'getState', documents), true)
  assert.equal(isTrustedSender(event, contents, 'launchExperience', documents), false)
  assert.equal(isTrustedSender(event, contents, 'getExperiences', documents), false)
  frame.url = 'quantum-app://iqm/index.html'
  assert.equal(isTrustedSender(event, contents, 'getState', documents), false)
})
