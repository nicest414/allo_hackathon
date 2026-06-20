import type {
  SttAudioChunkRequest,
  SttSpeaker,
  SttStartRequest,
  SttTranscriptEvent
} from '../../../shared/types/ipc'

/**
 * STT_PROVIDERの実体を意識しない、renderer側の薄いIPC窓口。
 * 話者(candidate/interviewer)はリクエスト/イベントに含めて受け渡す。
 */
export function startStt(request: SttStartRequest): Promise<void> {
  return window.allo.stt.start(request)
}

export function stopStt(speaker: SttSpeaker): Promise<void> {
  return window.allo.stt.stop(speaker)
}

export function sendSttAudioChunk(request: SttAudioChunkRequest): Promise<void> {
  return window.allo.stt.sendAudioChunk(request)
}

export function onSttTranscript(listener: (event: SttTranscriptEvent) => void): () => void {
  return window.allo.stt.onTranscript(listener)
}
