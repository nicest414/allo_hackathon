import electron from 'electron'
import { IPC_CHANNELS } from '../../shared/types/ipc'
import type { OverlaySetClickThroughRequest } from '../../shared/types/ipc'
import { setClickThrough } from '../windows/createOverlayWindow'

const { ipcMain } = electron

/**
 * renderer⇄main：オーバーレイのクリック透過ON/OFF切り替えipcMainハンドラを登録する。
 * UIコントロール上にマウスがある間だけrenderer側からOFFにし、操作可能にする。
 */
export function registerWindowIpc(getOverlayWindow: () => Electron.BrowserWindow | null): void {
  ipcMain.handle(
    IPC_CHANNELS.overlaySetClickThrough,
    (_event, request: OverlaySetClickThroughRequest) => {
      const overlayWindow = getOverlayWindow()
      if (overlayWindow) {
        setClickThrough(overlayWindow, request.enabled)
      }
    }
  )
}
