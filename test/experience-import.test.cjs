'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync, spawn } = require('node:child_process');
const F = require('../scripts/experience-import/files.cjs');
const { fs, path, write, serialize, copyTree, digest, walk } = F;
const { select } = require('../scripts/experience-import/profiles.cjs');
const { browserLock, validateLock } = require('../scripts/experience-import/lock.cjs');
const { planImport, initialize, applyImport, rollbackImport } = require('../scripts/experience-import/engine.cjs');
const { acquireWorkspaceLock } = require('../scripts/experience-import/workspace-lock.cjs');
const { parse } = require('../scripts/experience-import.cjs');
const fixtures = path.resolve(__dirname, '..', '.runtime', 'import-tests');
const vite = `import { defineConfig } from 'vite'\nexport default defineConfig({ root: 'src', base: './', build: { outDir: '../dist' }, resolve: { alias: { 'three/addons/': 'three/examples/jsm/' } }, optimizeDeps: { include: ['three', 'gsap', 'lottie-web', 'hammerjs'] } })\n`;
function fixture(t, profile = 'magne') {
  const base = path.join(fixtures, `fixture-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  const root = path.join(base, 'shell'), source = path.join(base, 'upstream'), destination = path.join(root, 'experiences', profile);
  fs.mkdirSync(destination, { recursive: true }); fs.mkdirSync(source, { recursive: true });
  t.after(() => fs.rmSync(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  write(path.join(root, 'experiences.json'), serialize({ version: 1, experiences: [{ id: profile, label: profile, directory: `experiences\\${profile}`, defaultSource: '..\\upstream', importProfile: profile, adapter: null, runtimeConfig: null }] }));
  const deps = profile === 'magne' ? { gsap: '3.14.2', hammerjs: '2.0.8', 'lottie-web': '5.13.0', three: '0.182.0' } : { gsap: '3.15.0', 'lottie-web': '5.13.0', three: '0.185.1' };
  const manifest = { name: 'upstream', version: '1.0.0', dependencies: deps, devDependencies: { vite: '7.3.1', electron: '39.8.10' } };
  const packages = { '': { ...manifest } };
  for (const [name, version] of Object.entries({ ...deps, ...manifest.devDependencies })) packages[`node_modules/${name}`] = { version, resolved: `https://registry.npmjs.org/${name}/-/${name}-${version}.tgz`, integrity: 'sha512-fixture' };
  packages['node_modules/vite'].dependencies = { esbuild: '0.28.2' };
  packages['node_modules/esbuild'] = { version: '0.28.2', resolved: 'https://registry.npmjs.org/esbuild/-/esbuild-0.28.2.tgz', optionalDependencies: { '@esbuild/win32-x64': '0.28.2' } };
  packages['node_modules/@esbuild/win32-x64'] = { version: '0.28.2', resolved: 'https://registry.npmjs.org/@esbuild/win32-x64/-/win32-x64-0.28.2.tgz', optional: true };
  write(path.join(source, 'package.json'), serialize(manifest)); write(path.join(source, 'package-lock.json'), serialize({ name: 'upstream', version: '1.0.0', lockfileVersion: 3, packages }));
  write(path.join(source, 'src', 'index.html'), '<html>fixture</html>');
  write(path.join(source, 'src', 'obsolete.js'), 'old');
  if (profile === 'magne') {
    write(path.join(source, 'vite.config.js'), vite);
    write(path.join(source, 'src', 'styles', 'variables.css'), "@import url('https://fonts.googleapis.com/css2?family=Unica+One&display=swap');\nbody { color: red; }");
    for (const file of ['UnicaOne-Regular.ttf', 'OFL.txt']) write(path.join(root, 'integration', 'magne', 'fonts', 'UnicaOne', file), 'local-font');
  } else {
    write(path.join(source, 'vite.config.js'), "export default { root: 'src', base: './', publicDir: '../public', resolve: { dedupe: ['three'] }, optimizeDeps: { exclude: ['three', 'three/webgpu', 'three/tsl'] }, server: { host: '127.0.0.1', port: 5173 } }");
    write(path.join(source, 'public', 'asset.txt'), 'asset');
    write(path.join(source, 'config', 'kiosk.config.json'), '{}');
    write(path.join(source, 'scripts', 'check-syntax.mjs'), "const roots = ['electron', 'scripts', 'src/js'];");
    for (const file of ['check-media-assets.mjs', 'check-nanoscale-camera.mjs']) write(path.join(source, 'scripts', file), '// fixture');
    write(path.join(source, 'test', 'renderer.test.mjs'), "import test from 'node:test'; test('renderer', () => {});");
    for (const file of ['app-protocol.test.mjs', 'pro-runtime-mode.test.mjs']) write(path.join(source, 'test', file), "import '../electron/runtime.cjs';");
  }
  const extraction = select(root, source, profile);
  for (const [key, bytes] of extraction.selected) write(path.join(destination, key), bytes);
  write(path.join(destination, 'README.md'), 'launcher README');
  write(path.join(destination, 'test', 'web-project.test.mjs'), '// launcher-owned');
  write(path.join(destination, 'dist', 'index.html'), 'old-build');
  write(path.join(destination, 'node_modules', '.package-lock.json'), '{"fixture":true}');
  write(path.join(destination, 'node_modules', 'reused.txt'), 'old-dependencies');
  return { root, source, destination, profile, state: path.join(root, '.experience-imports', profile, 'baseline.json'), base };
}
function validate(stage) { write(path.join(stage, 'dist', 'index.html'), fs.readFileSync(path.join(stage, 'src', 'index.html'))); }
function snapshot(directory) { return Object.fromEntries(walk(directory).map(file => [path.relative(directory, file), digest(fs.readFileSync(file))])); }
function init(f) { return initialize(f.root, f.profile); }
function apply(f, options = {}) { return applyImport(f.root, f.profile, { validator: validate, ...options }); }

test('CLI defaults to dry-run and rejects ambiguous operations/options', () => {
  assert.deepEqual(parse(['iqm']), { id: 'iqm', mode: 'dry-run', options: {} });
  assert.equal(parse(['iqm', '--rollback', 'abc-123']).options.backupId, 'abc-123');
  assert.throws(() => parse(['iqm', '--apply', '--initialize']), /exactly one/);
  assert.throws(() => parse(['iqm', '--from']), /requires/);
  assert.throws(() => parse(['iqm', '--force']), /Unknown/);
});
test('dry-run is read-only; initialization is explicit and cannot overwrite', t => {
  const f = fixture(t), before = snapshot(f.root);
  const plan = planImport(f.root, f.profile);
  assert.match(plan.localEdits[0], /Uninitialized/);
  assert.deepEqual(snapshot(f.root), before);
  assert.throws(() => apply(f), /initialize/);
  const destinationBefore = snapshot(f.destination);
  init(f); assert.throws(() => init(f), /already exists/);
  assert.deepEqual(snapshot(f.destination), destinationBefore);
  assert.equal(planImport(f.root, f.profile).localEdits.length, 0);
});
test('repeat imports mirror assets and remove only baseline tracked obsolete files', t => {
  const f = fixture(t); init(f);
  fs.unlinkSync(path.join(f.source, 'src', 'obsolete.js'));
  write(path.join(f.source, 'src', 'new.js'), 'new');
  write(path.join(f.source, 'src', 'index.html'), 'first');
  const plan = planImport(f.root, f.profile);
  assert.ok(plan.deletions.includes(path.join('src', 'obsolete.js')));
  const first = apply(f, { plan }); assert.ok(first.backupId);
  assert.equal(fs.existsSync(path.join(f.destination, 'src', 'obsolete.js')), false);
  assert.equal(fs.readFileSync(path.join(f.destination, 'README.md'), 'utf8'), 'launcher README');
  assert.equal(fs.readFileSync(path.join(f.destination, 'test', 'web-project.test.mjs'), 'utf8'), '// launcher-owned');
  write(path.join(f.source, 'src', 'index.html'), 'second');
  apply(f);
  assert.equal(fs.readFileSync(path.join(f.destination, 'src', 'index.html'), 'utf8'), 'second');
  assert.equal(planImport(f.root, f.profile).modifications.length, 0);
  write(path.join(f.destination, 'src', 'index.html'), 'first');
  assert.throws(() => apply(f), /Local edits/);
});
for (const mode of ['edit', 'delete', 'asset-add', 'test-add', 'script-add']) test(`protect local ${mode} against last baseline`, t => {
  const f = fixture(t); init(f);
  const beforeFile = path.join(f.destination, 'src', 'index.html');
  if (mode === 'edit') write(beforeFile, 'local');
  if (mode === 'delete') fs.unlinkSync(beforeFile);
  if (mode.endsWith('-add')) write(path.join(f.destination, mode === 'asset-add' ? 'src' : mode === 'test-add' ? 'test' : 'scripts', 'user-added.txt'), 'local');
  const before = snapshot(f.destination), baseline = fs.readFileSync(f.state, 'utf8');
  assert.ok(planImport(f.root, f.profile).localEdits.length);
  assert.throws(() => apply(f), /Local edits/);
  assert.deepEqual(snapshot(f.destination), before); assert.equal(fs.readFileSync(f.state, 'utf8'), baseline);
});
test('failed validation never mutates destination, dependencies, baseline, or upstream', t => {
  const f = fixture(t); init(f); write(path.join(f.source, 'src', 'index.html'), 'updated');
  const before = snapshot(f.destination), source = snapshot(f.source), state = fs.readFileSync(f.state, 'utf8');
  assert.throws(() => apply(f, { validator(stage) { write(path.join(stage, 'node_modules', 'reused.txt'), 'mutated'); throw new Error('fixture validation failed'); } }), /validation failed/);
  assert.deepEqual(snapshot(f.destination), before); assert.deepEqual(snapshot(f.source), source); assert.equal(fs.readFileSync(f.state, 'utf8'), state);
});
test('promotion rename failures restore the original paired project and baseline', t => {
  const f = fixture(t); init(f); write(path.join(f.source, 'src', 'index.html'), 'updated');
  const before = snapshot(f.destination), baseline = fs.readFileSync(f.state, 'utf8');
  const originalRename = fs.renameSync;
  fs.renameSync = (from, to) => {
    if (from.endsWith('next-state.json')) { const error = new Error('injected open baseline'); error.code = 'EPERM'; throw error; }
    return originalRename(from, to);
  };
  try { assert.throws(() => apply(f), /Transactional promotion refused/); } finally { fs.renameSync = originalRename; }
  assert.deepEqual(snapshot(f.destination), before); assert.equal(fs.readFileSync(f.state, 'utf8'), baseline);
  assert.equal(fs.existsSync(path.join(f.root, '.runtime', 'experience-import.lock')), false);
});
test('source and overlay changes invalidate stale plans and changes during staging refuse promotion', t => {
  const f = fixture(t); init(f);
  const plan = planImport(f.root, f.profile);
  write(path.join(f.source, 'src', 'index.html'), 'changed');
  assert.throws(() => apply(f, { plan }), /Stale import plan/);
  const next = planImport(f.root, f.profile);
  write(path.join(f.root, 'integration', 'magne', 'fonts', 'UnicaOne', 'OFL.txt'), 'changed overlay');
  assert.throws(() => apply(f, { plan: next }), /Stale import plan/);
  const before = snapshot(f.destination);
  assert.throws(() => apply(f, { validator(stage) { validate(stage); write(path.join(f.source, 'src', 'new-file.js'), 'late'); } }), /Stale source/);
  assert.deepEqual(snapshot(f.destination), before);
});
test('successful promote and rollback restore paired build, state and dependencies; new import remains possible', t => {
  const f = fixture(t); init(f); const original = snapshot(f.destination);
  write(path.join(f.source, 'src', 'index.html'), 'new import');
  const result = apply(f);
  write(path.join(f.destination, 'README.md'), 'new launcher README');
  rollbackImport(f.root, f.profile, { backupId: result.backupId });
  const restored = snapshot(f.destination); delete restored['README.md']; delete original['README.md'];
  assert.deepEqual(restored, original);
  assert.equal(fs.readFileSync(path.join(f.destination, 'README.md'), 'utf8'), 'new launcher README');
  assert.ok(fs.existsSync(path.join(f.root, '.experience-imports', f.profile, 'backups', result.backupId, 'project')));
  apply(f); assert.equal(fs.readFileSync(path.join(f.destination, 'src', 'index.html'), 'utf8'), 'new import');
});
test('rollback refuses local build/source/dependency edits and corrupted backups', t => {
  const f = fixture(t); init(f); const result = apply(f);
  write(path.join(f.destination, 'dist', 'index.html'), 'edited');
  assert.throws(() => rollbackImport(f.root, f.profile), /Local edits/);
  write(path.join(f.destination, 'dist', 'index.html'), fs.readFileSync(path.join(f.destination, 'src', 'index.html')));
  write(path.join(f.root, '.experience-imports', f.profile, 'backups', result.backupId, 'project', 'src', 'index.html'), 'corrupt');
  assert.throws(() => rollbackImport(f.root, f.profile), /integrity/);
});
test('unknown profiles, malformed baselines, malformed lock and incompatible upstream refuse', t => {
  const f = fixture(t); init(f);
  write(f.state, '{'); assert.throws(() => planImport(f.root, f.profile), /Malformed/);
  fs.unlinkSync(f.state);
  write(path.join(f.source, 'package-lock.json'), '{"lockfileVersion":1}');
  assert.throws(() => planImport(f.root, f.profile), /Malformed npm/);
  const registry = JSON.parse(fs.readFileSync(path.join(f.root, 'experiences.json'))); registry.experiences[0].importProfile = 'unsupported';
  write(path.join(f.root, 'experiences.json'), serialize(registry));
  assert.throws(() => planImport(f.root, f.profile), /Unknown import profile/);
  registry.experiences[0].importProfile = '__proto__';
  write(path.join(f.root, 'experiences.json'), serialize(registry));
  assert.throws(() => planImport(f.root, f.profile), /importProfile and adapter must be valid names/);
  assert.throws(() => select(f.root, f.source, '__proto__'), /Unknown import profile/);
});
test('central registry validation governs IDs and strict entry schemas', t => {
  const f = fixture(t), file = path.join(f.root, 'experiences.json'), registry = JSON.parse(fs.readFileSync(file));
  registry.experiences[0].id = 'magne--demo'; write(file, serialize(registry));
  assert.equal(planImport(f.root, 'magne--demo').profile, 'magne');
  registry.experiences[0].label = '<unsafe>'; write(file, serialize(registry));
  assert.throws(() => planImport(f.root, 'magne--demo'), /Unsafe label/);
  registry.experiences[0].label = 'safe'; delete registry.experiences[0].adapter; write(file, serialize(registry));
  assert.throws(() => planImport(f.root, 'magne--demo'), /entry schema/);
  assert.throws(() => planImport(f.root, 'launcher'), /Invalid experience ID/);
});
test('initialization rejects unknown assets rather than adopting local additions', t => {
  const f = fixture(t); write(path.join(f.destination, 'src', 'local.txt'), 'local');
  assert.throws(() => init(f), /unknown:/); assert.equal(fs.existsSync(f.state), false);
});
test('real default validator executes only its owned build command and reports bounded success output', t => {
  const f = fixture(t);
  write(path.join(f.destination, 'node_modules', 'vite', 'bin', 'vite.js'), "const fs = require('node:fs'); fs.mkdirSync('dist', {recursive:true}); fs.writeFileSync('dist/index.html','built'); console.log('fixture Vite build passed');");
  init(f);
  const result = apply(f, { validator: undefined });
  assert.equal(result.validation.dependenciesRestored, false);
  assert.equal(result.validation.commands.length, 1);
  assert.equal(result.validation.commands[0].command, 'node node_modules/vite/bin/vite.js build');
  assert.match(result.validation.commands[0].output, /Vite build passed/);
  assert.deepEqual(JSON.parse(fs.readFileSync(f.state)).validation, result.validation);
});
test('dependency pin changes are reported and stage receives isolated restoration signal', t => {
  const f = fixture(t); init(f);
  const lockFile = path.join(f.source, 'package-lock.json'), lock = JSON.parse(fs.readFileSync(lockFile));
  lock.packages['node_modules/gsap'].version = '3.15.0'; write(lockFile, serialize(lock));
  const plan = planImport(f.root, f.profile); assert.ok(plan.dependencyChanges.modifications.includes('gsap'));
  apply(f, { validator(stage, info) { assert.equal(info.dependenciesChanged, true); assert.equal(fs.existsSync(path.join(stage, 'node_modules', 'reused.txt')), false); validate(stage); } });
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.destination, 'package.json'))).dependencies.gsap, '3.15.0');
});
test('IQM only excludes explicitly known Electron tests; unexpected Electron tests are incompatible', t => {
  const f = fixture(t, 'iqm'); init(f);
  const plan = planImport(f.root, 'iqm'); assert.equal(plan.excludedTests.length, 2);
  assert.match(fs.readFileSync(path.join(f.destination, 'scripts', 'check-syntax.mjs'), 'utf8'), /\['scripts', 'src\/js', 'test'\]/);
  assert.match(fs.readFileSync(path.join(f.destination, 'vite.config.js'), 'utf8'), /port: 0/);
  write(path.join(f.source, 'test', 'new-electron.test.mjs'), "import 'electron';");
  assert.throws(() => planImport(f.root, 'iqm'), /Unexpected Electron/);
});
test('browser lock retains required/optional/nonoptional peer closure and omits wrapper tools', () => {
  const lock = { lockfileVersion: 3, packages: {
    '': {}, 'node_modules/vite': { version: '7.3.1', dependencies: { dep: '1' }, optionalDependencies: { optional: '1', missingOptional: '1' }, peerDependencies: { peer: '1', ignored: '1' }, peerDependenciesMeta: { ignored: { optional: true } } },
    'node_modules/dep': { version: '1.0.0', dependencies: { nested: '1' } }, 'node_modules/dep/node_modules/nested': { version: '1.0.0' },
    'node_modules/optional': { version: '1.0.0' }, 'node_modules/peer': { version: '1.0.0' }, 'node_modules/ignored': { version: '1.0.0' }, 'node_modules/electron': { version: '39.8.10' }
  } };
  const manifest = { name: 'web', version: '1.0.0', dependencies: {}, devDependencies: { vite: '7.3.1' } };
  const result = browserLock(lock, manifest);
  assert.deepEqual(Object.keys(result.packages).sort(), ['', 'node_modules/dep', 'node_modules/dep/node_modules/nested', 'node_modules/optional', 'node_modules/peer', 'node_modules/vite']);
  delete lock.packages['node_modules/peer']; assert.throws(() => browserLock(lock, manifest), /Missing required/);
  lock.packages['node_modules/vite'].peerDependencies = { missingOptional: '1' }; assert.throws(() => browserLock(lock, manifest), /Missing required/);
  assert.throws(() => validateLock({ lockfileVersion: 3, packages: { '': {}, 'node_modules/../evil': { version: '1.0.0' } } }), /Unsafe/);
});
test('workspace lock is reciprocal, exclusive and token-owned; dry-run refuses active launcher', t => {
  const f = fixture(t), release = acquireWorkspaceLock(f.root, 'launcher');
  assert.throws(() => acquireWorkspaceLock(f.root, 'import'), /busy/);
  assert.throws(() => planImport(f.root, f.profile), /busy/);
  const script = `const {acquireWorkspaceLock}=require(${JSON.stringify(path.resolve(__dirname, '..', 'scripts', 'experience-import', 'workspace-lock.cjs'))}); try {acquireWorkspaceLock(${JSON.stringify(f.root)},'import'); process.exit(0)} catch {process.exit(7)}`;
  assert.equal(spawnSync(process.execPath, ['-e', script]).status, 7);
  release(); release();
  const other = acquireWorkspaceLock(f.root, 'import'); assert.throws(() => acquireWorkspaceLock(f.root, 'launcher'), /busy/); assert.throws(() => acquireWorkspaceLock(f.root, 'import'), /busy/); other();
  const owner = acquireWorkspaceLock(f.root, 'import'), file = path.join(f.root, '.runtime', 'experience-import.lock');
  const record = JSON.parse(fs.readFileSync(file)); record.token = 'a'.repeat(32); write(file, serialize(record)); owner(); assert.equal(fs.existsSync(file), true); fs.unlinkSync(file);
});
test('stale locks are cleaned, malformed locks fail closed', t => {
  const f = fixture(t); fs.mkdirSync(path.join(f.root, '.runtime'), { recursive: true });
  const file = path.join(f.root, '.runtime', 'launcher.lock');
  write(file, serialize({ pid: 2147483646, token: 'b'.repeat(32), kind: 'launcher' }));
  acquireWorkspaceLock(f.root, 'import')(); assert.equal(fs.existsSync(file), false);
  write(file, '{}'); assert.throws(() => acquireWorkspaceLock(f.root, 'import'), /Malformed/);
});
test('parallel launcher/import acquisitions cannot both enter', async t => {
  const f = fixture(t), lockModule = path.resolve(__dirname, '..', 'scripts', 'experience-import', 'workspace-lock.cjs');
  const run = kind => new Promise(resolve => {
    const code = `const {acquireWorkspaceLock}=require(${JSON.stringify(lockModule)}); setTimeout(()=>{try{const release=acquireWorkspaceLock(${JSON.stringify(f.root)},${JSON.stringify(kind)});process.stdout.write('entered');setTimeout(()=>{release();process.exit(0)},300)}catch{process.exit(7)}},25);`;
    const child = spawn(process.execPath, ['-e', code]); let output = ''; child.stdout.on('data', data => output += data); child.on('close', status => resolve({ status, output }));
  });
  const results = await Promise.all([run('launcher'), run('import')]);
  assert.ok(results.filter(result => result.output === 'entered').length <= 1);
});
test('authored and generated files are internet-zone marked without downgrading ZoneId4', { skip: process.platform !== 'win32' }, t => {
  const f = fixture(t); init(f);
  const file = path.join(f.destination, 'src', 'index.html');
  const zone = Buffer.concat([Buffer.from([255, 254]), Buffer.from('[ZoneTransfer]\r\nZoneId="+0x4"\r\n', 'utf16le')]);
  fs.writeFileSync(`${file}:Zone.Identifier`, zone);
  write(file, fs.readFileSync(file));
  assert.deepEqual(fs.readFileSync(`${file}:Zone.Identifier`), zone);
  write(path.join(f.source, 'src', 'index.html'), 'new'); apply(f);
  assert.deepEqual(fs.readFileSync(`${file}:Zone.Identifier`), zone);
  const baselineZone = fs.readFileSync(`${f.state}:Zone.Identifier`, 'utf8'); assert.match(baselineZone, /ZoneId=3/);
});
test('path traversal, overlap and junction/symlink inputs are rejected', t => {
  const f = fixture(t); assert.throws(() => planImport(f.root, '../bad'), /Invalid/);
  assert.throws(() => planImport(f.root, f.profile, { from: f.root }), /overlap/);
  const junction = path.join(f.source, 'src', 'linked'); fs.symlinkSync(path.join(f.source, 'src', 'styles'), junction, process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => planImport(f.root, f.profile), /symlink\/junction/); fs.unlinkSync(junction);
});
