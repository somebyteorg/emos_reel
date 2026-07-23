import { readdirSync, readFileSync } from 'node:fs'
import { defineConfig, type Plugin } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath, URL } from 'node:url'

function libmediaAvPlayerAssets(): Plugin {
  const assetDirectory = fileURLToPath(new URL('./node_modules/@libmedia/avplayer/dist/esm/', import.meta.url))
  return {
    name: 'libmedia-avplayer-assets',
    apply: 'build',
    generateBundle() {
      for (const fileName of readdirSync(assetDirectory)) {
        if (fileName === 'avplayer.js' || !fileName.endsWith('.avplayer.js')) continue
        this.emitFile({
          type: 'asset',
          fileName: `assets/${fileName}`,
          source: readFileSync(new URL(fileName, `file://${assetDirectory}/`)),
        })
      }
    },
  }
}

function libmediaDebugPlaybackRate(): Plugin {
  const avPlayerEntry = '/@libmedia/avplayer/dist/esm/avplayer.js'
  const playbackRateClamp = /this\.playRate=\(0,([\w$]+)\.A\)\(e,\.5,2\)/g
  return {
    name: 'libmedia-debug-playback-rate',
    enforce: 'pre',
    transform(code, id) {
      if (!id.replaceAll('\\', '/').includes(avPlayerEntry)) return
      const matches = [...code.matchAll(playbackRateClamp)]
      if (matches.length !== 1) this.error(`无法定位 libmedia 播放倍速限制，匹配到 ${matches.length} 处`)
      return code.replace(playbackRateClamp, 'this.playRate=(0,$1.A)(e,.5,5)')
    },
  }
}

/**
 * Enable SharedArrayBuffer for libmedia multi-thread workers.
 * credentialless is preferred over require-corp so cross-origin media/API
 * fetches still work without every host sending CORP headers.
 */
const isolationHeaders = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'credentialless',
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue(), tailwindcss(), libmediaDebugPlaybackRate(), libmediaAvPlayerAssets()],
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
  optimizeDeps: {
    exclude: ['@libmedia/avplayer'],
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    headers: isolationHeaders,
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
  preview: {
    headers: isolationHeaders,
  },
})
