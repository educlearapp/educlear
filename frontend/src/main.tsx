import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './App.css'
import App from './App.tsx'
import { reconcileEduClearAppVersionCache } from './utils/appVersionCache'
import { registerEduClearStorageDebugGlobals } from './utils/educlearStorageDebug'

reconcileEduClearAppVersionCache()

if (import.meta.env.DEV) {
  registerEduClearStorageDebugGlobals()
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
