import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    // 固定前端开发端口，方便后端 CORS 和访问地址保持一致。
    port: 5173,
    proxy: {
      // 前端请求 /api 会被 Vite 转发到 FastAPI 后端，避免浏览器跨域问题。
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
    },
  },
})
