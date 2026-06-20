import electron from 'electron'
import { IPC_CHANNELS } from '../../shared/types/ipc'
import type { CaptureDesktopSourcesRequest } from '../../shared/types/ipc'
import { listDesktopSources } from '../capture/desktopSources'

const { ipcMain } = electron

export function registerCaptureIpc(): void {
  ipcMain.handle(
    IPC_CHANNELS.captureDesktopSources,
    async (_event, request?: CaptureDesktopSourcesRequest) => {
      return listDesktopSources(request)
    }
  )
}
