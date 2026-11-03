'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const source = fs.readFileSync(path.join(__dirname, '..', 'electron', 'preload.cjs'), 'utf8')
const envelope = overrides => ({ bridgeVersion: 1, platform: 'win32', appVersion: '1.0.0',
  isDevelopment: true, isKiosk: false,
  documents: [{ id: 'launcher', config: {} }, { id: 'sample', config: { kiosk: { idleReturnToHomeMs: 120000 } } }], ...overrides })
function setup({ host = 'sample', runtime = envelope(), argv, mainFrame = true, location = {}, cursor = false, dom = {}, invoke } = {}) {
  const exposed = {}
  const calls = []
  const events = {}
  const classes = new Set(cursor ? ['kiosk-mode', 'normal-theme'] : [])
  const observers = []
  let subscribed
  const context = {
    process: { isMainFrame: mainFrame, platform: 'win32', argv: argv || [`--quantum-runtime=${encodeURIComponent(JSON.stringify(runtime))}`] },
    location: { protocol: 'quantum-app:', hostname: host, pathname: '/index.html', ...location },
    document: { readyState: 'loading', body: { classList: { contains: value => classes.has(value), add: value => classes.add(value), remove: value => classes.delete(value) } }, ...dom },
    window: {
      addEventListener(name, callback) { (events[name] ||= new Set()).add(callback) },
      removeEventListener(name, callback) { events[name]?.delete(callback) }
    },
    MutationObserver: class {
      constructor(callback) { this.callback = callback; observers.push(this) }
      observe(target, options) { this.target = target; this.options = options }
      disconnect() { this.disconnected = true }
    },
    require: name => {
      assert.equal(name, 'electron', 'A sandboxed preload must not require local filesystem modules')
      return { contextBridge: { exposeInMainWorld: (name, value) => { exposed[name] = value } },
        ipcRenderer: { invoke: async (...args) => { calls.push(args); return invoke ? invoke(...args) : { ok: true } },
          on: (_channel, callback) => { subscribed = callback }, removeListener: (_channel, callback) => assert.equal(callback, subscribed) } }
    }
  }
  vm.runInNewContext(source, context)
  return { context, exposed, calls, classes, observers, emit: name => { for (const callback of events[name] || []) callback() }, notify: (event, state) => subscribed(event, state) }
}

test('sandbox preload derives arbitrary registered document metadata and exposes immutable backward-compatible bridges only', async () => {
  for (const host of ['launcher', 'sample']) {
    const page = setup({ host })
    const { kiosk, launcher } = page.exposed
    assert.equal(kiosk.bridgeVersion, 1)
    assert.equal(launcher.bridgeVersion, 1)
    assert.equal(kiosk.platform, 'win32')
    assert.equal(kiosk.isKiosk, false)
    assert.equal(kiosk.isDevelopment, true)
    assert.ok(Object.isFrozen(kiosk) && Object.isFrozen(kiosk.config) && Object.isFrozen(kiosk.capabilities))
    assert.equal(kiosk.config.kiosk?.idleReturnToHomeMs, host === 'sample' ? 120000 : undefined)
    assert.equal(launcher.capabilities.experienceList, host === 'launcher')
    assert.equal(launcher.capabilities.returnToLauncher, host !== 'launcher')
    assert.equal(kiosk.capabilities.returnToLauncher, host !== 'launcher')
    assert.equal(kiosk.documents, undefined)
    assert.equal(kiosk.directory, undefined)
    await launcher.getState()
    await launcher.getExperiences()
    await launcher.launchExperience('sample')
    await launcher.returnToLauncher()
    assert.deepEqual(page.calls.map(call => call[0]), ['quantum:get-state', 'quantum:get-experiences', 'quantum:launch-experience', 'quantum:return-to-launcher'])
    let received
    const unsubscribe = launcher.onStateChanged(state => { received = state })
    const state = { document: 'launcher' }
    page.notify({ secret: 'Electron event' }, state)
    assert.equal(received, state)
    assert.ok(Object.isFrozen(received))
    unsubscribe()
  }
})
test('invalid/missing envelopes, duplicate hosts, unsupported versions and non-main documents default-deny all bridge exposure', () => {
  const cases = [
    { argv: [] }, { argv: ['--quantum-runtime=invalid'] },
    { argv: ['--quantum-runtime=%', '--quantum-runtime=%'] },
    { runtime: null }, { runtime: {} }, { runtime: envelope({ bridgeVersion: 2 }) },
    { runtime: envelope({ isKiosk: true }) }, { runtime: envelope({ platform: {} }) },
    { runtime: envelope({ documents: [{ id: 'sample', config: {} }] }) },
    { runtime: envelope({ documents: [{ id: 'launcher', config: {} }, { id: 'launcher', config: {} }] }) },
    { runtime: envelope({ documents: [{ id: 'launcher', config: {} }, { id: '../sample', config: {} }] }) },
    { runtime: envelope({ documents: [{ id: 'launcher', config: {} }, { id: 'sample', config: null }] }) },
    { runtime: envelope({ documents: [{ id: 'launcher', config: {} }, { id: 'sample', config: {}, cursorPolicy: { hideClass: 'unsafe class' } }] }) },
    { host: 'unregistered' }, { mainFrame: false }, { location: { protocol: 'https:' } },
    { location: { pathname: '/asset.html' } }, { location: { username: 'user' } }, { location: { port: '443' } }
  ]
  for (const options of cases) assert.deepEqual(setup(options).exposed, {}, JSON.stringify(options))
})
test('launcher-owned MAGNE cursor adaptation changes only hiding class after load, without dev or idle mutations', () => {
  const runtime = envelope({ documents: [{ id: 'launcher', config: {} },
    { id: 'sample', config: {}, cursorPolicy: { hideClass: 'kiosk-mode' } }] })
  const page = setup({ runtime, cursor: true })
  assert.ok(page.classes.has('kiosk-mode'), 'The policy is applied after the page has loaded')
  page.emit('load')
  assert.deepEqual([...page.classes], ['normal-theme'])
  assert.equal(page.context.location.search, undefined)
  assert.equal(page.observers.length, 1)
  page.classes.add('kiosk-mode')
  page.observers[0].callback()
  assert.deepEqual([...page.classes], ['normal-theme'])
  page.emit('pagehide')
  assert.equal(page.observers[0].disconnected, true)
  page.classes.add('kiosk-mode')
  page.observers[0].callback()
  page.emit('load')
  assert.ok(page.classes.has('kiosk-mode'), 'Disposed callbacks cannot change a successor')
  assert.equal(page.observers.length, 1)
})
test('production cursor adaptation remains hidden and a stale document cannot affect a replacement', () => {
  const runtime = envelope({ isDevelopment: false, isKiosk: true, documents: [{ id: 'launcher', config: {} },
    { id: 'sample', config: {}, cursorPolicy: { hideClass: 'kiosk-mode' } }] })
  const page = setup({ runtime })
  page.emit('load')
  assert.ok(page.classes.has('kiosk-mode'))
  page.classes.delete('kiosk-mode')
  page.observers[0].callback()
  assert.ok(page.classes.has('kiosk-mode'))
  page.classes.delete('kiosk-mode')
  page.context.document = { body: {} }
  page.observers[0].callback()
  assert.equal(page.classes.has('kiosk-mode'), false)
  const unadapted = setup({ cursor: true })
  unadapted.emit('load')
  assert.ok(unadapted.classes.has('kiosk-mode'))
})

function returnFixture(theme, options = {}) {
  const { getRuntimeAdapter } = require('../electron/runtime-adapters.cjs')
  const adapter = getRuntimeAdapter(theme)
  const panelClasses = new Set([adapter.returnControl.activeClass])
  function element(tag) {
    const attributes = new Map()
    const listeners = new Map()
    return {
      tag, children: [], style: {}, isConnected: true, hidden: false,
      setAttribute: (name, value) => attributes.set(name, value),
      getAttribute: name => attributes.get(name) ?? null,
      removeAttribute: name => attributes.delete(name),
      append(...children) { this.children.push(...children); for (const child of children) child.parent = this },
      remove() { this.isConnected = false; this.parent.children = this.parent.children.filter(child => child !== this) },
      addEventListener: (name, callback) => listeners.set(name, callback),
      removeEventListener: (name, callback) => { if (listeners.get(name) === callback) listeners.delete(name) },
      click() { return listeners.get('click')?.({ preventDefault() {}, stopPropagation() {} }) },
      blur() { this.blurred = true }
    }
  }
  const panel = element('section')
  panel.classList = { contains: name => panelClasses.has(name) }
  const dom = { querySelector: selector => selector === adapter.returnControl.selector ? panel : null,
    createElement: element, ...options.dom }
  const runtime = envelope({ documents: [{ id: 'launcher', config: {} }, { id: 'sample', config: {}, ...adapter }] })
  const page = setup({ runtime, cursor: true, ...options, dom })
  return { ...page, panel, panelClasses,
    get control() { return panel.children[0] }, get button() { return panel.children[0]?.children[0] },
    get status() { return panel.children[0]?.children[1] },
    sync() { for (const observer of page.observers) if (observer.target === panel) observer.callback() } }
}

for (const theme of ['magne', 'iqm']) {
  test(`${theme} return control mounts once in the welcome panel and hides/disables/blurs outside welcome`, () => {
    const page = returnFixture(theme)
    assert.equal(page.control, undefined)
    page.emit('load')
    page.emit('load')
    assert.equal(page.panel.children.length, 1)
    assert.equal(page.control.getAttribute('data-quantum-return'), theme)
    assert.equal(page.button.type, 'button')
    assert.equal(page.button.textContent, 'Exit to main menu')
    assert.equal(page.control.hidden, false)
    assert.equal(page.button.disabled, false)
    assert.equal(page.button.tabIndex, 0)
    assert.equal(page.status.getAttribute('role'), 'alert')
    assert.equal(page.status.hidden, true)
    assert.equal(page.exposed.launcher.capabilities.returnToLauncher, true)
    if (theme === 'magne') assert.equal(page.classes.has('kiosk-mode'), false)
    const activeClass = theme === 'magne' ? 'active' : 'is-active'
    page.context.document.activeElement = page.button
    page.panelClasses.delete(activeClass)
    page.sync()
    assert.equal(page.control.hidden, true)
    assert.equal(page.button.disabled, true)
    assert.equal(page.button.tabIndex, -1)
    assert.equal(page.button.blurred, true)
    page.button.click()
    assert.equal(page.calls.length, 0)
    page.panelClasses.add(activeClass)
    page.sync()
    assert.equal(page.button.disabled, false)
    page.panel.style.pointerEvents = 'none'
    page.sync()
    assert.equal(page.control.hidden, true, 'Transitioning welcome screens must not remain tappable')
    page.panel.style.pointerEvents = ''
    page.panelClasses.add('is-leaving')
    page.sync()
    assert.equal(page.control.hidden, true)
    page.panelClasses.delete('is-leaving')
    page.panel.setAttribute('aria-hidden', 'true')
    page.sync()
    assert.equal(page.control.hidden, true)
  })
}

test('return activation uses authenticated IPC once, remains busy until document unload, and disposes both adapters', async () => {
  let resolve
  const pending = new Promise(done => { resolve = done })
  const page = returnFixture('magne', { invoke: () => pending })
  page.emit('load')
  const button = page.button
  const activation = button.click()
  await button.click()
  await button.click()
  assert.deepEqual(page.calls, [['quantum:return-to-launcher']])
  assert.equal(button.disabled, true)
  assert.equal(button.getAttribute('aria-busy'), 'true')
  assert.equal(button.textContent, 'Returning…')
  resolve({ ok: true })
  await activation
  assert.equal(button.disabled, true, 'Successful navigation replaces this document; do not re-enable it')
  page.emit('pagehide')
  assert.equal(page.panel.children.length, 0)
  assert.ok(page.observers.every(observer => observer.disconnected))
  await button.click()
  page.emit('load')
  for (const observer of page.observers) observer.callback()
  assert.equal(page.panel.children.length, 0)
  assert.equal(page.calls.length, 1)
})

test('failed/rejected return shows accessible feedback and permits a single retry', async () => {
  for (const failure of ['rejected', 'not-ok']) {
    let attempts = 0
    const page = returnFixture('iqm', { invoke: () => {
      attempts++
      if (attempts > 1) return { ok: true }
      if (failure === 'rejected') throw new Error('Internal IPC failure')
      return { ok: false }
    } })
    page.emit('load')
    await page.button.click()
    assert.equal(page.button.disabled, false)
    assert.equal(page.button.getAttribute('aria-busy'), null)
    assert.equal(page.button.textContent, 'Exit to main menu')
    assert.equal(page.status.hidden, false)
    assert.equal(page.status.textContent, 'Could not return. Please try again.')
    await page.button.click()
    assert.equal(page.calls.length, 2)
    assert.equal(page.status.hidden, true)
    assert.equal(page.button.disabled, true)
  }
})

test('pending return failure and stale load/observer callbacks never modify a successor document', async () => {
  let reject
  const page = returnFixture('iqm', { invoke: () => new Promise((_resolve, fail) => { reject = fail }) })
  page.emit('load')
  const button = page.button
  const status = page.status
  const activation = button.click()
  page.emit('pagehide')
  page.context.document = { body: {} }
  reject(new Error('Previous document unloaded'))
  await activation
  assert.equal(status.hidden, true)
  assert.equal(button.textContent, 'Returning…')
  page.sync()
  page.emit('load')
  assert.equal(page.panel.children.length, 0)
  const stale = returnFixture('iqm')
  stale.context.location.hostname = 'launcher'
  stale.emit('load')
  assert.equal(stale.panel.children.length, 0)
})

test('return adapters default-deny malformed metadata and never appear in standalone, subframe or launcher documents', () => {
  for (const options of [{ location: { protocol: 'file:' } }, { location: { protocol: 'http:' } },
    { mainFrame: false }, { host: 'unregistered' }, { host: 'launcher' }]) {
    const page = returnFixture('iqm', options)
    page.emit('load')
    assert.equal(page.panel.children.length, 0)
  }
  const valid = require('../electron/runtime-adapters.cjs').getRuntimeAdapter('iqm').returnControl
  for (const returnControl of [null, {}, { ...valid, selector: 'body' }, { ...valid, activeClass: 'a b' }, { ...valid, theme: 'unknown' },
    { ...valid, selector: '#attract-screen' }, { ...valid, activeClass: 'active' }]) {
    const runtime = envelope({ documents: [{ id: 'launcher', config: {} }, { id: 'sample', config: {}, returnControl }] })
    assert.deepEqual(setup({ runtime }).exposed, {})
  }
  const runtime = envelope({ documents: [{ id: 'launcher', config: {}, returnControl: valid }, { id: 'sample', config: {} }] })
  assert.deepEqual(setup({ runtime }).exposed, {})
  const missing = returnFixture('iqm', { dom: { querySelector: () => null } })
  missing.emit('load')
  assert.equal(missing.panel.children.length, 0)
  const complete = returnFixture('iqm', { dom: { readyState: 'complete' } })
  assert.equal(complete.panel.children.length, 1)
})
