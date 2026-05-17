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
  base: '/',
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
