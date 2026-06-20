/// <reference types="vite/client" />

import type { AlloPreloadApi } from '../../shared/types/ipc'

declare global {
  interface Window {
    allo: AlloPreloadApi
  }
}
