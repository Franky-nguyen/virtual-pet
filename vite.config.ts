import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import electron from 'vite-plugin-electron'
import renderer from 'vite-plugin-electron-renderer'

export default defineConfig({
  build: {
    target: 'esnext',
    minify: 'esbuild',
    cssMinify: true,
    sourcemap: false,
    reportCompressedSize: false,
  },
  plugins: [
    react(),
    electron([
      {
        entry: 'electron/main.ts',
        onstart(options) {
          options.startup()
        },
        vite: {
          build: {
            outDir: 'dist-electron',
            minify: 'esbuild',
            sourcemap: false,
          }
        }
      },
      {
        entry: 'electron/preload.ts',
        onstart(options) {
          options.reload()
        },
        vite: {
          build: {
            outDir: 'dist-electron',
            minify: 'esbuild',
            sourcemap: false,
            lib: {
              // Sandboxed Electron preloads must be CommonJS. The plugin derives
              // the format from package.json "type" ("module" → ESM), which the
              // sandboxed renderer silently refuses to load — killing every
              // main→renderer IPC channel (force-taskbar-ui, mode-changed, …).
              entry: 'electron/preload.ts',
              formats: ['cjs'],
              fileName: () => '[name].cjs'
            }
          }
        }
      }
    ]),
    renderer()
  ]
})
