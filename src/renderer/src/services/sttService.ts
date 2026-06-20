import type { SttAudioChunkRequest, SttStartRequest, SttTranscriptEvent } from '../../../shared/types/ipc'

/**
 * STT_PROVIDERの実体を意識しない、renderer側の薄いIPC窓口。
 */
export function startStt(request: SttStartRequest): Promise<void> {
  return window.allo.stt.start(request)
}

export function stopStt(): Promise<void> {
  return window.allo.stt.stop()
}

export function sendSttAudioChunk(request: SttAudioChunkRequest): Promise<void> {
  return window.allo.stt.sendAudioChunk(request)
}

export function onSttTranscript(listener: (event: SttTranscriptEvent) => void): () => void {
  return window.allo.stt.onTranscript(listener)
}
