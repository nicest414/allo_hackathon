import electron from 'electron'
import { enableLoopbackAudio } from './audio/enableLoopbackAudio'
import { registerCaptureIpc } from './ipc/captureIpc'
import { registerLlmIpc } from './ipc/llmIpc'
import { registerSttIpc } from './ipc/sttIpc'
import { registerWindowIpc } from './ipc/windowIpc'
import { createOverlayWindow } from './windows/createOverlayWindow'

const { app, BrowserWindow } = electron

// transparent:trueなBrowserWindow上でアルファ付き動画を再生すると、GPUの動画デコード経路が
// ウィンドウの透過と正しく合成されずわずかに黒みがかる(Chromiumの既知の制約)。
// ソフトウェアデコードに切り替えることで透過動画(稲妻演出)を正しく合成させる。
app.commandLine.appendSwitch('disable-accelerated-video-decode')

let overlayWindow: Electron.BrowserWindow | null = null

// electron-audio-loopback導入後はinitMain()がreadyイベント前の呼び出しを要求するため、
// app.whenReady()より前のトップレベルで呼び出す。
void enableLoopbackAudio().then((result) => {
  if (result.status !== 'enabled') {
    console.warn(`[audio] loopback ${result.status}: ${result.message}`)
  }
})

app.whenReady().then(() => {
  registerLlmIpc()
  overlayWindow = createOverlayWindow()
  overlayWindow.webContents.on('console-message', (_event, _level, message) => {
    console.log(`[renderer] ${message}`)
  })
  registerCaptureIpc()
  registerSttIpc(() => overlayWindow)
  registerWindowIpc(() => overlayWindow)

  // レンダラープロセスからの navigator.mediaDevices.getDisplayMedia 呼び出しを自動処理する。
  // macOS でシステムループバック音声を取得するための 'loopback' ターゲットを設定。
  electron.session.defaultSession.setDisplayMediaRequestHandler((_request, callback) => {
    electron.desktopCapturer.getSources({ types: ['screen'] })
      .then((sources) => {
        callback({
          video: sources[0],
          audio: 'loopback'
        })
      })
      .catch((error) => {
        console.error('Failed to get display media request sources:', error)
      })
  })

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
