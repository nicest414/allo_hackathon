import { app, BrowserWindow } from 'electron'
import { registerCaptureIpc } from './ipc/captureIpc'
import { registerSttIpc } from './ipc/sttIpc'
import { createOverlayWindow } from './windows/createOverlayWindow'

let overlayWindow: BrowserWindow | null = null

app.whenReady().then(() => {
  overlayWindow = createOverlayWindow()
  registerCaptureIpc()
  registerSttIpc(() => overlayWindow)

  app.on('activate', () => {
    // macOS: Dockアイコンクリック時にウィンドウが無ければ再生成する
    if (BrowserWindow.getAllWindows().length === 0) {
      overlayWindow = createOverlayWindow()
    }
  })
})

app.on('window-all-closed', () => {
  // オーバーレイ常駐アプリだが、ハッカソン段階では全OSで終了させて挙動を単純化する
  app.quit()
})
