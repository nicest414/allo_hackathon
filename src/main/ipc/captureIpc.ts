import electron from 'electron'
import { IPC_CHANNELS } from '../../shared/types/ipc'
import type { CaptureDesktopSourcesRequest, ScreenAccessStatus } from '../../shared/types/ipc'
import { listDesktopSources } from '../capture/desktopSources'

const { ipcMain, systemPreferences, shell } = electron

// macOS「プライバシーとセキュリティ > 画面収録」を直接開くURL。
const SCREEN_SETTINGS_URL =
  'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture'

export function registerCaptureIpc(): void {
  ipcMain.handle(
    IPC_CHANNELS.captureDesktopSources,
    async (_event, request?: CaptureDesktopSourcesRequest) => {
      return listDesktopSources(request)
    }
  )

  // 画面収録許可の状態を返す。macOS以外は許可不要なので 'granted' 扱い。
  ipcMain.handle(IPC_CHANNELS.captureScreenAccessStatus, (): ScreenAccessStatus => {
    if (process.platform !== 'darwin') {
      return 'granted'
    }
    return systemPreferences.getMediaAccessStatus('screen') as ScreenAccessStatus
  })

  // OSの画面収録許可の設定画面を開く（macOS）。
  ipcMain.handle(IPC_CHANNELS.captureOpenScreenSettings, async (): Promise<void> => {
    if (process.platform === 'darwin') {
      await shell.openExternal(SCREEN_SETTINGS_URL)
    }
  })
}
