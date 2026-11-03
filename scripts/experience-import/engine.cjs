'use strict';
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { isDeepStrictEqual } = require('node:util');
const F = require('./files.cjs');
const { fs, path, safe, inside, relative, walk, digest, serialize, write, copyFile, copyTree, json, hashes, mark } = F;
const { loadExperienceRegistry, resolveExperiencePath, validId } = require('../../electron/experience-registry.cjs');
const { select, getProfile, managed } = require('./profiles.cjs');
const { validateLock, browserLock } = require('./lock.cjs');
const { acquireWorkspaceLock, assertNoActiveLock } = require('./workspace-lock.cjs');
const uid = () => `${new Date().toISOString().replace(/[:.]/g, '-')}-${crypto.randomBytes(6).toString('hex')}`;
function context(projectRoot, id, from) {
  const root = path.resolve(projectRoot); safe(root);
  if (!validId(id)) throw new Error('Invalid experience ID');
  safe(path.join(root, 'experiences.json'));
  const entry = loadExperienceRegistry(root).find(item => item.id === id);
  if (!entry) throw new Error(`Unknown experience: ${id}`);
  getProfile(entry.importProfile);
  const destination = resolveExperiencePath(root, entry);
  const source = path.resolve(root, from || entry.defaultSource); safe(source);
  if (inside(source, root) || inside(root, source)) throw new Error('Source/workspace path overlap');
  const stateRoot = path.join(root, '.experience-imports', id), baselineFile = path.join(stateRoot, 'baseline.json');
  safe(stateRoot); safe(path.join(root, '.runtime', 'imports'));
  return { root, id, entry, source, destination, stateRoot, baselineFile };
}
function managedHashes(destination) { return hashes(walk(destination).filter(file => managed(path.relative(destination, file))), destination); }
function buildHashes(destination) { return hashes(walk(path.join(destination, 'dist')), destination); }
function dependencyHash(destination) { const file = path.join(destination, 'node_modules', '.package-lock.json'); safe(file); return fs.existsSync(file) ? digest(fs.readFileSync(file)) : null; }
function validateHashMap(map, scope) {
  if (!map || typeof map !== 'object' || Array.isArray(map)) throw new Error(`Malformed baseline ${scope}`);
  for (const [key, hash] of Object.entries(map)) {
    relative(key);
    if (!/^[a-f0-9]{64}$/.test(hash) || (scope === 'managed' && !managed(key)) || (scope === 'build' && !key.startsWith('dist' + path.sep))) throw new Error(`Malformed baseline ${scope} path/hash: ${key}`);
  }
}
function validateState(state, c) {
  if (!state || state.version !== 1 || state.id !== c.id || state.profile !== c.entry.importProfile || typeof state.generation !== 'string' || !state.provenance || typeof state.provenance.source !== 'string' || !state.inputs || typeof state.inputs !== 'object' || Array.isArray(state.inputs) || !state.dependencies || typeof state.dependencies !== 'object') throw new Error('Malformed/incompatible import baseline');
  validateHashMap(state.managed, 'managed'); validateHashMap(state.build, 'build');
  for (const hash of Object.values(state.inputs)) if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error('Malformed baseline input hash');
  if (state.dependencyLock !== null && !/^[a-f0-9]{64}$/.test(state.dependencyLock || '')) throw new Error('Malformed baseline dependency hash');
  if (state.lastBackup !== null && !/^[a-zA-Z0-9-]+$/.test(state.lastBackup || '')) throw new Error('Malformed backup ID');
  return state;
}
function loadState(c, required = false) {
  if (!fs.existsSync(c.baselineFile)) { if (required) throw new Error('No import baseline; run --initialize once before applying'); return null; }
  return validateState(json(c.baselineFile), c);
}
function changes(before, after) {
  const additions = [], modifications = [], deletions = [];
  for (const [key, hash] of Object.entries(after)) { if (!(key in before)) additions.push(key); else if (hash !== before[key]) modifications.push(key); }
  for (const key of Object.keys(before)) if (!(key in after)) deletions.push(key);
  return { additions: additions.sort(), modifications: modifications.sort(), deletions: deletions.sort() };
}
function localChanges(c, state, current) {
  if (!state) return Object.keys(current).length ? ['Uninitialized destination: explicit --initialize required'] : [];
  const diff = changes(state.managed, current), build = changes(state.build, buildHashes(c.destination));
  const dependency = state.dependencyLock !== dependencyHash(c.destination) ? ['node_modules/.package-lock.json'] : [];
  return [...diff.additions.map(key => `untracked:${key}`), ...diff.modifications.map(key => `modified:${key}`), ...diff.deletions.map(key => `deleted:${key}`), ...build.additions.map(key => `build-added:${key}`), ...build.modifications.map(key => `build-modified:${key}`), ...build.deletions.map(key => `build-deleted:${key}`), ...dependency];
}
function makePlan(c) {
  assertNoActiveLock(c.root, 'launcher');
  const extraction = select(c.root, c.source, c.entry.importProfile), state = loadState(c), current = managedHashes(c.destination);
  const target = Object.fromEntries([...extraction.selected].map(([key, bytes]) => [key, digest(bytes)]));
  const dependencyChanges = changes(state?.dependencies || {}, extraction.dependencies);
  const plan = { version: 1, id: c.id, profile: c.entry.importProfile, source: c.source, destination: c.destination,
    baseline: state ? digest(serialize(state)) : null, inputs: extraction.inputs, before: current, target,
    ...changes(current, target), localEdits: localChanges(c, state, current), dependencyChanges,
    dependencies: extraction.dependencies, dependencyCount: extraction.dependencyCount, excludedTests: extraction.excludedTests,
    provenance: { source: c.source, profile: c.entry.importProfile, inputDigest: digest(serialize(extraction.inputs)) } };
  return { plan, extraction, state };
}
function planImport(projectRoot, id, options = {}) { return makePlan(context(projectRoot, id, options.from || options.source)).plan; }
function verifyProjectLock(destination, profile) {
  const manifest = json(path.join(destination, 'package.json')), lock = validateLock(json(path.join(destination, 'package-lock.json')));
  const definition = getProfile(profile);
  if (Object.keys(manifest.dependencies || {}).sort().join() !== [...definition.dependencies].sort().join() || Object.keys(manifest.devDependencies || {}).join() !== 'vite') throw new Error('Incompatible extracted browser manifest');
  const closure = browserLock(lock, manifest);
  if (Object.keys(closure.packages).sort().join() !== Object.keys(lock.packages).sort().join()) throw new Error('Standalone/unreachable packages in extracted lock');
}
function stateFor(c, extraction, destination, lastBackup = null) {
  return { version: 1, id: c.id, profile: c.entry.importProfile, generation: uid(), importedAt: new Date().toISOString(),
    provenance: { source: c.source, inputDigest: digest(serialize(extraction.inputs)) }, inputs: extraction.inputs,
    dependencies: extraction.dependencies, managed: managedHashes(destination), build: buildHashes(destination), dependencyLock: dependencyHash(destination), lastBackup };
}
function initialize(projectRoot, id, options = {}) {
  const c = context(projectRoot, id, options.from || options.source), release = acquireWorkspaceLock(c.root, 'import');
  try {
    if (fs.existsSync(c.baselineFile)) throw new Error('Baseline already exists; initialization cannot overwrite state');
    const extraction = select(c.root, c.source, c.entry.importProfile), current = managedHashes(c.destination);
    const expected = new Set(extraction.selected.keys());
    const unknown = Object.keys(current).filter(key => !expected.has(key)), missing = [...expected].filter(key => !(key in current));
    if (unknown.length || missing.length) throw new Error(`Initialization requires reviewed extracted shape; unknown: ${unknown.join(', ')}; missing: ${missing.join(', ')}`);
    verifyProjectLock(c.destination, c.entry.importProfile);
    const state = stateFor(c, extraction, c.destination);
    write(c.baselineFile, serialize(state));
    return { initialized: true, id, files: Object.keys(state.managed).length, provenance: state.provenance };
  } finally { release(); }
}
function runCommand(stage, args) {
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const command = args[0] === 'npm' ? npm : process.execPath;
  const argv = args.slice(1);
  const env = { ...process.env, npm_config_ignore_scripts: 'true', npm_config_cache: path.join(stage, '..', 'npm-cache'), TEMP: path.join(stage, '..', 'temp'), TMP: path.join(stage, '..', 'temp') };
  fs.mkdirSync(env.TEMP, { recursive: true });
  // npm.cmd is a batch file; only fixed, profile-owned arguments are interpolated.
  const result = process.platform === 'win32' && args[0] === 'npm'
    ? spawnSync(process.env.ComSpec, ['/d', '/s', '/c', `${npm} ${argv.join(' ')}`], { cwd: stage, env, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
    : spawnSync(command, argv, { cwd: stage, env, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  for (const file of walk(path.dirname(stage))) mark(file);
  if (result.error || result.status !== 0) {
    const error = new Error(`Profile validation failed: ${args.join(' ')}\n${result.stdout || ''}${result.stderr || ''}${result.error?.message || ''}`);
    error.missingTool = /Cannot find (?:module|package)|MODULE_NOT_FOUND|ERR_MODULE_NOT_FOUND|not recognized|ENOENT|Cannot find module.*esbuild/.test(error.message); throw error;
  }
  return (result.stdout || '') + (result.stderr || '');
}
function defaultValidator(stage, info) {
  let restored = false;
  const commands = [];
  function run(args) {
    const started = Date.now();
    try {
      const output = runCommand(stage, args);
      commands.push({ command: args.join(' '), status: 'passed', durationMs: Date.now() - started, output: output.slice(-3000), truncated: output.length > 3000 });
    } catch (error) {
      commands.push({ command: args.join(' '), status: 'failed', durationMs: Date.now() - started, output: error.message.slice(-3000) });
      throw error;
    }
  }
  function restore() { run(['npm', 'ci', '--ignore-scripts', '--no-audit', '--no-fund']); restored = true; }
  if (info.dependenciesChanged) restore();
  const validate = () => {
    if (info.profile === 'iqm') {
      run(['node', 'scripts/check-syntax.mjs']);
      run(['node', '--test', ...walk(path.join(stage, 'test')).filter(file => file.endsWith('.test.mjs')).map(file => path.relative(stage, file))]);
      run(['node', 'scripts/check-nanoscale-camera.mjs']);
      run(['node', 'scripts/check-media-assets.mjs', 'public']);
    }
    run(['node', 'node_modules/vite/bin/vite.js', 'build']);
    if (info.profile === 'iqm') run(['node', 'scripts/check-media-assets.mjs', 'dist']);
  };
  try { validate(); } catch (error) { if (!restored && error.missingTool) { restore(); validate(); } else throw error; }
  return { commands, dependenciesRestored: restored };
}
function fullSnapshot(directory) { return hashes(walk(directory), directory); }
function rename(from, to) {
  for (let attempt = 0; ; attempt++) {
    try { fs.renameSync(from, to); return; } catch (error) {
      if (process.platform !== 'win32' || !['EPERM', 'EBUSY', 'ENOTEMPTY'].includes(error.code) || attempt === 3) throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
    }
  }
}
function promote(c, stage, state, previous, snapshot) {
  const backupId = uid(), backup = path.join(c.stateRoot, 'backups', backupId); safe(backup);
  const previousBaseline = fs.readFileSync(c.baselineFile);
  if (!isDeepStrictEqual(fullSnapshot(c.destination), snapshot) || !isDeepStrictEqual(loadState(c, true), previous)) throw new Error('Stale destination/baseline before promotion');
  fs.mkdirSync(backup, { recursive: true });
  write(path.join(backup, 'state.json'), previousBaseline);
  write(path.join(backup, 'backup.json'), serialize({ version: 1, id: c.id, backupId, createdAt: new Date().toISOString(), snapshot }));
  state.lastBackup = backupId;
  const stateStage = path.join(backup, 'next-state.json'); write(stateStage, serialize(state));
  let moved = false, promoted = false, baselineMoved = false;
  const oldState = path.join(backup, 'old-baseline.json');
  try {
    rename(c.destination, path.join(backup, 'project')); moved = true;
    rename(stage, c.destination); promoted = true;
    rename(c.baselineFile, oldState); baselineMoved = true;
    rename(stateStage, c.baselineFile);
    return backupId;
  } catch (error) {
    try {
      if (baselineMoved) rename(oldState, c.baselineFile);
      if (promoted) rename(c.destination, stage);
      if (moved) rename(path.join(backup, 'project'), c.destination);
    } catch (recovery) {
      const failure = new Error(`Promotion recovery requires inspection; retained backup ${backup} and stage ${stage}: ${recovery.message}; original: ${error.message}`);
      failure.recoveryRequired = true; throw failure;
    }
    throw new Error(`Transactional promotion refused (close active/open files): ${error.message}`);
  }
}
function applyImport(projectRoot, id, options = {}) {
  const c = context(projectRoot, id, options.from || options.source), release = acquireWorkspaceLock(c.root, 'import');
  let work;
  try {
    const { plan, extraction, state } = makePlan(c);
    if (!state) throw new Error('No import baseline; run --initialize once before applying');
    if (options.plan && !isDeepStrictEqual(options.plan, plan)) throw new Error('Stale import plan: source/profile/destination changed');
    if (plan.localEdits.length) throw new Error(`Local edits conflict: ${plan.localEdits.join(', ')}`);
    const snapshot = fullSnapshot(c.destination);
    work = path.join(c.root, '.runtime', 'imports', uid()); const stage = path.join(work, 'project'); safe(work);
    copyTree(c.destination, stage, new Set(['dist', 'node_modules']));
    const dependencyChanged = plan.before['package-lock.json'] !== plan.target['package-lock.json'] || plan.before['package.json'] !== plan.target['package.json'];
    if (!dependencyChanged && fs.existsSync(path.join(c.destination, 'node_modules'))) copyTree(path.join(c.destination, 'node_modules'), path.join(stage, 'node_modules'));
    for (const key of Object.keys(state.managed)) if (!extraction.selected.has(key)) fs.unlinkSync(path.join(stage, key));
    for (const [key, bytes] of extraction.selected) write(path.join(stage, key), bytes);
    const validation = (options.validator || defaultValidator)(stage, { profile: c.entry.importProfile, dependenciesChanged: dependencyChanged, plan }) || null;
    if (validation && typeof validation.then === 'function') throw new Error('Importer validators must finish synchronously');
    for (const file of walk(work)) mark(file);
    if (!fs.existsSync(path.join(stage, 'dist', 'index.html'))) throw new Error('Profile validation did not produce dist/index.html');
    verifyProjectLock(stage, c.entry.importProfile);
    if (!isDeepStrictEqual(managedHashes(stage), plan.target)) throw new Error('Validator changed managed extraction files');
    const fresh = makePlan(c).plan;
    if (!isDeepStrictEqual(fresh, plan)) throw new Error('Stale source/profile/destination during staging');
    const next = stateFor(c, extraction, stage); next.validation = validation;
    let backupId;
    try { backupId = promote(c, stage, next, state, snapshot); } catch (error) { if (error.recoveryRequired) work = null; throw error; }
    return { applied: true, id, backupId, plan, provenance: next.provenance, validation };
  } finally { try { if (work && fs.existsSync(work)) fs.rmSync(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } finally { release(); } }
}
function rollbackImport(projectRoot, id, options = {}) {
  const c = context(projectRoot, id, options.from || options.source), release = acquireWorkspaceLock(c.root, 'import');
  let work;
  try {
    const current = loadState(c, true), localEdits = localChanges(c, current, managedHashes(c.destination));
    if (localEdits.length) throw new Error(`Local edits conflict: ${localEdits.join(', ')}`);
    const backupId = options.backupId || current.lastBackup;
    if (!backupId || !/^[a-zA-Z0-9-]+$/.test(backupId)) throw new Error('No valid rollback backup ID');
    const backup = path.join(c.stateRoot, 'backups', backupId); safe(backup);
    const metadata = json(path.join(backup, 'backup.json'));
    if (metadata.version !== 1 || metadata.id !== id || metadata.backupId !== backupId) throw new Error('Malformed rollback backup metadata');
    validateHashMap(metadata.snapshot, 'snapshot');
    const project = path.join(backup, 'project'), old = validateState(json(path.join(backup, 'state.json')), c);
    if (!isDeepStrictEqual(fullSnapshot(project), metadata.snapshot) || !isDeepStrictEqual(managedHashes(project), old.managed) || !isDeepStrictEqual(buildHashes(project), old.build) || dependencyHash(project) !== old.dependencyLock) throw new Error('Rollback backup integrity mismatch');
    verifyProjectLock(project, c.entry.importProfile);
    const snapshot = fullSnapshot(c.destination);
    work = path.join(c.root, '.runtime', 'imports', uid()); const stage = path.join(work, 'project'); copyTree(project, stage);
    // Launcher-owned files are not importer state, including README and web-project tests.
    for (const file of walk(stage)) {
      const key = path.relative(stage, file);
      if (!managed(key) && !key.startsWith('dist' + path.sep) && !key.startsWith('node_modules' + path.sep)) fs.unlinkSync(file);
    }
    for (const file of walk(c.destination)) {
      const key = path.relative(c.destination, file);
      if (!managed(key) && !key.startsWith('dist' + path.sep) && !key.startsWith('node_modules' + path.sep)) copyFile(file, path.join(stage, key));
    }
    let recoveryBackup;
    try { recoveryBackup = promote(c, stage, { ...old, generation: uid(), rolledBackAt: new Date().toISOString() }, current, snapshot); } catch (error) { if (error.recoveryRequired) work = null; throw error; }
    return { rolledBack: true, id, restoredBackup: backupId, backupId: recoveryBackup };
  } finally { try { if (work && fs.existsSync(work)) fs.rmSync(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } finally { release(); } }
}
module.exports = { planImport, initialize, applyImport, rollbackImport, defaultValidator };
