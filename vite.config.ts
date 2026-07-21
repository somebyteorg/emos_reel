import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath, URL } from 'node:url'

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue(), tailwindcss()],
  build: {
    emptyOutDir: true,
    // https://github.com/vueuse/vueuse/issues/5387
    rolldownOptions: {
      onLog(level, log, defaultHandler) {
        if (log.code === 'INVALID_ANNOTATION') return
        else defaultHandler(level, log)
      },
    },
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      '/emos': {
        target: 'http://10.6.2.51:8000',
        changeOrigin: true,
        rewrite: (path) => path.replace('/emos', ''),
      },
      '/todb': {
        target: 'http://10.6.2.51:8005',
        changeOrigin: true,
        rewrite: (path) => path.replace('/todb', ''),
      },
    },
  },
})
