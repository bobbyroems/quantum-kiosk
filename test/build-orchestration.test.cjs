'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const scripts = path.join(__dirname, '..', 'scripts');
const entries = [
  { id: 'sample', label: 'Sample experience', directory: 'experiences\\custom-folder' },
  { id: 'second', label: 'Second experience', directory: 'experiences\\another-folder' }
];

function execute(name, options = {}) {
  const calls = [];
  const messages = [];
  const processMock = { platform: 'win32', env: { ComSpec: 'cmd.exe' }, exitCode: 0 };
  const modules = {
    'node:path': path,
    'node:fs': {
      existsSync: file => options.exists ? options.exists(file) : true,
      readFileSync: () => JSON.stringify({ scripts: options.noTests ? {} : { test: 'node --test' } })
    },
    'node:child_process': {
      spawnSync: (command, args, settings) => {
        calls.push({ command, args, cwd: settings.cwd });
        return { status: options.status || 0 };
      }
    },
    '..\\electron\\experience-registry.cjs': { loadExperienceRegistry: () => entries }
  };
  vm.runInNewContext(fs.readFileSync(path.join(scripts, name), 'utf8'), {
    require: name => { assert.ok(name in modules, `Unexpected dependency ${name}`); return modules[name]; },
    __dirname: scripts,
    process: processMock,
    console: { log: message => messages.push(message), error: message => messages.push(message) }
  }, { filename: name });
  return { calls, messages, process: processMock };
}

test('build orchestration uses registered directories and labels instead of fixed IDs', () => {
  const result = execute('build.cjs');
  assert.equal(result.calls.length, 2);
  assert.deepEqual(result.calls.map(call => call.cwd), entries.map(entry => path.join(scripts, '..', entry.directory)));
  assert.ok(result.messages.some(message => message.includes(entries[0].label)));
  assert.equal(result.process.exitCode, 0);
});

test('missing dependencies give the registered directory in an actionable command', () => {
  const result = execute('build.cjs', { exists: () => false });
  assert.equal(result.calls.length, 0);
  assert.equal(result.process.exitCode, 1);
  assert.ok(result.messages.some(message => message.includes('.\\experiences\\custom-folder ci')));
});

test('failed builds do not proceed to the next registered experience', () => {
  const result = execute('build.cjs', { status: 1 });
  assert.equal(result.calls.length, 1);
  assert.equal(result.process.exitCode, 1);
});

test('renderer check orchestration discovers all registered projects', () => {
  const result = execute('check-experiences.cjs');
  assert.deepEqual(result.calls.map(call => call.cwd), entries.map(entry => path.join(scripts, '..', entry.directory)));
  assert.equal(result.process.exitCode, 0);
});

test('renderer checks preserve projects without tests and propagate runner failure', () => {
  const skipped = execute('check-experiences.cjs', { noTests: true });
  assert.equal(skipped.calls.length, 0);
  assert.equal(skipped.process.exitCode, 0);
  assert.equal(execute('check-experiences.cjs', { status: 1 }).process.exitCode, 1);
});
