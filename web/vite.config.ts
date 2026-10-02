import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
export default defineConfig({
  plugins: [
    vue(),
    {
      name: 'cfasync',
      transformIndexHtml: (html) => html.replace(/<script /g, '<script data-cfasync="false" '),
    },
  ],
  resolve: { alias: { '@': '/src' } },
  server: {
    port: 3220,
    strictPort: true,
    proxy: { '/api': { target: 'http://localhost:3221', changeOrigin: false } },
  },
})
