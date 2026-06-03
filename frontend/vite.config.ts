import { readFileSync } from 'node:fs'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8')) as {
  version?: string
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  envPrefix: ['VITE_'],
  define: {
    'import.meta.env.VITE_FEE_CHECK_BUILD_ID': JSON.stringify(
      process.env.VITE_FEE_CHECK_BUILD_ID || `${pkg.version || '0'}-${Date.now()}`
    ),
  },
})
