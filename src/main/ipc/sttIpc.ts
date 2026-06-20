import electron from 'electron'
import { IPC_CHANNELS } from '../../shared/types/ipc'
import type { SttAudioChunkRequest, SttStartRequest, SttTranscriptEvent } from '../../shared/types/ipc'
import { createSttProvider } from '../stt/createSttProvider'
import type { SttProvider } from '../stt/SttProvider'

const { ipcMain } = electron

/**
 * renderer⇄main：音声chunk受信→STT結果送信のipcMainハンドラを登録する。
 * transcriptはgetTargetWindow()が返すWindowへのみ送信する。
 */
export function registerSttIpc(getTargetWindow: () => Electron.BrowserWindow | null): void {
  let provider: SttProvider | undefined
  let unsubscribeTranscript: (() => void) | undefined

  ipcMain.handle(IPC_CHANNELS.sttStart, async (_event, request: SttStartRequest) => {
    unsubscribeTranscript?.()

    provider = createSttProvider()
    unsubscribeTranscript = provider.onTranscript((segment) => {
      const payload: SttTranscriptEvent = { text: segment.text, isFinal: segment.isFinal }
      getTargetWindow()?.webContents.send(IPC_CHANNELS.sttTranscript, payload)
    })

    await provider.start(request)
  })

  ipcMain.handle(IPC_CHANNELS.sttStop, async () => {
    await provider?.stop()
    unsubscribeTranscript?.()
    unsubscribeTranscript = undefined
    provider = undefined
  })

  ipcMain.handle(IPC_CHANNELS.sttAudioChunk, async (_event, request: SttAudioChunkRequest) => {
    await provider?.sendAudioChunk(request.audio)
  })
}
