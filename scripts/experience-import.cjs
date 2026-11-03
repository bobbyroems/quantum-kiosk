'use strict';
const path = require('node:path');
const { planImport, initialize, applyImport, rollbackImport } = require('./experience-import/engine.cjs');
function parse(argv) {
  const options = {}, id = argv.shift();
  if (!id || id.startsWith('--')) throw new Error('Usage: experience-import <id> [--from <source>] [--dry-run | --apply | --initialize | --rollback [backup-id]]');
  let mode = 'dry-run', explicit = false;
  while (argv.length) {
    const arg = argv.shift();
    if (arg === '--from') {
      if (options.from || !argv.length || argv[0].startsWith('--')) throw new Error('--from requires one source directory');
      options.from = argv.shift();
    } else if (['--dry-run', '--apply', '--initialize', '--rollback'].includes(arg)) {
      if (explicit) throw new Error('Choose exactly one operation');
      explicit = true; mode = arg.slice(2);
      if (mode === 'rollback' && argv.length && !argv[0].startsWith('--')) options.backupId = argv.shift();
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  return { id, options, mode };
}
function main(argv = process.argv.slice(2), projectRoot = path.resolve(__dirname, '..')) {
  const { id, options, mode } = parse([...argv]);
  const result = mode === 'apply' ? applyImport(projectRoot, id, options)
    : mode === 'initialize' ? initialize(projectRoot, id, options)
      : mode === 'rollback' ? rollbackImport(projectRoot, id, options)
        : planImport(projectRoot, id, options);
  process.stdout.write(JSON.stringify({ operation: mode, ...result }, null, 2) + '\n');
  if (mode === 'dry-run' && result.localEdits.length) process.exitCode = 2;
  return result;
}
if (require.main === module) { try { main(); } catch (error) { process.stderr.write(`Experience import refused: ${error.message}\n`); process.exitCode = 1; } }
module.exports = { main, parse };
