import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import vue from '@vitejs/plugin-vue'
import type { Plugin } from 'vite'

/** monaco-editor ESM bundles reference source maps that are not shipped (e.g. marked.umd.js.map). */
function stripMonacoBrokenSourceMapUrls(): Plugin {
  return {
    name: 'strip-monaco-broken-sourcemap-urls',
    enforce: 'pre',
    transform(code, id) {
      if (!id.includes('monaco-editor')) return null
      if (!code.includes('sourceMappingURL')) return null
      return {
        code: code.replace(/\n?\/\/# sourceMappingURL=[^\n]*/g, ''),
        map: null
      }
    }
  }
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@shared': resolve('src/shared')
      }
    },
    build: {
      rollupOptions: {
        // 扩展宿主作为独立入口打包成 out/main/extension-host.js，由 utilityProcess.fork 拉起
        input: {
          index: resolve('src/main/index.ts'),
          'extension-host': resolve('src/main/extension-host/host-entry.ts')
        }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@shared': resolve('src/shared')
      }
    }
  },
  renderer: {
    optimizeDeps: {
      exclude: ['eslint', 'prettier', 'monaco-editor']
    },
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer'),
        '@shared': resolve('src/shared')
      }
    },
    plugins: [
      stripMonacoBrokenSourceMapUrls(),
      vue({
        template: {
          compilerOptions: {
            isCustomElement: (tag) => tag === 'webview'
          }
        }
      })
    ],
    css: {
      postcss: './postcss.config.js'
    }
  }
})
