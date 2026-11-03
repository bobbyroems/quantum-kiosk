'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function lockPath(root, kind) {
  if (!['launcher', 'import'].includes(kind)) throw new Error(`Unknown workspace lock kind: ${kind}`);
  return path.join(root, '.runtime', kind === 'launcher' ? 'launcher.lock' : 'experience-import.lock');
}
function assertPlain(target) {
  let cursor = path.resolve(target);
  for (;;) {
    if (fs.existsSync(cursor) && fs.lstatSync(cursor).isSymbolicLink()) throw new Error(`Unsafe workspace lock path: ${cursor}`);
    const parent = path.dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
}
function inspectLock(file) {
  assertPlain(file);
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  let record;
  try { record = JSON.parse(text); } catch { throw new Error(`Malformed workspace lock: ${file}`); }
  if (!record || !Number.isSafeInteger(record.pid) || record.pid <= 0 || typeof record.token !== 'string' || !/^[a-f0-9]{32}$/.test(record.token) || !['launcher', 'import'].includes(record.kind)) throw new Error(`Malformed workspace lock: ${file}`);
  let alive = true;
  try { process.kill(record.pid, 0); } catch (error) { if (error.code === 'ESRCH') alive = false; else if (error.code !== 'EPERM') throw error; }
  return { record, text, alive };
}
function assertNoActiveLock(root, kind, clean = false) {
  const file = lockPath(root, kind);
  const found = inspectLock(file);
  if (!found) return;
  if (found.alive) throw new Error(`Workspace busy: active ${kind} process ${found.record.pid}`);
  if (clean) {
    // Serialize stale-file cleanup: two cleaners must not unlink a newly acquired lock.
    const guard = path.join(root, '.runtime', 'workspace-lock-cleanup.lock');
    assertPlain(guard);
    let fd;
    try { fd = fs.openSync(guard, 'wx'); } catch (error) {
      if (error.code === 'EEXIST') throw new Error('Workspace lock cleanup busy; retry (or inspect an interrupted cleanup guard)');
      throw error;
    }
    const token = crypto.randomBytes(16).toString('hex');
    try {
      fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, token, kind: 'import' }));
      fs.closeSync(fd); fd = undefined; mark(guard);
      const current = inspectLock(file);
      if (current?.alive) throw new Error(`Workspace busy: active ${kind} process ${current.record.pid}`);
      if (current && current.record.token === found.record.token) fs.unlinkSync(file);
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
      const current = inspectLock(guard);
      if (current?.record.token === token) fs.unlinkSync(guard);
    }
  }
}
function mark(file) {
  if (process.platform !== 'win32') return;
  let old = '';
  try { old = fs.readFileSync(`${file}:Zone.Identifier`, 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (!/ZoneId\s*=\s*["']?4\b/.test(old)) fs.writeFileSync(`${file}:Zone.Identifier`, '[ZoneTransfer]\r\nZoneId=3\r\n');
  if (!/ZoneId\s*=\s*["']?[34]\b/.test(fs.readFileSync(`${file}:Zone.Identifier`, 'utf8'))) throw new Error(`Zone verification failed: ${file}`);
}
function acquireWorkspaceLock(projectRoot, kind) {
  const root = path.resolve(projectRoot), own = lockPath(root, kind), otherKind = kind === 'launcher' ? 'import' : 'launcher';
  assertPlain(root);
  assertNoActiveLock(root, otherKind, true);
  assertPlain(path.dirname(own));
  fs.mkdirSync(path.dirname(own), { recursive: true });
  const token = crypto.randomBytes(16).toString('hex');
  let fd;
  for (let attempt = 0; attempt < 3; attempt++) {
    try { fd = fs.openSync(own, 'wx'); break; } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      assertNoActiveLock(root, kind, true);
    }
  }
  if (fd === undefined) throw new Error(`Workspace busy: ${kind} lock acquisition raced`);
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    const found = inspectLock(own);
    if (found && found.record.token === token) fs.unlinkSync(own);
  };
  try {
    fs.writeFileSync(fd, JSON.stringify({ version: 1, pid: process.pid, token, kind, createdAt: new Date().toISOString() }));
    fs.fsyncSync(fd);
    fs.closeSync(fd); fd = undefined;
    mark(own);
    assertNoActiveLock(root, otherKind, true);
    return release;
  } catch (error) {
    if (fd !== undefined) fs.closeSync(fd);
    // A partially written owned file must not become a permanent malformed lock.
    try { const text = fs.readFileSync(own, 'utf8'); if (!text || JSON.parse(text).token === token) fs.unlinkSync(own); } catch { /* Preserve unrelated lock replacements. */ }
    throw error;
  }
}
module.exports = { acquireWorkspaceLock, assertNoActiveLock, inspectLock };
