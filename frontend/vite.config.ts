import path from 'node:path'
import react from '@vitejs/plugin-react'
import cesium from 'vite-plugin-cesium'
import { defineConfig } from 'vite'
import { cesiumDeferred, CESIUM_DIR } from './build/cesiumPlugin'

export default defineConfig({
  plugins: [
    react(),
    // Versioned directory (cesium-<x.y.z>/) so the unhashed engine files can be cached for a year without ever going stale.
    cesium({ cesiumBaseUrl: CESIUM_DIR }),
    cesiumDeferred(),
  ],
  define: { __CESIUM_DIR__: JSON.stringify(CESIUM_DIR) },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  // '/' for GitHub Pages / dev; the combined deployment builds with VITE_BASE=/_viewer/ so its assets never collide with the main site
  base: process.env.VITE_BASE ?? '/',
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
})
