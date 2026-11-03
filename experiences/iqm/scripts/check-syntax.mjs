import { readdirSync, statSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { extname, join, resolve } from 'node:path'

const projectRoot = resolve(import.meta.dirname, '..')
const roots = ['scripts', 'src/js', 'test']
const extensions = new Set(['.js', '.mjs', '.cjs'])
const ignoredFiles = new Set([resolve(import.meta.filename)])

function collectFiles(directory) {
  return readdirSync(directory).flatMap(entry => {
    const absolutePath = join(directory, entry)
    return statSync(absolutePath).isDirectory() ? collectFiles(absolutePath) : [absolutePath]
  })
}

const files = roots
  .flatMap(root => collectFiles(join(projectRoot, root)))
  .filter(file => extensions.has(extname(file)) && !ignoredFiles.has(resolve(file)))

for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' })
  if (result.status !== 0) process.exit(result.status || 1)
}

console.log(`Syntax checked: ${files.length} files`)
