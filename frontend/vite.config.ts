import path from 'node:path'
import react from '@vitejs/plugin-react'
import cesium from 'vite-plugin-cesium'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [
    react(),
    cesium(),
  ],
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
