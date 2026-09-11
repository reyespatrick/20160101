import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { VitePWA } from 'vite-plugin-pwa'

/**
 * The version the app shows, decided at build time and never edited by hand.
 *
 * The build number is the repository's commit count: it goes up on its own with every commit,
 * it is the same for everyone building the same code, and it says something true — this build
 * is the 143rd state of the project. A checkout without history (a CI export, a downloaded zip)
 * simply has no build number rather than a wrong one.
 */
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))
const git = (cmd) => {
  try {
    return execSync(cmd, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
  } catch {
    return ''
  }
}
const build = git('git rev-list --count HEAD')
const commit = git('git rev-parse --short HEAD')
const VERSION = { version: pkg.version, build: build || '', commit, builtAt: new Date().toISOString() }

export default defineConfig({
  define: {
    // A single frozen object rather than four globals: one thing to import, one thing to show.
    __APP_VERSION__: JSON.stringify(VERSION),
  },
  plugins: [
    vue(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['icons/*.png', 'splash.png'],
      manifest: {
        name: 'INMO · Inmovilla',
        short_name: 'INMO',
        description: 'Propiedades, clientes, agenda y propietarios del CRM Inmovilla',
        lang: 'es',
        start_url: '/',
        display: 'standalone',
        background_color: '#ffffff',
        theme_color: '#2e3192',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        cleanupOutdatedCaches: true,
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],
        globPatterns: ['**/*.{js,css,html,png,svg,ico,woff2}'],
        runtimeCaching: [
          {
            // Property photos: cache first, they are immutable per URL
            urlPattern: ({ request }) => request.destination === 'image',
            handler: 'CacheFirst',
            options: {
              cacheName: 'property-images',
              expiration: { maxEntries: 300, maxAgeSeconds: 60 * 60 * 24 * 14 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
  server: {
    host: true, // also reachable from a phone on the same Wi-Fi: http://<pc-ip>:5173
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:3000', changeOrigin: true },
      '/photos': { target: 'http://localhost:3000', changeOrigin: true },
      '/mock-photos': { target: 'http://localhost:3000', changeOrigin: true },
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.js'],
  },
})
