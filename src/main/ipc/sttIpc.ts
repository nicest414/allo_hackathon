import electron from 'electron'
import { IPC_CHANNELS } from '../../shared/types/ipc'
import type {
  SttAudioChunkRequest,
  SttSpeaker,
  SttStartRequest,
  SttTranscriptEvent
} from '../../shared/types/ipc'
import { createSttProvider } from '../stt/createSttProvider'
import type { SttProvider } from '../stt/SttProvider'

const { ipcMain } = electron

interface SpeakerSession {
  provider: SttProvider
  unsubscribe: () => void
}

/**
 * renderer⇄main：音声chunk受信→STT結果送信のipcMainハンドラを登録する。
 * 話者(candidate/interviewer)ごとにプロバイダを保持し、就活生マイクと面接官ループバックを
 * 同時に文字起こしできるようにする。transcriptはspeaker付きで対象Windowへ送る。
 */
export function registerSttIpc(getTargetWindow: () => Electron.BrowserWindow | null): void {
  const sessions = new Map<SttSpeaker, SpeakerSession>()

  async function stopSpeaker(speaker: SttSpeaker): Promise<void> {
    const session = sessions.get(speaker)
    if (!session) {
      return
    }
    sessions.delete(speaker)
    session.unsubscribe()
    await session.provider.stop()
  }

  ipcMain.handle(IPC_CHANNELS.sttStart, async (_event, request: SttStartRequest) => {
    await stopSpeaker(request.speaker)

    const provider = createSttProvider()
    const unsubscribe = provider.onTranscript((segment) => {
      const payload: SttTranscriptEvent = {
        text: segment.text,
        isFinal: segment.isFinal,
        speaker: request.speaker
      }
      getTargetWindow()?.webContents.send(IPC_CHANNELS.sttTranscript, payload)
    })

    sessions.set(request.speaker, { provider, unsubscribe })
    await provider.start(request)
  })

  ipcMain.handle(IPC_CHANNELS.sttStop, async (_event, speaker: SttSpeaker) => {
    await stopSpeaker(speaker)
  })

  ipcMain.handle(IPC_CHANNELS.sttAudioChunk, async (_event, request: SttAudioChunkRequest) => {
    await sessions.get(request.speaker)?.provider.sendAudioChunk(request.audio)
  })
}
