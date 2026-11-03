'use strict';
const { fs, path, safe, walk, digest, serialize, json, relative } = require('./files.cjs');
const { validateLock, browserLock } = require('./lock.cjs');
const scripts = {
  magne: { dev: 'vite --host 127.0.0.1 --port 0', build: 'vite build', preview: 'vite preview --host 127.0.0.1 --port 0' },
  iqm: {
    dev: 'vite --host 127.0.0.1 --port 0',
    'prebuild:renderer': 'node scripts/check-media-assets.mjs public',
    'build:renderer': 'vite build',
    'postbuild:renderer': 'node scripts/check-media-assets.mjs dist',
    build: 'npm run check && npm run build:renderer',
    preview: 'vite preview --host 127.0.0.1 --port 0',
    check: 'node scripts/check-syntax.mjs && npm test && npm run check:nanoscale && npm run check:assets',
    test: 'node --test test/*.test.mjs',
    'check:nanoscale': 'node scripts/check-nanoscale-camera.mjs',
    'check:assets': 'node scripts/check-media-assets.mjs public'
  }
};
const definitions = Object.freeze({
  magne: Object.freeze({ id: 'magne', roots: ['src'], dependencies: ['gsap', 'hammerjs', 'lottie-web', 'three'], excludedTests: [] }),
  iqm: Object.freeze({ id: 'iqm', roots: ['src', 'public'], dependencies: ['gsap', 'lottie-web', 'three'], excludedTests: ['app-protocol.test.mjs', 'pro-runtime-mode.test.mjs'] })
});
const owned = new Set([path.join('test', 'web-project.test.mjs')]);
function getProfile(name) { if (!Object.hasOwn(definitions, name)) throw new Error(`Unknown import profile: ${name}`); return definitions[name]; }
function managed(relativePath) {
  const key = relative(relativePath);
  if (owned.has(key)) return false;
  return ['src', 'public', 'scripts', 'test', 'config'].some(root => key.startsWith(root + path.sep)) || ['package.json', 'package-lock.json', 'vite.config.js'].includes(key);
}
function select(projectRoot, sourceRoot, name) {
  const profile = getProfile(name), source = path.resolve(sourceRoot);
  safe(source);
  const selected = new Map(), inputs = {}, excludedTests = [];
  function read(relativePath, optional = false) {
    const key = relative(relativePath), file = path.join(source, key); safe(file);
    if (optional && !fs.existsSync(file)) return null;
    const bytes = fs.readFileSync(file); inputs[`source:${key}`] = digest(bytes); return bytes;
  }
  function include(key, transform) {
    const bytes = read(key); selected.set(relative(key), transform ? Buffer.from(transform(bytes.toString('utf8'))) : bytes);
  }
  for (const root of profile.roots) {
    const directory = path.join(source, root);
    if (!fs.existsSync(directory) || !fs.lstatSync(directory).isDirectory()) throw new Error(`Incompatible upstream: missing ${root}`);
    for (const file of walk(directory)) {
      const key = path.relative(source, file);
      if (key.split(path.sep).some(part => ['node_modules', 'dist'].includes(part))) throw new Error(`Unexpected generated source content: ${key}`);
      include(key);
    }
  }
  if (!selected.has(path.join('src', 'index.html'))) throw new Error('Incompatible upstream: missing src/index.html');
  const sourceManifest = JSON.parse(read('package.json').toString('utf8'));
  const sourceLock = validateLock(JSON.parse(read('package-lock.json').toString('utf8')));
  if (!sourceManifest || !sourceManifest.dependencies || Object.keys(sourceManifest.dependencies).sort().join() !== [...profile.dependencies].sort().join() || !sourceManifest.devDependencies?.vite || typeof sourceManifest.version !== 'string') throw new Error('Incompatible upstream browser dependency shape');
  const pins = {};
  for (const dep of profile.dependencies) {
    const record = sourceLock.packages[`node_modules/${dep}`]; if (!record) throw new Error(`Missing browser dependency ${dep}`); pins[dep] = record.version;
  }
  const manifest = { name: name === 'magne' ? 'quantum-kiosk-magne' : 'quantum-kiosk-iqm-web', version: sourceManifest.version, private: true,
    description: name === 'magne' ? 'Microsoft Quantum Interactive Kiosk for Magne disclosure event' : 'IQM interactive touchscreen experience - standalone web renderer' };
  if (name === 'iqm') manifest.type = 'module';
  manifest.scripts = scripts[name];
  if (sourceManifest.engines) manifest.engines = sourceManifest.engines;
  if (name === 'magne') for (const key of ['keywords', 'author', 'license']) if (sourceManifest[key] !== undefined) manifest[key] = sourceManifest[key];
  manifest.dependencies = pins; manifest.devDependencies = { vite: sourceLock.packages['node_modules/vite']?.version };
  const lock = browserLock(sourceLock, manifest);
  selected.set('package.json', Buffer.from(serialize(manifest))); selected.set('package-lock.json', Buffer.from(serialize(lock)));
  if (name === 'iqm') {
    include(path.join('config', 'kiosk.config.json'));
    try { JSON.parse(selected.get(path.join('config', 'kiosk.config.json')).toString()); } catch { throw new Error('Malformed IQM runtime config'); }
    for (const script of ['check-media-assets.mjs', 'check-nanoscale-camera.mjs']) include(path.join('scripts', script));
    include(path.join('scripts', 'check-syntax.mjs'), text => {
      const expected = "const roots = ['electron', 'scripts', 'src/js']";
      if (text.split(expected).length !== 2) throw new Error('Incompatible upstream syntax checker');
      return text.replace(expected, "const roots = ['scripts', 'src/js', 'test']");
    });
    const testRoot = path.join(source, 'test');
    if (!fs.existsSync(testRoot)) throw new Error('Incompatible upstream: missing renderer tests');
    for (const file of walk(testRoot)) {
      const key = path.relative(source, file), text = read(key).toString('utf8');
      if (owned.has(key)) throw new Error(`Upstream collides with launcher-owned file: ${key}`);
      if (profile.excludedTests.includes(path.relative(testRoot, file))) { excludedTests.push(key); continue; }
      if (/electron[\\/]|['"](?:electron(?:\/[^'"]*)?|@electron\/[^'"]*)['"]/i.test(text)) throw new Error(`Unexpected Electron renderer test: ${key}`);
      if (!key.endsWith('.test.mjs')) throw new Error(`Unexpected upstream test file: ${key}`);
      selected.set(key, Buffer.from(text));
    }
    include('vite.config.js', text => {
      for (const token of ["root: 'src'", "base: './'", "publicDir: '../public'", "host: '127.0.0.1'", "dedupe: ['three']", "exclude: ['three', 'three/webgpu', 'three/tsl']", 'port: 5173']) if (!text.includes(token)) throw new Error(`Incompatible IQM Vite shape: ${token}`);
      if (text.split('port: 5173').length !== 2) throw new Error('Ambiguous Vite server port');
      return text.replace('port: 5173', 'port: 0');
    });
  } else {
    include('vite.config.js', text => {
      for (const token of ["root: 'src'", "base: './'", "outDir: '../dist'", "'three/addons/'", "include: ['three', 'gsap', 'lottie-web', 'hammerjs']"]) if (!text.includes(token)) throw new Error(`Incompatible MAGNE Vite shape: ${token}`);
      if (/\bserver\s*:/.test(text) || text.split('export default defineConfig({').length !== 2) throw new Error('Incompatible MAGNE Vite server shape');
      return text.replace('export default defineConfig({', "export default defineConfig({\n  server: { host: '127.0.0.1', port: 0, strictPort: false },");
    });
    const css = path.join('src', 'styles', 'variables.css');
    if (!selected.has(css)) throw new Error('Incompatible MAGNE font stylesheet');
    const text = selected.get(css).toString('utf8');
    const google = "@import url('https://fonts.googleapis.com/css2?family=Unica+One&display=swap');";
    if (text.split(google).length !== 2) throw new Error('Incompatible MAGNE Google font import');
    selected.set(css, Buffer.from(text.replace(google, '@font-face {\n  font-family: "Unica One";\n  src: url("/assets/fonts/UnicaOne/UnicaOne-Regular.ttf") format("truetype");\n  font-weight: 400;\n  font-style: normal;\n  font-display: swap;\n}')));
    for (const fileName of ['UnicaOne-Regular.ttf', 'OFL.txt']) {
      const file = path.join(projectRoot, 'integration', 'magne', 'fonts', 'UnicaOne', fileName); safe(file);
      const bytes = fs.readFileSync(file); inputs[`overlay:${fileName}`] = digest(bytes);
      selected.set(path.join('src', 'public', 'assets', 'fonts', 'UnicaOne', fileName), bytes);
    }
  }
  for (const file of walk(__dirname).filter(file => file.endsWith('.cjs'))) inputs[`importer:${path.basename(file)}`] = digest(fs.readFileSync(file));
  const cli = path.join(__dirname, '..', 'experience-import.cjs');
  if (fs.existsSync(cli)) inputs['importer:cli'] = digest(fs.readFileSync(cli));
  return { profile, selected, inputs, manifest, lock, excludedTests, dependencies: { ...pins, ...manifest.devDependencies }, dependencyCount: Object.keys(lock.packages).length - 1 };
}
module.exports = { getProfile, managed, select, scripts };
