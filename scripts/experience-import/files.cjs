'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const serialize = value => JSON.stringify(value, null, 2) + '\n';
function relative(value) {
  if (typeof value !== 'string' || !value || /^[\\/]|^[a-z]:/i.test(value) || value.includes(':') || value.split(/[\\/]/).some(part => !part || part === '.' || part === '..')) throw new Error(`Unsafe relative path: ${value}`);
  return value.split(/[\\/]/).join(path.sep);
}
function safe(target) {
  let cursor = path.resolve(target);
  for (;;) {
    try { if (fs.lstatSync(cursor).isSymbolicLink()) throw new Error(`Refusing symlink/junction: ${cursor}`); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const parent = path.dirname(cursor); if (parent === cursor) return target; cursor = parent;
  }
}
function inside(parent, child) { const rel = path.relative(path.resolve(parent), path.resolve(child)); return rel === '' || (!rel.startsWith(`..${path.sep}`) && rel !== '..' && !path.isAbsolute(rel)); }
function walk(directory) {
  safe(directory);
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory).sort().flatMap(name => {
    const file = path.join(directory, name); safe(file);
    const stat = fs.lstatSync(file);
    if (stat.isDirectory()) return walk(file);
    if (!stat.isFile()) throw new Error(`Unsupported file type: ${file}`);
    return [file];
  });
}
function readZone(file) {
  let bytes;
  try { bytes = fs.readFileSync(`${file}:Zone.Identifier`); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  if (bytes.length > 65536) throw new Error(`Oversized zone stream: ${file}`);
  const text = (bytes[0] === 255 && bytes[1] === 254 ? bytes.subarray(2).toString('utf16le') : new TextDecoder('utf-8', { fatal: true }).decode(bytes)).split('\0')[0];
  let insideSection = false;
  for (let line of text.split('\n')) {
    line = line.trim(); if (line.startsWith(';')) continue;
    if (line.startsWith('[')) {
      if (insideSection) return null;
      insideSection = /^\[\s*ZoneTransfer\s*\]/.test(line);
    } else if (insideSection && /^ZoneId\s*=/.test(line)) {
      let value = line.slice(line.indexOf('=') + 1).trim();
      const quoted = /^(?:"(.*)"|'(.*)')$/.exec(value); if (quoted) value = quoted[1] ?? quoted[2];
      value = value.replace(/^[\x00-\x20]+/, ''); const negative = value.startsWith('-');
      if (/^[+-]/.test(value)) value = value.slice(1);
      let radix = 10; const prefix = /^0([xob])/.exec(value);
      if (prefix) { radix = { x: 16, o: 8, b: 2 }[prefix[1]]; value = value.slice(2); }
      let number = 0n, digits = 0;
      for (const char of value.toLowerCase()) { const digit = '0123456789abcdef'.indexOf(char); if (digit < 0 || digit >= radix) break; number = (number * BigInt(radix) + BigInt(digit)) & 0xffffffffn; digits++; }
      if (negative) number = (-number) & 0xffffffffn;
      return digits && number <= 4n ? Number(number) : null;
    }
  }
  return null;
}
function mark(file) {
  if (process.platform !== 'win32') return;
  if (![3, 4].includes(readZone(file))) fs.writeFileSync(`${file}:Zone.Identifier`, '[ZoneTransfer]\r\nZoneId=3\r\n');
  if (![3, 4].includes(readZone(file))) throw new Error(`Zone verification failed: ${file}`);
}
function write(file, bytes) {
  safe(file);
  const preservedZone = process.platform === 'win32' && fs.existsSync(file) && readZone(file) === 4 ? fs.readFileSync(`${file}:Zone.Identifier`) : null;
  fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, bytes);
  if (preservedZone) fs.writeFileSync(`${file}:Zone.Identifier`, preservedZone);
  mark(file);
}
function copyFile(source, target) {
  safe(source); safe(target);
  const preservedZone = process.platform === 'win32' && readZone(source) === 4 ? fs.readFileSync(`${source}:Zone.Identifier`)
    : process.platform === 'win32' && fs.existsSync(target) && readZone(target) === 4 ? fs.readFileSync(`${target}:Zone.Identifier`) : null;
  fs.mkdirSync(path.dirname(target), { recursive: true }); fs.copyFileSync(source, target);
  if (preservedZone) fs.writeFileSync(`${target}:Zone.Identifier`, preservedZone);
  mark(target);
}
function copyTree(source, target, omit = new Set()) {
  safe(source); safe(target);
  fs.mkdirSync(target, { recursive: true });
  for (const name of fs.readdirSync(source)) {
    if (omit.has(name)) continue;
    const from = path.join(source, name), to = path.join(target, name); safe(from);
    if (fs.lstatSync(from).isDirectory()) copyTree(from, to);
    else copyFile(from, to);
  }
}
function json(file) { safe(file); try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (error) { throw new Error(`Malformed or missing JSON ${file}: ${error.message}`); } }
function hashes(files, root) { return Object.fromEntries(files.map(file => [path.relative(root, file), digest(fs.readFileSync(file))])); }
module.exports = { fs, path, digest, serialize, relative, safe, inside, walk, mark, write, copyFile, copyTree, json, hashes };
