import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// arXiv and ADS don't send CORS headers, so we proxy them in dev under the
// same /api/* paths the Cloudflare Worker serves in production.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api/arxiv': {
        target: 'https://export.arxiv.org',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/arxiv/, '/api/query'),
      },
      '/api/ads': {
        target: 'https://api.adsabs.harvard.edu',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/ads/, '/v1/search/query'),
      },
    },
  },
})
