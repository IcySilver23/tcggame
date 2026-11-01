// Throwaway config for verifying the DEALS hub against a sandbox save on a
// free port — the real dev API owns 8787. Deleted after the check.
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5200,
    strictPort: true,
    proxy: {
      '/api': 'http://127.0.0.1:8788',
    },
  },
})
