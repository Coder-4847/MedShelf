import { defineConfig } from 'vitest/config'
import { defaultClientConditions } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

// GitHub Pages serves project sites from /<repo>/. The deploy workflow sets BASE_PATH.
const base = process.env.BASE_PATH ?? '/'

export default defineConfig({
  base,
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'icons/*.png'],
      manifest: {
        name: 'MedShelf',
        short_name: 'MedShelf',
        description: 'Your home medicine cabinet, organised.',
        theme_color: '#0f6b64',
        background_color: '#f6f7f8',
        display: 'standalone',
        orientation: 'any',
        start_url: base,
        scope: base,
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'icons/icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // App shell is precached; the heavy reader assets are cached on first use (see below).
        globPatterns: ['**/*.{js,css,html,svg,png,woff2,webmanifest,json,wasm}'],
        globIgnores: ['vendor/**', 'models/**'],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        navigateFallback: 'index.html',
        runtimeCaching: [
          {
            // Only the Tesseract fallback files; models and ONNX WASM are cached by the reader itself.
            urlPattern: ({ url }) => /\/vendor\/tesseract\//.test(url.pathname),
            handler: 'CacheFirst',
            options: {
              cacheName: 'medshelf-reader-v1',
              cacheableResponse: { statuses: [200] },
            },
          },
        ],
      },
    }),
  ],
  // Use onnxruntime-web's "extern wasm" build: the app loads its WASM itself (from the offline
  // cache), so it must not also be bundled into the site.
  resolve: { conditions: [...defaultClientConditions, 'onnxruntime-web-use-extern-wasm'] },
  worker: { format: 'es' },
  build: { target: 'es2022', chunkSizeWarningLimit: 1200 },
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.ts'],
    setupFiles: ['tests/unit/setup.ts'],
  },
})
