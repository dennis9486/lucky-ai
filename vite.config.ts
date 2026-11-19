import { resolve } from 'node:path'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'

export default defineConfig({
  root: 'src/renderer',
  plugins: [
    vue({
      template: {
        compilerOptions: {
          isCustomElement: (tag) => tag === 'webview'
        }
      }
    })
  ],
  resolve: {
    alias: {
      '@renderer': resolve('src/renderer')
    }
  },
  optimizeDeps: {
    exclude: ['monaco-editor']
  },
  server: {
    host: '127.0.0.1',
    port: 5180
  }
})
