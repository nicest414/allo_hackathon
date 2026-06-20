import { app, BrowserWindow } from 'electron'
import { enableLoopbackAudio } from './audio/enableLoopbackAudio'
import { registerCaptureIpc } from './ipc/captureIpc'
import { registerSttIpc } from './ipc/sttIpc'
import { createOverlayWindow } from './windows/createOverlayWindow'

let overlayWindow: BrowserWindow | null = null

// electron-audio-loopback導入後はinitMain()がreadyイベント前の呼び出しを要求するため、
// app.whenReady()より前のトップレベルで呼び出す。
void enableLoopbackAudio().then((result) => {
  if (result.status !== 'enabled') {
    console.warn(`[audio] loopback ${result.status}: ${result.message}`)
  }
})

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
