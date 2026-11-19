import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
// En Docker el core se llama "siga-core"; corriendo localmente (npm run dev)
// hay que usar localhost. Se puede forzar con VITE_PROXY_TARGET.
const API_TARGET = process.env.VITE_PROXY_TARGET || 'http://localhost:8000'

export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    include: ['html5-qrcode']
  },
  server: {
    watch: {
      usePolling: true,
    },
    host: true, // needed for docker
    proxy: {
      '/api': {
        target: API_TARGET,
        changeOrigin: true
      },
      '/auth': {
        target: API_TARGET,
        changeOrigin: true
      },
      '/core': {
        target: API_TARGET,
        changeOrigin: true
      },
      '/ws': {
        target: API_TARGET,
        changeOrigin: true,
        ws: true
      }
    }
  }
})
