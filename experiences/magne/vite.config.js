import { defineConfig } from 'vite'
import { resolve } from 'path'

export default defineConfig({
  root: 'src',
  base: './',
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'src/index.html')
      }
    }
  },
  resolve: {
    alias: {
      'three': 'three',
      'three/addons/': 'three/examples/jsm/'
    }
  },
  optimizeDeps: {
    include: ['three', 'gsap', 'lottie-web', 'hammerjs']
  }
})
