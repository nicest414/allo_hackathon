import { cpSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

const __dirname = dirname(fileURLToPath(import.meta.url))

// MediaPipeのWASMはCSP(script-src 'self')のためCDNから読み込めない。
// node_modulesから同一オリジン配信用のpublicへ毎回コピーし、gitには含めない。
const mediapipeWasmSrcDir = resolve(__dirname, 'node_modules/@mediapipe/tasks-vision/wasm')
const mediapipeWasmDestDir = resolve(__dirname, 'src/renderer/public/mediapipe/wasm')
if (existsSync(mediapipeWasmSrcDir)) {
  mkdirSync(mediapipeWasmDestDir, { recursive: true })
  cpSync(mediapipeWasmSrcDir, mediapipeWasmDestDir, { recursive: true })
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/main/index.ts')
        }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/preload/index.ts')
        }
      }
    }
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    plugins: [react()]
  }
})
