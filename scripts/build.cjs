'use strict';
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const root = path.dirname(__dirname);
const { loadExperienceRegistry } = require('..\\electron\\experience-registry.cjs');

function runNpm(cwd, args) {
  const result = process.platform === 'win32'
    ? spawnSync(process.env.ComSpec, ['/d', '/s', '/c', ['npm.cmd', ...args].join(' ')], { cwd, stdio: 'inherit' })
    : spawnSync('npm', args, { cwd, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`npm ${args.join(' ')} failed in ${cwd} (exit ${result.status}).`);
}

try {
  for (const experience of loadExperienceRegistry(root)) {
    const cwd = path.join(root, experience.directory);
    if (!fs.existsSync(path.join(cwd, 'node_modules', 'vite', 'package.json'))) {
      throw new Error(`Install ${experience.label} dependencies first: npm.cmd --prefix .\\${experience.directory} ci`);
    }
    console.log(`\nBuilding ${experience.label}…`);
    runNpm(cwd, ['run', 'build']);
    if (!fs.existsSync(path.join(cwd, 'dist', 'index.html'))) throw new Error(`${experience.id} build did not produce dist\\index.html.`);
  }
  console.log('\nAll registered experience builds are ready.');
} catch (error) { console.error(error.message); process.exitCode = 1; }
