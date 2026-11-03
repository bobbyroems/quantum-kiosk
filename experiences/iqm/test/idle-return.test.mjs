import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

class MemoryStorage {
  constructor() {
    this.values = new Map()
  }

  getItem(key) {
    return this.values.has(key) ? this.values.get(key) : null
  }

  setItem(key, value) {
    this.values.set(key, String(value))
  }

  clear() {
    this.values.clear()
  }
}

const listeners = new Map()
const scheduled = new Map()
let nextTimerId = 1

globalThis.window = {
  kiosk: {},
  localStorage: new MemoryStorage(),
  addEventListener(type, listener) {
    if (!listeners.has(type)) listeners.set(type, new Set())
    listeners.get(type).add(listener)
  },
  removeEventListener(type, listener) {
    listeners.get(type)?.delete(listener)
  },
  setTimeout(callback, timeoutMs) {
    const id = nextTimerId++
    scheduled.set(id, { callback, timeoutMs })
    return id
  },
  clearTimeout(id) {
    scheduled.delete(id)
  },
  matchMedia: () => ({ matches: false })
}

const {
  configureIdleTimeouts,
  formatIdleTimeout,
  getIdleTimeouts,
  IDLE_TIMEOUT_LIMITS,
  setIdleTimeout
} = await import('../src/js/core/idle-timeouts.js')
const { IdleController } = await import('../src/js/core/idle-controller.js')
const {
  armIdleController,
  rearmIdleController,
  routeIdle
} = await import('../src/js/core/idle-navigation.js')
const {
  areUpNextCardsEnabled,
  createKioskSettings,
  setUpNextCardsEnabled
} = await import('../src/js/core/kiosk-settings.js')
const { bindUpNextPopupPreference } = await import('../src/js/modules/module-outro.js')
const { isPlayable, MODULES } = await import('../src/js/modules/module-registry.js')

test.beforeEach(() => {
  window.localStorage = new MemoryStorage()
  listeners.clear()
  scheduled.clear()
  configureIdleTimeouts({ returnToMenuMs: 120000, returnToHomeMs: 180000 })
})

test('configured defaults are returned when storage is empty', () => {
  assert.deepEqual(getIdleTimeouts(), {
    returnToMenuMs: 120000,
    returnToHomeMs: 180000
  })
})

test('valid stored values override defaults independently', () => {
  window.localStorage.setItem('kiosk-idle-return-to-menu-ms', '30000')
  window.localStorage.setItem('kiosk-idle-return-to-home-ms', '240000')
  assert.deepEqual(getIdleTimeouts(), {
    returnToMenuMs: 30000,
    returnToHomeMs: 240000
  })
})

test('empty, malformed, infinite and out-of-range stored values are rejected', () => {
  for (const invalid of ['', 'nope', 'Infinity', '9999', '600001']) {
    window.localStorage.setItem('kiosk-idle-return-to-menu-ms', invalid)
    assert.equal(getIdleTimeouts().returnToMenuMs, 120000, invalid)
  }
})

test('setIdleTimeout clamps both ends and ignores invalid keys and values', () => {
  assert.equal(setIdleTimeout('returnToMenuMs', 1), IDLE_TIMEOUT_LIMITS.minMs)
  assert.equal(getIdleTimeouts().returnToMenuMs, IDLE_TIMEOUT_LIMITS.minMs)
  assert.equal(setIdleTimeout('returnToHomeMs', 900000), IDLE_TIMEOUT_LIMITS.maxMs)
  assert.equal(getIdleTimeouts().returnToHomeMs, IDLE_TIMEOUT_LIMITS.maxMs)
  assert.equal(setIdleTimeout('unknown', 30000), null)
  assert.equal(setIdleTimeout('returnToMenuMs', Number.NaN), null)
})

test('storage failures preserve defaults and do not break updates', () => {
  window.localStorage = {
    getItem() { throw new Error('blocked') },
    setItem() { throw new Error('blocked') }
  }
  assert.deepEqual(getIdleTimeouts(), {
    returnToMenuMs: 120000,
    returnToHomeMs: 180000
  })
  assert.equal(setIdleTimeout('returnToMenuMs', 45000), 45000)
  assert.equal(getIdleTimeouts().returnToMenuMs, 45000)
})

test('formatIdleTimeout covers seconds, whole minutes and mixed values', () => {
  assert.equal(formatIdleTimeout(45000), '45 s')
  assert.equal(formatIdleTimeout(120000), '2 min')
  assert.equal(formatIdleTimeout(150000), '2 min 30 s')
  assert.equal(formatIdleTimeout(600000), '10 min')
})

test('IdleController rearms an enabled controller without duplicating listeners', () => {
  let idleCalls = 0
  const controller = new IdleController({ timeoutMs: 120000, onIdle: () => idleCalls++ })

  controller.start()
  assert.equal(listeners.get('pointerdown').size, 1)
  assert.equal(listeners.get('keydown').size, 1)
  assert.deepEqual([...scheduled.values()].map(timer => timer.timeoutMs), [120000])

  controller.start(30000)
  assert.equal(listeners.get('pointerdown').size, 1)
  assert.equal(listeners.get('keydown').size, 1)
  assert.deepEqual([...scheduled.values()].map(timer => timer.timeoutMs), [30000])

  const [{ callback }] = scheduled.values()
  callback()
  assert.equal(idleCalls, 1)
})

test('IdleController activity resets the active timeout and stop detaches activity', () => {
  const controller = new IdleController({ timeoutMs: 40000 })
  controller.start()
  const firstTimer = controller.timer
  listeners.get('pointerdown').values().next().value()
  assert.notEqual(controller.timer, firstTimer)
  assert.equal(scheduled.has(firstTimer), false)

  controller.stop()
  assert.equal(controller.enabled, false)
  assert.equal(controller.timer, null)
  assert.equal(listeners.get('pointerdown').size, 0)
  assert.equal(listeners.get('keydown').size, 0)
  assert.equal(scheduled.size, 0)
})

function fakeElement({ valueAsNumber = 0 } = {}) {
  const elementListeners = new Map()
  return {
    dataset: {},
    hidden: false,
    offsetWidth: 100,
    valueAsNumber,
    addEventListener(type, listener) { elementListeners.set(type, listener) },
    setAttribute(name, value) { this[name] = value },
    fire(type) { elementListeners.get(type)?.({ target: this }) }
  }
}

test('settings bind both sliders in seconds, update readouts and notify the app', () => {
  configureIdleTimeouts({ returnToMenuMs: 600000, returnToHomeMs: 120000 })
  const elements = {
    'kiosk-settings': { ...fakeElement(), contains: () => false },
    'kiosk-settings-launcher': fakeElement(),
    'kiosk-settings-panel': fakeElement(),
    'idle-menu-slider': fakeElement({ valueAsNumber: 600 }),
    'idle-menu-readout': fakeElement(),
    'idle-home-slider': fakeElement({ valueAsNumber: 120 }),
    'idle-home-readout': fakeElement()
  }
  const root = {
    getElementById: id => elements[id] ?? null,
    addEventListener() {}
  }
  let changes = 0
  createKioskSettings({ root, onIdleTimeoutChange: () => changes++ })

  assert.deepEqual(
    [elements['idle-menu-slider'].min, elements['idle-menu-slider'].max, elements['idle-menu-slider'].step],
    ['10', '600', '10']
  )
  assert.equal(elements['idle-menu-readout'].textContent, '10 min')
  assert.equal(elements['idle-home-readout'].textContent, '2 min')

  elements['idle-menu-slider'].valueAsNumber = 90
  elements['idle-menu-slider'].fire('input')
  assert.equal(elements['idle-menu-readout'].textContent, '1 min 30 s')
  assert.equal(getIdleTimeouts().returnToMenuMs, 90000)
  assert.equal(changes, 1)
})

test('idle navigation arms the active tier and only rearms enabled timers', () => {
  configureIdleTimeouts({ returnToMenuMs: 30000, returnToHomeMs: 70000 })
  const starts = []
  const idleController = { enabled: true, start: timeoutMs => starts.push(timeoutMs) }

  armIdleController(idleController, 'nanoscale')
  armIdleController(idleController, null)
  rearmIdleController(idleController, null)
  idleController.enabled = false
  rearmIdleController(idleController, 'nanoscale')
  assert.deepEqual(starts, [30000, 70000, 70000])
})

test('idle navigation routes a module to menu and menu to home', () => {
  configureIdleTimeouts({ returnToMenuMs: 30000, returnToHomeMs: 70000 })
  const destinations = []
  const common = {
    goHome: () => destinations.push('home'),
    idleController: { reset: () => destinations.push('reset') },
    isOpeningExperience: false,
    openMenu: () => destinations.push('menu')
  }

  assert.equal(routeIdle({ ...common, activeModuleId: 'nanoscale' }), 'menu')
  assert.equal(routeIdle({ ...common, activeModuleId: null }), 'home')
  assert.deepEqual(destinations, ['menu', 'home'])
})

test('idle navigation keeps the active tier alive while an experience is opening', () => {
  const destinations = []
  const result = routeIdle({
    activeModuleId: 'build-majorana-2',
    isOpeningExperience: true,
    idleController: { reset: () => destinations.push('reset') },
    openMenu: () => destinations.push('menu'),
    goHome: () => destinations.push('home')
  })
  assert.equal(result, 'reset')
  assert.deepEqual(destinations, ['reset'])
})

test('runtime config and settings markup expose both idle-return stages', async () => {
  const config = JSON.parse(await readFile(new URL('../config/kiosk.config.json', import.meta.url)))
  for (const mode of ['development', 'kiosk']) {
    assert.equal(Number.isFinite(config[mode].idleReturnToMenuMs), true)
    assert.equal(Number.isFinite(config[mode].idleReturnToHomeMs), true)
    assert.equal('idleTimeoutMs' in config[mode], false)
  }
  assert.deepEqual(
    [config.development.idleReturnToMenuMs, config.development.idleReturnToHomeMs],
    [600000, 600000]
  )
  assert.deepEqual(
    [config.kiosk.idleReturnToMenuMs, config.kiosk.idleReturnToHomeMs],
    [120000, 120000]
  )

  const markup = await readFile(new URL('../src/index.html', import.meta.url), 'utf8')
  for (const id of [
    'idle-menu-slider',
    'idle-menu-readout',
    'idle-home-slider',
    'idle-home-readout'
  ]) assert.match(markup, new RegExp(`id="${id}"`))
})

test('turning off up-next cards cancels pending or visible shared popups', () => {
  setUpNextCardsEnabled(true)
  let withdraws = 0
  const unbind = bindUpNextPopupPreference({ withdraw: () => withdraws++ })

  setUpNextCardsEnabled(false)
  assert.equal(areUpNextCardsEnabled(), false)
  assert.equal(withdraws, 1)

  setUpNextCardsEnabled(true)
  assert.equal(withdraws, 1)
  unbind()
  setUpNextCardsEnabled(false)
  assert.equal(withdraws, 1)
  setUpNextCardsEnabled(true)
})

test('every playable module uses the shared outro that applies the up-next setting', async () => {
  for (const module of MODULES.filter(isPlayable)) {
    const source = await readFile(
      new URL(`../src/js/modules/${module.id}/index.js`, import.meta.url),
      'utf8'
    )
    assert.match(source, /mountModuleOutro\s*\(/, module.id)
  }
})
