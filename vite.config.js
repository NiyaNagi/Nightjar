import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import wasm from 'vite-plugin-wasm'
import topLevelAwait from 'vite-plugin-top-level-await'
import { VitePWA } from 'vite-plugin-pwa'

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  // Load .env files so VITE_GITHUB_PAT (and any other env vars) are available
  // The empty prefix '' loads ALL env vars, not just VITE_-prefixed ones
  const env = loadEnv(mode, process.cwd(), '');
  
  return {
  root: 'frontend',
  base: './',  // Use relative paths for Electron file:// protocol compatibility
  plugins: [
    react(),
    wasm(),
    topLevelAwait(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['nightjar-192.png', 'nightjar-512.png', 'nightjar-maskable-512.png'],
      manifest: false, // Use existing public/manifest.json
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,svg,woff2}'],
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024, // 8 MB — covers large main chunk
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts',
              expiration: { maxEntries: 30, maxAgeSeconds: 60 * 60 * 24 * 365 },
            },
          },
        ],
        // Skip Electron-only files
        navigateFallback: 'index.html',
        navigateFallbackDenylist: [/^\/api/],
      },
      devOptions: {
        enabled: false, // Only enable SW in production builds
      },
    }),
  ],
  define: {
    // Polyfill Node.js globals for browser compatibility (needed by Fortune Sheet and bip39)
    global: 'globalThis',
    // Inject app version from package.json
    __APP_VERSION__: JSON.stringify(require('./package.json').version),
    // Inject VITE_GITHUB_PAT for bug report modal (loaded from .env or CI secrets)
    // In CI, the PAT is provided via secrets.VITE_GITHUB_PAT at build time
    'process.env.VITE_GITHUB_PAT': JSON.stringify(env.VITE_GITHUB_PAT || ''),
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
    sourcemap: false,
    minify: 'esbuild',  // esbuild is faster than terser
    commonjsOptions: {
      include: [/node_modules/],
    },
    target: 'esnext',
    rollupOptions: {
      // Externalize Capacitor plugins - they're only available on mobile and are dynamically imported
      external: [
        '@capacitor/app',
        '@capacitor/clipboard',
        '@capacitor/share',
        '@capacitor/haptics',
        '@capacitor/device',
        '@capacitor/splash-screen',
      ],
    },
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
  };
})
