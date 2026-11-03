import assert from 'node:assert/strict'
import test from 'node:test'
import { ModuleHost } from '../src/js/core/module-host.js'

const pending = () => { let resolve; const promise = new Promise(r => { resolve = r }); return { promise, resolve } }
function fixture(mountTimeoutMs = 25) {
  const view = { state: '', showStage() { this.state = 'active'; return {} }, revealStage() {}, clear() { this.state = 'empty' }, showLoading() {}, showError(_module, error, retry) { this.state = 'error'; this.error = error; this.retry = retry } }
  return { view, host: new ModuleHost({ view, mountTimeoutMs }) }
}

test('stalled loader becomes a retryable error and can recover', async () => {
  const { host, view } = fixture()
  let stalled = true
  const module = { id: 'stalled', load: () => stalled ? new Promise(() => {}) : { mount: () => () => {} } }
  assert.equal((await host.mount(module)).status, 'error')
  assert.equal(view.error.name, 'TimeoutError')
  stalled = false
  view.retry()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(view.state, 'active')
  host.unmount()
})

test('a controller arriving after the deadline is disposed without replacing the error', async () => {
  const { host, view } = fixture()
  const mount = pending()
  let disposed = 0, signal
  const result = await host.mount({ id: 'late', load: () => ({ mount: (_root, context) => { signal = context.signal; return mount.promise } }) })
  assert.equal(result.status, 'error')
  assert.equal(signal.aborted, true)
  mount.resolve(() => disposed++)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(disposed, 1)
  assert.equal(view.state, 'error')
})

test('a stalled presentation is disposed and cannot hold the host indefinitely', async () => {
  const { host, view } = fixture()
  let disposed = 0
  const result = await host.mount({ id: 'presentation', load: () => ({ mount: () => ({ dispose: () => disposed++, presentationReady: () => new Promise(() => {}) }) }) })
  assert.equal(result.status, 'error')
  assert.equal(disposed, 1)
  assert.equal(view.state, 'error')
  host.unmount()
  assert.equal(disposed, 1)
})

test('leaving a stalled mount settles promptly and disposes its late result', async () => {
  const { host, view } = fixture(60000)
  const late = pending()
  let disposed = 0
  const started = host.mount({ id: 'old', load: () => ({ mount: () => late.promise }) })
  await new Promise(resolve => setImmediate(resolve))
  host.unmount()
  assert.equal((await started).status, 'stale')
  late.resolve(() => disposed++)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(disposed, 1)
  assert.equal(view.state, 'empty')
})

test('interaction errors dispose the active module; stale callbacks cannot fail its successor', async () => {
  const { host, view } = fixture()
  let report, disposed = 0
  await host.mount({ id: 'game', load: () => ({ mount: (_root, context) => { report = context.onError; return () => disposed++ } }) })
  report(new Error('GPU unavailable'))
  assert.equal(disposed, 1)
  assert.equal(view.state, 'error')
  await host.mount({ id: 'next', load: () => ({ mount: () => () => {} }) })
  report(new Error('late error'))
  assert.equal(view.state, 'active')
  host.unmount()
})

test('a dependency abort without host cancellation still presents a recoverable error', async () => {
  const { host, view } = fixture()
  const result = await host.mount({ id: 'asset-timeout', load: () => Promise.reject(new DOMException('fetch timed out', 'AbortError')) })
  assert.equal(result.status, 'error')
  assert.equal(view.state, 'error')
  host.unmount()
})
