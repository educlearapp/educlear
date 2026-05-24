import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './App.css'
import App from './App.tsx'
import { registerEduClearStorageDebugGlobals } from './utils/educlearStorageDebug'

if (import.meta.env.DEV) {
  registerEduClearStorageDebugGlobals()
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
