import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // react-rnd's bundled react-draggable reads process.env.DRAGGABLE_DEBUG;
  // without this shim every drag throws "process is not defined"
  define: { 'process.env.DRAGGABLE_DEBUG': 'false' },
  server: {
    proxy: {
      '/api': { target: 'http://127.0.0.1:4711' },
      // ws: true is load-bearing — without it Vite silently drops the upgrade
      '/ws': { target: 'http://127.0.0.1:4711', ws: true },
    },
  },
})
