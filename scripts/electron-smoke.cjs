'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');
const root = path.dirname(__dirname);
const production = process.argv.includes('--production');
const output = path.join(root, '.runtime', 'smoke', production ? 'production' : 'windowed');
process.env.QUANTUM_KIOSK_USER_DATA_DIR ||= path.join(output, 'user-data');
if (production) process.argv = process.argv.filter(argument => argument !== '--windowed');
else if (!process.argv.includes('--windowed')) process.argv.push('--windowed');
fs.mkdirSync(output, { recursive: true });
const report = { electron: process.versions.electron, mode: production ? 'production' : 'windowed', checks: [], consoleErrors: [], resourceErrors: [], screenshots: [] };
const entry = path.join(root, 'experiences', 'magne', 'dist', 'index.html');
const backup = `${entry}.smoke-backup`;
let entryMoved = false;
let completed = false;
let failed = false;
let windowId;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const timeout = setTimeout(() => fail(new Error('Electron smoke timed out after 180 seconds.')), 180000);

function restoreEntry() {
  if (entryMoved) {
    fs.renameSync(backup, entry);
    entryMoved = false;
  }
}
function writeReport() {
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
}
function fail(error) {
  if (failed) return;
  failed = true;
  clearTimeout(timeout);
  restoreEntry();
  report.failure = error.stack || String(error);
  writeReport();
  console.error(report.failure);
  app.exit(1);
}
process.on('exit', restoreEntry);
process.on('uncaughtException', fail);
process.on('unhandledRejection', fail);
app.on('before-quit', () => {
  clearTimeout(timeout);
  restoreEntry();
  if (!completed && !failed) {
    failed = true;
    report.failure = 'The application quit before smoke checks completed.';
    report.navigationAtQuit = shell?.getNavigationState();
    writeReport();
    app.exit(1);
    return;
  } else if (completed) {
    check('Focused Ctrl+Shift+Q quits the shared shell', true);
  }
  writeReport();
});

app.on('browser-window-created', (_event, window) => {
  window.webContents.on('before-input-event', (_event, input) => {
    if (input.type === 'keyDown' && input.control && input.shift && input.key.toLowerCase() === 'q') report.operatorQuitReceived = true;
  });
  window.webContents.on('console-message', event => {
    if (event.level === 'error' || event.level === 3) report.consoleErrors.push({
      level: event.level, message: event.message, lineNumber: event.lineNumber, sourceId: event.sourceId
    });
  });
  const requests = new Map();
  window.webContents.debugger.attach('1.3');
  window.webContents.debugger.on('message', (_event, method, params) => {
    if (method === 'Network.requestWillBeSent') requests.set(params.requestId, params.request.url);
    if (method === 'Network.responseReceived' && params.response.status >= 400) {
      report.resourceErrors.push({ url: params.response.url, status: params.response.status });
    }
    if (method === 'Network.loadingFailed' && params.errorText !== 'net::ERR_ABORTED') {
      report.resourceErrors.push({ url: requests.get(params.requestId), error: params.errorText });
    }
  });
  void window.webContents.debugger.sendCommand('Network.enable').catch(fail);
});
let shell;
shell = require(path.join(root, 'electron', 'main.cjs'));
const window = () => shell.getWindow();
const evaluate = code => window().webContents.executeJavaScript(code, true);
function check(name, evidence) {
  report.checks.push({ name, evidence });
  console.log(`PASS ${name}`);
}
async function until(predicate, name, milliseconds = 20000) {
  const deadline = Date.now() + milliseconds;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await wait(100);
  }
  throw new Error(`Timed out: ${name}; navigation=${JSON.stringify(shell.getNavigationState())}`);
}
async function documentReady(name) {
  await until(() => shell.getNavigationState()?.document === name && !shell.getNavigationState().isLoading &&
    window().webContents.getURL() === `quantum-app://${name}/index.html`, `${name} document`);
  assert.equal(window().id, windowId);
  assert.equal(BrowserWindow.getAllWindows().length, 1);
  await until(() => evaluate('document.readyState === "complete" && Boolean(window.launcher && window.kiosk)'), `${name} bridge`);
}
async function checkLayout() {
  const layout = await evaluate('[...document.querySelectorAll("[data-experience]")].map(button => { const rect = button.getBoundingClientRect(); return { id: button.dataset.experience, width: rect.width, height: rect.height, visible: rect.top >= 0 && rect.left >= 0 && rect.bottom <= innerHeight && rect.right <= innerWidth }; })');
  assert.equal(layout.length, 2);
  assert.ok(layout.every(button => button.visible && button.height >= 160), `Welcome targets do not fit: ${JSON.stringify(layout)}`);
  check('Both large welcome touch targets fit the viewport', layout);
}
async function screenshot(name) {
  await wait(500);
  const filename = path.join(output, `${name}.png`);
  fs.writeFileSync(filename, (await window().webContents.capturePage()).toPNG());
  report.screenshots.push(filename);
}
async function checkLauncherDesign() {
  const debuggerClient = window().webContents.debugger;
  try {
    for (const [width, height] of [[768, 1365], [1080, 1920], [2160, 3840], [1280, 720], [390, 844]]) {
      await debuggerClient.sendCommand('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
      await evaluate('document.fonts.ready');
      const design = await evaluate(`(() => {
        const bounds = node => { const r = node.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height,
          visible: r.top >= 0 && r.left >= 0 && r.bottom <= innerHeight && r.right <= innerWidth }; };
        const cards = [...document.querySelectorAll('.experience')];
        return { cards: cards.map(bounds), colors: cards.map(node => getComputedStyle(node).backgroundColor),
          descriptions: cards.map(node => node.querySelector('.experience__description').textContent),
          descriptionLines: cards.map(node => { const text = node.querySelector('.experience__description');
            return Math.round(text.getBoundingClientRect().height / parseFloat(getComputedStyle(text).lineHeight)); }),
          branding: [...document.querySelectorAll('.partners img')].map(node => ({ ...bounds(node), loaded: node.complete && node.naturalWidth > 0 })),
          header: bounds(document.querySelector('header')), footer: bounds(document.querySelector('.partners')),
          overflow: document.documentElement.scrollWidth > innerWidth || document.documentElement.scrollHeight > innerHeight,
          fontLoaded: document.fonts.check('22px "Segoe Sans"') };
      })()`);
      assert.ok(design.cards.every(card => card.visible && card.height >= 160), JSON.stringify(design));
      assert.ok(design.header.visible && design.footer.visible && !design.overflow, JSON.stringify(design));
      assert.ok(design.branding.every(logo => logo.loaded && logo.visible));
      assert.equal(design.fontLoaded, true);
      assert.deepEqual(design.colors, ['rgb(255, 255, 255)', 'rgb(7, 30, 42)']);
      assert.deepEqual(design.descriptions, ['Explore the Nordic quantum initiative', 'Explore the building blocks of quantum computing']);
      if (width === 768) {
        assert.ok(Math.abs(design.cards[0].x - 71) < 3 && Math.abs(design.cards[0].y - 449) < 3, JSON.stringify(design.cards));
        assert.ok(Math.abs(design.cards[0].width - 626) < 3 && Math.abs(design.cards[0].height - 283) < 3);
        assert.deepEqual(design.descriptionLines, [1, 1]);
        await screenshot('welcome-reference');
      }
      check(`Reference launcher design fits ${width}x${height}`, design);
    }
    await debuggerClient.sendCommand('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
    await debuggerClient.sendCommand('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
    const focus = await evaluate('({ visible: document.activeElement.matches(".experience:focus-visible"), outline: getComputedStyle(document.activeElement).outlineStyle })');
    assert.equal(focus.visible, true);
    assert.equal(focus.outline, 'solid');
    check('Keyboard focus remains visible on launcher cards', focus);
  } finally {
    await debuggerClient.sendCommand('Emulation.clearDeviceMetricsOverride');
  }
}
async function touch(selector) {
  const target = await evaluate(`(() => { const selector = ${JSON.stringify(selector)}; const button = document.querySelector(selector); const rect = button.getBoundingClientRect(); const point = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, id: 1 }; const hit = document.elementFromPoint(point.x, point.y); return { point, width: innerWidth, height: innerHeight, hit: hit?.outerHTML.slice(0, 300), reachable: Boolean(hit?.closest(selector)), screen: document.querySelector('[data-screen].is-active')?.dataset.screen }; })()`);
  assert.ok(target.point.x >= 0 && target.point.x < target.width && target.point.y >= 0 && target.point.y < target.height, `Touch target is outside the viewport: ${JSON.stringify(target)}`);
  assert.equal(target.reachable, true, `Touch target is obscured: ${JSON.stringify(target)}`);
  (report.touchEvents ||= []).push({ selector, ...target });
  await window().webContents.debugger.sendCommand('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [target.point] });
  await window().webContents.debugger.sendCommand('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}
async function launch(name) {
  await until(() => evaluate('[...document.querySelectorAll("[data-experience]")].every(button => !button.disabled)'), 'enabled welcome targets');
  await evaluate(`document.querySelector('[data-experience="${name}"]').click(); document.querySelector('[data-experience="${name}"]').click(); true`);
  await documentReady(name);
}
async function returnHome() {
  await evaluate('void window.launcher.returnToLauncher(); true');
  await documentReady('launcher');
  await until(() => !window().webContents.isCurrentlyAudible(), 'inactive experience audio stops', 5000);
}

const returnSelector = '[data-quantum-return] button';
async function checkReturnControl(name, visible) {
  await until(() => evaluate(`(() => {
    const button = document.querySelector(${JSON.stringify(returnSelector)});
    if (!button) return false;
    const panel = button.closest('[data-quantum-return]');
    return ${visible} ? !panel.hidden && !button.disabled : panel.hidden && button.disabled && button.tabIndex === -1;
  })()`), `${name} return control ${visible ? 'visible' : 'hidden'}`);
  const control = await evaluate(`(() => {
    const button = document.querySelector(${JSON.stringify(returnSelector)});
    const rect = button.getBoundingClientRect();
    const style = getComputedStyle(button);
    const stage = document.getElementById('kiosk-stage');
    const unit = stage ? 2.8125 * Math.min(innerWidth / 2160, innerHeight / 3840) : Math.max(1, Math.min(innerWidth / 768, 2.8125));
    return { text: button.textContent, width: rect.width, height: rect.height,
      visible: rect.width > 0 && rect.height > 0 && rect.top >= 0 && rect.left >= 0 && rect.bottom <= innerHeight && rect.right <= innerWidth,
      color: style.color, background: style.backgroundColor, border: style.borderTopStyle, borderColor: style.borderTopColor,
      appearance: style.appearance,
      icon: getComputedStyle(button, '::after').content, expectedHeight: 26 * unit,
      disabled: button.disabled, tabIndex: button.tabIndex };
  })()`);
  if (visible) {
    assert.equal(control.text, 'Exit to main menu');
    assert.equal(control.visible, true);
    assert.ok(Math.abs(control.height - control.expectedHeight) < 1, `Return target does not match reference sizing: ${JSON.stringify(control)}`);
    assert.equal(control.color, 'rgb(255, 90, 54)');
    assert.equal(control.background, 'rgb(255, 255, 255)');
    assert.equal(control.border, 'solid');
    assert.equal(control.borderColor, 'rgb(255, 90, 54)');
    assert.equal(control.appearance, 'none');
    assert.equal(control.icon, '""');
  } else assert.equal(control.visible, false);
  check(`${name} return control is ${visible ? 'visible at its configured size on welcome' : 'hidden and unfocusable during interaction'}`, control);
}
async function visitorReturn(name, input = 'touch') {
  await checkReturnControl(name, true);
  if (input === 'touch') await touch(returnSelector);
  else await evaluate(`document.querySelector(${JSON.stringify(returnSelector)}).click(); document.querySelector(${JSON.stringify(returnSelector)}).click(); true`);
  await documentReady('launcher');
  await until(() => !window().webContents.isCurrentlyAudible(), 'visitor return stops experience audio', 5000);
  assert.equal(await evaluate('document.querySelector("[data-quantum-return]") === null'), true);
  check(`${name} welcome ${input} returns directly to launcher in the same window`, true);
}
async function checkReturnReference(name) {
  const debuggerClient = window().webContents.debugger;
  try {
    for (const [width, height] of [[768, 1365], [2160, 3840]]) {
      await debuggerClient.sendCommand('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
      await wait(100);
      await checkReturnControl(name, true);
      const rect = await evaluate(`(() => { const r = document.querySelector(${JSON.stringify(returnSelector)}).getBoundingClientRect();
        return { top: r.top, right: innerWidth - r.right, width: r.width }; })()`);
      const scale = width / 768;
      assert.ok(Math.abs(rect.top - 12 * scale) < 2 && Math.abs(rect.right - 36 * scale) < 2, JSON.stringify(rect));
      assert.ok(Math.abs(rect.width - 123 * scale) < 8 * scale, JSON.stringify(rect));
      if (width === 768) await screenshot(`${name.toLowerCase()}-return-reference`);
      check(`${name} exit button matches reference at ${width}x${height}`, rect);
    }
  } finally {
    await debuggerClient.sendCommand('Emulation.clearDeviceMetricsOverride');
  }
}

async function run() {
  await app.whenReady();
  await until(() => window() && !window().isDestroyed(), 'shared window');
  windowId = window().id;
  await documentReady('launcher');
  const welcome = await evaluate(`({ secure: isSecureContext, node: typeof require, sandbox: typeof process,
    labels: [...document.querySelectorAll('.experience__label')].map(node => node.textContent),
    color: getComputedStyle(document.body).backgroundColor, platform: kiosk.platform })`);
  assert.equal(welcome.secure, true);
  assert.equal(welcome.node, 'undefined');
  assert.equal(welcome.sandbox, 'undefined');
  assert.deepEqual(welcome.labels, ['QuNorth', 'Explore Quantum']);
  check('Secure sandboxed welcome and QuNorth/Explore Quantum targets', welcome);
  await checkLauncherDesign();
  await checkLayout();
  await screenshot('welcome');

  const rejected = await evaluate('window.launcher.launchExperience("unknown-experience")');
  assert.equal(rejected.ok, false);
  assert.equal(rejected.state.document, 'launcher');
  check('Unknown experience is rejected', rejected.state.error);
  await evaluate('window.launcher.returnToLauncher()');

  assert.equal(fs.existsSync(backup), false, `Refusing to overwrite ${backup}`);
  fs.renameSync(entry, backup);
  entryMoved = true;
  try {
    await touch('[data-experience="magne"]');
    await until(() => !shell.getNavigationState().isLoading && /build unavailable/.test(shell.getNavigationState().error || ''), 'missing build recovery');
    await documentReady('launcher');
    await until(() => evaluate('document.getElementById("status").textContent.includes("build unavailable")'), 'visible missing build feedback');
    check('Missing build restores welcome with feedback', shell.getNavigationState().error);
  } finally {
    restoreEntry();
  }

  await launch('magne');
  await until(() => evaluate('Boolean(window.quantumKiosk)'), 'Magne controller');
  await until(() => evaluate('getComputedStyle(document.body).cursor !== "none"'), 'windowed Magne cursor policy');
  const magneRuntime = await evaluate('({ idle: window.quantumKiosk.idleTimeout, cursor: getComputedStyle(document.body).cursor, buttonCursor: getComputedStyle(document.getElementById("startButton")).cursor, dev: new URLSearchParams(location.search).get("dev"), bridgeVersion: kiosk.bridgeVersion })');
  assert.equal(magneRuntime.idle, 60000);
  assert.notEqual(magneRuntime.cursor, 'none');
  assert.equal(magneRuntime.buttonCursor, 'pointer');
  assert.notEqual(magneRuntime.dev, '1');
  assert.equal(magneRuntime.bridgeVersion, 1);
  check('Windowed MAGNE shows normal cursor affordances without enabling standalone dev mode', magneRuntime);
  await evaluate('window.__smokeDocumentMarker = "magne"; true');
  check('MAGNE launches once with its original production idle timeout', shell.getNavigationState());
  await checkReturnControl('MAGNE', true);
  await checkReturnReference('MAGNE');
  await screenshot('magne');
  const fonts = await evaluate('(async () => ({ outfit: (await document.fonts.load(\'16px "Outfit"\')).length, unica: (await document.fonts.load(\'16px "Unica One"\')).length }))()');
  assert.ok(fonts.outfit > 0 && fonts.unica > 0);
  const navigationImage = await evaluate('fetch(new URL("assets/next-page.png", document.baseURI), { method: "HEAD" }).then(response => ({ status: response.status, type: response.headers.get("content-type") }))');
  assert.equal(navigationImage.status, 200);
  assert.equal(navigationImage.type, 'image/png');
  check('MAGNE fonts and navigation image load from the offline build', { ...fonts, navigationImage });
  const forbidden = await evaluate('window.launcher.launchExperience("iqm").then(value => ({ value }), error => ({ rejected: error.message }))');
  assert.ok(forbidden.rejected || forbidden.value?.ok === false);
  assert.equal(shell.getNavigationState().document, 'magne');
  check('Experience documents cannot launch another experience', forbidden);
  await evaluate('document.getElementById("startButton").click(); true');
  await until(() => evaluate('window.quantumKiosk.attract.currentSlide === 2'), 'Magne introduction slides');
  await evaluate('[...document.querySelectorAll(".nav-word")].find(node => node.textContent.trim().toLowerCase() === "connect").click(); true');
  await until(() => evaluate('window.quantumKiosk.isInteractive'), 'Magne start interaction');
  await screenshot('magne-interactive');
  check('MAGNE interactive entry works', true);
  await checkReturnControl('MAGNE', false);
  await evaluate('document.getElementById("navHomeBtn").click(); true');
  await until(() => evaluate('!window.quantumKiosk.isInteractive && document.getElementById("attract-screen").classList.contains("active")'), 'MAGNE existing Home returns to welcome');
  assert.equal(shell.getNavigationState().document, 'magne');
  check('MAGNE internal Home still returns to its own welcome', true);
  await screenshot('magne-welcome-return');
  await visitorReturn('MAGNE');
  assert.equal(await evaluate('typeof window.__smokeDocumentMarker'), 'undefined');
  check('Returning unloads the experience document and its audio', true);

  await launch('iqm');
  await until(() => evaluate('Boolean(window.__kioskApp)'), 'IQM controller');
  const runtime = await evaluate('({ ...kiosk, configured: Boolean(window.__kioskApp.config), idle: kiosk.config.kiosk.idleReturnToHomeMs })');
  assert.equal(runtime.isDevelopment, true);
  assert.equal(runtime.isKiosk, false);
  assert.equal(runtime.idle, 120000);
  check('IQM receives its runtime configuration before startup', runtime);
  await checkReturnControl('IQM', true);
  await checkReturnReference('IQM');
  await screenshot('iqm');
  await evaluate('window.__kioskApp.goHome(); true');
  await wait(700);
  await touch('#start-button');
  await until(() => evaluate('document.querySelector("[data-screen=menu]").classList.contains("is-active")'), 'IQM touch entry to menu', 10000);
  check('IQM Start touch opens its menu', true);
  await checkReturnControl('IQM', false);
  const graphics = await evaluate(`(async () => {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2');
    const webgl2 = Boolean(gl);
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
    const adapter = await navigator.gpu?.requestAdapter();
    return { secure: isSecureContext, webgl2, webgpu: Boolean(adapter) };
  })()`);
  assert.equal(graphics.secure, true);
  assert.equal(graphics.webgl2, true);
  check('Secure-context graphics capability', graphics);

  const media = await evaluate(`(async () => {
    const url = new URL('assets/modules/states-of-matter/SoM_IceCube_4k_vertical.mp4', document.baseURI);
    const head = await fetch(url, { method: 'HEAD' });
    const range = await fetch(url, { headers: { Range: 'bytes=0-1023' } });
    const bytes = (await range.arrayBuffer()).byteLength;
    const video = document.createElement('video');
    video.muted = true; video.preload = 'auto'; video.src = url.href;
    try {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Video metadata timed out')), 15000);
        video.onloadedmetadata = () => { clearTimeout(timer); resolve(); };
        video.onerror = () => { clearTimeout(timer); reject(new Error('Video metadata failed')); };
        video.load();
      });
      const duration = video.duration;
      const target = Math.min(2, duration / 2);
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Video seek timed out')), 15000);
        video.onseeked = () => { clearTimeout(timer); resolve(); };
        video.currentTime = target;
      });
      return { head: head.status, length: Number(head.headers.get('content-length')), range: range.status,
        bytes, duration, seek: video.currentTime, width: video.videoWidth, height: video.videoHeight };
    } finally { video.pause(); video.removeAttribute('src'); video.load(); }
  })()`);
  assert.equal(media.head, 200);
  assert.equal(media.range, 206);
  assert.equal(media.bytes, 1024);
  assert.ok(media.duration > 0 && media.seek > 0 && media.width > 0);
  check('Real protocol HEAD/range and video seeking', media);

  for (const id of ['states-of-matter', 'nanoscale']) {
    await evaluate(`window.__kioskApp.openModule('${id}'); true`);
    await until(() => evaluate(`window.__kioskApp.activeModuleId === '${id}' && !window.__kioskApp.isOpeningExperience && Boolean(document.querySelector('[data-module-stage="${id}"]'))`), `${id} module`, 30000);
    await wait(2000);
    await screenshot(`iqm-${id}`);
    assert.equal(await evaluate(`Boolean(document.querySelector('[data-module-stage="${id}"] .module-error'))`), false);
    check(`IQM ${id} dynamic module mounts`, true);
    await evaluate('window.__kioskApp.openMenu(); true');
    await wait(600);
  }
  await evaluate('document.querySelector(\'[data-screen="menu"] [data-action="home"]\').click(); true');
  await until(() => evaluate('document.querySelector(\'[data-screen="attract"]\').classList.contains("is-active")'), 'IQM existing Exit returns to welcome');
  assert.equal(shell.getNavigationState().document, 'iqm');
  check('IQM internal Exit still returns to its own welcome', true);
  await screenshot('iqm-welcome-return');
  await visitorReturn('IQM');
  await launch('magne');
  await visitorReturn('MAGNE', 'mouse');
  await launch('iqm');
  await returnHome();
  check('Repeated switching keeps one window and fresh documents', { windowId });
  await launch('magne');
  window().webContents.forcefullyCrashRenderer();
  await documentReady('launcher');
  assert.match(shell.getNavigationState().error, /closed unexpectedly/);
  check('A renderer crash recovers to welcome in the same window', shell.getNavigationState().error);
  await screenshot('welcome-returned');
  assert.deepEqual(report.resourceErrors, [], 'A required resource failed during the smoke check.');
  assert.deepEqual(report.consoleErrors, [], 'The renderer logged an error during the smoke check.');
  check('No renderer or resource errors', true);

  finish();
}
function finish() {
  completed = true;
  writeReport();
  window().focus();
  window().webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Q', modifiers: ['control', 'shift'] });
  setTimeout(() => fail(new Error('Focused Ctrl+Shift+Q did not quit the shell.')), 5000).unref();
}
async function runProduction() {
  await app.whenReady();
  await until(() => window() && !window().isDestroyed(), 'production window');
  windowId = window().id;
  await documentReady('launcher');
  await until(() => window().isKiosk() && window().isFullScreen(), 'fullscreen kiosk placement');
  const bounds = window().getBounds();
  assert.equal(await evaluate('kiosk.isDevelopment'), false);
  check('Production shell is fullscreen and in kiosk mode', bounds);
  await screenshot('welcome-fullscreen');
  await checkLayout();

  await window().webContents.debugger.sendCommand('Page.enable');
  await window().webContents.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument', {
    source: 'window.__smokeTimerDelays = []; const nativeTimeout = window.setTimeout; window.setTimeout = function (...args) { window.__smokeTimerDelays.push(args[1]); return Reflect.apply(nativeTimeout, this, args); };'
  });
  await touch('[data-experience="iqm"]');
  await documentReady('iqm');
  await until(() => evaluate('document.body.classList.contains("is-kiosk")'), 'production IQM startup');
  const runtime = await evaluate('({ isKiosk: kiosk.isKiosk, isDevelopment: kiosk.isDevelopment, idle: kiosk.config.kiosk, consoleApp: typeof window.__kioskApp, timers: [...new Set(window.__smokeTimerDelays)].filter(delay => delay >= 60000) })');
  report.productionRuntime = runtime;
  assert.equal(runtime.isKiosk, true);
  assert.equal(runtime.isDevelopment, false);
  assert.equal(runtime.consoleApp, 'undefined');
  assert.equal(runtime.idle.idleReturnToHomeMs, 120000);
  assert.equal(runtime.idle.idleReturnToMenuMs, 120000);
  await screenshot('iqm-fullscreen');
  await evaluate('document.getElementById("start-button").click(); true');
  await until(() => evaluate('document.querySelector("[data-screen=menu]").classList.contains("is-active")'), 'production IQM menu', 10000);
  report.productionRuntime.screen = await evaluate('document.querySelector("[data-screen].is-active")?.dataset.screen');
  await until(() => evaluate('Boolean(window.__smokeTimerDelays?.includes(120000))'), 'production IQM menu idle timer', 10000);
  report.productionRuntime.timers = await evaluate('[...new Set(window.__smokeTimerDelays)].filter(delay => delay >= 60000)');
  check('Touch launch preserves IQM kiosk styling and production idle timers', report.productionRuntime);
  await returnHome();
  check('Production return uses a fresh welcome document', true);
  assert.deepEqual(report.resourceErrors, []);
  assert.deepEqual(report.consoleErrors, []);
  check('Production boot has no renderer or resource errors', true);
  finish();
}
void (production ? runProduction() : run()).catch(fail);
