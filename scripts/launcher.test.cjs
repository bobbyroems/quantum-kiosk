'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(path.dirname(__dirname), 'launcher', 'renderer.js'), 'utf8');
const html = fs.readFileSync(path.join(path.dirname(__dirname), 'launcher', 'index.html'), 'utf8');
const registeredExperiences = JSON.parse(fs.readFileSync(path.join(path.dirname(__dirname), 'experiences.json'), 'utf8')).experiences;
const idle = { document: 'launcher', isLoading: false, experienceId: null, error: null };
const turn = () => new Promise(resolve => setImmediate(resolve));
function setup(options = {}) {
  const node = () => ({ dataset: {}, attributes: {}, children: [], disabled: false, textContent: '',
    append(...children) { this.children.push(...children); },
    setAttribute(name, value) { this.attributes[name] = value; },
    addEventListener(_name, listener) { this.click = listener; } });
  const status = node();
  const buttons = ['magne', 'iqm'].map(id => ({ ...node(), dataset: { experience: id } }));
  const group = { ...node(), replaceChildren(...children) { buttons.splice(0, buttons.length, ...children); } };
  let subscriber, closed = false;
  const events = {};
  const calls = [];
  const bridge = { getState: options.getState || (() => Promise.resolve(idle)),
    getExperiences: options.getExperiences || (() => Promise.resolve(options.experiences || registeredExperiences)),
    launchExperience: options.launch || (id => { calls.push(id); return new Promise(() => {}); }),
    onStateChanged(callback) { subscriber = callback; return () => { closed = true; }; } };
  const window = { launcher: options.noBridge ? undefined : bridge, addEventListener(name, listener) { events[name] = listener; } };
  const document = { querySelectorAll: () => buttons, getElementById: () => status, querySelector: () => group, createElement: node };
  vm.runInNewContext(source, { window, document });
  return { status, buttons, group, calls, emit: state => subscriber(state), pagehide: () => events.pagehide(), isClosed: () => closed };
}

test('static welcome copy matches registered display names and retains an accessible heading', () => {
  assert.deepEqual(registeredExperiences.map(entry => [entry.id, entry.label]), [['magne', 'QuNorth'], ['iqm', 'Explore Quantum']]);
  assert.deepEqual([...html.matchAll(/class="experience__label">([^<]+)</g)].map(match => match[1]), registeredExperiences.map(entry => entry.label));
  assert.deepEqual([...html.matchAll(/data-experience="([^"]+)"/g)].map(match => match[1]), registeredExperiences.map(entry => entry.id));
  assert.equal([...html.matchAll(/class="experience__action" aria-hidden="true"><\/span>/g)].length, 2);
  assert.deepEqual([...html.matchAll(/class="experience__description">([^<]+)</g)].map(match => match[1]),
    ['Explore the Nordic quantum initiative', 'Explore the building blocks of quantum computing']);
  assert.match(html, /aria-labelledby="welcome-title"/);
  assert.match(html, /<h1 id="welcome-title" class="eyebrow">Quantum experiences<\/h1>/);
  assert.doesNotMatch(html, />Explore quantum\.<|>Begin /i);
});
test('redesigned targets retain descriptions, decorative chevrons, and original launch IDs', async () => {
  const calls = [];
  const page = setup({ launch: async id => { calls.push(id); return { ok: true, state: idle }; } });
  await turn();
  assert.deepEqual(page.buttons.map(button => button.children[0].children[0].textContent), ['QuNorth', 'Explore Quantum']);
  assert.deepEqual(page.buttons.map(button => button.children[0].children[1].textContent),
    ['Explore the Nordic quantum initiative', 'Explore the building blocks of quantum computing']);
  assert.ok(page.buttons.every(button => button.children[1].attributes['aria-hidden'] === 'true'));
  await page.buttons[0].click();
  await page.buttons[1].click();
  assert.deepEqual(calls, ['magne', 'iqm']);
});
test('standalone preview explains shell requirement and disables launches', () => {
  const page = setup({ noBridge: true });
  assert.ok(page.buttons.every(button => button.disabled));
  assert.match(page.status.textContent, /launcher application/);
  assert.equal(page.status.dataset.error, 'true');
});
test('only one launch is sent for rapid repeated taps', async () => {
  const page = setup(); await turn();
  page.buttons[0].click(); page.buttons[0].click(); page.buttons[1].click();
  assert.deepEqual(page.calls, ['magne']);
  assert.ok(page.buttons.every(button => button.disabled));
  assert.equal(page.group.attributes['aria-busy'], 'true');
  assert.equal(page.status.textContent, 'Opening QuNorth…');
});
test('failed navigation result restores touch targets and plain-text feedback', async () => {
  const page = setup({ launch: async () => ({ ok: false, state: { ...idle, error: '<b>Missing build</b>' } }) });
  await turn(); await page.buttons[1].click();
  assert.equal(page.status.textContent, '<b>Missing build</b>');
  assert.equal(page.status.dataset.error, 'true');
  assert.ok(page.buttons.every(button => !button.disabled));
});
test('rejected IPC call restores touch targets with actionable feedback', async () => {
  const page = setup({ launch: async () => { throw new Error('IPC disconnected'); } });
  await turn(); await page.buttons[0].click();
  assert.match(page.status.textContent, /could not open/);
  assert.ok(page.buttons.every(button => !button.disabled));
});
test('a late initial read cannot overwrite a newer state notification', async () => {
  let resolve;
  const page = setup({ getState: () => new Promise(done => { resolve = done; }) });
  page.emit({ ...idle, error: 'Build unavailable' }); resolve(idle); await turn();
  assert.equal(page.status.textContent, 'Build unavailable');
});
test('busy notifications disable both experiences and release afterward', async () => {
  const page = setup(); await turn();
  page.emit({ ...idle, isLoading: true, experienceId: 'iqm' });
  assert.equal(page.status.textContent, 'Opening Explore Quantum…');
  assert.ok(page.buttons.every(button => button.disabled));
  page.emit(idle);
  assert.ok(page.buttons.every(button => !button.disabled));
  assert.equal(page.status.textContent, '');
});
test('state subscription is disposed on document unload', () => {
  const page = setup(); page.pagehide(); assert.equal(page.isClosed(), true);
});
test('a failed initial connection shows restart instructions', async () => {
  const page = setup({ getState: async () => { throw new Error('gone'); } }); await turn();
  assert.match(page.status.textContent, /restart/);
});
test('read-only registry drives every welcome target, preserves plain-text labels, and third target launches', async () => {
  const page = setup({ experiences: [{ id: 'first', label: 'First' }, { id: 'second', label: 'Second' },
    { id: 'third', label: '<b>Third & final</b>' }] });
  await turn();
  assert.equal(page.buttons.length, 3);
  assert.deepEqual(page.buttons.map(button => button.dataset.experience), ['first', 'second', 'third']);
  assert.equal(page.buttons[2].children[0].children[0].textContent, '<b>Third & final</b>');
  assert.equal(page.buttons[2].children[0].children[0].innerHTML, undefined);
  assert.equal(page.buttons[2].children[0].children.length, 1);
  page.buttons[2].click();
  assert.deepEqual(page.calls, ['third']);
  assert.equal(page.status.textContent, 'Opening <b>Third & final</b>…');
});
test('pending registry read keeps targets disabled and failure stays default-deny with restart feedback', async () => {
  let reject;
  const page = setup({ getExperiences: () => new Promise((_resolve, fail) => { reject = fail; }) });
  await turn();
  assert.ok(page.buttons.every(button => button.disabled));
  reject(new Error('Registry unavailable'));
  await turn();
  assert.match(page.status.textContent, /restart/);
  assert.ok(page.buttons.every(button => button.disabled));
});
test('registry and state callbacks completing after unload never replace or re-enable the old document', async () => {
  let resolve;
  const page = setup({ getExperiences: () => new Promise(done => { resolve = done; }) });
  page.pagehide();
  resolve([{ id: 'late', label: 'Late' }]);
  await turn();
  assert.deepEqual(page.buttons.map(button => button.dataset.experience), ['magne', 'iqm']);
  assert.ok(page.buttons.every(button => button.disabled));
});
