import { defineConfig } from 'vite'
import { resolve } from 'node:path'

export default defineConfig({
  root: 'src',
  base: './',
  publicDir: '../public',
  resolve: {
    dedupe: ['three']
  },
  /* three must never be pre-bundled: threejs-water-pro (served from the
     repo, outside optimizeDeps) and the app must share one three.core.js /
     three/tsl module instance, or TSL's stack state splits in two. */
  optimizeDeps: {
    exclude: ['three', 'three/webgpu', 'three/tsl']
  },
  server: {
    host: '127.0.0.1',
    port: 0,
    strictPort: false
  },
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    rollupOptions: {
      input: resolve(process.cwd(), 'src/index.html')
    }
  }
})
