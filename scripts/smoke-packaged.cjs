'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawn, spawnSync } = require('node:child_process')
const root = path.dirname(__dirname)
const { version } = require('../package.json')
const executable = path.resolve(process.argv[2] || path.join(root, 'release', `Quantum-Kiosk-${version}-x64-portable.exe`))
const output = path.join(root, '.runtime', 'packaged-smoke', String(Date.now()))
const report = { executable, checks: [] }
const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))

function stopPortableProcess(pid) {
  const command = `
    $ErrorActionPreference = 'Stop'
    function Stop-PortableTree([int]$processId) {
      foreach ($child in @(Get-CimInstance Win32_Process -Filter "ParentProcessId = $processId")) {
        Stop-PortableTree $child.ProcessId
      }
      if (Get-Process -Id $processId -ErrorAction SilentlyContinue) { Stop-Process -Id $processId -Force }
    }
    Stop-PortableTree ${pid}
  `
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { encoding: 'utf8' })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`Could not clean up portable smoke process ${pid}: ${result.stderr}`)
}

async function connect(url) {
  const socket = new WebSocket(url)
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true })
    socket.addEventListener('error', () => reject(new Error(`Cannot connect to ${url}`)), { once: true })
  })
  let sequence = 0
  const pending = new Map()
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data)
    const request = pending.get(message.id)
    if (!request) return
    clearTimeout(request.timer)
    pending.delete(message.id)
    if (message.error) request.reject(new Error(message.error.message))
    else request.resolve(message.result)
  })
  socket.addEventListener('close', () => {
    for (const request of pending.values()) {
      clearTimeout(request.timer)
      request.reject(new Error('Packaged browser disconnected'))
    }
    pending.clear()
  })
  return {
    close: () => socket.close(),
    send(method, params = {}) {
      return new Promise((resolve, reject) => {
        const id = ++sequence
        const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timed out: ${method}`)) }, 30000)
        pending.set(id, { resolve, reject, timer })
        socket.send(JSON.stringify({ id, method, params }))
      })
    }
  }
}

async function run() {
  assert.ok(fs.statSync(executable).isFile(), `Missing executable: ${executable}. Run npm.cmd run package:win first.`)
  const workingDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'quantum-kiosk-smoke-'))
  const userData = path.join(workingDirectory, 'user-data')
  fs.mkdirSync(output, { recursive: true })
  fs.mkdirSync(userData, { recursive: true })
  const env = { ...process.env, QUANTUM_KIOSK_USER_DATA_DIR: userData }
  delete env.ELECTRON_RUN_AS_NODE
  const child = spawn(executable, ['--windowed', '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0'],
    { cwd: workingDirectory, env, stdio: ['ignore', 'pipe', 'pipe'] })
  let launchError
  let exited = false
  let log = ''
  child.on('error', error => { launchError = error })
  child.on('exit', () => { exited = true })
  for (const stream of [child.stdout, child.stderr]) stream.on('data', data => { log += data.toString() })
  let page
  let browser
  let quitRequested = false
  async function until(description, predicate, timeout = 30000) {
    const deadline = Date.now() + timeout
    while (Date.now() < deadline) {
      if (launchError) throw launchError
      if (!quitRequested && exited) throw new Error(`Executable exited before ${description} (code ${child.exitCode}).\n${log}`)
      if (await predicate()) return
      await wait(100)
    }
    throw new Error(`Timed out: ${description}.\n${log}`)
  }
  async function evaluate(expression) {
    const result = await page.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text)
    return result.result.value
  }
  async function documentReady(id) {
    await until(`${id} document`, async () => {
      try {
        return await evaluate(`location.hostname === ${JSON.stringify(id)} && document.readyState === 'complete' && Boolean(window.launcher && window.kiosk)`)
      } catch (error) {
        if (/Execution context was destroyed|Cannot find context|Inspected target navigated/.test(error.message)) return false
        throw error
      }
    })
  }
  function check(name, evidence) {
    report.checks.push({ name, evidence })
    console.log(`PASS ${name}`)
  }
  try {
    const portFile = path.join(userData, 'session', 'DevToolsActivePort')
    await until('portable extraction and browser startup', () => fs.existsSync(portFile), 120000)
    const port = Number(fs.readFileSync(portFile, 'utf8').split(/\r?\n/)[0])
    assert.ok(Number.isInteger(port) && port > 0)
    const address = `http://127.0.0.1:${port}`
    const metadata = await (await fetch(`${address}/json/version`)).json()
    browser = await connect(metadata.webSocketDebuggerUrl)
    let target
    await until('application page', async () => {
      target = (await (await fetch(`${address}/json/list`)).json()).find(entry => entry.type === 'page')
      return Boolean(target?.webSocketDebuggerUrl)
    })
    page = await connect(target.webSocketDebuggerUrl)
    await documentReady('launcher')
    await page.send('Emulation.setDeviceMetricsOverride', { width: 2160, height: 3840, deviceScaleFactor: 1, mobile: false })
    const welcome = await evaluate(`({
      secure: isSecureContext, node: typeof require, platform: kiosk.platform, windowed: kiosk.isDevelopment,
      targets: [...document.querySelectorAll('[data-experience]')].map(button => {
        const rect = button.getBoundingClientRect();
        return { id: button.dataset.experience, visible: rect.top >= 0 && rect.left >= 0 && rect.bottom <= innerHeight && rect.right <= innerWidth,
          width: rect.width, height: rect.height };
      })
    })`)
    assert.equal(welcome.secure, true)
    assert.equal(welcome.node, 'undefined')
    assert.equal(welcome.platform, 'win32')
    assert.equal(welcome.windowed, true)
    assert.deepEqual(welcome.targets.map(target => target.id), ['magne', 'iqm'])
    assert.ok(welcome.targets.every(target => target.visible && target.width >= 160 && target.height >= 160))
    check('Portable executable starts outside the checkout with a sandboxed 2160x3840 welcome', welcome)

    for (const id of ['magne', 'iqm']) {
      await evaluate(`document.querySelector('[data-experience="${id}"]').click(); true`)
      await documentReady(id)
      const readiness = id === 'magne' ? 'Boolean(window.quantumKiosk)' : 'Boolean(window.__kioskApp)'
      await until(`${id} renderer startup`, () => evaluate(readiness))
      await until(`${id} return control`, () => evaluate(`Boolean(document.querySelector('[data-quantum-return] button:not(:disabled)'))`))
      const config = await evaluate('({ bridge: kiosk.bridgeVersion, design: kiosk.config.design, idle: kiosk.config.kiosk?.idleReturnToHomeMs })')
      assert.equal(config.bridge, 1)
      if (id === 'magne') {
        const fonts = await evaluate(`(async () => ({
          outfit: (await document.fonts.load('16px "Outfit"')).length,
          unica: (await document.fonts.load('16px "Unica One"')).length
        }))()`)
        assert.ok(fonts.outfit > 0 && fonts.unica > 0)
        check('Packaged MAGNE loads its offline fonts', fonts)
      } else {
        assert.deepEqual(config.design, { width: 2160, height: 3840 })
        assert.equal(config.idle, 120000)
        const media = await evaluate(`(async () => {
          const url = new URL('assets/modules/states-of-matter/SoM_IceCube_4k_vertical.mp4', document.baseURI);
          const head = await fetch(url, { method: 'HEAD' });
          const range = await fetch(url, { headers: { Range: 'bytes=0-1023' } });
          return { head: head.status, length: Number(head.headers.get('content-length')), range: range.status,
            bytes: (await range.arrayBuffer()).byteLength };
        })()`)
        assert.equal(media.head, 200)
        assert.ok(media.length > 1024)
        assert.equal(media.range, 206)
        assert.equal(media.bytes, 1024)
        check('Packaged IQM receives portrait configuration and streams bundled 4K video', { config, media })
      }
      await evaluate('document.querySelector("[data-quantum-return] button").click(); true')
      await documentReady('launcher')
      check(`Packaged ${id} launches and returns to welcome`, true)
    }
    quitRequested = true
    page.close()
    try {
      await browser.send('Browser.close')
    } catch (error) {
      if (!/disconnected/.test(error.message)) throw error
    }
    await until('windowed application shutdown', () => exited, 120000)
    assert.equal(child.exitCode, 0)
    check('Windowed portable executable closes cleanly', true)
  } catch (error) {
    report.failure = error.stack || String(error)
    throw error
  } finally {
    quitRequested = true
    if (!exited && browser) {
      try { await browser.send('Browser.close') } catch (error) {
        if (!/disconnected/.test(error.message)) console.error(`Packaged smoke cleanup: ${error.message}`)
      }
    }
    if (!exited && child.pid) {
      await wait(1000)
      if (!exited) stopPortableProcess(child.pid)
    }
    page?.close()
    browser?.close()
    child.stdout.destroy()
    child.stderr.destroy()
    child.unref()
    fs.writeFileSync(path.join(output, 'console.log'), log)
    fs.rmSync(workingDirectory, { recursive: true, force: true, maxRetries: 50, retryDelay: 200 })
  }
}

run().catch(error => {
  report.failure ||= error.stack || String(error)
  console.error(error.stack || String(error))
  process.exitCode = 1
}).finally(() => {
  fs.mkdirSync(output, { recursive: true })
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n')
})
