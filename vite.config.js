import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import wasm from 'vite-plugin-wasm'
import topLevelAwait from 'vite-plugin-top-level-await'

// https://vitejs.dev/config/
export default defineConfig({
  root: 'frontend',
  base: './',  // Use relative paths for Electron file:// protocol compatibility
  plugins: [
    react(),
    wasm(),
    topLevelAwait(),
  ],
  define: {
    // Polyfill Node.js globals for browser compatibility (needed by Fortune Sheet and bip39)
    global: 'globalThis',
  },
  optimizeDeps: {
    include: ['yjs', 'y-websocket', 'tweetnacl', 'uint8arrays', '@popperjs/core', '@fortune-sheet/react'],
    exclude: ['@aspect-build/rules_js', 'argon2-browser'],
  },
  resolve: {
    dedupe: ['yjs', 'y-websocket'],
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,  // Disable source maps in production for faster builds
    minify: 'esbuild',  // esbuild is faster than terser
    commonjsOptions: {
      include: [/node_modules/],
    },
    target: 'esnext',
  },
  server: {
    port: 5174,
    strictPort: true,  // Fail if port is in use
    host: '127.0.0.1',  // Force IPv4 only
    fs: {
      strict: false,
    },
    watch: {
      // Use polling for network drives (like Z:)
      usePolling: true,
      interval: 1000,
    },
    // Proxy API requests to the unified server (port 3000)
    // This enables cross-compatibility between Electron (Vite dev) and hosted web app
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
})
