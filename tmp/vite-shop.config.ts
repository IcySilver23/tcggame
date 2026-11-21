// Temporary Vite config for a local visual check of the Pack Shop: the same app,
// but proxying /api at the isolated server on 8790 instead of the dev API.
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: Number(process.env.SHOP_VITE_PORT ?? 5288),
    strictPort: true,
    proxy: {
      '/api': process.env.SHOP_API ?? 'http://127.0.0.1:8790',
    },
  },
})
