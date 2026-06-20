import type { ResponseJudgment, TranscriptSegment } from './analysis'

export const IPC_CHANNELS = {
  sttStart: 'stt:start',
  sttStop: 'stt:stop',
  sttAudioChunk: 'stt:audio-chunk',
  sttTranscript: 'stt:transcript',
  llmJudgeResponse: 'llm:judge-response'
} as const

export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS]

export interface SttStartRequest {
  sampleRate: number
  language?: string
}

export interface SttAudioChunkRequest {
  audio: ArrayBuffer
}

export type SttTranscriptEvent = Pick<TranscriptSegment, 'text' | 'isFinal'>

export type LlmJudgeResponseRequest = Pick<ResponseJudgment, 'question' | 'answer'>

export type LlmJudgeResponseResult = Pick<ResponseJudgment, 'score' | 'reason'>

export interface AlloPreloadApi {
  stt: {
    start: (request: SttStartRequest) => Promise<void>
    stop: () => Promise<void>
    sendAudioChunk: (request: SttAudioChunkRequest) => Promise<void>
    onTranscript: (listener: (event: SttTranscriptEvent) => void) => () => void
  }
  llm: {
    judgeResponse: (request: LlmJudgeResponseRequest) => Promise<LlmJudgeResponseResult>
  }
}
