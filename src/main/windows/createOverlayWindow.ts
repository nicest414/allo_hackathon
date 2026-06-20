import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import electron from 'electron'

const __dirname = dirname(fileURLToPath(import.meta.url))
const { BrowserWindow, screen } = electron

/**
 * Web会議画面の上に重ねる透明オーバーレイWindowを生成する。
 *
 * - transparent: 背景透過
 * - alwaysOnTop: 常に最前面（'screen-saver' レベルで他アプリより前に出す）
 * - frame: false: タイトルバー等のクローム非表示
 * - クリック透過は setClickThrough() でON/OFF切り替え可能（初期はON＝下のアプリを操作可能）
 *
 * 開発時はVite dev server、本番時はビルド済みHTMLを読み込む。
 */
export function createOverlayWindow(): Electron.BrowserWindow {
  const primaryDisplay = screen.getPrimaryDisplay()
  const { width, height } = primaryDisplay.workAreaSize

  const overlayWindow = new BrowserWindow({
    width,
    height,
    x: 0,
    y: 0,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: false,
    // 背景を完全透過にする（macOSで黒背景が残らないようにする）
    backgroundColor: '#00000000',
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      // クリック透過＋常時非フォーカスのオーバーレイのため、デフォルトの
      // バックグラウンドスロットリングが効くと顔解析等のrAF/タイマーが間引かれて停止する
      backgroundThrottling: false
    }
  })

  // 他アプリ（フルスクリーンのZoom等）より前面に出すための最前面レベル設定
  overlayWindow.setAlwaysOnTop(true, 'screen-saver')
  // すべてのワークスペース・フルスクリーンアプリ上にも表示する（macOS）
  overlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })

  // 初期状態はクリック透過ON：オーバーレイ越しに下のアプリを操作できる
  setClickThrough(overlayWindow, true)

  overlayWindow.once('ready-to-show', () => {
    overlayWindow.show()
  })

  loadOverlayContent(overlayWindow)

  return overlayWindow
}

/**
 * クリック透過のON/OFFを切り替える。
 * @param enabled true: マウスイベントを下のアプリへ素通し / false: オーバーレイ自身が受け取る
 */
export function setClickThrough(window: Electron.BrowserWindow, enabled: boolean): void {
  // forward: true で透過中もmousemove等のイベントはrendererに届く（hover演出用）
  window.setIgnoreMouseEvents(enabled, { forward: true })
}

function loadOverlayContent(window: Electron.BrowserWindow): void {
  const devServerUrl = process.env['ELECTRON_RENDERER_URL']
  if (devServerUrl) {
    window.loadURL(devServerUrl)
  } else {
    window.loadFile(join(__dirname, '../renderer/index.html'))
  }
}
