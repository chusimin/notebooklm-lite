import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 开发服务器：5173 端口，/api 代理到 FastAPI 后端（8765）
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        // 用 127.0.0.1 而非 localhost，避免 Node 优先解析到 IPv6 ::1 而后端只监听 IPv4
        target: 'http://127.0.0.1:8765',
        changeOrigin: true,
        // SSE 不缓冲：禁用压缩协商，并在响应上标记 no-cache / 关闭代理缓冲
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq) => {
            proxyReq.setHeader('Accept-Encoding', 'identity')
          })
          proxy.on('proxyRes', (proxyRes) => {
            const ct = String(proxyRes.headers['content-type'] || '')
            if (ct.includes('text/event-stream')) {
              proxyRes.headers['cache-control'] = 'no-cache, no-transform'
              proxyRes.headers['x-accel-buffering'] = 'no'
            }
          })
        },
      },
    },
  },
})
