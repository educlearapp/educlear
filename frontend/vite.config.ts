import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8')) as {
  version?: string
}

const CERT_DIR = process.env.VITE_LOCAL_CERT_DIR || join(homedir(), 'EduClear-certs')
const CERT_NAME = process.env.VITE_LOCAL_CERT_NAME || 'localhost+3'
const KEY_PATH = join(CERT_DIR, `${CERT_NAME}-key.pem`)
const CERT_PATH = join(CERT_DIR, `${CERT_NAME}.pem`)

/**
 * Local iPhone HTTPS only — enabled when VITE_LOCAL_HTTPS=1 (see npm run dev:https).
 * Never falls back to HTTP: missing certs abort startup with a clear error.
 */
function localHttpsConfig(): { key: Buffer; cert: Buffer } | undefined {
  const enabled = String(process.env.VITE_LOCAL_HTTPS || '').trim() === '1'
  if (!enabled) return undefined

  if (!existsSync(KEY_PATH) || !existsSync(CERT_PATH)) {
    throw new Error(
      [
        '[vite] Local HTTPS is required (VITE_LOCAL_HTTPS=1) but mkcert files were not found.',
        `  Expected key:  ${KEY_PATH}`,
        `  Expected cert: ${CERT_PATH}`,
        '  Create them with mkcert, for example:',
        `    mkdir -p "${CERT_DIR}" && cd "${CERT_DIR}" && mkcert localhost 127.0.0.1 ::1 "$(ipconfig getifaddr en0)"`,
        '  Then install/trust the mkcert root CA on the iPhone before Safari GPS will work.',
      ].join('\n')
    )
  }

  console.log(`[vite] Local HTTPS enabled`)
  console.log(`[vite]   cert: ${CERT_PATH}`)
  console.log(`[vite]   key:  ${KEY_PATH}`)

  return {
    key: readFileSync(KEY_PATH),
    cert: readFileSync(CERT_PATH),
  }
}

const https = localHttpsConfig()

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  envPrefix: ['VITE_'],
  server: {
    host: '0.0.0.0',
    port: 5173,
    ...(https ? { https } : {}),
    // Same-origin proxy for HTTPS LAN / iPhone — browser must not call http://host:3000.
    // Login and session use /auth/* (also mounted at /api/auth on the backend).
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3000',
        changeOrigin: true,
      },
      '/auth': {
        target: 'http://127.0.0.1:3000',
        changeOrigin: true,
      },
    },
  },
  define: {
    'import.meta.env.VITE_FEE_CHECK_BUILD_ID': JSON.stringify(
      process.env.VITE_FEE_CHECK_BUILD_ID || `${pkg.version || '0'}-${Date.now()}`
    ),
  },
})
