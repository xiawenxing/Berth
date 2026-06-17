import React from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { App } from './App'
import { initTheme } from './lib/theme'

initTheme() // apply the saved (or default) color scheme before render

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
