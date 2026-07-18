import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { DefenseApp } from './DefenseApp.tsx'

// URL 파라미터로 모드 선택: ?mode=defense
const params = new URLSearchParams(window.location.search)
const mode = params.get('mode')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {mode === 'defense' ? <DefenseApp /> : <App />}
  </StrictMode>,
)
