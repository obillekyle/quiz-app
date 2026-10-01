import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
export default defineConfig({
  plugins: [
    vue(),
    {
      // Cloudflare's Rocket Loader, on for the okyle.dev zone, defers every
      // script tag it finds, module scripts included, and the app then
      // mounts late behind its loader. data-cfasync="false" on the tag tells
      // it to leave the tag alone.
      name: 'cfasync',
      transformIndexHtml: (html) => html.replace(/<script /g, '<script data-cfasync="false" '),
    },
  ],
  // `@/x` means `src/x`, the same alias tsconfig.json declares. A leading
  // slash is the project root to Vite.
  resolve: { alias: { '@': '/src' } },
  // 3000 is taken on this machine; cutvid uses 3200 and reviewer 3210.
  // `/api` goes to the server (server/, port 3221), so the app calls its own
  // origin in development exactly as it will when both are deployed together.
  server: {
    port: 3220,
    strictPort: true,
    // changeOrigin off: the server sees Host localhost:3220, the address the
    // browser used, and builds Google's redirect URI from it. The string
    // shorthand turns changeOrigin on and the server saw localhost:3221.
    proxy: { '/api': { target: 'http://localhost:3221', changeOrigin: false } },
  },
})
