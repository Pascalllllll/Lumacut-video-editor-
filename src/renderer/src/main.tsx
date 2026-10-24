import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/inter'
import './styles/tokens.css'
import './styles/base.css'
import { App } from './App'

const renderJob = /^#render=(.+)$/.exec(window.location.hash)

if (renderJob) {
  // The hidden export window: no interface, just frames.
  void import('./render-worker').then((m) => m.runRender(decodeURIComponent(renderJob[1]!)))
} else {
  const root = document.getElementById('root')
  if (!root) throw new Error('Missing #root element')
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}
