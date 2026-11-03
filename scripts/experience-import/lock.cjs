'use strict';
const { relative } = require('./files.cjs');
const banned = /^(?:electron(?:-builder|-winstaller|-rebuild)?|@electron\/|@gltf-transform\/cli$|concurrently$|wait-on$)/;
function validateLock(lock) {
  if (!lock || ![2, 3].includes(lock.lockfileVersion) || !lock.packages || typeof lock.packages !== 'object' || Array.isArray(lock.packages) || !lock.packages['']) throw new Error('Malformed npm package lock (packages lock v2/v3 required)');
  for (const [key, record] of Object.entries(lock.packages)) {
    if (key) {
      relative(key);
      if (!key.startsWith('node_modules/') || key.includes('\\') || !record || record.link || !/^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(record.version || '')) throw new Error(`Malformed/linked lock package: ${key}`);
      if (record.resolved && !/^https:\/\//.test(record.resolved)) throw new Error(`Non-registry lock resolution: ${key}`);
    }
    if (!record || typeof record !== 'object' || Array.isArray(record)) throw new Error(`Malformed lock entry: ${key}`);
    if (record.peerDependenciesMeta !== undefined) {
      if (!record.peerDependenciesMeta || typeof record.peerDependenciesMeta !== 'object' || Array.isArray(record.peerDependenciesMeta)) throw new Error(`Malformed peer metadata: ${key}`);
      for (const metadata of Object.values(record.peerDependenciesMeta)) if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata) || (metadata.optional !== undefined && typeof metadata.optional !== 'boolean')) throw new Error(`Malformed peer metadata: ${key}`);
    }
    for (const field of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
      if (record[field] === undefined) continue;
      if (!record[field] || typeof record[field] !== 'object' || Array.isArray(record[field])) throw new Error(`Malformed lock ${field}: ${key}`);
      for (const [name, range] of Object.entries(record[field])) {
        if (!/^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/i.test(name) || typeof range !== 'string' || /^(?:file:|link:|workspace:|git|https?:)/.test(range)) throw new Error(`Unsupported lock dependency: ${key} ${name}`);
      }
    }
  }
  return lock;
}
function browserLock(sourceLock, manifest) {
  validateLock(sourceLock);
  const source = sourceLock.packages, packages = { '': {} }, retained = new Set();
  for (const field of ['name', 'version', 'engines', 'dependencies', 'devDependencies']) if (manifest[field] !== undefined) packages[''][field] = manifest[field];
  function resolve(key, name) {
    let cursor = key;
    while (cursor) {
      const found = `${cursor}/node_modules/${name}`;
      if (source[found]) return found;
      const index = cursor.lastIndexOf('/node_modules/'); cursor = index < 0 ? '' : cursor.slice(0, index);
    }
    return source[`node_modules/${name}`] ? `node_modules/${name}` : null;
  }
  function retain(key) {
    if (retained.has(key)) return;
    const record = source[key];
    const name = key.slice(key.lastIndexOf('node_modules/') + 13);
    if (banned.test(name)) throw new Error(`Standalone tool in browser closure: ${name}`);
    retained.add(key); packages[key] = structuredClone(record);
    const optional = new Set(Object.keys(record.optionalDependencies || {}));
    const peers = new Set(Object.keys(record.peerDependencies || {}).filter(name => !record.peerDependenciesMeta?.[name]?.optional));
    const required = new Set([...Object.keys(record.dependencies || {}).filter(name => !optional.has(name)), ...peers]);
    for (const name of new Set([...required, ...optional])) {
      const dependency = resolve(key, name);
      if (dependency) retain(dependency);
      else if (required.has(name)) throw new Error(`Missing required lock dependency: ${key} -> ${name}`);
    }
  }
  for (const [name, pin] of Object.entries({ ...manifest.dependencies, ...manifest.devDependencies })) {
    const key = `node_modules/${name}`;
    if (!source[key] || source[key].version !== pin) throw new Error(`Missing exact browser pin: ${name}@${pin}`);
    retain(key);
  }
  const sorted = { '': packages[''] };
  for (const key of [...retained].sort()) sorted[key] = packages[key];
  // v3 avoids v2's legacy full dependency graph, which includes standalone tools.
  return { name: manifest.name, version: manifest.version, lockfileVersion: 3, requires: true, packages: sorted };
}
module.exports = { validateLock, browserLock };
