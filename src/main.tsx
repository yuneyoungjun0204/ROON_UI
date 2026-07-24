import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { DefenseApp } from './DefenseApp.tsx'
import { BridgeApp } from './BridgeApp.tsx'

// URL 파라미터로 모드 선택: ?mode=defense | ?mode=bridge
const params = new URLSearchParams(window.location.search)
const mode = params.get('mode')

function getApp() {
  switch (mode) {
    case 'defense':
      return <DefenseApp />;
    case 'bridge':
      return <BridgeApp />;
    default:
      return <App />;
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {getApp()}
  </StrictMode>,
)
