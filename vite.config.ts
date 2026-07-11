import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // PORT 환경변수가 있으면 그 포트로 (프리뷰 도구가 자동 할당), 없으면 기본 5173
    port: Number(process.env.PORT) || 5173,
  },
})
