import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        // React is the one vendor piece every screen shares; keeping it in its
        // own file lets it stay cached across app updates.
        manualChunks: { react: ['react', 'react-dom'] },
      },
    },
  },
  server: {
    port: 5199,
    strictPort: true,
    proxy: {
      '/api': 'http://127.0.0.1:8787',
    },
  },
})
