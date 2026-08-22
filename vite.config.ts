import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.VITE_BASE_PATH || '/',
})
