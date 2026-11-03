'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { loadExperienceRegistry } = require('..\\electron\\experience-registry.cjs');
const root = path.dirname(__dirname);
let failed = false;
for (const experience of loadExperienceRegistry(root)) {
  const cwd = path.join(root, experience.directory);
  const manifest = JSON.parse(fs.readFileSync(path.join(cwd, 'package.json'), 'utf8'));
  if (!manifest.scripts?.test) { console.log(`${experience.label}: no upstream renderer test runner.`); continue; }
  console.log(`\nChecking ${experience.label} renderer…`);
  const result = process.platform === 'win32'
    ? spawnSync(process.env.ComSpec, ['/d', '/s', '/c', 'npm.cmd test'], { cwd, stdio: 'inherit' })
    : spawnSync('npm', ['test'], { cwd, stdio: 'inherit' });
  if (result.error) console.error(result.error.message);
  if (result.error || result.status !== 0) failed = true;
}
process.exitCode = failed ? 1 : 0;
