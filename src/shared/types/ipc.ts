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

export interface SttTranscriptEvent {
  text: string
  isFinal: boolean
}

export interface LlmJudgeResponseRequest {
  question: string
  answer: string
}

export interface LlmJudgeResponseResult {
  score: number
  reason: string
}

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
