import type { ResponseJudgment, TranscriptSegment } from './analysis'
import type { DesktopCaptureSource, DesktopCaptureSourcesRequest } from './capture'

export const IPC_CHANNELS = {
  sttStart: 'stt:start',
  sttStop: 'stt:stop',
  sttAudioChunk: 'stt:audio-chunk',
  sttTranscript: 'stt:transcript',
  llmJudgeResponse: 'llm:judge-response',
  captureDesktopSources: 'capture:desktop-sources',
  captureEnableLoopbackAudio: 'enable-loopback-audio',
  captureDisableLoopbackAudio: 'disable-loopback-audio',
  overlaySetClickThrough: 'overlay:set-click-through'
} as const

export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS]

/** STTの話者。就活生マイクと面接官ループバックを同時に動かすための識別子。 */
export type SttSpeaker = 'candidate' | 'interviewer'

export interface SttStartRequest {
  sampleRate: number
  language?: string
  speaker: SttSpeaker
}

export interface SttAudioChunkRequest {
  audio: ArrayBuffer
  speaker: SttSpeaker
}

export type SttTranscriptEvent = Pick<TranscriptSegment, 'text' | 'isFinal'> & {
  speaker: SttSpeaker
}

export type LlmJudgeResponseRequest = Pick<ResponseJudgment, 'question' | 'answer'>

export type LlmJudgeResponseResult = Pick<ResponseJudgment, 'score' | 'reason'>

export type CaptureDesktopSourcesRequest = DesktopCaptureSourcesRequest

export type CaptureDesktopSourcesResult = DesktopCaptureSource[]

export interface OverlaySetClickThroughRequest {
  enabled: boolean
}

export interface AlloPreloadApi {
  stt: {
    start: (request: SttStartRequest) => Promise<void>
    stop: (speaker: SttSpeaker) => Promise<void>
    sendAudioChunk: (request: SttAudioChunkRequest) => Promise<void>
    onTranscript: (listener: (event: SttTranscriptEvent) => void) => () => void
  }
  llm: {
    judgeResponse: (request: LlmJudgeResponseRequest) => Promise<LlmJudgeResponseResult>
  }
  capture: {
    listDesktopSources: (
      request?: CaptureDesktopSourcesRequest
    ) => Promise<CaptureDesktopSourcesResult>
    enableLoopbackAudio: () => Promise<void>
    disableLoopbackAudio: () => Promise<void>
  }
  overlay: {
    setClickThrough: (request: OverlaySetClickThroughRequest) => Promise<void>
  }
}
